// Jump timing and bunny hopping with the real movement sim, on a flat open floor.
// Run: npx tsx scripts/check-jump.ts
import { newBody, stepBody, BTN_JUMP, type Body } from '../src/shared/sim';
import type { GameMap } from '../src/shared/map';
import { TICK_DT, RUN_SPEED, HOP_MAX, JUMP_BUFFER } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
const st = { role: 'runner' as const, frozen: false, chilled: false, locked: false };
// Endless flat floor: nothing to bump into, so only timing decides
const FLAT = { solids: [], bridges: [], heightAt: () => 0 } as unknown as GameMap;
const step = (b: Body, jump: boolean, mx = 0) => stepBody(FLAT, b, { mx, mz: 0, b: jump ? BTN_JUMP : 0 }, st, TICK_DT);

/** Jump once, then press `offset` seconds relative to landing (negative = before). Seconds from landing to the 2nd jump. */
function secondJump(offset: number): number {
  const b = newBody(FLAT, 0, 0);
  step(b, true);
  // Find when this jump lands (same physics, dry run)
  const dry = newBody(FLAT, 0, 0);
  step(dry, true);
  let landT = 0;
  for (let t = TICK_DT; ; t += TICK_DT) { if (step(dry, t < 0.3).landed) { landT = t; break; } }
  let jumpedAt = -1;
  for (let t = TICK_DT; t < 2 && jumpedAt < 0; t += TICK_DT) {
    const press = Math.abs(t - (landT + offset)) < TICK_DT / 2;
    if (step(b, press || t < 0.3).jumped && t > 0.1) jumpedAt = t;
  }
  return jumpedAt < 0 ? Infinity : jumpedAt - landT;
}

const after = secondJump(0.15);
check(Math.abs(after - 0.15) < TICK_DT + 1e-6, `no cooldown: press 0.15s after landing → jumps at once (${after.toFixed(2)}s)`);
const early = secondJump(-0.03);
check(after < Infinity && Math.abs(early) <= TICK_DT * 2 + 1e-6, `press just before landing → fires on landing (${early.toFixed(3)}s after)`);
const tooEarly = secondJump(-0.12);
check(tooEarly === Infinity, `press ${0.12}s before landing (buffer ${JUMP_BUFFER}s) → lost, no jump`);

/** Run +x for `secs`, pressing Space per `press(t, sinceLanding, airborne)`; top hop multiplier and final speed. */
function hopRun(secs: number, press: (t: number, sinceLand: number, air: boolean) => boolean) {
  const b = newBody(FLAT, 0, 0);
  let landedAt = 0, top = 1, t = 0;
  for (; t < secs; t += TICK_DT) {
    const ev = step(b, press(t, t - landedAt, !b.grounded), 1);
    if (ev.landed) landedAt = t;
    top = Math.max(top, b.hop);
  }
  return { top, speed: Math.hypot(b.vx, b.vz) };
}

// Perfect timing: press on the first tick back on the ground
const timed = hopRun(4, (_t, since, air) => !air && since < TICK_DT * 1.5);
check(timed.top >= HOP_MAX - 1e-6 && timed.speed > RUN_SPEED * (HOP_MAX - 0.05), `timed hops build to ${HOP_MAX}× speed (top ${timed.top.toFixed(2)}×, ${timed.speed.toFixed(1)} u/s)`);
// Late: a fifth of a second on the ground each time
const late = hopRun(4, (_t, since, air) => !air && since > 0.2 && since < 0.2 + TICK_DT);
check(late.top <= 1 + 1e-6, `late hops gain nothing (top ${late.top.toFixed(2)}×)`);
// Mashing at a human 8 presses/s: some speed, nowhere near the timed top end on average
const mash = hopRun(6, t => Math.floor(t * 16) % 2 === 0);
console.log(`     (mashing 8×/s tops out at ${mash.top.toFixed(2)}×)`);
check(mash.top < timed.top, 'mashing does worse than timing');

console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
