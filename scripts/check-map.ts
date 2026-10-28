// Reports which roofs the validated nav graph can reach. Every edge in NAV has already been
// completed by the real movement sim, so gaps here are real map problems.
// Run: npx tsx scripts/check-map.ts
import { NAV } from '../src/shared/nav';
import { BUILDINGS } from '../src/shared/map';

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
process.exit(unreachable.length || stuck.length ? 1 : 0);
