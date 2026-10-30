// One match: rounds, phases, combat, grenades. Two modes:
// - Tag plays like CS 1.6 Hide 'n Seek (HNS), which is really a game of tag. Everyone is visible; runners get a
//   head start and survive by running, jumping gaps and throwing grenades. See README "Rules".
// - Deathmatch: same teams and kit, no rounds. Catch a runner and you swap sides; they respawn as a
//   tagger. Points for catches, drops and time survived; most points when the clock runs out.
import {
  TICK_DT, SNAPSHOT_EVERY, PLAYER_RADIUS, EYE_HEIGHT, SAFE_FALL_SPEED, FATAL_FALL_SPEED, KILL_Y, MAX_HP,
  STAB_RANGE, STAB_ARC_COS, STAB_DAMAGE, STAB_HEIGHT, UNLAG_MAX_TICKS, UNLAG_NOW_SLACK,
  NADE_KINDS, NADE_LOADOUT, NADE_REFILL_EVERY, NADE_FUSE, NADE_THROW_SPEED, NADE_THROW_UP, NADE_GRAVITY,
  NADE_MIN_CHARGE, NADE_CHARGE_TIME, FROST_RADIUS, FROST_TIME, CHILL_RADIUS, CHILL_TIME, FLASH_RADIUS,
  FLASH_TIME,
  HEAD_START, ROUND_END_TIME, ROUNDS_PER_MATCH, DM_TIME, RESPAWN_TIME, SPAWN_PROTECTION, SWAP_PROTECTION, SURVIVE_POINT_EVERY,
  STOMP_STUN, PLANK_CRACK_TIME, PLANK_FIX_TIME, type NadeKind,
} from '../shared/constants';
import { TAGGER_SPAWNS, RUNNER_SPAWNS, FULL_MAP, mapFor, roundTimeFor, type GameMap } from '../shared/map';
import { newBody, stepBody, BTN_ACTION, BTN_FLASH, BTN_FROST, type Body, type Dyn, type Input, type Role, type Status } from '../shared/sim';
import type {
  GameEvent, GameMode, KillCause, LobbyPlayer, NetPlayer, NetProjectile, Phase, ServerMessage, Snapshot, Standing,
} from '../shared/protocol';
import { Brain } from './bots';

const INPUT_BANK = 60; // ticks of input a player can catch up on after a stall (1s)
const STALL_TICKS = 15; // no input this long (250ms): carry on without them (gravity, planks)

export interface MatchHost {
  send(playerId: number, msg: ServerMessage): void;
  onMatchEnd(standings: Standing[]): void;
}

export interface MPlayer {
  id: number;
  name: string;
  character: number;
  bot: boolean;
  connected: boolean;
  body: Body;
  input: Input;
  queue: { seq: number; input: Input; v?: number }[];
  viewTick: number; // tick the client was showing others at for the input being run
  lastSeq: number; // newest input seq queued (inputs can arrive more than once over UDP)
  hist: { t: number; x: number; y: number; z: number; alive: boolean }[]; // recent positions, for rewinds
  ack: number;
  credit: number; // inputs this player may still run: +1 per tick, banked up to INPUT_BANK
  waitT: number; // ticks since an input last arrived
  owed: number; // ticks we ran without them (a long stall); that many late inputs get skipped
  net: { dropped: number; waited: number }; // input trouble so far (net bench / netgraph)
  role: Role;
  hp: number;
  alive: boolean;
  frozen: number;
  chilled: number;
  blind: number;
  nades: Record<NadeKind, number>;
  aimKind: NadeKind; // the grenade being aimed (J: flash, K: frost)
  aimT: number; // grenade charge time, -1 when not aiming
  stabPending: boolean;
  shovedBy: number; // last opponent to knock us around, for crediting falls
  shovedT: number;
  respawnT: number; // deathmatch: seconds until back in, 0 = not waiting
  prot: number; // deathmatch spawn protection left
  survT: number; // deathmatch: time alive as a runner since the last survival point
  nadeT: number; // chase time alive while missing a grenade (one comes back every NADE_REFILL_EVERY)
  stun: number; // dizzy from a head stomp: can't move
  plankFallT: number; // just dropped through a collapsing plank (not their fault)
  score: number;
  kills: number;
  survived: number;
  brain: Brain | null;
}

