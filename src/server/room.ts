import { WebSocket } from 'ws';
import {
  ClientMessage, ServerMessage,
  RoomCreatedMsg, RoomJoinedMsg, OpponentJoinedMsg, OpponentLeftMsg,
  CountdownMsg, InputMsg,
} from '../shared/protocol';
import { COUNTDOWN_SECONDS, ARENA_WIDTH } from '../shared/constants';
import { ServerPlayer } from './player-sim';
import { GameLoop } from './game-loop';

type RoomState = 'waiting' | 'countdown' | 'playing' | 'finished';

interface ClientSlot {
  ws: WebSocket;
  name: string;
}

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const rooms = new Map<string, Room>();

export function createRoom(ws: WebSocket, name: string): Room {
  let id: string;
  do { id = generateRoomId(); } while (rooms.has(id));

  const room = new Room(id);
  rooms.set(id, room);
  room.addPlayer(ws, name);
  return room;
}

export function joinRoom(ws: WebSocket, roomId: string, name: string): Room | null {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) return null;
  if (!room.addPlayer(ws, name)) return null;
  return room;
}

export function findRoomByWs(ws: WebSocket): Room | undefined {
  for (const room of rooms.values()) {
    if (room.hasClient(ws)) return room;
  }
  return undefined;
}

export function removeFromRoom(ws: WebSocket): void {
  for (const room of rooms.values()) {
    room.removePlayer(ws);
  }
}

export class Room {
  id: string;
  private state: RoomState = 'waiting';
  private clients: (ClientSlot | null)[] = [null, null];
  private gameLoop: GameLoop | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string) {
    this.id = id;
  }

  hasClient(ws: WebSocket): boolean {
    return this.clients.some(c => c?.ws === ws);
  }

  addPlayer(ws: WebSocket, name: string): boolean {
    if (this.state !== 'waiting') return false;

    const slot = this.clients[0] === null ? 0 : this.clients[1] === null ? 1 : -1;
    if (slot === -1) return false;

    this.clients[slot] = { ws, name };

    if (slot === 0) {
      const msg: RoomCreatedMsg = { type: 'room_created', roomId: this.id, playerId: 0 };
      this.sendRaw(ws, msg);
    } else {
      // Notify joiner
      const joinMsg: RoomJoinedMsg = {
        type: 'room_joined', roomId: this.id, playerId: 1,
        opponent: this.clients[0]!.name,
      };
      this.sendRaw(ws, joinMsg);

      // Notify creator
      const opponentMsg: OpponentJoinedMsg = { type: 'opponent_joined', opponent: name };
      this.sendRaw(this.clients[0]!.ws, opponentMsg);

      // Start countdown
      this.startCountdown();
    }

    return true;
  }

  removePlayer(ws: WebSocket): void {
    const idx = this.clients.findIndex(c => c?.ws === ws);
    if (idx === -1) return;

    this.clients[idx] = null;

    if (this.state === 'playing' || this.state === 'countdown') {
      this.gameLoop?.stop();
      this.gameLoop = null;
      this.state = 'finished';

      const other = this.clients[1 - idx];
      if (other) {
        const msg: OpponentLeftMsg = { type: 'opponent_left' };
        this.sendRaw(other.ws, msg);
      }
    }

    // Schedule cleanup if empty
    if (!this.clients[0] && !this.clients[1]) {
      this.scheduleCleanup(5000);
    } else {
      this.scheduleCleanup(30000);
    }
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.type === 'input' && this.state === 'playing') {
      const idx = this.clients.findIndex(c => c?.ws === ws);
      if (idx === -1) return;
      const input = msg as InputMsg;
      const players = this.getPlayers();
      if (players) {
        players[idx].inputQueue.push({
          seq: input.seq,
          input: { dx: input.dx, dz: input.dz, tag: input.tag },
        });
      }
    }
  }

  broadcast(msg: ServerMessage): void {
    for (const client of this.clients) {
      if (client) this.sendRaw(client.ws, msg);
    }
  }

  sendTo(playerIdx: number, msg: ServerMessage): void {
    const client = this.clients[playerIdx];
    if (client) this.sendRaw(client.ws, msg);
  }

  onGameOver(): void {
    this.state = 'finished';
    this.scheduleCleanup(30000);
  }

  private getPlayers(): [ServerPlayer, ServerPlayer] | null {
    return this.gameLoop ? (this.gameLoop as any).players : null;
  }

  private startCountdown(): void {
    this.state = 'countdown';
    let seconds = COUNTDOWN_SECONDS;

    const tick = () => {
      if (this.state !== 'countdown') return;

      const msg: CountdownMsg = { type: 'countdown', seconds };
      this.broadcast(msg);

      if (seconds <= 0) {
        this.startGame();
        return;
      }
      seconds--;
      setTimeout(tick, 1000);
    };

    tick();
  }

  private startGame(): void {
    this.state = 'playing';

    const spawnX = ARENA_WIDTH / 4;
    const p1 = new ServerPlayer(this.clients[0]!.name, -spawnX, 0);
    const p2 = new ServerPlayer(this.clients[1]!.name, spawnX, 0);

    this.gameLoop = new GameLoop(this, [p1, p2]);
    this.gameLoop.start();
  }

  private sendRaw(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private scheduleCleanup(ms: number): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      this.gameLoop?.stop();
      rooms.delete(this.id);
    }, ms);
  }
}
