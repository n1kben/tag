// Roof-to-roof navigation for bots. Candidate jumps come from geometry, but an edge only
// exists if the real movement sim (driven by the same steering bots use) completes it.
import { BUILDINGS, BRIDGES, PROPS, heightAt, type Solid } from './map';
import { newBody, stepBody, BTN_JUMP, type Body, type Input } from './sim';
import { TICK_DT, STEP_HEIGHT, KILL_Y } from './constants';

export interface NavEdge {
  to: number;
  rx: number; rz: number; // run-up spot on this surface
  tx: number; tz: number; // landing spot on the target surface
}

export interface NavNode { id: number; solid: Solid; cx: number; cz: number; edges: NavEdge[] }

const surfaces: Solid[] = [
  ...BUILDINGS.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
  ...BRIDGES.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
  ...PROPS.filter(p => p.kind === 'crate' || p.kind === 'crate2' || p.kind === 'ac' || p.kind === 'skylight')
    .map(p => ({ x0: p.x - p.w / 2, z0: p.z - p.d / 2, x1: p.x + p.w / 2, z1: p.z + p.d / 2, top: p.base + p.h })),
];

export const NAV: NavNode[] = surfaces.map((s, id) => ({
  id, solid: s, cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, edges: [],
}));

/** Topmost nav surface under a point that the body could be standing on. */
export function navNodeAt(x: number, z: number, y: number): NavNode | undefined {
  let best: NavNode | undefined;
  for (const n of NAV) {
    const s = n.solid;
    if (x >= s.x0 - 0.05 && x <= s.x1 + 0.05 && z >= s.z0 - 0.05 && z <= s.z1 + 0.05 && s.top <= y + 0.3) {
      if (!best || s.top > best.solid.top) best = n;
    }
  }
  return best;
}

/**
 * Steering toward a spot. With `leap` the bot runs straight at it and jumps at the lip
 * (committed to a validated edge). Without it, the bot hops knee-high obstacles but brakes
 * at drops, so walking around a roof never sends it over the edge.
 * Bots and edge validation share this so validated edges stay valid.
 */
export function steerTo(b: Body, tx: number, tz: number, run = 1, leap = true): Input {
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const ahead = heightAt(b.x + ux * 0.6, b.z + uz * 0.6);
  const hop = b.grounded && ahead > b.y + STEP_HEIGHT && ahead < b.y + 1.15;
  const holding = !b.grounded && b.vy > 0; // keep Space down for a full-height jump
  if (leap) {
    const jump = hop || holding || (b.grounded && ahead < b.y - 0.3);
    return { mx: ux * run, mz: uz * run, b: jump ? BTN_JUMP : 0 };
  }
  if (b.grounded) {
    // Look further ahead the faster we slide; stop short of any drop
    const look = 0.45 + Math.hypot(b.vx, b.vz) * 0.12;
    if (heightAt(b.x + ux * look, b.z + uz * look) < b.y - 0.3) return { mx: 0, mz: 0, b: 0 };
  }
  return { mx: ux * run, mz: uz * run, b: hop || holding ? BTN_JUMP : 0 };
}

function inside(s: Solid, x: number, z: number, m = 0): boolean {
  return x >= s.x0 + m && x <= s.x1 - m && z >= s.z0 + m && z <= s.z1 - m;
}

function clampIn(s: Solid, x: number, z: number, m: number): [number, number] {
  return [Math.max(s.x0 + m, Math.min(s.x1 - m, x)), Math.max(s.z0 + m, Math.min(s.z1 - m, z))];
}

function standsOn(s: Solid, x: number, z: number): boolean {
  return inside(s, x, z, 0.3) && Math.abs(heightAt(x, z) - s.top) < 0.01;
}

function simulate(from: NavNode, to: NavNode, e: NavEdge, drift: number, short: number): boolean {
  // Start up to `short` units past the run-up spot, with sideways drift, like a bot arriving from elsewhere
  const dx = e.tx - e.rx, dz = e.tz - e.rz, d = Math.hypot(dx, dz) || 1;
  const b = newBody(e.rx + (dx / d) * short, e.rz + (dz / d) * short);
  b.y = from.solid.top;
  b.vx = (-dz / d) * drift;
  b.vz = (dx / d) * drift;
  const st = { role: 'hider' as const, frozen: false, chilled: false, locked: false };
  for (let i = 0; i < 240; i++) {
    stepBody(b, steerTo(b, e.tx, e.tz), st, TICK_DT);
    if (b.y < KILL_Y) return false;
    if (b.grounded && navNodeAt(b.x, b.z, b.y)?.id === to.id) return true;
    if (b.grounded && i > 30 && Math.hypot(b.vx, b.vz) < 0.5) return false; // stuck on something
  }
  return false;
}

