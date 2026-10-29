// Slash checks through the real server tick (Enter press → lunge → hit test):
// how close you must be on open roof, and that walls/obstacles block it.
// Run: npx tsx scripts/check-slash.ts
import { Match, type MPlayer } from '../src/server/match';
import { FULL_MAP, ROOF_H } from '../src/shared/map';
import { BTN_ACTION } from '../src/shared/sim';
import { PLAYER_RADIUS } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

/** Seeker at (ax, az) facing +x/+z towards a hider at (tx, tz); press Enter once; did it hit? */
function slash(ax: number, az: number, tx: number, tz: number): boolean {
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: false }));
  const m = new Match({ send() {}, onMatchEnd() {} }, roster, 'hns');
  const I = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number };
  I.startRound(true);
  const [s, h] = m.players as MPlayer[];
  s.role = 'seeker'; h.role = 'hider';
  I.phase = 'seek'; I.timeLeft = 100;
  for (const [p, x, z] of [[s, ax, az], [h, tx, tz]] as const) {
    p.body.x = x; p.body.z = z; p.body.y = FULL_MAP.heightAt(x, z); p.body.vx = p.body.vz = p.body.vy = 0; p.body.grounded = true;
  }
  const dx = tx - ax, dz = tz - az, l = Math.hypot(dx, dz);
  s.body.facing = Math.atan2(dx, dz);
  h.body.facing = s.body.facing + Math.PI; // facing the attacker: no backstab
  // One input per tick like a real client (the server drops backlog): Enter on the first tick
  for (let i = 1; i <= 20; i++) {
    m.pushInput(1, i, { mx: (dx / l) * 0.01, mz: (dz / l) * 0.01, b: i === 1 ? BTN_ACTION : 0 });
    I.step();
  }
  return h.hp < 100;
}

// 1) Reach on open roof (plaza middle, nothing in between)
const gaps = [0.1, 0.2, 0.3, 0.45, 0.6, 0.9];
const results = gaps.map(g => ({ g, hit: slash(-1, -3, -1 + PLAYER_RADIUS * 2 + g, -3) }));
console.log('open roof, gap between bodies → hit?', results.map(r => `${r.g}u:${r.hit ? 'HIT' : 'miss'}`).join('  '));
check(results.find(r => r.g === 0.1)!.hit && results.find(r => r.g === 0.3)!.hit, 'hits when (almost) touching');
check(!results.find(r => r.g === 0.6)!.hit && !results.find(r => r.g === 0.9)!.hit, 'misses from more than half a body-width away');

// 2) Obstacles block it: put a low wall/duct/hedge/crate between two players near-touching
for (const kind of ['wall', 'hedge', 'duct', 'crate', 'hut'] as const) {
  const p = FULL_MAP.props.find(q => q.kind === kind);
  if (!p) continue;
  const acrossX = p.w <= p.d; // slash across the thin side
  const half = (acrossX ? p.w : p.d) / 2 + PLAYER_RADIUS + 0.05;
  const [ax, az, tx, tz] = acrossX ? [p.x - half, p.z, p.x + half, p.z] : [p.x, p.z - half, p.x, p.z + half];
  if (FULL_MAP.heightAt(ax, az) !== ROOF_H || FULL_MAP.heightAt(tx, tz) !== ROOF_H) { console.log(`  (skip ${kind}: no clear standing spots)`); continue; }
  check(!slash(ax, az, tx, tz), `${kind} (${p.h}u tall) between you blocks the slash`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
