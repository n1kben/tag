// One match: rounds, phases, combat, grenades. Two modes:
// - Tag plays like CS 1.6 Hide 'n Seek (HNS), which is really a game of tag. Everyone is visible; runners get a
//   head start and survive by running, jumping gaps and throwing grenades. See README "Rules".
// - Deathmatch: same teams and kit, no rounds. Catch a runner and you swap sides; they respawn as a
//   tagger. Points for catches, drops and time survived; most points when the clock runs out.
import {
  TICK_DT, SNAPSHOT_EVERY, PLAYER_RADIUS, EYE_HEIGHT, SAFE_FALL_SPEED, FATAL_FALL_SPEED, KILL_Y, MAX_HP,
  STAB_RANGE, STAB_ARC_COS, STAB_DAMAGE, STAB_HEIGHT,
  NADE_KINDS, NADE_LOADOUT, NADE_FUSE, NADE_THROW_SPEED, NADE_THROW_UP, NADE_GRAVITY,
  NADE_MIN_CHARGE, NADE_CHARGE_TIME, FROST_RADIUS, FROST_TIME, CHILL_RADIUS, CHILL_TIME, FLASH_RADIUS,
  FLASH_TIME,
  HEAD_START, ROUND_END_TIME, ROUNDS_PER_MATCH, DM_TIME, RESPAWN_TIME, SPAWN_PROTECTION, SWAP_PROTECTION, SURVIVE_POINT_EVERY,
  STOMP_STUN, PLANK_CRACK_TIME, PLANK_FIX_TIME, type NadeKind,
} from '../shared/constants';
import { TAGGER_SPAWNS, RUNNER_SPAWNS, FULL_MAP, mapFor, roundTimeFor, type GameMap } from '../shared/map';
import { newBody, stepBody, BTN_ACTION, BTN_ALT, type Body, type Dyn, type Input, type Role, type Status } from '../shared/sim';
import type {
  GameEvent, GameMode, KillCause, LobbyPlayer, NetPlayer, NetProjectile, Phase, ServerMessage, Snapshot, Standing,
} from '../shared/protocol';
import { Brain } from './bots';

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
  queue: { seq: number; input: Input }[];
  ack: number;
  starved: number; // ticks without a fresh input
  net: { dropped: number; starved: number }; // input problems so far (net bench / netgraph)
  role: Role;
  hp: number;
  alive: boolean;
  frozen: number;
  chilled: number;
  blind: number;
  nades: Record<NadeKind, number>;
  nadeSel: NadeKind;
  aimT: number; // grenade charge time, -1 when not aiming
  stabPending: boolean;
  shovedBy: number; // last opponent to knock us around, for crediting falls
  shovedT: number;
  respawnT: number; // deathmatch: seconds until back in, 0 = not waiting
  prot: number; // deathmatch spawn protection left
  survT: number; // deathmatch: time alive as a runner since the last survival point
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
      body: newBody(this.map, 0, 0), input: { mx: 0, mz: 0, b: 0 }, queue: [], ack: 0, starved: 0, net: { dropped: 0, starved: 0 },
      role: 'runner', hp: MAX_HP, alive: false, frozen: 0, chilled: 0, blind: 0,
      nades: NO_NADES(), nadeSel: 'flash', aimT: -1, stabPending: false, shovedBy: 0, shovedT: 0,
      respawnT: 0, prot: 0, survT: 0, stun: 0, plankFallT: 0, score: 0, kills: 0, survived: 0, brain: p.bot ? new Brain() : null,
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

  pushInput(id: number, seq: number, input: Input): void {
    const p = this.players.find(q => q.id === id);
    if (!p || seq <= p.ack) return;
    p.queue.push({ seq, input });
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
      p.nadeSel = 'flash';
      p.aimT = -1;
      p.stabPending = false;
      p.queue = [];
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
    p.nadeSel = 'flash';
    p.aimT = -1;
    p.stabPending = false;
    p.respawnT = 0;
    p.survT = 0;
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
    this.stepPlanks();
    this.stepProjectiles();

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
      this.broadcast({ type: 'ev', events: this.events });
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
    let input: Input;
    if (p.bot) {
      input = p.alive ? p.brain!.think(this, p) : { mx: 0, mz: 0, b: 0 };
    } else {
      // Exactly one input per tick keeps prediction in lockstep; drain backlog if a client bursts
      while (p.queue.length > 4) { p.ack = p.queue.shift()!.seq; p.net.dropped++; }
      const next = p.queue.shift();
      if (next) { p.ack = next.seq; p.input = next.input; p.starved = 0; }
      else {
        if (p.alive) p.net.starved++;
        // A backgrounded tab stops sending; don't keep running them off a roof on their last input
        if (++p.starved > 6) p.input = { mx: 0, mz: 0, b: 0 };
      }
      input = p.input;
    }

    p.frozen = Math.max(0, p.frozen - TICK_DT);
    p.chilled = Math.max(0, p.chilled - TICK_DT);
    p.blind = Math.max(0, p.blind - TICK_DT);
    p.shovedT = Math.max(0, p.shovedT - TICK_DT);
    p.prot = Math.max(0, p.prot - TICK_DT);
    p.stun = Math.max(0, p.stun - TICK_DT);
    p.plankFallT = Math.max(0, p.plankFallT - TICK_DT);
    if (!p.alive && p.respawnT > 0 && this.phase !== 'end' && (p.respawnT -= TICK_DT) <= 0) this.spawn(p, true);
    if (!p.alive || this.phase === 'end') return; // freeze the scene on the round result

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

    // Runner grenades: ALT (Q) switches, hold ACTION (Enter) to charge, release to throw
    if (p.role === 'runner') {
      if (canAct && (ev.pressed & BTN_ALT)) this.cycleNade(p);
      if (canAct && (ev.pressed & BTN_ACTION) && p.nades[p.nadeSel] > 0) p.aimT = 0;
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

  /** Whoever knocked this player around in the last few seconds gets credit for their fall. */
  private shover(p: MPlayer): MPlayer | null {
    if (p.shovedT <= 0) return null;
    return this.players.find(q => q.id === p.shovedBy && this.enemies(q, p)) ?? null;
  }

  private cycleNade(p: MPlayer): void {
    const i = NADE_KINDS.indexOf(p.nadeSel);
    for (let k = 1; k <= NADE_KINDS.length; k++) {
      const kind = NADE_KINDS[(i + k) % NADE_KINDS.length];
      if (p.nades[kind] > 0) { p.nadeSel = kind; return; }
    }
  }

  private throwNade(p: MPlayer, charge: number): void {
    const kind = p.nadeSel;
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
    if (p.nades[kind] === 0) this.cycleNade(p);
  }

  private tryStab(p: MPlayer): void {
    const fx = Math.sin(p.body.facing), fz = Math.cos(p.body.facing);
    for (const t of this.active()) {
      if (!t.alive || !this.enemies(p, t) || t.prot > 0) continue; // spawn protection: no hit, no knockback
      const dx = t.body.x - p.body.x, dz = t.body.z - p.body.z;
      const d = Math.hypot(dx, dz);
      if (d > STAB_RANGE + PLAYER_RADIUS * 2 || Math.abs(t.body.y - p.body.y) > 1.2) continue; // range = gap between bodies
      if (d > 0.3 && (dx * fx + dz * fz) / d < STAB_ARC_COS) continue;
      // No slashing through walls, hedges, crates or huts
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
        by.nadeSel = 'flash';
        by.prot = SWAP_PROTECTION;
        by.survT = 0;
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
        if (d <= FROST_RADIUS) {
          // Frozen mid-jump = no sideways speed, so they drop; the thrower gets the kill
          s.frozen = FROST_TIME;
          s.shovedBy = pr.owner;
          s.shovedT = FROST_TIME + 2;
        }
        s.chilled = Math.max(s.chilled, CHILL_TIME);
        hits.push(s.id);
      }
    }
    this.events.push({ k: 'det', kind, x: pr.x, y: pr.y, z: pr.z, hits });
  }

  // ── Snapshots ───────────────────────────────────────────────────────────

  private netPlayer(p: MPlayer): NetPlayer {
    const b = p.body;
    return {
      id: p.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), vx: r2(b.vx), vy: r2(b.vy), vz: r2(b.vz), f: r2(b.facing),
      hp: Math.round(p.hp), alive: p.alive, role: p.role, frozen: r2(p.frozen), chilled: r2(p.chilled),
      lunge: r2(b.lunge), aiming: p.aimT >= 0 ? r2(Math.min(1, p.aimT / NADE_CHARGE_TIME)) : 0,
      nade: p.aimT >= 0 ? p.nadeSel : null,
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
          nades: viewer.nades, nadeSel: viewer.nadeSel, respawn: r2(viewer.respawnT), stun: r2(viewer.stun),
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
