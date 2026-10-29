import { ROUND_TIME, MIN_ROUND_TIME } from './constants';
// "Rooftops" — a city of flat roofs over a misty drop, laid out like hns/awp_rooftops.
// Every roof is the same height: the skill is timing jumps across the alleys and through the
// obstacles. Obstacles come in exactly two heights so they read at a glance:
//   LOW  (crates, AC units, vents, ducts, low walls, hedges ≤ 0.85): always jumpable
//   TALL (water tanks, stair huts, chimneys, stalls ≥ 2): run around them
// Each roof gets a maze-like layout that never seals a path, with a clear strip along the edges
// for run-ups. One authoritative definition: physics, prediction, rendering and bots all read this.

export type RoofStyle = 'cream' | 'terra' | 'mint' | 'garden' | 'plaza' | 'tower';

export interface Building {
  id: number;
  x0: number; z0: number; x1: number; z1: number;
  h: number; // roof height
  style: RoofStyle;
}

export type PropKind =
  | 'ac' | 'crate' | 'vent' | 'duct' | 'wall' | 'hedge' | 'skylight' // low
  | 'chimney' | 'tank' | 'booth' | 'hut'; // tall

export interface Prop {
  kind: PropKind;
  x: number; z: number;
  w: number; d: number;
  h: number; // height above the surface it stands on
  base: number; // world y of its bottom
  rot?: number; // visual only, collision stays axis-aligned
}

export interface Bridge {
  x0: number; z0: number; x1: number; z1: number;
  h: number;
}

export interface Bunting {
  ax: number; az: number; bx: number; bz: number; base: number;
}

// Axis-aligned column from the void up to `top`. Everything solid in the map is one of these.
export interface Solid {
  x0: number; z0: number; x1: number; z1: number;
  top: number;
}

export const ROOF_H = 0;
export const LOW_MAX = 0.85; // anything at or below this is meant to be jumped
export const TALL_MIN = 2; // anything at or above this is meant to be run around

// Footprints below are the street grid; each roof spreads ROOF_GROW past it on every side,
// which sets alley width to match the jump (alleys = grid gap − 2 × ROOF_GROW).
const ROOF_GROW = 0.5;
const B = (id: number, x0: number, z0: number, x1: number, z1: number, style: RoofStyle): Building =>
  ({ id, x0: x0 - ROOF_GROW, z0: z0 - ROOF_GROW, x1: x1 + ROOF_GROW, z1: z1 + ROOF_GROW, h: ROOF_H, style });

export const BUILDINGS: Building[] = [
  // North row
  B(0, -34, -24, -22, -14, 'cream'),
  B(1, -19.5, -25, -8, -15, 'terra'),
  B(2, -5, -24, 5, -12, 'garden'),
  B(3, 8, -25, 19, -14, 'mint'),
  B(4, 21.5, -24, 34, -13, 'cream'),
  // Middle row
  B(5, -34, -11, -24, 1, 'garden'),
  B(6, -21, -12, -11, -1, 'tower'),
  B(7, -8.5, -9, 8.5, 3, 'plaza'),
  B(8, 11, -11, 22, 0, 'terra'),
  B(9, 24, -10, 34, 2, 'cream'),
  // South row
  B(10, -34, 4, -21, 14, 'terra'),
  B(11, -18, 6, -6, 17, 'mint'),
  B(12, -3, 6, 9, 16, 'cream'),
  B(13, 12, 3, 24.5, 13, 'garden'),
  B(14, 26, 5, 34, 15, 'tower'),
  B(15, -30, 17, -16, 25, 'cream'),
  B(16, -2, 19, 14, 25, 'garden'),
  B(17, 17, 17, 30, 25, 'terra'),
];

// Planks over the gaps too wide to jump
export const BRIDGES: Bridge[] = [
  { x0: -16.6, z0: 17.6, x1: -15.4, z1: 21.5, h: ROOF_H },
  { x0: -16, z0: 19, x1: -2, z1: 20.2, h: ROOF_H },
  { x0: 5, z0: -19, x1: 8, z1: -17.8, h: ROOF_H },
];

// ── Obstacle layouts ──────────────────────────────────────────────────────
// Fixed-size kinds: [w, d, h]. Linear kinds (duct/wall/hedge) take their length from the layout.
const PROP_SIZE: Record<PropKind, [number, number, number]> = {
  ac: [1.5, 1.1, 0.8],
  crate: [1.6, 1.6, 0.7],
  vent: [0.6, 0.6, 0.6],
  skylight: [2.2, 1.4, 0.3],
  duct: [0, 0.8, 0.55],
  wall: [0, 0.5, 0.75],
  hedge: [0, 0.9, 0.85],
  chimney: [1.0, 1.0, 2.2],
  tank: [2.2, 2.2, 3.4],
  booth: [3.2, 2.4, 2.6],
  hut: [2.6, 2.2, 2.4],
};

