// Client netcode, free of DOM and three.js so the browser and the network test bench
// (scripts/net-bench.ts) run the same code: fixed-step prediction + reconciliation for the
// local player, a snapshot buffer and render clock for everyone else, and the numbers that
// say how it's going (corrections, starved render time, snapshot gaps).
import { stepBody, type Body, type Dyn, type Input, type Status } from '../shared/sim';
import type { GameMap } from '../shared/map';
import type { NetPlayer, Snapshot } from '../shared/protocol';
import { TICK_DT, TICK_RATE, SNAPSHOT_EVERY } from '../shared/constants';

export interface Buffered { tick: number; players: Map<number, NetPlayer>; snap: Snapshot; at: number }
export type ViewPlayer = NetPlayer & { visible: boolean };

// Remote players are drawn `delay` ticks behind our estimate of the server's clock: one
// snapshot interval plus however late snapshots tend to arrive (90th percentile over the last
// few seconds), so there's nearly always a newer snapshot to blend towards. Smooth network:
// ~50ms. Bumpy: more, but only as much as it needs.
const MIN_DELAY = SNAPSHOT_EVERY + 1, MAX_DELAY = 20;
const LATE_WINDOW = 90; // snapshots (~3s) of lateness samples
const EXTRAPOLATE_TICKS = 6; // a late snapshot: keep others moving along their velocity this long
const BODY_KEYS: (keyof Body)[] = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'facing', 'grounded', 'airTime', 'groundTime', 'jumpBuf', 'rising', 'attackCd', 'lunge', 'prevB', 'onHead'];

/** Running totals; read (and reset) by the netgraph and the bench. */
export class NetStats {
  snaps = 0;
  corrections = 0; // reconciles that moved us more than 0.3m
  teleports = 0; // …more than 1m
  maxCorrection = 0;
  gaps = 0; // snapshots that arrived >100ms after the previous one
  maxGap = 0; // ms
  starvedMs = 0; // render time past the newest snapshot and the extrapolation (remote players stuck)
  extrapolatedMs = 0; // render time spent guessing ahead of the newest snapshot
  lastAt = 0;

  reset(): void {
    this.snaps = this.corrections = this.teleports = this.maxCorrection = this.gaps = this.maxGap = this.starvedMs = this.extrapolatedMs = 0;
  }
}

export class ClientNet {
  myId = -1;
  latest: Snapshot | null = null;
  pred: Body | null = null;
  pending: { seq: number; input: Input }[] = [];
  seq = 0;
  buffer: Buffered[] = [];
  renderTick = 0;
  /** Render delay in ticks (see MIN_DELAY); tracks network jitter. */
  delay = 6;
  /** Server tick ≈ now * TICK_RATE / 1000 + clockOff (fitted to the least-delayed snapshots). */
  private clockOff = NaN;
  private late: number[] = [];
  /** Visual offset left by a correction; decays so the fix is a slide, not a pop. */
  err = { x: 0, y: 0, z: 0 };
  stats = new NetStats();

  constructor(public map: GameMap) {}

  /** New round / match: drop everything tied to the old one. */
  reset(): void {
    this.latest = null;
    this.pred = null;
    this.pending = [];
    this.buffer = [];
  }

  myStatus(): Status | null {
    const me = this.latest?.me;
    if (!me) return null;
    return {
      role: me.role,
      frozen: me.frozen > 0 || me.stun > 0, // frozen solid or dizzy from a stomp
      chilled: me.chilled > 0,
      locked: !me.alive || this.latest!.phase === 'end' || (this.latest!.phase === 'start' && me.role === 'tagger'),
    };
  }

