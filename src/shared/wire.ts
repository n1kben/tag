// What travels at 30-60Hz, in binary. Snapshots: small enough for a single UDP packet (~500 bytes for 13 players
// instead of ~3.3KB of JSON). Other players are quantized (positions to 1cm, angles to a byte,
// timers to 1/20s): they're only drawn. Our own body stays exact (float64): prediction replays
// inputs from it, and any rounding would show up as corrections.
import type { NetPlayer, NetProjectile, Phase, Snapshot } from './protocol';
import type { NadeKind } from './constants';
import type { Input } from './sim';

const PHASES: Phase[] = ['start', 'chase', 'end'];
const NADES: NadeKind[] = ['flash', 'frost'];
export const SNAPSHOT_TAG = 1; // first byte; every other server message is JSON text
export const INPUTS_TAG = 2; // client → server over UDP: the last few inputs

const ME_F64 = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'facing', 'airTime', 'groundTime', 'jumpBuf', 'attackCd', 'lunge'] as const;
const ME_F32 = ['frozen', 'chilled', 'blind', 'respawn', 'stun'] as const;
const TAU = Math.PI * 2;

class Writer {
  private buf = new ArrayBuffer(1024);
  private v = new DataView(this.buf);
  n = 0;
  private room(k: number): void {
    if (this.n + k <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.n + k));
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.n));
    this.buf = next;
    this.v = new DataView(next);
  }
  u8(x: number): void { this.room(1); this.v.setUint8(this.n, x); this.n += 1; }
  u16(x: number): void { this.room(2); this.v.setUint16(this.n, x, true); this.n += 2; }
  i16(x: number): void { this.room(2); this.v.setInt16(this.n, Math.max(-32768, Math.min(32767, Math.round(x))), true); this.n += 2; }
  u32(x: number): void { this.room(4); this.v.setUint32(this.n, x, true); this.n += 4; }
  f32(x: number): void { this.room(4); this.v.setFloat32(this.n, x, true); this.n += 4; }
  f64(x: number): void { this.room(8); this.v.setFloat64(this.n, x, true); this.n += 8; }
  /** A 0..max value in a byte, with `per` steps per unit. */
  q8(x: number, per: number): void { this.u8(Math.max(0, Math.min(255, Math.round(x * per)))); }
  bytes(): Uint8Array { return new Uint8Array(this.buf, 0, this.n); }
}

