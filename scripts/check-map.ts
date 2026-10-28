// Reports which roofs the validated nav graph can reach. Every edge in NAV has already been
// completed by the real movement sim, so gaps here are real map problems.
// Run: npx tsx scripts/check-map.ts
import { NAV, steerTo } from '../src/shared/nav';
import { BUILDINGS, PROPS, SEEKER_SPAWNS, HIDER_SPAWNS, heightAt, LOW_MAX, TALL_MIN, ROOF_H } from '../src/shared/map';
import { newBody, stepBody } from '../src/shared/sim';
import { TICK_DT, PLAYER_RADIUS } from '../src/shared/constants';

function reach(from: number): Set<number> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    for (const e of NAV[c].edges) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
  }
  return seen;
}

const PLAZA = 7;
const fromPlaza = reach(PLAZA);
const edges = NAV.reduce((n, x) => n + x.edges.length, 0);
const roofs = BUILDINGS.map(b => b.id);
const unreachable = roofs.filter(id => !fromPlaza.has(id));
const stuck = roofs.filter(id => !reach(id).has(PLAZA));
console.log(`surfaces ${NAV.length}, validated edges ${edges}`);
console.log(`roofs unreachable from plaza: [${unreachable}]`);
console.log(`roofs with no way back to plaza: [${stuck}]`);
for (const id of roofs) {
  console.log(`  roof ${id} (h ${BUILDINGS[id].h}) → ${[...new Set(NAV[id].edges.map(e => e.to))].join(',')}`);
}

// Spawns must stand on clear roof with a body's room around them
const badSpawns = [...SEEKER_SPAWNS, ...HIDER_SPAWNS].filter(([x, z]) =>
  [[0, 0], [PLAYER_RADIUS, 0], [-PLAYER_RADIUS, 0], [0, PLAYER_RADIUS], [0, -PLAYER_RADIUS]].some(([dx, dz]) => heightAt(x + dx, z + dz) !== ROOF_H));
console.log(`spawns blocked: [${badSpawns.map(s => s.join(',')).join(' ')}]`);

// Two heights only: low (jumpable) or tall (run around), nothing ambiguous in between
const ambiguous = PROPS.filter(p => p.h > LOW_MAX && p.h < TALL_MIN && p.kind !== 'skylight');
console.log(`ambiguous-height props: [${ambiguous.map(p => p.kind).join(',')}]`);

// Every low obstacle is clearable by a running jump with the real physics
let unjumpable = 0;
for (const p of PROPS.filter(q => q.h <= LOW_MAX && q.kind !== 'skylight')) {
  const across = p.w < p.d ? 'x' : 'z'; // jump over the thin side
  const b = across === 'x' ? newBody(p.x - p.w / 2 - 2.2, p.z) : newBody(p.x, p.z - p.d / 2 - 2.2);
  if (heightAt(b.x, b.z) !== ROOF_H) continue; // approach blocked by another prop; skip
  // Hop whatever low obstacles come up (like a player would), heading past this one
  const tx = across === 'x' ? p.x + p.w / 2 + 1.5 : p.x, tz = across === 'x' ? p.z : p.z + p.d / 2 + 1.5;
  let cleared = false;
  for (let i = 0; i < 180; i++) {
    stepBody(b, steerTo(b, tx, tz, 1, false), { role: 'hider', frozen: false, chilled: false, locked: false }, TICK_DT);
    if ((across === 'x' ? b.x > p.x + p.w / 2 + 0.5 : b.z > p.z + p.d / 2 + 0.5)) { cleared = true; break; }
  }
  if (!cleared) { unjumpable++; console.log(`  can't jump ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`); }
}
console.log(`low obstacles that can't be jumped: ${unjumpable}`);
process.exit(unreachable.length || stuck.length || badSpawns.length || ambiguous.length || unjumpable ? 1 : 0);
