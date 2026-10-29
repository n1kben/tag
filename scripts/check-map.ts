// Map checks. For every map size (roofs chosen per player count), each roof must be reachable from
// the plaza and have a way back, using that map's own validated nav (every edge in it was completed
// by the real movement sim). Plus: spawns clear, no in-between obstacle heights, every low obstacle
// clearable with the real jump. Run: npx tsx scripts/check-map.ts
import { navFor, steerTo, type Nav } from '../src/shared/nav';
import { FULL_MAP, PLAZA_ID, SEEKER_SPAWNS, HIDER_SPAWNS, LOW_MAX, TALL_MIN, ROOF_H, mapFor, roofsForPlayers } from '../src/shared/map';
import { newBody, stepBody } from '../src/shared/sim';
import { TICK_DT, PLAYER_RADIUS } from '../src/shared/constants';

let failures = 0;

function reach(nav: Nav, from: number): Set<number> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    for (const e of nav.nodes[c].edges) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
  }
  return seen;
}

// 1) Every map size is one connected, escapable patch
const sizes = new Map<string, number[]>();
for (let players = 1; players <= 18; players++) {
  const key = roofsForPlayers(players).join(',');
  sizes.set(key, [...(sizes.get(key) ?? []), players]);
}
for (const [key, players] of sizes) {
  const map = mapFor(key.split(',').map(Number));
  const t0 = Date.now();
  const nav = navFor(map);
  const ms = Date.now() - t0;
  const plazaNode = map.buildings.findIndex(b => b.id === PLAZA_ID); // roof nodes come first, in building order
  const fromPlaza = reach(nav, plazaNode);
  const unreachable = map.buildings.filter((_, i) => !fromPlaza.has(i)).map(b => b.id);
  const stuck = map.buildings.filter((_, i) => !reach(nav, i).has(plazaNode)).map(b => b.id);
  const ok = !unreachable.length && !stuck.length;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${map.buildings.length} roofs (players ${players[0]}–${players.at(-1)}): `
    + `${nav.nodes.reduce((n, x) => n + x.edges.length, 0)} jumps, nav built in ${ms}ms`
    + (ok ? '' : ` unreachable [${unreachable}] no way back [${stuck}]`));
}

// 2) Spawns must stand on clear roof with a body's room around them (the plaza is in every map)
const badSpawns = [...SEEKER_SPAWNS, ...HIDER_SPAWNS].filter(([x, z]) =>
  [[0, 0], [PLAYER_RADIUS, 0], [-PLAYER_RADIUS, 0], [0, PLAYER_RADIUS], [0, -PLAYER_RADIUS]].some(([dx, dz]) => FULL_MAP.heightAt(x + dx, z + dz) !== ROOF_H));
console.log(`spawns blocked: [${badSpawns.map(s => s.join(',')).join(' ')}]`);

// 3) Two heights only: low (jumpable) or tall (run around), nothing ambiguous in between
const ambiguous = FULL_MAP.props.filter(p => p.h > LOW_MAX && p.h < TALL_MIN && p.kind !== 'skylight');
console.log(`ambiguous-height props: [${ambiguous.map(p => p.kind).join(',')}]`);

// 4) Every low obstacle is clearable by a running jump with the real physics
let unjumpable = 0;
for (const p of FULL_MAP.props.filter(q => q.h <= LOW_MAX && q.kind !== 'skylight')) {
  const across = p.w < p.d ? 'x' : 'z'; // jump over the thin side
  const b = across === 'x' ? newBody(FULL_MAP, p.x - p.w / 2 - 2.2, p.z) : newBody(FULL_MAP, p.x, p.z - p.d / 2 - 2.2);
  if (FULL_MAP.heightAt(b.x, b.z) !== ROOF_H) continue; // approach blocked by another prop; skip
  // Hop whatever low obstacles come up (like a player would), heading past this one
  const tx = across === 'x' ? p.x + p.w / 2 + 1.5 : p.x, tz = across === 'x' ? p.z : p.z + p.d / 2 + 1.5;
  let cleared = false;
  for (let i = 0; i < 180; i++) {
    stepBody(FULL_MAP, b, steerTo(FULL_MAP, b, tx, tz, 1, false), { role: 'hider', frozen: false, chilled: false, locked: false }, TICK_DT);
    if ((across === 'x' ? b.x > p.x + p.w / 2 + 0.5 : b.z > p.z + p.d / 2 + 0.5)) { cleared = true; break; }
  }
  if (!cleared) { unjumpable++; console.log(`  can't jump ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`); }
}
console.log(`low obstacles that can't be jumped: ${unjumpable}`);
process.exit(failures || badSpawns.length || ambiguous.length || unjumpable ? 1 : 0);