interface Projectile {
  id: number;
  kind: NadeKind;
  owner: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number;
}

const NO_NADES = (): Record<NadeKind, number> => ({ flash: 0, frost: 0 });

export class Match {
  players: MPlayer[] = [];
  phase: Phase = 'start';
  timeLeft = HEAD_START;
  round = 0;
  tick = 0;
  private swapPending = false;
  // Weak planks (per map.bridges): 0 solid, 1 cracking, 2 collapsed; t = time left in that state
  private planks: { state: 0 | 1 | 2; t: number }[] = [];
  broken = new Set<number>(); // collapsed planks (bots route around them)
  private projectiles: Projectile[] = [];
  private events: GameEvent[] = [];
  private nextId = 1;
  private interval: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;

  readonly map: GameMap;

  constructor(private host: MatchHost, roster: LobbyPlayer[], readonly mode: GameMode = 'tag', roofs?: number[]) {
    this.map = roofs ? mapFor(roofs) : FULL_MAP;
    this.resetPlanks();
    for (const p of roster) this.addPlayer(p);
  }

  /** Who can hurt whom: the other team, in both modes. */
  private enemies(a: MPlayer, b: MPlayer): boolean {
    return a !== b && a.role !== b.role;
  }

  addPlayer(p: LobbyPlayer): MPlayer {
    const mp: MPlayer = {
      id: p.id, name: p.name, character: p.character, bot: p.bot, connected: true,
      body: newBody(this.map, 0, 0), input: { mx: 0, mz: 0, b: 0 }, queue: [], viewTick: 0, lastSeq: 0, hist: [], ack: 0, credit: 0, waitT: 0, owed: 0, net: { dropped: 0, waited: 0 },
      role: 'runner', hp: MAX_HP, alive: false, frozen: 0, chilled: 0, blind: 0,
      nades: NO_NADES(), aimKind: 'flash', aimT: -1, stabPending: false, shovedBy: 0, shovedT: 0,
      respawnT: 0, prot: 0, survT: 0, nadeT: 0, stun: 0, plankFallT: 0, score: 0, kills: 0, survived: 0, brain: p.bot ? new Brain() : null,
    };
    this.players.push(mp);
    // Joining a running deathmatch: drop into the smaller team after a short beat
    if (this.mode === 'dm' && this.round > 0) {
      const live = this.active().filter(q => q !== mp);
      mp.role = live.filter(q => q.role === 'tagger').length * 2 < live.length ? 'tagger' : 'runner';
      mp.respawnT = 1;
    }
    return mp;
  }

  removePlayer(id: number): void {
    const p = this.players.find(q => q.id === id);
    if (!p) return;
    // Keep their score on the board but take them out of play
    p.connected = false;
    p.alive = false;
  }

  start(): void {
    this.startRound(true);
    this.last = performance.now();
    this.interval = setInterval(() => this.frame(), 4);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  pushInput(id: number, seq: number, input: Input, v?: number): void {
    const p = this.players.find(q => q.id === id);
    if (!p || seq <= p.ack || seq <= p.lastSeq) return; // old, or a redundant copy
    p.lastSeq = seq;
    p.queue.push({ seq, input, v });
  }

  private frame(): void {
    const now = performance.now();
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= TICK_DT * 1000) {
      this.acc -= TICK_DT * 1000;
      this.step();
    }
  }

  // ── Rounds ──────────────────────────────────────────────────────────────

  active(): MPlayer[] {
    return this.players.filter(p => p.connected);
  }