// Layout pieces in the roof's own frame: u runs along the long side, v across, both 0..1 of the
// usable area (roof minus an edge strip). 'along' = a linear piece spanning u0..u1 at v;
// 'across' = spanning v0..v1 at u; 'at' = a fixed-size prop at (u, v).
type Piece =
  | { k: PropKind; along: [number, number]; v: number }
  | { k: PropKind; across: [number, number]; u: number }
  | { k: PropKind; at: [number, number] };

const LAYOUTS: Record<string, Piece[]> = {
  // Staggered ducts: hop them or run around the open ends
  ducts: [
    { k: 'duct', along: [0, 0.62], v: 0.3 },
    { k: 'duct', along: [0.38, 1], v: 0.72 },
    { k: 'tank', at: [0.92, 0.08] },
    { k: 'crate', at: [0.08, 0.92] },
  ],
  // A stair hut with a broken ring of low walls around it
  courtyard: [
    { k: 'hut', at: [0.5, 0.5] },
    { k: 'wall', along: [0.12, 0.42], v: 0.08 },
    { k: 'wall', along: [0.58, 0.88], v: 0.92 },
    { k: 'wall', across: [0.35, 0.75], u: 0.06 },
    { k: 'ac', at: [0.94, 0.35] },
  ],
  // Low walls alternating sides: a slalom you can also jump straight through
  slalom: [
    { k: 'wall', across: [0, 0.58], u: 0.22 },
    { k: 'wall', across: [0.42, 1], u: 0.5 },
    { k: 'wall', across: [0, 0.58], u: 0.78 },
    { k: 'chimney', at: [0.96, 0.92] },
    { k: 'vent', at: [0.04, 0.92] },
  ],
  // Hedge rows (the trailer's grass tufts, now a low hedge maze)
  hedges: [
    { k: 'hedge', along: [0, 0.6], v: 0.15 },
    { k: 'hedge', along: [0.4, 1], v: 0.5 },
    { k: 'hedge', along: [0, 0.6], v: 0.85 },
    { k: 'booth', at: [0.88, 0.12] },
  ],
  // A stall, a crate pile and a duct
  yard: [
    { k: 'booth', at: [0.2, 0.3] },
    { k: 'crate', at: [0.66, 0.22] },
    { k: 'crate', at: [0.82, 0.32] },
    { k: 'duct', along: [0.45, 1], v: 0.85 },
    { k: 'skylight', at: [0.12, 0.88] },
  ],
};

const LAYOUT_FOR: Record<number, keyof typeof LAYOUTS> = {
  0: 'ducts', 1: 'courtyard', 2: 'hedges', 3: 'hedges', 4: 'slalom',
  5: 'hedges', 6: 'slalom', 8: 'yard', 9: 'ducts',
  10: 'courtyard', 11: 'hedges', 12: 'slalom', 13: 'hedges', 14: 'ducts',
  15: 'yard', 16: 'hedges', 17: 'courtyard',
};

const EDGE_STRIP = 1.6; // keep this much clear along every roof edge for run-ups
const CLEARANCE = 1.1; // min gap between obstacles: always room to run through
const FILL: PropKind[] = ['crate', 'ac', 'vent', 'crate', 'ac']; // low scatter in open space

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearOf(p: Prop, others: Prop[], gap: number): boolean {
  return others.every(o =>
    Math.abs(p.x - o.x) >= (p.w + o.w) / 2 + gap || Math.abs(p.z - o.z) >= (p.d + o.d) / 2 + gap);
}