  /** Other players (solid, with heads) and collapsed planks, as the server saw them in a snapshot. */
  dynFrom(s: Snapshot): Dyn {
    return {
      bodies: s.players.filter(p => p.id !== this.myId && p.alive).map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z, role: p.role })),
      broken: new Set(s.planks.flatMap((st, i) => (st === 2 ? [i] : []))),
    };
  }

  onSnapshot(s: Snapshot, now: number): void {
    if (s.tick <= (this.buffer.at(-1)?.tick ?? -1)) return; // out of order / duplicate
    const st = this.stats;
    st.snaps++;
    if (st.lastAt) {
      const gap = now - st.lastAt;
      if (gap > 100) st.gaps++;
      st.maxGap = Math.max(st.maxGap, gap);
    }
    st.lastAt = now;

    const wasAlive = !!this.latest?.me?.alive;
    this.latest = s;
    this.buffer.push({ tick: s.tick, players: new Map(s.players.map(p => [p.id, p])), snap: s, at: now });
    while (this.buffer.length > 40) this.buffer.shift();

    // Clock fit + jitter: how much later than the fastest recent snapshot did this one arrive?
    const sample = s.tick - (now * TICK_RATE) / 1000;
    if (Number.isNaN(this.clockOff) || sample > this.clockOff) this.clockOff = sample;
    this.late.push(this.clockOff - sample);
    if (this.late.length > LATE_WINDOW) this.late.shift();
    const sorted = [...this.late].sort((a, b) => a - b);
    const jitter = sorted[Math.floor(sorted.length * 0.9)] ?? 0; // rarer stalls: extrapolation covers them
    const want = Math.min(MAX_DELAY, Math.max(MIN_DELAY, SNAPSHOT_EVERY + jitter + 1));
    // Grow quickly when it gets bumpy, shrink slowly once it calms down
    this.delay += (want - this.delay) * (want > this.delay ? 0.3 : 0.02);
    if (this.renderTick === 0 || Math.abs(this.renderTick - (s.tick - this.delay)) > 30) this.renderTick = s.tick - this.delay;

    // Reconcile the local player: take the server body, replay unacknowledged inputs
    const me = s.me;
    if (!me) return;
    const server = {} as Body;
    for (const k of BODY_KEYS) (server as unknown as Record<string, unknown>)[k] = me[k];
    this.pending = this.pending.filter(p => p.seq > s.ack);
    const status = this.myStatus()!;
    // The server doesn't step bodies at round end or when dead; neither do we
    const dyn = this.dynFrom(s);
    if (me.alive && s.phase !== 'end') for (const p of this.pending) stepBody(this.map, server, p.input, status, TICK_DT, dyn);
    if (this.pred && me.alive && wasAlive) { // (a respawn isn't a correction)
      const dx = this.pred.x - server.x, dy = this.pred.y - server.y, dz = this.pred.z - server.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 0.3) st.corrections++;
      if (d > 1) st.teleports++;
      st.maxCorrection = Math.max(st.maxCorrection, d);
      if (d < 3) { this.err.x += dx; this.err.y += dy; this.err.z += dz; } else this.err = { x: 0, y: 0, z: 0 };
    }
    this.pred = server;
  }

  /**
   * One fixed 60Hz client tick: number the input, predict it locally.
   * Returns the message to send and the sim events (null before the first snapshot).
   */
  predict(input: Input): { msg: { type: 'input'; seq: number; mx: number; mz: number; b: number }; ev: ReturnType<typeof stepBody> } | null {
    const st = this.myStatus();
    const latest = this.latest, pred = this.pred;
    if (!latest || !pred || !st) return null;
    this.seq++;
    this.pending.push({ seq: this.seq, input });
    if (this.pending.length > 120) this.pending.shift();
    const frozenScene = latest.phase === 'end' || !latest.me?.alive;
    const ev = frozenScene
      ? { jumped: false, landed: 0, lunged: false, pressed: input.b & ~pred.prevB, released: 0, stomped: null }
      : stepBody(this.map, pred, input, st, TICK_DT, this.dynFrom(latest));
    if (frozenScene) pred.prevB = input.b;
    return { msg: { type: 'input', seq: this.seq, mx: input.mx, mz: input.mz, b: input.b }, ev };
  }

  /** Our best guess at the server's current tick. */
  serverTick(now: number): number {
    return (now * TICK_RATE) / 1000 + this.clockOff;
  }

  /** Advance the render clock (remote players are drawn at renderTick) and decay the correction. */
  advance(dt: number, now: number): void {
    const newest = this.buffer.at(-1)?.tick;
    if (newest === undefined) return;
    // The path can get slower: let the clock fit drift back so it re-fits to the new delay
    this.clockOff -= dt * 0.25;
    this.renderTick += dt * TICK_RATE;
    const target = this.serverTick(now) - this.delay;
    this.renderTick += (target - this.renderTick) * Math.min(1, dt * 2);
    if (this.renderTick > newest + EXTRAPOLATE_TICKS) this.stats.starvedMs += dt * 1000;
    else if (this.renderTick > newest) this.stats.extrapolatedMs += dt * 1000;
    const k = Math.exp(-dt * 12);
    this.err.x *= k; this.err.y *= k; this.err.z *= k;
  }

  /** Everyone as they should be drawn at renderTick. */
  interpolate(): Map<number, ViewPlayer> {
    const out = new Map<number, ViewPlayer>();
    const buffer = this.buffer;
    if (!buffer.length) return out;
    let a = buffer[0], b = buffer[buffer.length - 1];
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].tick <= this.renderTick && buffer[i + 1].tick >= this.renderTick) { a = buffer[i]; b = buffer[i + 1]; break; }
    }
    if (this.renderTick > b.tick) {
      // Late snapshot: carry everyone on along their velocity for a little while, then hold
      const ahead = Math.min(EXTRAPOLATE_TICKS, this.renderTick - b.tick) * TICK_DT;
      for (const [id, pb] of b.players) {
        const moving = pb.alive && !pb.frozen && !pb.stun;
        out.set(id, { ...pb, x: moving ? pb.x + pb.vx * ahead : pb.x, z: moving ? pb.z + pb.vz * ahead : pb.z, visible: true });
      }
      return out;
    }
    const t = b.tick > a.tick ? Math.min(1, Math.max(0, (this.renderTick - a.tick) / (b.tick - a.tick))) : 1;
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      if (!pa) { out.set(id, { ...pb, visible: t > 0.5 }); continue; }
      out.set(id, {
        ...pb,
        x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t,
        f: lerpAngle(pa.f, pb.f, t), visible: true,
      });
    }
    // Present before, gone now: keep them until the newer frame wins
    for (const [id, pa] of a.players) if (!out.has(id) && t < 0.5) out.set(id, { ...pa, visible: true });
    return out;
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