  private startRound(first: boolean): void {
    this.round++;
    const ps = this.active();
    if (first) {
      // Roughly even teams, like a CS server autobalance; taggers are the smaller side
      const shuffled = [...ps].sort(() => Math.random() - 0.5);
      const taggers = Math.max(1, Math.floor(ps.length / 2));
      shuffled.forEach((p, i) => { p.role = i < taggers ? 'tagger' : 'runner'; });
    } else {
      if (this.swapPending) for (const p of this.players) p.role = p.role === 'tagger' ? 'runner' : 'tagger';
      this.swapPending = false;
      // Balance late joiners into the smaller team
      const nS = ps.filter(p => p.role === 'tagger').length;
      const nH = ps.length - nS;
      if (nS === 0 && ps.length > 0) ps[0].role = 'tagger';
      if (nH === 0 && ps.length > 1) ps[ps.length - 1].role = 'runner';
    }

    let si = 0, hi = 0;
    const runnerSpots = [...RUNNER_SPAWNS].sort(() => Math.random() - 0.5);
    for (const p of ps) {
      const [x, z] = p.role === 'tagger'
        ? TAGGER_SPAWNS[si++ % TAGGER_SPAWNS.length]
        : runnerSpots[hi++ % runnerSpots.length];
      p.body = newBody(this.map, x, z);
      p.body.facing = p.role === 'tagger' ? Math.PI : 0;
      p.hp = MAX_HP;
      p.alive = true;
      p.frozen = p.chilled = p.blind = 0;
      p.nades = p.role === 'runner' ? { ...NADE_LOADOUT } : NO_NADES();
      p.nadeT = 0;
      p.aimT = -1;
      p.stabPending = false;
      p.queue = []; // (lastSeq stays: inputs still in flight from the old round are dropped)
      p.brain?.reset();
    }
    this.projectiles = [];
    this.resetPlanks();
    this.phase = 'start';
    this.timeLeft = HEAD_START;

    const roles: Record<number, Role> = {};
    for (const p of ps) roles[p.id] = p.role;
    this.broadcast({ type: 'round_start', round: this.round, roles });
  }

  private endRound(winner: Role): void {
    this.phase = 'end';
    this.timeLeft = ROUND_END_TIME;
    this.projectiles = []; // nothing in flight may hurt anyone after the result
    if (winner === 'runner') {
      // hns_hiders_alivefrags: every surviving runner scores
      for (const p of this.active()) {
        if (p.role === 'runner' && p.alive) { p.score += 1; p.survived += 1; }
      }
    }
    const swap = winner === 'tagger';
    this.broadcast({ type: 'round_end', round: this.round, winner, swap, standings: this.standings() });
    this.swapPending = swap;
  }

