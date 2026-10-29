// Jump cooldown checks with the real movement sim.
// Run: npx tsx scripts/check-jump.ts
import { newBody, stepBody, BTN_JUMP, type Body } from '../src/shared/sim';
import { FULL_MAP } from '../src/shared/map';
import { TICK_DT, JUMP_COOLDOWN } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
const st = { role: 'hider' as const, frozen: false, chilled: false, locked: false };
const step = (b: Body, jump: boolean) => stepBody(FULL_MAP, b, { mx: 0, mz: 0, b: jump ? BTN_JUMP : 0 }, st, TICK_DT);

/** Jump once, then press again `pressAfter` seconds after landing; when does the 2nd jump happen? */
function secondJumpDelay(pressAfter: number): number {
  const b = newBody(FULL_MAP, -2, -3); // open plaza
  step(b, true);
  let t = 0, landedAt = -1, jumpedAt = -1, held = false;
  for (let i = 0; i < 200 && jumpedAt < 0; i++) {
    t += TICK_DT;
    const press = landedAt >= 0 && t - landedAt >= pressAfter - 1e-9 && !held;
    const ev = step(b, press || (held && landedAt >= 0 && t - landedAt < pressAfter + 0.05));
    if (press) held = true;
    if (ev.landed && landedAt < 0) landedAt = t;
    if (ev.jumped && landedAt >= 0) jumpedAt = t;
  }
  return jumpedAt < 0 ? Infinity : jumpedAt - landedAt;
}

const queued = secondJumpDelay(0.1);
check(Math.abs(queued - JUMP_COOLDOWN) < 0.05, `press 0.1s after landing → jumps when the cooldown ends (${queued.toFixed(2)}s)`);
const free = secondJumpDelay(0.5);
check(Math.abs(free - 0.5) < 0.05, `press after the cooldown → jumps immediately (${free.toFixed(2)}s)`);

// Mashing Space can't out-pace the cooldown: count jumps in 3 seconds
{
  const b = newBody(FULL_MAP, -2, -3);
  let jumps = 0, landings = 0, minGap = Infinity, lastLand = -1, t = 0;
  for (let i = 0; i < 180; i++) {
    t += TICK_DT;
    const ev = step(b, i % 2 === 0); // press every other tick
    if (ev.landed) { landings++; lastLand = t; }
    if (ev.jumped) { jumps++; if (lastLand >= 0) minGap = Math.min(minGap, t - lastLand); }
  }
  check(minGap >= JUMP_COOLDOWN - 1e-6, `mashing: never jumps sooner than ${JUMP_COOLDOWN}s after landing (min ${minGap.toFixed(2)}s, ${jumps} jumps in 3s)`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
