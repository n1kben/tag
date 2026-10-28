// "Rooftops" — a city of flat roofs over a misty drop, laid out like hns/awp_rooftops:
// alleys you can bunny-hop, a few planks over wide gaps, crate stairs up to the towers,
// and nothing on the edge that can't be reached (the original map's campable-edge problem).
// One authoritative definition: server physics, client prediction, rendering and bots all read this.

export type RoofStyle = 'cream' | 'terra' | 'mint' | 'garden' | 'plaza' | 'tower';

export interface Building {
  id: number;
  x0: number; z0: number; x1: number; z1: number;
  h: number; // roof height
  style: RoofStyle;
}

export type PropKind = 'ac' | 'crate' | 'crate2' | 'chimney' | 'tank' | 'booth' | 'skylight' | 'vent';

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

export interface Bush {
  x: number; z: number; r: number; base: number;
}

export interface Bunting {
  ax: number; az: number; bx: number; bz: number; base: number;
}

// Axis-aligned column from the void up to `top`. Everything solid in the map is one of these.
export interface Solid {
  x0: number; z0: number; x1: number; z1: number;
  top: number;
}

// Footprints below are the street grid; each roof spreads ROOF_GROW past it on every side,
// which sets alley width to match the jump (alleys = grid gap − 2 × ROOF_GROW).
const ROOF_GROW = 0.5;
const B = (id: number, x0: number, z0: number, x1: number, z1: number, h: number, style: RoofStyle): Building =>
  ({ id, x0: x0 - ROOF_GROW, z0: z0 - ROOF_GROW, x1: x1 + ROOF_GROW, z1: z1 + ROOF_GROW, h, style });

export const BUILDINGS: Building[] = [
  // North row
  B(0, -34, -24, -22, -14, 1.0, 'cream'),
  B(1, -19.5, -25, -8, -15, 2.0, 'terra'),
  B(2, -5, -24, 5, -12, 0.0, 'garden'),
  B(3, 8, -25, 19, -14, 1.0, 'mint'),
  B(4, 21.5, -24, 34, -13, 2.0, 'cream'),
  // Middle row
  B(5, -34, -11, -24, 1, 0.0, 'garden'),
  B(6, -21, -12, -11, -1, 3.0, 'tower'),
  B(7, -8.5, -9, 8.5, 3, 1.0, 'plaza'),
  B(8, 11, -11, 22, 0, 2.0, 'terra'),
  B(9, 24, -10, 34, 2, 0, 'cream'),
  // South row
  B(10, -34, 4, -21, 14, 2.0, 'terra'),
  B(11, -18, 6, -6, 17, 0.5, 'mint'),
  B(12, -3, 6, 9, 16, 1.5, 'cream'),
  B(13, 12, 3, 24.5, 13, 0.0, 'garden'),
  B(14, 26, 5, 34, 15, 3.0, 'tower'),
  B(15, -30, 17, -16, 25, 1.0, 'cream'),
  B(16, -2, 19, 14, 25, 0.5, 'garden'),
  B(17, 17, 17, 30, 25, 1.5, 'terra'),
];

// Planks over the gaps too wide to jump. Height = the lower roof so the high side is a hop up.
export const BRIDGES: Bridge[] = [
  { x0: -16.6, z0: 17.6, x1: -15.4, z1: 21.5, h: 0.5 }, // D1 ↔ C2 corner
  { x0: -16, z0: 19, x1: -2, z1: 20.2, h: 0.5 }, // D1 → D2 long plank
  { x0: 5, z0: -19, x1: 8, z1: -17.8, h: 0.0 }, // garden → mint
];

type PropSpec = [PropKind, number, number, number?];
const PROP_SIZE: Record<PropKind, [number, number, number]> = {
  ac: [1.5, 1.1, 0.8],
  crate: [1.6, 1.6, 0.7],
  crate2: [1.6, 1.6, 1.4],
  chimney: [0.9, 0.9, 1.9],
  tank: [2.2, 2.2, 3.4],
  booth: [3.2, 2.4, 2.6],
  skylight: [2.2, 1.4, 0.35],
  vent: [0.6, 0.6, 0.6],
};

const PROP_SPECS: PropSpec[] = [
  // North row
  ['ac', -30, -21], ['chimney', -24, -16], ['crate', -27, -16], ['skylight', -29, -17.5],
  ['tank', -12, -21], ['ac', -17, -17], ['vent', -10, -17], ['chimney', -17.5, -23],
  ['booth', 0, -21], ['crate', 3.2, -14],
  ['ac', 11, -22], ['ac', 11, -20.5], ['skylight', 15.5, -17], ['chimney', 17.5, -24],
  ['tank', 30, -20], ['crate', 23, -15], ['vent', 26, -21], ['ac', 26, -16],
  // Middle row
  ['booth', -29, -6], ['crate', -25, -9.5],
  ['tank', -16, -7], ['chimney', -12.5, -2.5],
  // Plaza: crate stairs up to the west tower
  ['crate', -6.1, -5], ['crate2', -7.7, -5], ['ac', 4, -6], ['skylight', 0, 0], ['chimney', 7, 1.5],
  ['crate', 6, -7.5],
  ['tank', 19, -7], ['ac', 14, -3], ['vent', 13, -9],
  // East roof: crate stairs back up to the terrace
  ['ac', 31, -6], ['crate', 26.4, -4], ['crate2', 24.8, -4], ['chimney', 32.5, 0.5],
  // South row
  ['chimney', -31, 6], ['ac', -25, 11], ['skylight', -29, 10.5],
  ['tank', -10, 14], ['crate', -16, 8], ['vent', -8, 8],
  ['booth', 3, 9.5], ['ac', -1, 14],
  ['crate', 20.5, 11.6], ['skylight', 16, 5], ['vent', 14, 11.5],
  ['crate', 22.2, 7.3], ['crate2', 22.2, 8.9],
  ['tank', 31, 11], ['chimney', 28, 6.5],
  ['ac', -26, 20], ['crate', -19, 23], ['chimney', -29, 23.5],
  ['skylight', 8, 22], ['vent', 1, 23.5],
  // East tower: crate stairs from the south-east roof
  ['ac', 23, 22], ['crate', 27.0, 18.6], ['crate2', 28.6, 17.85], ['chimney', 20, 23.5],
];