function candidates(a: Solid, b: Solid): NavEdge[] {
  const out: NavEdge[] = [];
  const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
  const gapZ = Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1);
  const push = (tx: number, tz: number, dirX: number, dirZ: number) => {
    // Run-up starts 2.5 behind the lip along the jump direction, kept on the source surface
    const [lx, lz] = clampIn(a, tx - dirX * 1.2, tz - dirZ * 1.2, 0.35);
    const [rx, rz] = clampIn(a, lx - dirX * 2.6, lz - dirZ * 2.6, 0.45);
    out.push({ to: -1, rx, rz, tx, tz });
  };

  if (gapX < 0 && gapZ < 0) {
    // Overlapping footprints: a crate/plank sitting on a roof, or a roof under a plank
    const small = (b.x1 - b.x0) * (b.z1 - b.z0) < (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a;
    const cx = (small.x0 + small.x1) / 2, cz = (small.z0 + small.z1) / 2;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const hx = (small.x1 - small.x0) / 2, hz = (small.z1 - small.z0) / 2;
      if (small === b) {
        // a → b: approach from outside, land on the small thing
        push(cx, cz, -nx, -nz);
      } else {
        // a (small) → b: step off a side, land 1 unit beyond it
        const tx = cx + nx * (hx + 1.0), tz = cz + nz * (hz + 1.0);
        out.push({ to: -1, rx: cx - nx * hx * 0.6, rz: cz - nz * hz * 0.6, tx, tz });
      }
    }
    return out;
  }

  if (gapX >= 0 && gapZ >= 0 && (gapX > 0.01 && gapZ > 0.01)) {
    // Diagonal corner jump
    const cx = a.x1 < b.x0 ? a.x1 : a.x0, cz = a.z1 < b.z0 ? a.z1 : a.z0;
    const tx = b.x0 > a.x1 ? b.x0 : b.x1, tz = b.z0 > a.z1 ? b.z0 : b.z1;
    const d = Math.hypot(tx - cx, tz - cz) || 1;
    const dirX = (tx - cx) / d, dirZ = (tz - cz) / d;
    push(tx + dirX * 0.9, tz + dirZ * 0.9, dirX, dirZ);
    return out;
  }

  // Side-by-side: sample along the shared span
  const alongX = gapZ >= 0 || gapX < 0; // shared span runs along x when separated in z
  const lo = alongX ? Math.max(a.x0, b.x0) : Math.max(a.z0, b.z0);
  const hi = alongX ? Math.min(a.x1, b.x1) : Math.min(a.z1, b.z1);
  const n = Math.max(1, Math.min(7, Math.floor((hi - lo) / 1.2)));
  for (let i = 0; i < n; i++) {
    const u = lo + ((i + 0.5) / n) * (hi - lo);
    if (alongX) {
      const dirZ = b.z0 >= a.z1 - 0.01 ? 1 : -1;
      const tz = dirZ > 0 ? b.z0 + 0.9 : b.z1 - 0.9;
      push(u, tz, 0, dirZ);
    } else {
      const dirX = b.x0 >= a.x1 - 0.01 ? 1 : -1;
      const tx = dirX > 0 ? b.x0 + 0.9 : b.x1 - 0.9;
      push(tx, u, dirX, 0);
    }
  }
  return out;
}

// Build once at load: ~a few thousand sim steps, a few ms
for (const a of NAV) {
  for (const b of NAV) {
    if (a === b) continue;
    const up = b.solid.top - a.solid.top;
    if (up > 1.2 || up < -4.5) continue;
    const gap = Math.hypot(
      Math.max(0, Math.max(a.solid.x0, b.solid.x0) - Math.min(a.solid.x1, b.solid.x1)),
      Math.max(0, Math.max(a.solid.z0, b.solid.z0) - Math.min(a.solid.z1, b.solid.z1)),
    );
    if (gap > 4.5) continue;
    for (const e of candidates(a.solid, b.solid)) {
      if (!standsOn(a.solid, e.rx, e.rz) || !standsOn(b.solid, e.tx, e.tz)) continue;
      e.to = b.id;
      const ok = [[0, 0], [3, 0], [-3, 0], [0, 0.45], [2, 0.45], [-2, 0.45]]
        .every(([drift, short]) => simulate(a, b, e, drift, short));
      if (ok) { a.edges.push(e); break; }
    }
  }
}

/** BFS over surfaces; first edge to take from `from` towards `to`. */
export function navNextEdge(from: number, to: number): NavEdge | null {
  if (from === to) return null;
  const prev = new Map<number, { node: number; edge: NavEdge }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const e of NAV[n].edges) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { node: n, edge: e });
      queue.push(e.to);
    }
  }
  if (!prev.has(to)) return null;
  let cur = to;
  while (prev.get(cur)!.node !== from) cur = prev.get(cur)!.node;
  return prev.get(cur)!.edge;
}

/** Roofs (buildings) only: handy for bots picking somewhere to go. */
export const ROOF_NODES = NAV.slice(0, BUILDINGS.length);
