// One match of Hide 'n Seek on Rooftops: rounds, phases, combat, grenades, visibility.
// Rules follow the CS 1.6 hidenseek plugin defaults (see README "Rules").
import {
  TICK_DT, SNAPSHOT_EVERY, PLAYER_RADIUS, EYE_HEIGHT, SAFE_FALL_SPEED, FATAL_FALL_SPEED, KILL_Y, MAX_HP,
  STAB_RANGE, STAB_ARC_COS, STAB_DAMAGE, BACKSTAB_DAMAGE, BACKSTAB_MAX_SPEED, NUBSLASH_LOSSES, RANG_SPEED, RANG_OUT_TIME,
  RANG_RADIUS, RANG_DAMAGE, NADE_KINDS, NADE_LOADOUT, NADE_FUSE, NADE_THROW_SPEED, NADE_THROW_UP,
  NADE_MIN_CHARGE, NADE_CHARGE_TIME, FROST_RADIUS, FROST_TIME, CHILL_RADIUS, CHILL_TIME, FLASH_RADIUS,
  FLASH_TIME, SMOKE_RADIUS, SMOKE_TIME, BOOM_RADIUS, BOOM_KNOCK, BOOM_DAMAGE, VIEW_RANGE, BUSH_REVEAL_RANGE,
  HIDE_TIME, ROUND_TIME, ROUND_END_TIME, ROUNDS_PER_MATCH, GRAVITY, type NadeKind,
} from '../shared/constants';
import { heightAt, inBush, lineOfSight, SEEKER_SPAWNS, HIDER_SPAWNS, type Smoke } from '../shared/map';
import { newBody, stepBody, BTN_ACTION, BTN_ALT, type Body, type Input, type Role, type Status } from '../shared/sim';
import type {
  GameEvent, LobbyPlayer, NetPlayer, NetProjectile, Phase, ServerMessage, Snapshot, Standing,
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
  rangHeld: boolean;
  shovedBy: number; // last opponent to knock us around, for crediting falls
  shovedT: number;
  score: number;
  kills: number;
  survived: number;
  brain: Brain | null;
}

interface Projectile {
  id: number;
  kind: NadeKind | 'rang';
  owner: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number;
  returning: boolean;
  hit: Set<number>;
}

interface SmokeCloud extends Smoke { id: number; t: number }

const NO_NADES = (): Record<NadeKind, number> => ({ flash: 0, frost: 0, smoke: 0, boom: 0 });

export class Match {
  players: MPlayer[] = [];
  phase: Phase = 'hide';
  timeLeft = HIDE_TIME;
  round = 0;
  tick = 0;
  seekerLossStreak = 0;
  rangUnlocked = false;
  private swapPending = false;
  spotted = new Set<number>(); // hiders currently seen by any seeker
  smokes: SmokeCloud[] = [];
  private projectiles: Projectile[] = [];
  private events: GameEvent[] = [];
  private nextId = 1;
  private interval: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;

  constructor(private host: MatchHost, roster: LobbyPlayer[]) {
    for (const p of roster) this.addPlayer(p);
  }