  /** Deathmatch respawn on the roof spot farthest from everyone still alive, with the team's kit. */
  private spawn(p: MPlayer, announce: boolean): void {
    const others = this.active().filter(q => q.alive && q !== p);
    let best: [number, number] = [0, 0], bestD = -1;
    for (let i = 0; i < 24; i++) {
      const b = this.map.buildings[Math.floor(Math.random() * this.map.buildings.length)];
      const x = b.x0 + 1 + Math.random() * (b.x1 - b.x0 - 2), z = b.z0 + 1 + Math.random() * (b.z1 - b.z0 - 2);
      if (Math.abs(this.map.heightAt(x, z) - b.h) > 0.01 || this.map.props.some(pr => Math.abs(pr.x - x) < pr.w / 2 + 0.6 && Math.abs(pr.z - z) < pr.d / 2 + 0.6)) continue;
      const d = others.length ? Math.min(...others.map(q => Math.hypot(q.body.x - x, q.body.z - z))) : Math.random();
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    p.body = newBody(this.map, best[0], best[1]);
    p.body.facing = Math.random() * Math.PI * 2;
    p.hp = MAX_HP;
    p.alive = true;
    p.frozen = p.chilled = p.blind = 0;
    p.nades = p.role === 'runner' ? { ...NADE_LOADOUT } : NO_NADES();
    p.aimT = -1;
    p.stabPending = false;
    p.respawnT = 0;
    p.survT = 0;
    p.nadeT = 0;
    p.prot = SPAWN_PROTECTION;
    p.brain?.reset();
    if (announce) this.events.push({ k: 'spawn', id: p.id, x: p.body.x, y: p.body.y, z: p.body.z });
  }

  standings(): Standing[] {
    return this.players
      .map(p => ({ id: p.id, name: p.name, character: p.character, score: p.score, kills: p.kills, survived: p.survived }))
      .sort((a, b) => b.score - a.score);
  }

  // ── Tick ────────────────────────────────────────────────────────────────

  private step(): void {
    this.tick++;
    this.timeLeft -= TICK_DT;

    if (this.phase === 'start' && this.timeLeft <= 0) {
      this.phase = 'chase';
      this.timeLeft = this.mode === 'dm' ? DM_TIME : roundTimeFor(this.map);
    }

    for (const p of this.active()) this.stepPlayer(p);
    // Where everyone was this tick, for checking slashes against an attacker's (older) view
    for (const p of this.players) {
      p.hist.push({ t: this.tick, x: p.body.x, y: p.body.y, z: p.body.z, alive: p.alive });
      if (p.hist.length > UNLAG_MAX_TICKS + 4) p.hist.shift();
    }
    this.stepPlanks();
    this.stepProjectiles();
    if (this.phase === 'chase') this.refillNades();

    if (this.mode === 'dm') {
      // Runners earn points just for staying alive
      if (this.phase === 'chase') {
        for (const p of this.active()) {
          if (p.role !== 'runner' || !p.alive) continue;
          if ((p.survT += TICK_DT) >= SURVIVE_POINT_EVERY) { p.survT -= SURVIVE_POINT_EVERY; p.score += 1; p.survived += 1; }
        }
      }
      if (this.phase === 'chase' && this.timeLeft <= 0) {
        this.phase = 'end';
        this.timeLeft = ROUND_END_TIME;
        this.projectiles = [];
      } else if (this.phase === 'end' && this.timeLeft <= 0) {
        this.stop();
        const standings = this.standings();
        this.broadcast({ type: 'match_end', standings });
        this.host.onMatchEnd(standings);
        return;
      }
    } else if (this.phase === 'chase') {
      const ps = this.active();
      const runnersAlive = ps.filter(p => p.role === 'runner' && p.alive).length;
      const taggersAlive = ps.filter(p => p.role === 'tagger' && p.alive).length;
      if (runnersAlive === 0) this.endRound('tagger');
      else if (taggersAlive === 0 || this.timeLeft <= 0) this.endRound('runner');
    } else if (this.phase === 'end' && this.timeLeft <= 0) {
      if (this.round >= ROUNDS_PER_MATCH || this.active().filter(p => !p.bot).length === 0) {
        this.stop();
        const standings = this.standings();
        this.broadcast({ type: 'match_end', standings });
        this.host.onMatchEnd(standings);
        return;
      }
      this.startRound(false);
    }

    if (this.events.length) {
      this.broadcast({ type: 'ev', tick: this.tick, events: this.events });
      this.events = [];
    }
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  private status(p: MPlayer): Status {
    return {
      role: p.role,
      frozen: p.frozen > 0 || p.stun > 0, // frozen solid, or dizzy from a stomp
      chilled: p.chilled > 0,
      locked: !p.alive || this.phase === 'end' || (this.phase === 'start' && p.role === 'tagger'),
    };
  }

  private stepPlayer(p: MPlayer): void {
    p.frozen = Math.max(0, p.frozen - TICK_DT);
    p.chilled = Math.max(0, p.chilled - TICK_DT);
    p.blind = Math.max(0, p.blind - TICK_DT);
    p.shovedT = Math.max(0, p.shovedT - TICK_DT);
    p.prot = Math.max(0, p.prot - TICK_DT);
    p.stun = Math.max(0, p.stun - TICK_DT);
    p.plankFallT = Math.max(0, p.plankFallT - TICK_DT);
    if (!p.alive && p.respawnT > 0 && this.phase !== 'end' && (p.respawnT -= TICK_DT) <= 0) this.spawn(p, true);
    if (!p.alive || this.phase === 'end') {
      // Freeze the scene on the round result; the client doesn't step either, so just ack
      for (const q of p.queue) p.ack = q.seq;
      p.queue = [];
      return;
    }

    if (p.bot) { p.viewTick = this.tick; this.runInput(p, p.brain!.think(this, p)); return; }
    // Humans: run every input that arrived, in order, each exactly once, so the client's
    // prediction (which ran the same inputs) agrees. Nothing arrived: wait, don't guess.
    // Late inputs bank credit, so a burst after a network stall is caught up at once, but
    // a client can't run faster than real time for more than INPUT_BANK ticks.
    p.credit = Math.min(INPUT_BANK, p.credit + 1);
    if (p.queue.length && p.owed > 0) {
      // Input again after a stall we stood in for. A backlog that piled up during it is late
      // for the ticks we already ran: skip that many of the oldest, but never the newest (a
      // client that simply wasn't sending, like a background tab, has no backlog to skip)
      for (let k = Math.min(p.owed, p.queue.length - 1); k > 0; k--) { p.ack = p.queue.shift()!.seq; p.net.dropped++; }
      p.owed = 0;
    }
    while (p.queue.length > INPUT_BANK * 2) { p.ack = p.queue.shift()!.seq; p.net.dropped++; } // hopeless backlog
    if (!p.queue.length) {
      p.net.waited++;
      // A long stall (or a backgrounded tab): don't let them hang in the air or on a broken
      // plank; stand still for them (and skip a backlog of that size when it turns up, above)
      if (++p.waitT > STALL_TICKS && p.credit >= 1) {
        p.credit--;
        p.owed = Math.min(INPUT_BANK, p.owed + 1);
        this.runInput(p, { mx: 0, mz: 0, b: 0 });
      }
      return;
    }
    p.waitT = 0;
    while (p.queue.length && p.credit >= 1 && p.alive) {
      const next = p.queue.shift()!;
      p.credit--;
      p.ack = next.seq;
      p.input = next.input;
      p.viewTick = next.v ?? this.tick;
      this.runInput(p, next.input);
    }
  }

  /** One input's worth of movement and actions (one 60Hz client tick). */
  private runInput(p: MPlayer, input: Input): void {
    const st = this.status(p);
    const ev = stepBody(this.map, p.body, input, st, TICK_DT, this.dynFor(p));
    if (ev.stomped !== null) this.stomp(p, ev.stomped);
    const canAct = !st.locked && !st.frozen;

    if (ev.lunged) {
      p.stabPending = true;
      this.events.push({ k: 'stab', by: p.id });
    }
    if (p.stabPending) {
      if (p.body.lunge > 0) this.tryStab(p);
      else p.stabPending = false;
    }

    // Runner grenades: J (FLASH) or K (FROST) held to charge, let go to throw. Asking for one
    // you're out of does nothing (no surprise throw of the other kind)
    if (p.role === 'runner') {
      if (canAct && (ev.pressed & BTN_ACTION)) {
        const want: NadeKind = input.b & BTN_FROST ? 'frost' : 'flash';
        if (p.nades[want] > 0) { p.aimKind = want; p.aimT = 0; }
      }
      if (p.aimT >= 0) {
        if (!canAct) p.aimT = -1;
        else if (input.b & BTN_ACTION) p.aimT += TICK_DT;
        else {
          this.throwNade(p, Math.min(1, NADE_MIN_CHARGE + (p.aimT / NADE_CHARGE_TIME) * (1 - NADE_MIN_CHARGE)));
          p.aimT = -1;
        }
      }
    }

    // Fall damage on big drops
    if (ev.landed > SAFE_FALL_SPEED) {
      const dmg = ((ev.landed - SAFE_FALL_SPEED) / (FATAL_FALL_SPEED - SAFE_FALL_SPEED)) * MAX_HP;
      this.damage(p, dmg, this.shover(p), 'fall', 0, 0);
    }
    if (p.alive && p.body.y < KILL_Y) this.kill(p, this.shover(p), 'void', 0, 0);
  }

  /** Runners who stay alive get their grenades back, one every NADE_REFILL_EVERY seconds, up to the loadout. */
  private refillNades(): void {
    for (const p of this.active()) {
      if (p.role !== 'runner' || !p.alive) continue;
      const missing = NADE_KINDS.filter(k => p.nades[k] < NADE_LOADOUT[k]);
      if (!missing.length) { p.nadeT = 0; continue; }
      if ((p.nadeT += TICK_DT) < NADE_REFILL_EVERY) continue;
      p.nadeT = 0;
      // The kind we're shortest of, relative to the kit (frost on a tie: it's the rarer one)
      const kind = missing.sort((a, b) => p.nades[a] / NADE_LOADOUT[a] - p.nades[b] / NADE_LOADOUT[b] || (a === 'frost' ? -1 : 1))[0];
      p.nades[kind]++;
      this.events.push({ k: 'refill', id: p.id, kind });
    }
  }

  /** Whoever knocked this player around in the last few seconds gets credit for their fall. */
  private shover(p: MPlayer): MPlayer | null {
    if (p.shovedT <= 0) return null;
    return this.players.find(q => q.id === p.shovedBy && this.enemies(q, p)) ?? null;
  }

  private throwNade(p: MPlayer, charge: number): void {
    const kind = p.aimKind;
    if (p.nades[kind] <= 0) return;
    p.nades[kind]--;
    const fx = Math.sin(p.body.facing), fz = Math.cos(p.body.facing);
    this.projectiles.push({
      id: this.nextId++, kind, owner: p.id,
      x: p.body.x + fx * 0.4, y: p.body.y + 0.9, z: p.body.z + fz * 0.4,
      vx: fx * NADE_THROW_SPEED * charge + p.body.vx * 0.5,
      vy: NADE_THROW_UP * (0.6 + 0.4 * charge) + Math.max(0, p.body.vy) * 0.5,
      vz: fz * NADE_THROW_SPEED * charge + p.body.vz * 0.5,
      t: 0,
    });
    this.events.push({ k: 'throw', by: p.id, kind });
  }

  /**
   * Where a player was at (fractional) tick v, from the history; v is clamped to the last
   * UNLAG_MAX_TICKS. Null if they weren't alive then.
   */
  private rewound(t: MPlayer, v: number): { x: number; y: number; z: number } | null {
    v = Math.max(this.tick - UNLAG_MAX_TICKS, Math.min(this.tick, v));
    const h = t.hist;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t > v) continue;
      if (!a.alive || !b.alive) return null;
      const k = b.t > a.t ? Math.min(1, (v - a.t) / (b.t - a.t)) : 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    }
    return t.alive ? t.body : null;
  }