// Bamboo pots and shrub clusters (decoration, like the trailer's grass tufts)
const BUSH_SPECS: [number, number, number][] = [
  [-32.5, -15.5, 1.0], [-14, -23.5, 0.9], [-3.5, -13.5, 1.1], [3.5, -23, 0.9], [17.5, -15.5, 1.0], [32.5, -14.5, 1.0],
  [-32.5, -0.5, 1.1], [-26, -1, 0.9], [-19.5, -2.5, 0.9], [-7, 1.5, 1.0], [7, -2.5, 0.9], [20.5, -1.5, 1.0], [32.5, -8.5, 1.0],
  [-22.5, 12.5, 1.0], [-7.5, 15.5, 1.1], [7.5, 7.5, 0.9], [13.5, 11.5, 1.1], [17, 9, 0.9], [27.5, 13.5, 1.0],
  [-17.5, 18.5, 1.0], [12.5, 20.5, 1.0], [-0.5, 20.5, 0.9], [18.5, 19.5, 0.9],
];

export function buildingAt(x: number, z: number): Building | undefined {
  return BUILDINGS.find(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
}

function surfaceUnder(x: number, z: number): number {
  const b = buildingAt(x, z);
  return b ? b.h : 0;
}

export const PROPS: Prop[] = PROP_SPECS.map(([kind, x, z, rot]) => {
  const [w, d, h] = PROP_SIZE[kind];
  return { kind, x, z, w, d, h, base: surfaceUnder(x, z), rot };
});

export const BUSHES: Bush[] = BUSH_SPECS.map(([x, z, r]) => ({ x, z, r, base: surfaceUnder(x, z) }));

export const BUNTINGS: Bunting[] = [
  { ax: -8, az: -8.5, bx: 8, bz: -8.5, base: 1 },
  { ax: -5, az: -12.5, bx: 5, bz: -12.5, base: 0 },
  { ax: 12, az: 3.5, bx: 23, bz: 3.5, base: 0 },
  { ax: -2, az: 24.5, bx: 14, bz: 24.5, base: 0.5 },
];

export const SOLIDS: Solid[] = [
  ...BUILDINGS.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
  ...BRIDGES.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, top: b.h })),
  ...PROPS.map(p => ({ x0: p.x - p.w / 2, z0: p.z - p.d / 2, x1: p.x + p.w / 2, z1: p.z + p.d / 2, top: p.base + p.h })),
];

export const MAP_BOUNDS = { x0: -36, z0: -27, x1: 36, z1: 27 };

/** Highest walkable top under a point, or -Infinity over the void. */
export function heightAt(x: number, z: number): number {
  let h = -Infinity;
  for (const s of SOLIDS) {
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.top > h) h = s.top;
  }
  return h;
}

export interface Smoke { x: number; y: number; z: number; r: number }

/**
 * Line of sight between two eye points. Blocked by any solid whose top rises above the
 * sight line (roof edges, tanks, booths) and by smoke clouds. This is what lets a hider
 * vanish by dropping onto a lower roof or ducking behind a water tank.
 */
export function lineOfSight(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  smokes: Smoke[] = [],
): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(len / 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const h = heightAt(ax + dx * t, az + dz * t);
    if (h > ay + dy * t - 0.05) return false;
  }
  for (const s of smokes) {
    // Distance from smoke centre to the segment
    const fx = s.x - ax, fz = s.z - az;
    const t = Math.max(0, Math.min(1, (fx * dx + fz * dz) / (len * len || 1)));
    const px = ax + dx * t - s.x, pz = az + dz * t - s.z;
    if (px * px + pz * pz < s.r * s.r) return false;
  }
  return true;
}

// ── Spawns ────────────────────────────────────────────────────────────────
// Seekers start together on the plaza; hiders scatter from the plaza edges.
export const SEEKER_SPAWNS: [number, number][] = [[-2, -3], [2, -3], [-2, -1], [2, -1], [0, -5]];
export const HIDER_SPAWNS: [number, number][] = [
  [-6, 1.5], [6, 1.5], [-6, -7.5], [3, -7.5], [0, 2], [-4, -2], [4, -2], [-1, -7], [5, 0], [-5, 0],
];