function layoutProps(b: Building, pieces: Piece[]): Prop[] {
  const x0 = b.x0 + EDGE_STRIP, x1 = b.x1 - EDGE_STRIP, z0 = b.z0 + EDGE_STRIP, z1 = b.z1 - EDGE_STRIP;
  const alongX = x1 - x0 >= z1 - z0;
  const lenU = alongX ? x1 - x0 : z1 - z0, lenV = alongX ? z1 - z0 : x1 - x0;
  // Same layout reads differently per roof: mirror it seeded by the building id
  const rng = seeded(b.id * 7919 + 13);
  const flipU = rng() < 0.5, flipV = rng() < 0.5;
  const fu = (u: number) => (flipU ? 1 - u : u), fv = (v: number) => (flipV ? 1 - v : v);
  // Map (u, v) to world, keeping a prop of half-size (hu, hv) inside the usable area
  const at = (u: number, v: number, hu: number, hv: number): [number, number] => {
    const pu = Math.min(Math.max(fu(u) * lenU, hu), lenU - hu);
    const pv = Math.min(Math.max(fv(v) * lenV, hv), lenV - hv);
    return alongX ? [x0 + pu, z0 + pv] : [x0 + pv, z0 + pu];
  };
  const out: Prop[] = [];
  const place = (prop: Prop) => { if (clearOf(prop, out, CLEARANCE)) out.push(prop); };
  for (const p of pieces) {
    const [sw, sd, h] = PROP_SIZE[p.k];
    if ('at' in p) {
      const [hu, hv] = alongX ? [sw / 2, sd / 2] : [sd / 2, sw / 2];
      if (hu * 2 > lenU || hv * 2 > lenV) continue; // roof too small for it
      const [x, z] = at(p.at[0], p.at[1], hu, hv);
      place({ kind: p.k, x, z, w: sw, d: sd, h, base: b.h });
    } else if ('along' in p) {
      const len = (p.along[1] - p.along[0]) * lenU;
      const [x, z] = at((p.along[0] + p.along[1]) / 2, p.v, len / 2, sd / 2);
      place({ kind: p.k, x, z, w: alongX ? len : sd, d: alongX ? sd : len, h, base: b.h });
    } else {
      const len = (p.across[1] - p.across[0]) * lenV;
      const [x, z] = at(p.u, (p.across[0] + p.across[1]) / 2, sd / 2, len / 2);
      place({ kind: p.k, x, z, w: alongX ? sd : len, d: alongX ? len : sd, h, base: b.h });
    }
  }
  // Fill open space with low clutter: more to hop over, still room to weave through
  const target = out.length + Math.floor((lenU * lenV) / 14);
  for (let tries = 0; tries < 300 && out.length < target; tries++) {
    const kind = FILL[Math.floor(rng() * FILL.length)];
    const [sw, sd, h] = PROP_SIZE[kind];
    const x = x0 + sw / 2 + rng() * Math.max(0, x1 - x0 - sw), z = z0 + sd / 2 + rng() * Math.max(0, z1 - z0 - sd);
    const prop: Prop = { kind, x, z, w: sw, d: sd, h, base: b.h };
    // …and never right in front of something tall, so a jump over it has somewhere to land
    if (clearOf(prop, out.filter(o => o.h < TALL_MIN), CLEARANCE + 0.2) && clearOf(prop, out.filter(o => o.h >= TALL_MIN), 2.2)) out.push(prop);
  }
  return out;
}

// The plaza is the spawn: open middle, low planters and crates around it
const PLAZA_PROPS: Prop[] = ([
  ['hedge', -4.2, -6.2, 3.6, 0.9], ['hedge', 4.2, -6.2, 3.6, 0.9],
  ['hedge', -4.2, 0.2, 3.6, 0.9], ['hedge', 4.2, 0.2, 3.6, 0.9],
  ['crate', -7, -3, 1.6, 1.6], ['crate', 7, -3, 1.6, 1.6],
  ['chimney', 7.3, 2.2, 1.0, 1.0], ['vent', -7.4, 2.3, 0.6, 0.6],
] as [PropKind, number, number, number, number][]).map(([kind, x, z, w, d]) => ({ kind, x, z, w, d, h: PROP_SIZE[kind][2], base: ROOF_H }));

// Each roof's obstacles, computed once and seeded by roof id: a roof looks the same at every map size
const ROOF_PROPS = new Map<number, Prop[]>(BUILDINGS.map(b =>
  [b.id, b.style === 'plaza' ? PLAZA_PROPS : layoutProps(b, LAYOUTS[LAYOUT_FOR[b.id]])]));

const ALL_BUNTINGS: Bunting[] = [
  { ax: -8, az: -8.8, bx: 8, bz: -8.8, base: ROOF_H },
  { ax: -5, az: -12.5, bx: 5, bz: -12.5, base: ROOF_H },
  { ax: 12, az: 3.5, bx: 23, bz: 3.5, base: ROOF_H },
  { ax: -2, az: 24.5, bx: 14, bz: 24.5, base: ROOF_H },
];

export const MAP_BOUNDS = { x0: -36, z0: -27, x1: 36, z1: 27 };
export const PLAZA_ID = 7;