  private tryStab(p: MPlayer): void {
    const fx = Math.sin(p.body.facing), fz = Math.cos(p.body.facing);
    for (const t of this.active()) {
      if (!t.alive || !this.enemies(p, t) || t.prot > 0) continue; // spawn protection: no hit, no knockback
      // Lag compensation: judge the slash against where the attacker saw the target...
      const at = this.rewound(t, p.viewTick);
      if (!at) continue;
      const dx = at.x - p.body.x, dz = at.z - p.body.z;
      const d = Math.hypot(dx, dz);
      if (d > STAB_RANGE + PLAYER_RADIUS * 2 || Math.abs(at.y - p.body.y) > 1.2) continue; // range = gap between bodies
      if (d > 0.3 && (dx * fx + dz * fz) / d < STAB_ARC_COS) continue;
      // ...but someone who has really got away (on the server, now) can't be reached back in time
      if (Math.hypot(t.body.x - p.body.x, t.body.z - p.body.z) > STAB_RANGE + PLAYER_RADIUS * 2 + UNLAG_NOW_SLACK) continue;
      // No slashing through walls, hedges, crates or huts
      if (!this.map.lineOfSight(p.body.x, p.body.y + STAB_HEIGHT, p.body.z, at.x, at.y + STAB_HEIGHT, at.z)) continue;
      if (!this.map.lineOfSight(p.body.x, p.body.y + STAB_HEIGHT, p.body.z, t.body.x, t.body.y + STAB_HEIGHT, t.body.z)) continue;
      p.stabPending = false;
      this.damage(t, STAB_DAMAGE, p, 'stab', fx, fz); // one hit kills
      // Knock the victim along the swing so hits read clearly
      t.body.vx += fx * 6; t.body.vz += fz * 6;
      t.shovedBy = p.id; t.shovedT = 3;
      return;
    }
  }