  addPlayer(p: LobbyPlayer): MPlayer {
    const mp: MPlayer = {
      id: p.id, name: p.name, character: p.character, bot: p.bot, connected: true,
      body: newBody(0, 0), input: { mx: 0, mz: 0, b: 0 }, queue: [], ack: 0, starved: 0,
      role: 'hider', hp: MAX_HP, alive: false, frozen: 0, chilled: 0, blind: 0,
      nades: NO_NADES(), nadeSel: 'flash', aimT: -1, stabPending: false, rangHeld: false, shovedBy: 0, shovedT: 0,
      score: 0, kills: 0, survived: 0, brain: p.bot ? new Brain() : null,
    };
    this.players.push(mp);
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

  private active(): MPlayer[] {
    return this.players.filter(p => p.connected);
  }

  private startRound(first: boolean): void {
    this.round++;
    const ps = this.active();
    if (first) {
      // Roughly even teams, like a CS server autobalance; seekers are the smaller side
      const shuffled = [...ps].sort(() => Math.random() - 0.5);
      const seekers = Math.max(1, Math.floor(ps.length / 2));
      shuffled.forEach((p, i) => { p.role = i < seekers ? 'seeker' : 'hider'; });
    } else {
      if (this.swapPending) for (const p of this.players) p.role = p.role === 'seeker' ? 'hider' : 'seeker';
      this.swapPending = false;
      // Balance late joiners into the smaller team
      const nS = ps.filter(p => p.role === 'seeker').length;
      const nH = ps.length - nS;
      if (nS === 0 && ps.length > 0) ps[0].role = 'seeker';
      if (nH === 0 && ps.length > 1) ps[ps.length - 1].role = 'hider';
    }

    let si = 0, hi = 0;
    const hiderSpots = [...HIDER_SPAWNS].sort(() => Math.random() - 0.5);
    for (const p of ps) {
      const [x, z] = p.role === 'seeker'
        ? SEEKER_SPAWNS[si++ % SEEKER_SPAWNS.length]
        : hiderSpots[hi++ % hiderSpots.length];
      p.body = newBody(x, z);
      p.body.facing = p.role === 'seeker' ? Math.PI : 0;
      p.hp = MAX_HP;
      p.alive = true;
      p.frozen = p.chilled = p.blind = 0;
      p.nades = p.role === 'hider' ? { ...NADE_LOADOUT } : NO_NADES();
      p.nadeSel = 'flash';
      p.aimT = -1;
      p.stabPending = false;
      p.rangHeld = p.role === 'seeker' && this.rangUnlocked;
      p.queue = [];
      p.brain?.reset();
    }
    this.projectiles = [];
    this.smokes = [];
    this.spotted.clear();
    this.phase = 'hide';
    this.timeLeft = HIDE_TIME;

    const roles: Record<number, Role> = {};
    for (const p of ps) roles[p.id] = p.role;
    this.broadcast({ type: 'round_start', round: this.round, roles, rangUnlocked: this.rangUnlocked });
  }

  private endRound(winner: Role): void {
    this.phase = 'end';
    this.timeLeft = ROUND_END_TIME;
    this.projectiles = []; // nothing in flight may hurt anyone after the result
    if (winner === 'hider') {
      // hns_hiders_alivefrags: every surviving hider scores
      for (const p of this.active()) {
        if (p.role === 'hider' && p.alive) { p.score += 1; p.survived += 1; }
      }
      this.seekerLossStreak++;
    } else {
      this.seekerLossStreak = 0;
    }
    // hns_nubslash: seekers get a better weapon after losing enough rounds in a row
    this.rangUnlocked = this.seekerLossStreak >= NUBSLASH_LOSSES;
    const swap = winner === 'seeker';
    this.broadcast({
      type: 'round_end', round: this.round, winner, swap, standings: this.standings(), rangNext: this.rangUnlocked,
    });
    this.swapPending = swap;
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

    if (this.phase === 'hide' && this.timeLeft <= 0) {
      this.phase = 'seek';
      this.timeLeft = ROUND_TIME;
    }

    this.updateVisibility();

    for (const p of this.active()) this.stepPlayer(p);
    this.collidePlayers();
    this.stepProjectiles();
    this.smokes = this.smokes.filter(s => (s.t -= TICK_DT) > 0);

    if (this.phase === 'seek') {
      const ps = this.active();
      const hidersAlive = ps.filter(p => p.role === 'hider' && p.alive).length;
      const seekersAlive = ps.filter(p => p.role === 'seeker' && p.alive).length;
      if (hidersAlive === 0) this.endRound('seeker');
      else if (seekersAlive === 0 || this.timeLeft <= 0) this.endRound('hider');
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
      // Seekers sitting out the hide phase must not learn where grenades land
      const hideSafe = this.events.filter(e => e.k !== 'bounce' && e.k !== 'det' && e.k !== 'throw');
      for (const p of this.players) {
        if (p.bot || !p.connected) continue;
        const events = this.phase === 'hide' && p.role === 'seeker' && p.alive ? hideSafe : this.events;
        if (events.length) this.host.send(p.id, { type: 'ev', events });
      }
      this.events = [];
    }
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  private status(p: MPlayer): Status {
    return {
      role: p.role,
      frozen: p.frozen > 0,
      chilled: p.chilled > 0,
      locked: !p.alive || this.phase === 'end' || (this.phase === 'hide' && p.role === 'seeker'),
    };
  }

  private stepPlayer(p: MPlayer): void {
    let input: Input;
    if (p.bot) {
      input = p.alive ? p.brain!.think(this, p) : { mx: 0, mz: 0, b: 0 };
    } else {
      // Exactly one input per tick keeps prediction in lockstep; drain backlog if a client bursts
      while (p.queue.length > 4) p.ack = p.queue.shift()!.seq;
      const next = p.queue.shift();
      if (next) { p.ack = next.seq; p.input = next.input; p.starved = 0; }
      // A backgrounded tab stops sending; don't keep running them off a roof on their last input
      else if (++p.starved > 6) p.input = { mx: 0, mz: 0, b: 0 };
      input = p.input;
    }

    p.frozen = Math.max(0, p.frozen - TICK_DT);
    p.chilled = Math.max(0, p.chilled - TICK_DT);
    p.blind = Math.max(0, p.blind - TICK_DT);
    p.shovedT = Math.max(0, p.shovedT - TICK_DT);
    if (!p.alive || this.phase === 'end') return; // freeze the scene on the round result

    const st = this.status(p);
    const ev = stepBody(p.body, input, st, TICK_DT);
    const canAct = !st.locked && !st.frozen;

    if (ev.lunged) {
      p.stabPending = true;
      this.events.push({ k: 'stab', by: p.id });
    }
    if (p.stabPending) {
      if (p.body.lunge > 0) this.tryStab(p);
      else p.stabPending = false;
    }

    // Seeker boomerang (only after the nubslash unlock)
    if (canAct && p.role === 'seeker' && (ev.pressed & BTN_ALT) && p.rangHeld) {
      p.rangHeld = false;
      const fx = Math.sin(p.body.facing), fz = Math.cos(p.body.facing);
      this.projectiles.push({
        id: this.nextId++, kind: 'rang', owner: p.id,
        x: p.body.x + fx * 0.5, y: p.body.y + 0.7, z: p.body.z + fz * 0.5,
        vx: fx * RANG_SPEED + p.body.vx * 0.3, vy: 0, vz: fz * RANG_SPEED + p.body.vz * 0.3,
        t: 0, returning: false, hit: new Set(),
      });
      this.events.push({ k: 'throw', by: p.id, kind: 'rang' });
    }

    // Hider grenades: ALT cycles, hold ACTION to charge, release to throw
    if (p.role === 'hider') {
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

    // Fall damage (CS 1.6 curve, scaled)
    if (ev.landed > SAFE_FALL_SPEED) {
      const dmg = ((ev.landed - SAFE_FALL_SPEED) / (FATAL_FALL_SPEED - SAFE_FALL_SPEED)) * MAX_HP;
      this.damage(p, dmg, this.shover(p), 'fall', 0, 0);
    }
    if (p.alive && p.body.y < KILL_Y) this.kill(p, this.shover(p), 'void', 0, 0);
  }

  /** Whoever knocked this player around in the last few seconds gets credit for their fall. */
  private shover(p: MPlayer): MPlayer | null {
    if (p.shovedT <= 0) return null;
    return this.players.find(q => q.id === p.shovedBy && q.role !== p.role) ?? null;
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
      t: 0, returning: false, hit: new Set(),
    });
    this.events.push({ k: 'throw', by: p.id, kind });
    if (p.nades[kind] === 0) this.cycleNade(p);
  }

  private tryStab(p: MPlayer): void {
    const fx = Math.sin(p.body.facing), fz = Math.cos(p.body.facing);
    for (const t of this.active()) {
      if (!t.alive || t.role === p.role) continue;
      const dx = t.body.x - p.body.x, dz = t.body.z - p.body.z;
      const d = Math.hypot(dx, dz);
      if (d > STAB_RANGE + PLAYER_RADIUS || Math.abs(t.body.y - p.body.y) > 1.2) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < STAB_ARC_COS) continue;
      // Backstab: attacker behind a victim who isn't running (caught hiding/sneaking).
      // A fleeing hider always faces away, so without the speed check every chase would one-shot.
      const tfx = Math.sin(t.body.facing), tfz = Math.cos(t.body.facing);
      const sneaking = Math.hypot(t.body.vx, t.body.vz) < BACKSTAB_MAX_SPEED;
      const back = sneaking && d > 0.05 && (dx * tfx + dz * tfz) / d > 0.35;
      p.stabPending = false;
      this.damage(t, back ? BACKSTAB_DAMAGE : STAB_DAMAGE, p, back ? 'backstab' : 'stab', fx, fz);
      // Knock the victim along the swing so hits read clearly
      t.body.vx += fx * 6; t.body.vz += fz * 6;
      t.shovedBy = p.id; t.shovedT = 3;
      return;
    }
  }