function inRect(r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function overlaps(a: { x0: number; z0: number; x1: number; z1: number }, b: { x0: number; z0: number; x1: number; z1: number }): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/**
 * A playable map: a subset of the city's roofs (the rest stays in the backdrop, out of reach).
 * Matches size it to the player count; physics, bots and rendering all take one of these.
 */
export class GameMap {
  readonly buildings: Building[];
  readonly bridges: Bridge[];
  readonly props: Prop[];
  readonly buntings: Bunting[];
  readonly solids: Solid[];

  constructor(readonly roofIds: number[]) {
    const ids = new Set(roofIds);
    this.buildings = BUILDINGS.filter(b => ids.has(b.id));
    // Planks only if every roof they touch is in play
    this.bridges = BRIDGES.filter(br => BUILDINGS.filter(b => overlaps(br, b)).every(b => ids.has(b.id)));
    this.props = this.buildings.flatMap(b => ROOF_PROPS.get(b.id)!);
    this.buntings = ALL_BUNTINGS.filter(bt => this.buildingAt(bt.ax, bt.az) && this.buildingAt(bt.bx, bt.bz));
    this.solids = [
      ...this.buildings.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
      ...this.bridges.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
      ...this.props.map(p => ({ x0: p.x - p.w / 2, z0: p.z - p.d / 2, x1: p.x + p.w / 2, z1: p.z + p.d / 2, top: p.base + p.h })),
    ];
  }

  buildingAt(x: number, z: number): Building | undefined {
    return this.buildings.find(b => inRect(b, x, z));
  }

  /** Highest walkable top under a point, or -Infinity over the void. */
  heightAt(x: number, z: number): number {
    let h = -Infinity;
    for (const s of this.solids) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.top > h) h = s.top;
    }
    return h;
  }

  /** Line of sight between two points: blocked by any solid rising above the sight line
   * (walls, hedges, tanks, huts). Grenades and slashes need it. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(len / 0.25));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.heightAt(ax + dx * t, az + dz * t) > ay + dy * t - 0.05) return false;
    }
    return true;
  }
}

const mapCache = new Map<string, GameMap>();

/** Shared instance per roof set (rooms of the same size reuse it, and its bot nav). */
export function mapFor(roofIds: number[]): GameMap {
  const ids = [...new Set(roofIds)].filter(id => BUILDINGS.some(b => b.id === id)).sort((a, b) => a - b);
  if (!ids.includes(PLAZA_ID)) ids.unshift(PLAZA_ID);
  const key = ids.join(',');
  let m = mapCache.get(key);
  if (!m) { m = new GameMap(ids); mapCache.set(key, m); }
  return m;
}

export const FULL_MAP = mapFor(BUILDINGS.map(b => b.id));

// ── Map size per player count ─────────────────────────────────────────────
// One roof per player plus the plaza (min 5 roofs), grown outward from the plaza through
// jumpable gaps/planks so the play area is always one connected patch.
export const MIN_ROOFS = 5;
export const ROOFS_PER_PLAYER = 1.25; // roofs added per player, on top of the plaza (1.0 got too crowded for hiders)
const JUMPABLE_GAP = 3.4;

function gapBetween(a: Building, b: Building): number {
  return Math.hypot(Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)), Math.max(0, Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1)));
}

function linked(a: Building, b: Building): boolean {
  if (gapBetween(a, b) <= JUMPABLE_GAP) return true;
  return BRIDGES.some(br => overlaps(br, a) && overlaps(br, b));
}

/** Hide 'n Seek round length for a map: less ground to cover = less time to survive. */
export function roundTimeFor(map: GameMap): number {
  const t = (map.buildings.length - MIN_ROOFS) / (BUILDINGS.length - MIN_ROOFS);
  return Math.round(MIN_ROUND_TIME + Math.max(0, Math.min(1, t)) * (ROUND_TIME - MIN_ROUND_TIME));
}

export function roofsForPlayers(players: number, perPlayer = ROOFS_PER_PLAYER): number[] {
  const want = Math.min(BUILDINGS.length, Math.max(MIN_ROOFS, Math.ceil(players * perPlayer) + 1));
  const plaza = BUILDINGS.find(b => b.id === PLAZA_ID)!;
  const pcx = (plaza.x0 + plaza.x1) / 2, pcz = (plaza.z0 + plaza.z1) / 2;
  const dist = (b: Building) => Math.hypot((b.x0 + b.x1) / 2 - pcx, (b.z0 + b.z1) / 2 - pcz);
  const chosen = [plaza];
  while (chosen.length < want) {
    // Nearest roof (to the plaza) that links to the patch so far
    const next = BUILDINGS
      .filter(b => !chosen.includes(b) && chosen.some(c => linked(b, c)))
      .sort((a, b) => dist(a) - dist(b) || a.id - b.id)[0];
    if (!next) break;
    chosen.push(next);
  }
  return chosen.map(b => b.id).sort((a, b) => a - b);
}

// ── Spawns ────────────────────────────────────────────────────────────────
// Seekers start together on the plaza; hiders scatter from the plaza edges.
export const SEEKER_SPAWNS: [number, number][] = [[-2, -3], [2, -3], [-2, -1], [2, -1], [0, -5]];
// Hiders start in the rows outside the plaza planters, a hop away from the alleys
export const HIDER_SPAWNS: [number, number][] = [
  [-6, 1.9], [6, 1.9], [-6, -7.9], [6, -7.9], [0, 1.9], [0, -7.9], [-3, 1.9], [3, 1.9], [-3, -7.9], [3, -7.9],
];