  private damage(t: MPlayer, dmg: number, by: MPlayer | null, cause: Exclude<KillCause, 'void'>, dx: number, dz: number): void {
    if (!t.alive || t.prot > 0) return;
    t.hp -= dmg;
    if (t.hp <= 0) this.kill(t, by, cause, dx, dz);
    else this.events.push({ k: 'hurt', id: t.id, hp: Math.round(t.hp), cause });
  }

  private kill(t: MPlayer, by: MPlayer | null, cause: KillCause, dx: number, dz: number): void {
    t.alive = false;
    t.hp = 0;
    t.aimT = -1;
    if (by && this.enemies(by, t)) { by.score += 1; by.kills += 1; }
    if (this.mode === 'dm') {
      if (!by && (cause === 'fall' || cause === 'void') && t.plankFallT <= 0) t.score -= 1; // CS-style suicide penalty (not for planks giving way)
      if (by && by.role === 'tagger' && t.role === 'runner') {
        // HNS deathmatch swap: the catcher runs now, the caught one hunts after respawning
        by.role = 'runner';
        by.nades = { ...NADE_LOADOUT };
        by.prot = SWAP_PROTECTION;
        by.survT = 0;
        by.nadeT = 0;
        by.stabPending = false;
        by.brain?.reset();
        t.role = 'tagger';
      }
      t.respawnT = RESPAWN_TIME;
    }
    this.events.push({
      k: 'kill', id: t.id, by: by?.id ?? null, cause,
      x: t.body.x, y: t.body.y, z: t.body.z, dx, dz,
    });
  }