class Reader {
  private v: DataView;
  n = 0;
  constructor(data: ArrayBuffer | ArrayBufferView) {
    this.v = data instanceof ArrayBuffer ? new DataView(data) : new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8(): number { return this.v.getUint8(this.n++); }
  u16(): number { const x = this.v.getUint16(this.n, true); this.n += 2; return x; }
  i16(): number { const x = this.v.getInt16(this.n, true); this.n += 2; return x; }
  u32(): number { const x = this.v.getUint32(this.n, true); this.n += 4; return x; }
  f32(): number { const x = this.v.getFloat32(this.n, true); this.n += 4; return x; }
  f64(): number { const x = this.v.getFloat64(this.n, true); this.n += 8; return x; }
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer();
  w.u8(SNAPSHOT_TAG);
  w.u32(s.tick);
  w.u8(PHASES.indexOf(s.phase));
  w.f32(s.timeLeft);
  w.u32(s.ack);
  const me = s.me;
  w.u8(me ? 1 : 0);
  if (me) {
    for (const k of ME_F64) w.f64(me[k]);
    for (const k of ME_F32) w.f32(me[k]);
    w.u8((me.grounded ? 1 : 0) | (me.rising ? 2 : 0) | (me.onHead ? 4 : 0) | (me.alive ? 8 : 0) | (me.role === 'tagger' ? 16 : 0) | (me.nadeSel === 'frost' ? 32 : 0));
    w.u8(me.prevB);
    w.u8(me.hp);
    w.u8(me.nades.flash);
    w.u8(me.nades.frost);
  }
  w.u8(s.players.length);
  for (const p of s.players) {
    w.u16(p.id);
    w.i16(p.x * 100); w.i16(p.y * 100); w.i16(p.z * 100);
    w.i16(p.vx * 100); w.i16(p.vy * 100); w.i16(p.vz * 100);
    w.u8(Math.round((((p.f % TAU) + TAU) % TAU) / TAU * 256) & 255);
    w.u8(p.hp);
    w.u8((p.alive ? 1 : 0) | (p.role === 'tagger' ? 2 : 0) | (p.prot ? 4 : 0) | (p.nade ? 8 : 0) | (p.nade === 'frost' ? 16 : 0));
    w.q8(p.frozen, 20); w.q8(p.chilled, 20); w.q8(p.stun, 20);
    w.q8(p.lunge, 1000);
    w.q8(p.aiming, 255);
  }
  w.u8(s.projectiles.length);
  for (const pr of s.projectiles) {
    w.u16(pr.id); w.u8(NADES.indexOf(pr.kind));
    w.i16(pr.x * 100); w.i16(pr.y * 100); w.i16(pr.z * 100);
    w.u16(pr.owner);
  }
  w.u8(s.scores.length);
  for (const sc of s.scores) { w.u16(sc.id); w.i16(sc.score); w.u16(sc.kills); }
  w.u8(s.planks.length);
  for (const pl of s.planks) w.u8(pl);
  return w.bytes();
}

export function decodeSnapshot(data: ArrayBuffer | ArrayBufferView): Snapshot {
  const r = new Reader(data);
  r.u8(); // tag
  const tick = r.u32(), phase = PHASES[r.u8()], timeLeft = r.f32(), ack = r.u32();
  let me: Snapshot['me'] = null;
  if (r.u8()) {
    const m: Record<string, unknown> = {};
    for (const k of ME_F64) m[k] = r.f64();
    for (const k of ME_F32) m[k] = r.f32();
    const bits = r.u8();
    m.grounded = !!(bits & 1); m.rising = !!(bits & 2); m.onHead = !!(bits & 4); m.alive = !!(bits & 8);
    m.role = bits & 16 ? 'tagger' : 'runner';
    m.nadeSel = bits & 32 ? 'frost' : 'flash';
    m.prevB = r.u8();
    m.hp = r.u8();
    m.nades = { flash: r.u8(), frost: r.u8() };
    me = m as unknown as Snapshot['me'];
  }
  const players: NetPlayer[] = [];
  for (let i = r.u8(); i > 0; i--) {
    const id = r.u16();
    const x = r.i16() / 100, y = r.i16() / 100, z = r.i16() / 100;
    const vx = r.i16() / 100, vy = r.i16() / 100, vz = r.i16() / 100;
    const f = (r.u8() / 256) * TAU, hp = r.u8(), bits = r.u8();
    players.push({
      id, x, y, z, vx, vy, vz, f: f > Math.PI ? f - TAU : f, hp,
      alive: !!(bits & 1), role: bits & 2 ? 'tagger' : 'runner', prot: !!(bits & 4),
      nade: bits & 8 ? (bits & 16 ? 'frost' : 'flash') : null,
      frozen: r.u8() / 20, chilled: r.u8() / 20, stun: r.u8() / 20, lunge: r.u8() / 1000, aiming: r.u8() / 255,
    });
  }
  const projectiles: NetProjectile[] = [];
  for (let i = r.u8(); i > 0; i--) {
    projectiles.push({ id: r.u16(), kind: NADES[r.u8()], x: r.i16() / 100, y: r.i16() / 100, z: r.i16() / 100, owner: r.u16() });
  }
  const scores: Snapshot['scores'] = [];
  for (let i = r.u8(); i > 0; i--) scores.push({ id: r.u16(), score: r.i16(), kills: r.u16() });
  const planks: number[] = [];
  for (let i = r.u8(); i > 0; i--) planks.push(r.u8());
  return { type: 'snap', tick, phase, timeLeft, ack, me, players, projectiles, scores, planks };
}

// ── Inputs ─────────────────────────────────────────────────────────────────
export interface WireInput { seq: number; mx: number; mz: number; b: number; v: number }

/**
 * Stick values travel as 1/127 steps. The client predicts with the rounded input too, so the
 * server runs exactly what the client ran, whichever way it was sent.
 */
export function quantizeInput(i: Input): Input {
  const q = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 127) / 127;
  return { mx: q(i.mx), mz: q(i.mz), b: i.b };
}

/** One UDP packet carries the newest few inputs, so a lost packet costs nothing. */
export function encodeInputs(list: WireInput[]): Uint8Array {
  const w = new Writer();
  w.u8(INPUTS_TAG);
  w.u8(list.length);
  for (const i of list) {
    w.u32(i.seq);
    w.u8(Math.round(i.mx * 127) & 255);
    w.u8(Math.round(i.mz * 127) & 255);
    w.u8(i.b);
    w.f32(i.v);
  }
  return w.bytes();
}

export function decodeInputs(data: ArrayBuffer | ArrayBufferView): WireInput[] {
  const r = new Reader(data);
  if (r.u8() !== INPUTS_TAG) return [];
  const out: WireInput[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const seq = r.u32();
    const mx = ((r.u8() << 24) >> 24) / 127, mz = ((r.u8() << 24) >> 24) / 127;
    out.push({ seq, mx, mz, b: r.u8(), v: r.f32() });
  }
  return out;
}