  private damage(t: MPlayer, dmg: number, by: MPlayer | null, cause: 'stab' | 'backstab' | 'fall' | 'boom' | 'rang', dx: number, dz: number): void {
    if (!t.alive) return;
    t.hp -= dmg;
    if (t.hp <= 0) this.kill(t, by, cause, dx, dz);
    else this.events.push({ k: 'hurt', id: t.id, hp: Math.round(t.hp), cause: cause === 'backstab' ? 'stab' : cause });
  }

  private kill(t: MPlayer, by: MPlayer | null, cause: 'stab' | 'backstab' | 'fall' | 'void' | 'boom' | 'rang', dx: number, dz: number): void {
    t.alive = false;
    t.hp = 0;
    t.aimT = -1;
    if (by && by.role !== t.role) { by.score += 1; by.kills += 1; }
    this.events.push({
      k: 'kill', id: t.id, by: by?.id ?? null, cause,
      x: t.body.x, y: t.body.y, z: t.body.z, dx, dz,
    });
    // A dead seeker's boomerang falls out of play
    if (t.role === 'seeker') this.projectiles = this.projectiles.filter(pr => !(pr.kind === 'rang' && pr.owner === t.id));
  }

  private collidePlayers(): void {
    // Semiclip: teammates pass through each other, opponents shove (CS hns_semiclip)
    const ps = this.active().filter(p => p.alive);
    const minD = PLAYER_RADIUS * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        if (a.role === b.role || Math.abs(a.body.y - b.body.y) > 1) continue;
        const dx = b.body.x - a.body.x, dz = b.body.z - a.body.z;
        const d = Math.hypot(dx, dz);
        if (d >= minD || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, push = (minD - d) / 2;
        a.body.x -= nx * push; a.body.z -= nz * push;
        b.body.x += nx * push; b.body.z += nz * push;
      }
    }
  }

  // ── Projectiles ─────────────────────────────────────────────────────────

  private stepProjectiles(): void {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.t += TICK_DT;
      const done = pr.kind === 'rang' ? this.stepRang(pr) : this.stepNade(pr);
      if (!done) keep.push(pr);
    }
    this.projectiles = keep;
  }

  private stepNade(pr: Projectile): boolean {
    pr.vy -= GRAVITY * TICK_DT;
    const nx = pr.x + pr.vx * TICK_DT, nz = pr.z + pr.vz * TICK_DT, ny = pr.y + pr.vy * TICK_DT;
    // Walls: bounce off columns rising above the grenade
    if (heightAt(nx, pr.z) > ny) { pr.vx *= -0.5; this.bounce(pr); } else pr.x = nx;
    if (heightAt(pr.x, nz) > ny) { pr.vz *= -0.5; this.bounce(pr); } else pr.z = nz;
    const g = heightAt(pr.x, pr.z);
    if (ny <= g && pr.vy < 0) {
      pr.y = g;
      if (pr.vy < -2) this.bounce(pr);
      pr.vy = -pr.vy * 0.4;
      pr.vx *= 0.65; pr.vz *= 0.65;
    } else {
      pr.y = ny;
    }
    if (pr.y < KILL_Y) return true;
    if (pr.t >= NADE_FUSE[pr.kind as NadeKind]) {
      this.detonate(pr);
      return true;
    }
    return false;
  }

  private bounce(pr: Projectile): void {
    if (Math.hypot(pr.vx, pr.vy, pr.vz) > 2.5) this.events.push({ k: 'bounce', x: pr.x, y: pr.y, z: pr.z });
  }

  private detonate(pr: Projectile): void {
    const kind = pr.kind as NadeKind;
    const hits: number[] = [];
    const eyeY = pr.y + 0.3;
    const seekers = this.active().filter(p => p.alive && p.role === 'seeker');
    const reach = (p: MPlayer, r: number): number => {
      const d = Math.hypot(p.body.x - pr.x, p.body.y + EYE_HEIGHT - eyeY, p.body.z - pr.z);
      if (d > r) return -1;
      if (!lineOfSight(pr.x, eyeY, pr.z, p.body.x, p.body.y + EYE_HEIGHT, p.body.z, this.smokes)) return -1;
      return d;
    };
    if (kind === 'flash') {
      for (const s of seekers) {
        const d = reach(s, FLASH_RADIUS);
        if (d < 0) continue;
        s.blind = Math.max(s.blind, FLASH_TIME * (1 - (d / FLASH_RADIUS) * 0.6));
        hits.push(s.id);
      }
    } else if (kind === 'frost') {
      for (const s of seekers) {
        const d = reach(s, CHILL_RADIUS);
        if (d < 0) continue;
        if (d <= FROST_RADIUS) s.frozen = FROST_TIME;
        s.chilled = Math.max(s.chilled, CHILL_TIME);
        hits.push(s.id);
      }
    } else if (kind === 'smoke') {
      this.smokes.push({ id: pr.id, x: pr.x, y: pr.y, z: pr.z, r: SMOKE_RADIUS, t: SMOKE_TIME });
    } else if (kind === 'boom') {
      const owner = this.players.find(p => p.id === pr.owner) ?? null;
      for (const s of seekers) {
        const d = reach(s, BOOM_RADIUS);
        if (d < 0) continue;
        const k = 1 - d / BOOM_RADIUS;
        const dx = s.body.x - pr.x, dz = s.body.z - pr.z, l = Math.hypot(dx, dz) || 1;
        s.body.vx += (dx / l) * BOOM_KNOCK * k;
        s.body.vz += (dz / l) * BOOM_KNOCK * k;
        s.body.vy = 5 + 4 * k;
        s.body.grounded = false;
        hits.push(s.id);
        if (owner) { s.shovedBy = owner.id; s.shovedT = 3; }
        this.damage(s, BOOM_DAMAGE * k, owner, 'boom', dx / l, dz / l);
      }
    }
    this.events.push({ k: 'det', kind, x: pr.x, y: pr.y, z: pr.z, hits });
  }

  private stepRang(pr: Projectile): boolean {
    const owner = this.players.find(p => p.id === pr.owner);
    if (!owner || !owner.alive) return true;
    if (!pr.returning && pr.t > RANG_OUT_TIME) pr.returning = true;
    if (pr.returning) {
      // Home back to the thrower's hands, accelerating like Boomerang Fu's return arc
      const tx = owner.body.x, ty = owner.body.y + 0.7, tz = owner.body.z;
      const dx = tx - pr.x, dy = ty - pr.y, dz = tz - pr.z, d = Math.hypot(dx, dy, dz) || 1;
      const speed = RANG_SPEED * Math.min(1.3, 0.6 + pr.t);
      const k = 1 - Math.exp(-8 * TICK_DT);
      pr.vx += ((dx / d) * speed - pr.vx) * k;
      pr.vy += ((dy / d) * speed - pr.vy) * k;
      pr.vz += ((dz / d) * speed - pr.vz) * k;
      if (d < 0.7 || pr.t > 4) {
        owner.rangHeld = true;
        this.events.push({ k: 'catch', id: owner.id });
        return true;
      }
    } else {
      // Slight curve: the throw bends toward the thrower's left like a real boomerang
      const turn = 1.4 * TICK_DT;
      const c = Math.cos(turn), s = Math.sin(turn);
      const vx = pr.vx * c - pr.vz * s, vz = pr.vx * s + pr.vz * c;
      pr.vx = vx; pr.vz = vz;
    }
    const nx = pr.x + pr.vx * TICK_DT, nz = pr.z + pr.vz * TICK_DT;
    if (!pr.returning && heightAt(nx, nz) > pr.y) {
      // Ricochet off whatever we hit, then start coming back
      if (heightAt(nx, pr.z) > pr.y) pr.vx = -pr.vx;
      if (heightAt(pr.x, nz) > pr.y) pr.vz = -pr.vz;
      pr.returning = true;
      this.bounce(pr);
    } else {
      pr.x = nx; pr.z = nz;
    }
    pr.y += pr.vy * TICK_DT;
    for (const t of this.active()) {
      if (!t.alive || t.role !== 'hider' || pr.hit.has(t.id)) continue;
      const d = Math.hypot(t.body.x - pr.x, t.body.y + 0.5 - pr.y, t.body.z - pr.z);
      if (d < RANG_RADIUS + PLAYER_RADIUS) {
        pr.hit.add(t.id);
        const l = Math.hypot(pr.vx, pr.vz) || 1;
        this.damage(t, RANG_DAMAGE, owner, 'rang', pr.vx / l, pr.vz / l);
      }
    }
    return false;
  }

  // ── Visibility + snapshots ──────────────────────────────────────────────

  /** CS-style: a hider is shown to seekers only while some seeker can actually see them. */
  private updateVisibility(): void {
    this.spotted.clear();
    if (this.phase !== 'seek') return;
    const seekers = this.active().filter(p => p.alive && p.role === 'seeker' && p.blind < 0.5);
    for (const h of this.active()) {
      if (!h.alive || h.role !== 'hider') continue;
      const hidden = inBush(h.body.x, h.body.z, h.body.y);
      for (const s of seekers) {
        const d = Math.hypot(h.body.x - s.body.x, h.body.z - s.body.z);
        if (d > VIEW_RANGE) continue;
        if (hidden && d > BUSH_REVEAL_RANGE) continue;
        if (!lineOfSight(
          s.body.x, s.body.y + EYE_HEIGHT, s.body.z,
          h.body.x, h.body.y + EYE_HEIGHT, h.body.z, this.smokes,
        ) && !lineOfSight(
          // Also peek at their head so a hider can't hide behind a knee-high lip
          s.body.x, s.body.y + EYE_HEIGHT, s.body.z,
          h.body.x, h.body.y + EYE_HEIGHT + 0.4, h.body.z, this.smokes,
        )) continue;
        this.spotted.add(h.id);
        break;
      }
    }
  }

  canSee(viewer: MPlayer, target: MPlayer): boolean {
    if (viewer.id === target.id || target.role === 'seeker') return true;
    if (viewer.role === 'hider' || !viewer.alive || this.phase === 'end') return true;
    if (!target.alive) return true;
    return this.spotted.has(target.id);
  }

  private netPlayer(p: MPlayer): NetPlayer {
    const b = p.body;
    return {
      id: p.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), vx: r2(b.vx), vy: r2(b.vy), vz: r2(b.vz), f: r2(b.facing),
      hp: Math.round(p.hp), alive: p.alive, role: p.role, frozen: r2(p.frozen), chilled: r2(p.chilled),
      lunge: r2(b.lunge), rang: p.rangHeld, aiming: p.aimT >= 0 ? r2(Math.min(1, p.aimT / NADE_CHARGE_TIME)) : 0,
      bush: inBush(b.x, b.z, b.y),
    };
  }

  private sendSnapshots(): void {
    const projectiles: NetProjectile[] = this.projectiles.map(pr => ({
      id: pr.id, kind: pr.kind, x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), owner: pr.owner,
    }));
    // A grenade's first moments give away where the thrower stands: seekers get it once it's away
    const hiderNades = new Set(this.projectiles.filter(pr => pr.kind !== 'rang' && pr.t < 0.3).map(pr => pr.id));
    const smokes = this.smokes.map(s => ({ id: s.id, x: s.x, y: s.y, z: s.z, t: r2(s.t) }));
    for (const viewer of this.players) {
      if (viewer.bot || !viewer.connected) continue;
      const players = this.active().filter(p => this.canSee(viewer, p)).map(p => this.netPlayer(p));
      const blindSeeker = viewer.role === 'seeker' && viewer.alive && this.phase !== 'end';
      const visibleProjectiles = !blindSeeker ? projectiles
        : this.phase === 'hide' ? [] : projectiles.filter(pr => !hiderNades.has(pr.id));
      const snap: Snapshot = {
        type: 'snap', tick: this.tick, phase: this.phase, timeLeft: r2(Math.max(0, this.timeLeft)), ack: viewer.ack,
        me: {
          ...viewer.body, hp: Math.round(viewer.hp), alive: viewer.alive, role: viewer.role,
          frozen: viewer.frozen, chilled: viewer.chilled, blind: viewer.blind,
          rangHeld: viewer.rangHeld, rangUnlocked: this.rangUnlocked, nades: viewer.nades, nadeSel: viewer.nadeSel,
        },
        players, projectiles: visibleProjectiles, smokes,
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