  /** Other living players as solid bodies for this player's physics step (plus collapsed planks). */
  private dynFor(p: MPlayer): Dyn {
    return {
      bodies: this.active().filter(q => q !== p && q.alive).map(q => ({ id: q.id, x: q.body.x, y: q.body.y, z: q.body.z, role: q.role })),
      broken: this.broken,
    };
  }

  /** Landing on an enemy's head: they're dizzy for a moment (the stomper already bounced in the sim). */
  private stomp(by: MPlayer, id: number): void {
    const v = this.players.find(q => q.id === id);
    if (!v || !v.alive || v.prot > 0 || !this.enemies(by, v)) return;
    v.stun = STOMP_STUN;
    v.stabPending = false;
    v.shovedBy = by.id; v.shovedT = 3; // if they stumble off a roof dizzy, the stomper gets it
    this.events.push({ k: 'stomp', by: by.id, id, x: v.body.x, y: v.body.y + 1, z: v.body.z });
  }

  private resetPlanks(): void {
    this.planks = this.map.bridges.map(() => ({ state: 0 as const, t: 0 }));
    this.broken = new Set();
  }

  /** Weak planks crack under a player over the gap, collapse, then get rebuilt once clear. */
  private stepPlanks(): void {
    this.planks.forEach((pl, i) => {
      const br = this.map.bridges[i];
      const on = this.active().filter(p => p.alive && p.body.grounded && Math.abs(p.body.y - br.h) < 0.05
        && p.body.x >= br.x0 && p.body.x <= br.x1 && p.body.z >= br.z0 && p.body.z <= br.z1);
      if (pl.state === 0) {
        // Only weight over the gap counts (the plank ends rest on the roofs)
        const without = new Set(this.broken).add(i);
        if (on.some(p => this.map.heightAt(p.body.x, p.body.z, without) < br.h - 0.01)) { pl.state = 1; pl.t = PLANK_CRACK_TIME; }
      } else if (pl.state === 1) {
        if ((pl.t -= TICK_DT) <= 0) {
          pl.state = 2; pl.t = PLANK_FIX_TIME;
          this.broken.add(i);
          for (const p of on) p.plankFallT = 3;
        }
      } else if ((pl.t -= TICK_DT) <= 0 && on.length === 0) {
        pl.state = 0;
        this.broken.delete(i);
      }
    });
  }

  // ── Grenades ────────────────────────────────────────────────────────────

  private stepProjectiles(): void {
    this.projectiles = this.projectiles.filter(pr => {
      pr.t += TICK_DT;
      return !this.stepNade(pr);
    });
  }

  private stepNade(pr: Projectile): boolean {
    pr.vy -= NADE_GRAVITY * TICK_DT;
    const nx = pr.x + pr.vx * TICK_DT, nz = pr.z + pr.vz * TICK_DT, ny = pr.y + pr.vy * TICK_DT;
    // Walls: bounce off columns rising above the grenade
    if (this.map.heightAt(nx, pr.z) > ny) { pr.vx *= -0.5; this.bounce(pr); } else pr.x = nx;
    if (this.map.heightAt(pr.x, nz) > ny) { pr.vz *= -0.5; this.bounce(pr); } else pr.z = nz;
    const g = this.map.heightAt(pr.x, pr.z);
    if (ny <= g && pr.vy < 0) {
      pr.y = g;
      if (pr.vy < -2) this.bounce(pr);
      pr.vy = -pr.vy * 0.4;
      pr.vx *= 0.65; pr.vz *= 0.65;
    } else {
      pr.y = ny;
    }
    if (pr.y < KILL_Y) return true;
    if (pr.t >= NADE_FUSE[pr.kind]) {
      this.detonate(pr);
      return true;
    }
    return false;
  }

