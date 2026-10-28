// Prints the feel numbers of the movement sim: time to top speed, stop slide, jump arcs.
// Run: npx tsx scripts/jump-metrics.ts
import { newBody, stepBody, BTN_JUMP, type Body } from '../src/shared/sim';
import { TICK_DT, RUN_SPEED, PLAYER_RADIUS } from '../src/shared/constants';

const st = { role: 'hider' as const, frozen: false, chilled: false, locked: false };
const W = PLAYER_RADIUS * 2; // body width

function onPlaza(): Body {
  const b = newBody(-6, -2); // middle of the plaza roof, lots of room to the right
  b.y = 1;
  return b;
}

// Run-up: time to 90% speed
let b = onPlaza();
let t = 0;
while (Math.hypot(b.vx, b.vz) < RUN_SPEED * 0.9) { stepBody(b, { mx: 1, mz: 0, b: 0 }, st, TICK_DT); t += TICK_DT; }
console.log(`top speed ${RUN_SPEED} u/s = ${(RUN_SPEED / W).toFixed(1)} body-widths/s; 90% after ${(t * 1000).toFixed(0)}ms`);

// Stop slide
for (let i = 0; i < 30; i++) stepBody(b, { mx: 1, mz: 0, b: 0 }, st, TICK_DT);
const x0 = b.x;
t = 0;
while (Math.hypot(b.vx, b.vz) > 0.1) { stepBody(b, { mx: 0, mz: 0, b: 0 }, st, TICK_DT); t += TICK_DT; }
console.log(`stop: slides ${(b.x - x0).toFixed(2)}u (${((b.x - x0) / W).toFixed(1)} widths) in ${(t * 1000).toFixed(0)}ms`);

// Jumps from a run: full hold vs tap
for (const [label, holdTicks] of [['full hold', 999], ['tap (2 ticks)', 2]] as const) {
  b = onPlaza();
  for (let i = 0; i < 40; i++) stepBody(b, { mx: 1, mz: 0, b: 0 }, st, TICK_DT);
  const sx = b.x, sy = b.y;
  let apex = 0, air = 0, i = 0;
  do {
    stepBody(b, { mx: 1, mz: 0, b: i < holdTicks ? BTN_JUMP : 0 }, st, TICK_DT);
    apex = Math.max(apex, b.y - sy);
    air += TICK_DT;
    i++;
  } while (!b.grounded && i < 200);
  console.log(`${label}: apex ${apex.toFixed(2)}u, airtime ${(air * 1000).toFixed(0)}ms, distance ${(b.x - sx).toFixed(2)}u`);
}
