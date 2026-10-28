import { WebSocket } from 'ws';
import type { ClientMessage, GameMode, LobbyPlayer, ServerMessage, Standing } from '../shared/protocol';
import { CHARACTERS, MAX_PLAYERS } from '../shared/constants';
import { Match } from './match';

const ADJECTIVES = ['Sneaky', 'Zippy', 'Sly', 'Jolly', 'Turbo', 'Fuzzy', 'Dizzy', 'Lucky', 'Sassy', 'Brave', 'Bouncy', 'Shifty'];

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const rooms = new Map<string, Room>();
const roomOf = new Map<WebSocket, Room>();

export function createRoom(ws: WebSocket, practice: boolean, mode: GameMode): Room {
  let id: string;
  do { id = generateRoomId(); } while (rooms.has(id));
  const room = new Room(id, practice);
  room.mode = mode;
  rooms.set(id, room);
  room.join(ws);
  if (practice) room.startPractice();
  return room;
}

export function joinRoom(ws: WebSocket, roomId: string): Room | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room || !room.join(ws)) return null;
  return room;
}

export function findRoom(ws: WebSocket): Room | undefined {
  return roomOf.get(ws);
}

export function leaveRoom(ws: WebSocket): void {
  roomOf.get(ws)?.leave(ws);
}

export class Room {
  private roster: LobbyPlayer[] = [];
  private sockets = new Map<number, WebSocket>();
  private match: Match | null = null;
  private lastStandings?: Standing[];
  private nextId = 1;
  private cleanup: ReturnType<typeof setTimeout> | null = null;
  mode: GameMode = 'hns';

  constructor(readonly id: string, readonly practice: boolean) {}

  join(ws: WebSocket): boolean {
    if (this.roster.length >= MAX_PLAYERS) {
      // Make room by dropping a bot if one is there
      const bot = this.roster.findLast(p => p.bot);
      if (!bot || this.match) return false;
      this.roster = this.roster.filter(p => p !== bot);
    }
    const p = this.newPlayer(false);
    this.roster.push(p);
    this.sockets.set(p.id, ws);
    roomOf.set(ws, this);
    if (this.cleanup) { clearTimeout(this.cleanup); this.cleanup = null; }
    this.sendTo(p.id, { type: 'welcome', roomId: this.id, playerId: p.id, practice: this.practice });
    if (this.match) {
      // Late join: spectate until the next round assigns a team
      const mp = this.match.addPlayer(p);
      if (this.match.mode === 'hns') {
        const live = this.match.players.filter(q => q.connected);
        mp.role = live.filter(q => q.role === 'seeker').length * 2 < live.length - 1 ? 'seeker' : 'hider';
      }
      this.sendTo(p.id, { type: 'match_start', roster: this.roster, rounds: 0, mode: this.match.mode });
    }
    this.broadcastLobby();
    return true;
  }

  leave(ws: WebSocket): void {
    const id = [...this.sockets].find(([, s]) => s === ws)?.[0];
    roomOf.delete(ws);
    if (id === undefined) return;
    this.sockets.delete(id);
    this.roster = this.roster.filter(p => p.id !== id);
    this.match?.removePlayer(id);
    if (this.sockets.size === 0) {
      this.match?.stop();
      this.match = null;
      this.cleanup = setTimeout(() => rooms.delete(this.id), 5000);
      return;
    }
    this.broadcastLobby();
    if (!this.match) this.maybeStart(); // the last unready player may have just left
  }

  handle(ws: WebSocket, msg: ClientMessage): void {
    const id = [...this.sockets].find(([, s]) => s === ws)?.[0];
    if (id === undefined) return;
    const me = this.roster.find(p => p.id === id)!;

    switch (msg.type) {
      case 'input':
        if (!Number.isFinite(msg.seq)) return;
        this.match?.pushInput(id, msg.seq, {
          mx: clamp1(msg.mx), mz: clamp1(msg.mz), b: (Number(msg.b) || 0) & 7,
        });
        break;
      case 'profile':
        if (this.match) return;
        if (typeof msg.name === 'string' && msg.name.trim()) me.name = msg.name.trim().slice(0, 16);
        if (Number.isInteger(msg.character)) me.character = ((msg.character! % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
        this.broadcastLobby();
        break;
      case 'mode':
        if (this.match || (msg.mode !== 'hns' && msg.mode !== 'dm')) return;
        if (msg.mode !== this.mode) for (const p of this.roster) if (!p.bot) p.ready = false; // ready for these rules only
        this.mode = msg.mode;
        this.broadcastLobby();
        break;
      case 'ready':
        if (this.match) return;
        me.ready = !me.ready;
        this.broadcastLobby();
        this.maybeStart();
        break;
      case 'add_bot':
        if (this.match || this.roster.length >= MAX_PLAYERS) return;
        this.roster.push(this.newPlayer(true));
        this.broadcastLobby();
        this.maybeStart();
        break;
      case 'remove_bot': {
        if (this.match) return;
        const bot = this.roster.findLast(p => p.bot);
        if (bot) this.roster = this.roster.filter(p => p !== bot);
        this.broadcastLobby();
        break;
      }
    }
  }

  startPractice(): void {
    while (this.roster.length < 6) this.roster.push(this.newPlayer(true));
    this.startMatch();
  }

  private newPlayer(bot: boolean): LobbyPlayer {
    const used = new Set(this.roster.map(p => p.character));
    const free = CHARACTERS.map((_, i) => i).filter(i => !used.has(i));
    const character = free.length ? pick(free) : Math.floor(Math.random() * CHARACTERS.length);
    return {
      id: this.nextId++,
      name: `${pick(ADJECTIVES)} ${CHARACTERS[character]}`,
      character,
      ready: bot,
      bot,
    };
  }

  private maybeStart(): void {
    const humans = this.roster.filter(p => !p.bot);
    if (this.roster.length >= 2 && humans.length > 0 && humans.every(p => p.ready)) this.startMatch();
  }

  private startMatch(): void {
    for (const p of this.roster) if (!p.bot) p.ready = false;
    this.match = new Match({
      send: (pid, msg) => this.sendTo(pid, msg),
      onMatchEnd: standings => {
        this.match = null;
        this.lastStandings = standings;
        this.broadcastLobby();
      },
    }, this.roster, this.mode);
    this.broadcastAll({ type: 'match_start', roster: this.roster, rounds: 0, mode: this.mode });
    this.match.start();
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    this.broadcastAll({ type: 'lobby', players: this.roster, inMatch: !!this.match, mode: this.mode, lastStandings: this.lastStandings });
  }

  private broadcastAll(msg: ServerMessage): void {
    for (const id of this.sockets.keys()) this.sendTo(id, msg);
  }

  private sendTo(id: number, msg: ServerMessage): void {
    const ws = this.sockets.get(id);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}

function clamp1(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-1, Math.min(1, n));
}
