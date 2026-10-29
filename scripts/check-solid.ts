// Solid players, heads, stomps and weak planks, checked with the real sim / server.
// Run: npx tsx scripts/check-solid.ts
import { newBody, stepBody, BTN_JUMP, type Body, type Dyn, type Role } from '../src/shared/sim';
import { steerTo } from '../src/shared/nav';
import { FULL_MAP } from '../src/shared/map';
import { Match, type MPlayer } from '../src/server/match';
import { TICK_DT, KILL_Y, PLAYER_HEIGHT, PLANK_CRACK_TIME, PLANK_FIX_TIME } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
const map = FULL_MAP;
const status = (role: Role) => ({ role, frozen: false, chilled: false, locked: false });
const still = (id: number, b: Body, role: Role): Dyn['bodies'][number] => ({ id, x: b.x, y: b.y, z: b.z, role });

// 1) Edge block: seeker leaps plaza → east terrace across the alley (z = -6, away from the planks)
function leap(blocker: boolean, tap: boolean): 'landed' | 'fell' | 'other' {
  const seeker = newBody(map, 5, -6);
  const guard = newBody(map, 10.95, -6); // hider standing right at the far roof's edge
  const dyn: Dyn = { bodies: blocker ? [still(2, guard, 'hider')] : [] };
  let jumped = false;
  for (let i = 0; i < 240; i++) {
    let input = steerTo(map, seeker, 14, -6); // run at the far roof, jump at the lip
    if (tap && jumped && !seeker.grounded) input = { ...input, b: 0 }; // short hop
    if (input.b & BTN_JUMP) jumped = true;
    stepBody(map, seeker, input, status('seeker'), TICK_DT, dyn);
    if (seeker.y < KILL_Y) return 'fell';
    if (seeker.grounded && seeker.x > 10.6 && Math.abs(seeker.y) < 0.01) return 'landed';
  }
  return 'other';
}
check(map.heightAt(11.5, -6) === 0 && map.heightAt(9.75, -6) === -Infinity, 'test setup: open alley at z=-6');
check(leap(false, false) === 'landed', 'no guard: the leap to the next roof lands');
check(leap(true, false) === 'fell', 'hider guarding the edge: a full leap is bonked into the alley');
check(leap(true, true) === 'fell', 'hider guarding the edge: a short hop is body-blocked into the alley');

// 2) Standing on a teammate's head
{
  const a = newBody(map, 0, -3);
  const b = newBody(map, 0.1, -3);
  b.y = 2.5; b.grounded = false;
  for (let i = 0; i < 60; i++) stepBody(map, b, { mx: 0, mz: 0, b: 0 }, status('hider'), TICK_DT, { bodies: [still(1, a, 'hider')] });
  check(b.grounded && Math.abs(b.y - PLAYER_HEIGHT) < 0.01 && b.onHead, `drop onto a teammate → standing on their head (y=${b.y.toFixed(2)})`);
}

// 3) Boost: a stair hut roof (2.4 up) is out of reach from the ground but reachable off a head
{
  const hut = map.props.find(p => p.kind === 'hut')!;
  const sx = hut.x - hut.w / 2 - 0.9, sz = hut.z; // just west of the hut
  const tryReach = (fromHead: boolean): number => {
    const a = newBody(map, sx, sz);
    const b = newBody(map, sx, sz);
    if (fromHead) { b.y = PLAYER_HEIGHT; b.onHead = true; } else { b.x = sx - 0.9; }
    const dyn: Dyn = { bodies: fromHead ? [still(1, a, 'hider')] : [] };
    let best = b.y;
    for (let i = 0; i < 120; i++) {
      stepBody(map, b, { mx: 1, mz: 0, b: i < 40 ? BTN_JUMP : 0 }, status('hider'), TICK_DT, dyn);
      if (b.grounded) best = Math.max(best, b.y);
    }
    return best;
  };
  const ground = tryReach(false), head = tryReach(true);
  check(ground < hut.h - 0.01, `from the ground you can't get onto a hut (best ${ground.toFixed(2)})`);
  check(Math.abs(head - hut.h) < 0.01, `boosted off a teammate's head you land on the hut roof (${head.toFixed(2)})`);
}

// 4) Stomp (hider on seeker) vs bonk (seeker on hider)
for (const [lander, under] of [['hider', 'seeker'], ['seeker', 'hider']] as const) {
  const a = newBody(map, 0, -3);
  const b = newBody(map, 0.1, -3);
  b.y = 3; b.grounded = false; b.vx = 0.4; // drifting slightly, still over their head on the way down
  let stomped: number | null = null, bounced = false;
  for (let i = 0; i < 40 && stomped === null && !bounced; i++) {
    const vy0 = b.vy;
    const ev = stepBody(map, b, { mx: 0, mz: 0, b: 0 }, status(lander), TICK_DT, { bodies: [still(7, a, under)] });
    if (ev.stomped !== null) stomped = ev.stomped;
    if (vy0 < 0 && b.vy > 0) bounced = true;
  }
  if (lander === 'hider') check(stomped === 7, 'hider lands on a seeker → stomp (seeker gets stunned)');
  else check(stomped === null && bounced && b.vx < 0, 'seeker lands on a hider → bonked back, no stomp');
}

// 5) Weak plank through the real server: crack → collapse (player drops) → rebuilt once clear
{
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: false }));
  const m = new Match({ send() {}, onMatchEnd() {} }, roster, 'dm'); // deaths don't end a round (and reset planks) here
  const I = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number };
  I.startRound(true);
  I.phase = 'seek'; I.timeLeft = 999;
  const i = map.bridges.findIndex(b => b.x0 === -0.6 && b.z0 === -12.2); // plaza ↔ north garden
  const br = map.bridges[i];
  const [p, q] = m.players as MPlayer[];
  p.body = newBody(map, 0, (br.z0 + br.z1) / 2); // middle of the plank, over the alley
  q.body = newBody(map, 5, -3);
  const state = () => (m as unknown as { planks: { state: number }[] }).planks[i].state;
  let t = 0, crackAt = -1, breakAt = -1, fixAt = -1, fell = false;
  while (t < PLANK_CRACK_TIME + PLANK_FIX_TIME + 3) {
    I.step(); t += TICK_DT;
    if (state() === 1 && crackAt < 0) crackAt = t;
    if (state() === 2 && breakAt < 0) breakAt = t;
    if (breakAt > 0 && state() === 0 && fixAt < 0) fixAt = t;
    if (!p.alive) fell = true;
  }
  check(crackAt >= 0 && crackAt < 0.1, `stepping on the plank over the gap cracks it (${crackAt.toFixed(2)}s)`);
  check(Math.abs(breakAt - crackAt - PLANK_CRACK_TIME) < 0.05, `it collapses ${PLANK_CRACK_TIME}s later (${(breakAt - crackAt).toFixed(2)}s)`);
  check(fell, 'the player on it drops into the alley');
  check(Math.abs(fixAt - breakAt - PLANK_FIX_TIME) < 0.05, `it's rebuilt ${PLANK_FIX_TIME}s after collapsing (${(fixAt - breakAt).toFixed(2)}s)`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