  private bounce(pr: Projectile): void {
    if (Math.hypot(pr.vx, pr.vy, pr.vz) > 2.5) this.events.push({ k: 'bounce', x: pr.x, y: pr.y, z: pr.z });
  }

  private detonate(pr: Projectile): void {
    const kind = pr.kind;
    const hits: number[] = [];
    const frozen: number[] = []; // frost: the direct hits (the rest were only chilled)
    const eyeY = pr.y + 0.3;
    const taggers = this.active().filter(p => p.alive && p.role === 'tagger');
    // Effects need a clear line from the blast (roof edges, tanks and booths block it)
    const reach = (p: MPlayer, r: number): number => {
      const d = Math.hypot(p.body.x - pr.x, p.body.y + EYE_HEIGHT - eyeY, p.body.z - pr.z);
      if (d > r) return -1;
      if (!this.map.lineOfSight(pr.x, eyeY, pr.z, p.body.x, p.body.y + EYE_HEIGHT, p.body.z)) return -1;
      return d;
    };
    if (kind === 'flash') {
      for (const s of taggers) {
        const d = reach(s, FLASH_RADIUS);
        if (d < 0) continue;
        s.blind = Math.max(s.blind, FLASH_TIME * (1 - (d / FLASH_RADIUS) * 0.6));
        hits.push(s.id);
      }
    } else if (kind === 'frost') {
      for (const s of taggers) {
        const d = reach(s, CHILL_RADIUS);
        if (d < 0) continue;
        // Direct hit freezes, the outer ring chills; never both (thawing doesn't leave you slowed)
        if (d <= FROST_RADIUS) {
          // Frozen mid-jump = no sideways speed, so they drop; the thrower gets the kill
          s.frozen = FROST_TIME;
          s.chilled = 0;
          s.shovedBy = pr.owner;
          s.shovedT = FROST_TIME + 2;
          frozen.push(s.id);
        } else if (s.frozen <= 0) {
          s.chilled = Math.max(s.chilled, CHILL_TIME);
        } else continue; // already frozen solid: the ring doesn't stack a chill on top
        hits.push(s.id);
      }
    }
    this.events.push({ k: 'det', kind, x: pr.x, y: pr.y, z: pr.z, hits, frozen });
  }

  // ── Snapshots ───────────────────────────────────────────────────────────

  private netPlayer(p: MPlayer): NetPlayer {
    const b = p.body;
    return {
      id: p.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), vx: r2(b.vx), vy: r2(b.vy), vz: r2(b.vz), f: r2(b.facing),
      hp: Math.round(p.hp), alive: p.alive, role: p.role, frozen: r2(p.frozen), chilled: r2(p.chilled),
      lunge: r2(b.lunge), aiming: p.aimT >= 0 ? r2(Math.min(1, p.aimT / NADE_CHARGE_TIME)) : 0,
      nade: p.aimT >= 0 ? p.aimKind : null,
      prot: p.prot > 0,
      stun: r2(p.stun),
    };
  }

  private sendSnapshots(): void {
    // Tag rules: everyone sees everyone, so one shared player/projectile list per tick
    const players = this.active().map(p => this.netPlayer(p));
    const projectiles: NetProjectile[] = this.projectiles.map(pr => ({
      id: pr.id, kind: pr.kind, x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), owner: pr.owner,
    }));
    const scores = this.players.map(p => ({ id: p.id, score: p.score, kills: p.kills }));
    for (const viewer of this.players) {
      if (viewer.bot || !viewer.connected) continue;
      const snap: Snapshot = {
        type: 'snap', tick: this.tick, phase: this.phase, timeLeft: r2(Math.max(0, this.timeLeft)), ack: viewer.ack,
        me: {
          ...viewer.body, hp: Math.round(viewer.hp), alive: viewer.alive, role: viewer.role,
          frozen: viewer.frozen, chilled: viewer.chilled, blind: viewer.blind,
          nades: viewer.nades, respawn: r2(viewer.respawnT), stun: r2(viewer.stun),
        },
        players, projectiles, scores, planks: this.planks.map(pl => pl.state),
      };
      this.host.send(viewer.id, snap);
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const p of this.players) if (!p.bot && p.connected) this.host.send(p.id, msg);
  }
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
