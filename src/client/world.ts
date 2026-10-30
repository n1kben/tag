// Scene, lighting, camera and the rooftop city, styled after Boomerang Fu's floating-island
// arenas: pastel flat colours, periwinkle cliff sides, pale rims on top edges, soft lavender
// shadows, and walls that fade into a bright mist below.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BUILDINGS, MAP_BOUNDS, FULL_MAP, type GameMap, type Building, type Prop, type RoofStyle,
} from '../shared/map';

export const MIST = new THREE.Color(0xe3e9f6);
const MIST_TOP = -0.6; // world y where walls start fading
const MIST_BOTTOM = -14;

// ── Materials ─────────────────────────────────────────────────────────────

const matCache = new Map<string, THREE.MeshLambertMaterial>();

/** Matte material with the height-mist patch, cached by colour. */
export function mat(color: number, opts: { transparent?: boolean; opacity?: number; emissive?: number; cache?: boolean } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.transparent ?? ''}|${opts.opacity ?? ''}|${opts.emissive ?? ''}`;
  if (opts.cache !== false && matCache.has(key)) return matCache.get(key)!;
  const m = new THREE.MeshLambertMaterial({
    color,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
  });
  addMist(m);
  if (opts.cache !== false) matCache.set(key, m);
  return m;
}

export function addMist(m: THREE.Material): void {
  m.onBeforeCompile = shader => {
    shader.uniforms.uMist = { value: MIST };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMistY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMistY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMistY;\nuniform vec3 uMist;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float mistK = smoothstep(${MIST_TOP.toFixed(2)}, ${MIST_BOTTOM.toFixed(2)}, vMistY);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uMist, mistK);`);
  };
  // Lambert's default program key would share the unpatched program
  m.customProgramCacheKey = () => 'mist';
}

// ── Palette (picked from Boomerang Fu trailer frames) ─────────────────────

const SIDE_COLORS = [0x8f99de, 0x97a0e2, 0x8a93d8, 0x9ca5e6];
const WINDOW = 0x8590d6;
const ROOF: Record<RoofStyle, { top: number; rim: number; patch?: number }> = {
  cream: { top: 0xf2dfaa, rim: 0xfff3cf, patch: 0xf7e8bd },
  terra: { top: 0xee9f78, rim: 0xf9c9a2, patch: 0xf3b28e },
  mint: { top: 0xb5e39a, rim: 0xdaf6c0, patch: 0xc6ebad },
  garden: { top: 0xaedd55, rim: 0xd6f283, patch: 0xc4e870 },
  plaza: { top: 0xeedfc0, rim: 0xfff6e2, patch: 0xf4e8cf },
  tower: { top: 0xf2cd76, rim: 0xfbe6a8, patch: 0xf6da92 },
};

// ── Scene setup ───────────────────────────────────────────────────────────

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  city: THREE.Group | null; // the baked rooftops for the current map
  planks: { group: THREE.Group; state: number; t: number }[]; // weak planks: kept separate so they can shake and fall
  debris: { group: THREE.Group; vy: number; spin: number; t: number }[];
  map: GameMap;
}

export const CAMERA_FOV = 30;
export const CAMERA_PITCH = THREE.MathUtils.degToRad(58);
export const CAMERA_DIST = 31;

// The canvas fills its parent, which CSS sizes to the real screen (taller than innerHeight in iOS home-screen apps)
let viewParent: HTMLElement | null = null;
const viewW = () => viewParent?.clientWidth || window.innerWidth;
const viewH = () => viewParent?.clientHeight || window.innerHeight;

export function createWorld(canvasParent: HTMLElement): World {
  viewParent = canvasParent;
  // MSAA costs ~40% of frame time; dense (Retina) screens don't need it. ?noaa forces it off.
  const antialias = !new URLSearchParams(location.search).has('noaa') && window.devicePixelRatio < 1.5;
  const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
  // ?lite: half resolution, no shadows (weak machines, headless tests)
  const lite = new URLSearchParams(location.search).has('lite');
  // ?dpr=1 pins the resolution (benchmarks, or players who prefer a fixed one)
  const fixed = Number(new URLSearchParams(location.search).get('dpr'));
  adaptive = !lite && !(fixed > 0);
  maxPixelRatio = lite ? 0.5 : fixed > 0 ? fixed : Math.min(window.devicePixelRatio, 2);
  pixelRatio = ceiling = maxPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(viewW(), viewH());
  renderer.shadowMap.enabled = !lite && !new URLSearchParams(location.search).has('noshadow');
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF + radius: soft enough, much cheaper than PCFSoft
  // The city never moves and characters use blob shadows, so the shadow map is drawn once
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.localClippingEnabled = true;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = MIST.clone();

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, viewW() / viewH(), 1, 200);

  // Bright sky fill with a lavender ground bounce: shadows come out periwinkle, never grey
  scene.add(new THREE.HemisphereLight(0xf7f8ff, 0xb3b9ee, 1.75));
  // Fixed sun with one shadow map over the whole map (front-left light like the trailer)
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
  sun.position.set(-24, 60, 24);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 20; sc.far = 130;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const world: World = { scene, camera, renderer, sun, city: null, map: FULL_MAP, planks: [], debris: [] };
  // The far-below street: a flat mist floor so nothing reads as a hard edge
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: MIST }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = MIST_BOTTOM - 2;
  scene.add(floor);
  setMap(world, FULL_MAP);

  window.addEventListener('resize', () => {
    camera.aspect = viewW() / viewH();
    camera.updateProjectionMatrix();
    renderer.setSize(viewW(), viewH());
  });
  return world;
}

// ── Adaptive resolution ───────────────────────────────────────────────────
// Pixels are the main cost (Retina = 4× the pixels). Start at full resolution, step down a little
// whenever frames run slower than ~50fps, and probe back up once there's headroom again.
let adaptive = true;
let maxPixelRatio = 1;
let pixelRatio = 1;
let ceiling = 1; // don't climb above this for a while after a step down
let ceilingT = 0;
let windowT = 0;
let windowFrames = 0;
let windowWork = 0;
let goodWindows = 0;
const MIN_PIXEL_RATIO = 0.6;

export function adaptResolution(world: World, dt: number): void {
  if (!adaptive || dt > 0.1) return; // pinned, or a tab switch / hitch that isn't representative
  windowT += dt;
  windowFrames++;
  windowWork += dt;
  if (windowT < 1) return;
  const avgMs = (windowWork / windowFrames) * 1000;
  windowT = windowFrames = windowWork = 0;
  ceilingT = Math.max(0, ceilingT - 1);
  if (ceilingT === 0) ceiling = maxPixelRatio;
  let next = pixelRatio;
  if (avgMs > 20 && pixelRatio > MIN_PIXEL_RATIO) {
    next = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.15);
    ceiling = next + 0.05;
    ceilingT = 20;
    goodWindows = 0;
  } else if (avgMs < 17.5 && pixelRatio < ceiling) {
    if (++goodWindows >= 3) { next = Math.min(ceiling, pixelRatio + 0.1); goodWindows = 0; }
  } else {
    goodWindows = 0;
  }
  if (Math.abs(next - pixelRatio) > 0.01) {
    pixelRatio = next;
    world.renderer.setPixelRatio(pixelRatio);
    world.renderer.setSize(viewW(), viewH());
  }
}

/** Point the camera at a ground target from the fixed Boomerang Fu-style angle. */
export function aimCamera(world: World, tx: number, ty: number, tz: number, dist = CAMERA_DIST): void {
  const { camera } = world;
  // Portrait screens: back off until the view is as wide as a square one, so a phone held upright
  // sees the same width of roof (at the same character size) as one held sideways sees in height
  dist *= Math.max(1, 1 / camera.aspect);
  camera.position.set(tx, ty + Math.sin(CAMERA_PITCH) * dist, tz + Math.cos(CAMERA_PITCH) * dist);
  camera.lookAt(tx, ty, tz);
}

// ── City ──────────────────────────────────────────────────────────────────

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse(c => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
  });
  return o;
}

// Props default to one bevel segment: at this camera distance more detail is invisible but costs
// ~600 triangles per box (a crate stack is 8 boxes). Buildings pass more segments explicitly.
function rbox(w: number, h: number, d: number, r: number, color: number, segs = 1): THREE.Mesh {
  const geo = new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new THREE.Mesh(geo, mat(color));
}

const DEPTH = 17; // how far buildings extend down: just past the mist floor, nothing below is visible

/**
 * The city never moves, so merge every mesh that shares a material (and shadow flags) into one.
 * ~1,000 draw calls (plus the shadow pass) become a few dozen; instanced meshes are kept as is.
 */
function bakeStatic(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const instanced: THREE.InstancedMesh[] = [];
  root.traverse(o => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) { instanced.push(o as THREE.InstancedMesh); return; }
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const material = m.material as THREE.Material;
    const key = `${material.uuid}|${m.castShadow}|${m.receiveShadow}`;
    let g = groups.get(key);
    if (!g) { g = { material, cast: m.castShadow, receive: m.receiveShadow, geos: [] }; groups.set(key, g); }
    // World-space, non-indexed, position + normal only, so everything merges cleanly
    let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    geo.clearGroups();
    g.geos.push(geo);
  });
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    out.add(mesh);
    for (const geo of g.geos) geo.dispose();
  }
  for (const im of instanced) {
    im.updateMatrixWorld(true);
    out.add(im); // re-parented; its own transform was identity-relative to the city
  }
  return out;
}

const OUT_OF_PLAY_H = -10; // roofs not in this match sink deep into the mist: still a city, clearly unreachable

/** (Re)build the rooftops for a map: its roofs and obstacles in play, the rest sunk as backdrop. */
export function setMap(world: World, map: GameMap): void {
  if (world.city && world.map === map) return;
  if (world.city) {
    world.scene.remove(world.city);
    for (const pl of world.planks) pl.group.removeFromParent();
    world.city.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
  const rng = mulberry(7);
  // Build everything into a scratch group, then bake it into a handful of merged meshes
  const city = new THREE.Group();
  const inPlay = new Set(map.roofIds);
  for (const b of BUILDINGS) buildBuilding(city, inPlay.has(b.id) ? b : { ...b, h: OUT_OF_PLAY_H }, rng);
  // Planks stay live objects (not baked): they crack, fall and come back
  world.planks = map.bridges.map(br => ({ group: buildBridge(world.scene, br), state: 0, t: 0 }));
  for (const p of map.props) {
    const obj = buildProp(p, rng);
    obj.position.set(p.x, p.base, p.z);
    if (p.rot) obj.rotation.y = p.rot;
    city.add(shadowed(obj));
  }
  for (const bt of map.buntings) city.add(buildBunting(bt.ax, bt.az, bt.bx, bt.bz, bt.base));
  buildSkyline(city, rng);
  world.city = bakeStatic(city);
  world.scene.add(world.city);
  world.map = map;
  world.renderer.shadowMap.needsUpdate = true; // static shadows: redraw once for the new layout
}

function buildBuilding(scene: THREE.Object3D, b: Building, rng: () => number): void {
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const style = ROOF[b.style];
  const side = SIDE_COLORS[b.id % SIDE_COLORS.length];

  // Body: rounded column with the same periwinkle sides as the Boomerang Fu cliffs
  const body = rbox(w, DEPTH, d, 0.45, side, 3);
  body.material = mat(side, { emissive: 0x262a52 }); // lift the walls to the trailer's light lavender
  body.position.set(cx, b.h - DEPTH / 2, cz);
  scene.add(shadowed(body, true, false)); // walls cast onto roofs, but shadow lookups on them are wasted pixels

  // Rim band then roof surface inset: the pale lip around every Boomerang Fu platform
  const rim = rbox(w - 0.06, 0.12, d - 0.06, 0.06, style.rim, 1);
  rim.position.set(cx, b.h - 0.065, cz);
  scene.add(shadowed(rim, false, true));
  const top = rbox(w - 0.7, 0.1, d - 0.7, 0.05, style.top, 1);
  top.position.set(cx, b.h - 0.04, cz);
  scene.add(shadowed(top, false, true));

  // Soft blotches like the light grass patches on Boomerang Fu islands
  if (style.patch) {
    const n = Math.floor((w * d) / 45) + 1;
    for (let i = 0; i < n; i++) {
      const r = 0.6 + rng() * 0.9;
      const px = b.x0 + 1 + rng() * (w - 2), pz = b.z0 + 1 + rng() * (d - 2);
      const patch = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat(style.patch));
      patch.rotation.x = -Math.PI / 2;
      patch.scale.set(1, 0.65 + rng() * 0.5, 1);
      patch.position.set(px, b.h + 0.02, pz);
      patch.receiveShadow = true;
      scene.add(patch);
    }
  }
  if (b.style === 'plaza') {
    // Big round fountain-style tile in the middle (the trailer's plaza disc)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), mat(0xe4d5bb));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(cx, b.h + 0.035, cz - 3);
    disc.receiveShadow = true;
    scene.add(disc);
    const inner = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.7, 40), mat(0xd7c6a8));
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(cx, b.h + 0.045, cz - 3);
    scene.add(inner);
  }

  // Windows: rows of darker inset panes that sink into the mist
  const winGeo = new THREE.BoxGeometry(0.9, 1.1, 0.12); // plain box: ~900 windows, keep them cheap
  const count = Math.ceil(w / 2.2) * 2 * 4 + Math.ceil(d / 2.2) * 2 * 4;
  const wins = new THREE.InstancedMesh(winGeo, mat(WINDOW, { emissive: 0x1c2048 }), count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let k = 0;
  for (let row = 0; row < 4; row++) {
    const y = b.h - 1.6 - row * 2.6;
    for (const [len, axis] of [[w, 'x'], [d, 'z']] as const) {
      const n = Math.floor(len / 2.2);
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (len - (n - 1) * 2.2) / 2 + i * 2.2;
        if (rng() < 0.15) continue;
        for (const s of [-1, 1]) {
          const px = axis === 'x' ? cx + u : cx + s * (w / 2 + 0.01);
          const pz = axis === 'x' ? cz + s * (d / 2 + 0.01) : cz + u;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), axis === 'x' ? 0 : Math.PI / 2);
          m4.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(1, 1, 1));
          if (k < count) wins.setMatrixAt(k++, m4);
        }
      }
    }
  }
  wins.count = k;
  scene.add(wins);
}

function buildBridge(scene: THREE.Object3D, br: { x0: number; z0: number; x1: number; z1: number; h: number }): THREE.Group {
  const w = br.x1 - br.x0, d = br.z1 - br.z0;
  const alongX = w > d;
  const len = alongX ? w : d;
  const n = Math.max(2, Math.round(len / 0.55));
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const plank = rbox(alongX ? len / n - 0.07 : w, 0.16, alongX ? d : len / n - 0.07, 0.04, i % 3 === 0 ? 0xb08060 : 0xa7785a, 1);
    const u = -len / 2 + (i + 0.5) * (len / n);
    plank.position.set(alongX ? u : 0, -0.08, alongX ? 0 : u);
    g.add(plank);
  }
  // Rope rails
  for (const s of [-1, 1]) {
    const rail = rbox(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, 0.03, 0x7a5a50, 1);
    rail.position.set(alongX ? 0 : s * (w / 2), 0.45, alongX ? s * (d / 2) : 0);
    g.add(rail);
  }
  g.position.set((br.x0 + br.x1) / 2, br.h, (br.z0 + br.z1) / 2);
  scene.add(shadowed(g, false, true));
  return g;
}

function buildProp(p: Prop, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  switch (p.kind) {
    case 'ac': {
      const box = rbox(p.w, p.h, p.d, 0.14, 0xc9cdeb);
      box.position.y = p.h / 2;
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20), mat(0x8f95c8));
      fan.position.set(-p.w * 0.18, p.h + 0.01, 0);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10), mat(0xdfe2f6));
      hub.position.copy(fan.position);
      const grill = rbox(0.4, 0.04, p.d * 0.7, 0.02, 0xadb2dd, 1);
      grill.position.set(p.w * 0.25, p.h + 0.01, 0);
      g.add(box, fan, hub, grill);
      break;
    }
    case 'crate': {
      // A 2x2 cluster of Boomerang Fu's purple-brown crates
      const s = p.w / 2;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const c = new THREE.Group();
        const box = rbox(s - 0.04, 0.68, s - 0.04, 0.07, 0x7b5770);
        const band = rbox(s - 0.01, 0.14, s * 0.42, 0.03, 0x9c7790, 1);
        band.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
        box.position.y = 0.34;
        band.position.y = 0.34;
        c.add(box, band);
        c.position.set(ox * s / 2, 0, oz * s / 2);
        c.rotation.y = (rng() - 0.5) * 0.12;
        g.add(c);
      }
      break;
    }
    case 'duct': {
      // Long low air duct on little feet, with seam bands: hop it
      const along = p.w >= p.d;
      const len = along ? p.w : p.d, thick = along ? p.d : p.w;
      const pipe = rbox(along ? len : thick * 0.9, p.h - 0.12, along ? thick * 0.9 : len, 0.18, 0xc3c8e8);
      pipe.position.y = 0.12 + (p.h - 0.12) / 2;
      g.add(pipe);
      const n = Math.max(2, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) {
        const u = -len / 2 + 0.25 + (i / n) * (len - 0.5);
        const band = rbox(along ? 0.09 : thick * 0.95, p.h - 0.08, along ? thick * 0.95 : 0.09, 0.03, 0xa5abd6, 1);
        band.position.set(along ? u : 0, 0.12 + (p.h - 0.12) / 2, along ? 0 : u);
        const foot = rbox(along ? 0.14 : thick * 0.6, 0.14, along ? thick * 0.6 : 0.14, 0.03, 0x6e5866, 1);
        foot.position.set(along ? u : 0, 0.07, along ? 0 : u);
        g.add(band, foot);
      }
      break;
    }
    case 'wall': {
      // Low stone parapet with a pale cap
      const body = rbox(p.w, p.h - 0.1, p.d, 0.08, 0xd9c7a8);
      body.position.y = (p.h - 0.1) / 2;
      const cap = rbox(p.w + 0.1, 0.12, p.d + 0.1, 0.05, 0xf3e7cf);
      cap.position.y = p.h - 0.06;
      g.add(body, cap);
      break;
    }
    case 'hedge': {
      // Clipped hedge: rounded base + blob tufts, kept to its collision height so it reads as jumpable
      const base = rbox(p.w, p.h * 0.7, p.d, 0.2, 0x5db552);
      base.position.y = p.h * 0.35;
      g.add(base);
      const along = p.w >= p.d;
      const len = along ? p.w : p.d, thick = along ? p.d : p.w;
      const n = Math.max(2, Math.round(len / 0.7));
      const greens = [0x6cc25a, 0x7fcf62, 0x5db552, 0x8bd86b];
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (i + 0.5) * (len / n);
        const r = thick * (0.42 + rng() * 0.12);
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(greens[i % greens.length]));
        blob.position.set(along ? u : (rng() - 0.5) * 0.1, p.h - r * 0.75, along ? (rng() - 0.5) * 0.1 : u);
        blob.scale.y = 0.75;
        g.add(blob);
      }
      break;
    }
    case 'hut': {
      // Roof stair hut: tall, run around it
      const walls = rbox(p.w, p.h - 0.25, p.d, 0.12, 0xe6e1f4);
      walls.position.y = (p.h - 0.25) / 2;
      const roof = rbox(p.w + 0.3, 0.3, p.d + 0.3, 0.08, 0xe0605a);
      roof.position.y = p.h - 0.1;
      const door = rbox(0.9, 1.5, 0.06, 0.04, 0x5d3f55, 1);
      door.position.set(0, 0.75, p.d / 2 + 0.02);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xffd27a, { emissive: 0x7a5410 }));
      lamp.position.set(0, 1.75, p.d / 2 + 0.08);
      g.add(walls, roof, door, lamp);
      break;
    }
    case 'chimney': {
      const body = rbox(p.w, p.h, p.d, 0.1, 0xd0705f);
      body.position.y = p.h / 2;
      const cap = rbox(p.w + 0.16, 0.16, p.d + 0.16, 0.05, 0xe39684);
      cap.position.y = p.h;
      const hole = rbox(p.w - 0.3, 0.06, p.d - 0.3, 0.02, 0x4d3446, 1);
      hole.position.y = p.h + 0.07;
      g.add(body, cap, hole);
      break;
    }
    case 'tank': {
      // Wooden water tower on stilts with a terracotta cone roof
      const legH = 1.2;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = rbox(0.16, legH, 0.16, 0.04, 0x6e5866, 1);
        leg.position.set(ox * 0.75, legH / 2, oz * 0.75);
        g.add(leg);
      }
      const barrelH = p.h - legH - 0.7;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, barrelH, 24), mat(0xbb8c64));
      barrel.position.y = legH + barrelH / 2;
      g.add(barrel);
      for (const t of [0.2, 0.8]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.07, 0.05, 6, 28), mat(0x6e5866));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = legH + barrelH * t;
        g.add(ring);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.8, 24), mat(0xe2735e));
      roof.position.y = legH + barrelH + 0.38;
      g.add(roof);
      break;
    }
    case 'booth': {
      // The red-roofed market stall from the trailer's temple arena
      const walls = rbox(p.w - 0.4, 1.6, p.d - 0.4, 0.12, 0xf3e3c6);
      walls.position.y = 0.8;
      const door = rbox(1.0, 1.1, 0.06, 0.04, 0x5d3f55, 1);
      door.position.set(0, 0.55, (p.d - 0.4) / 2 + 0.02);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(p.w, p.d) / 2 + 0.3, p.h - 1.5, 4), mat(0xe0605a));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, p.d / p.w);
      roof.position.y = 1.6 + (p.h - 1.5) / 2;
      const eave = rbox(p.w + 0.3, 0.14, p.d + 0.3, 0.05, 0xb84a4c);
      eave.position.y = 1.62;
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), mat(0xffb84a, { emissive: 0x7a4410 }));
      lantern.position.set(p.w / 2 - 0.2, 1.35, p.d / 2 - 0.2);
      g.add(walls, door, roof, eave, lantern);
      break;
    }
    case 'skylight': {
      const frame = rbox(p.w, p.h, p.d, 0.08, 0xd9dcf2);
      frame.position.y = p.h / 2;
      const glass = rbox(p.w - 0.25, 0.05, p.d - 0.25, 0.02, 0xa9d8ef, 1);
      glass.position.y = p.h + 0.01;
      const bar = rbox(0.06, 0.06, p.d - 0.25, 0.02, 0xd9dcf2, 1);
      bar.position.y = p.h + 0.03;
      g.add(frame, glass, bar);
      break;
    }
    case 'vent': {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, p.h, 14), mat(0xb5bbe0));
      pipe.position.y = p.h / 2;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.22, 14), mat(0xd3d7f0));
      hat.position.y = p.h + 0.14;
      g.add(pipe, hat);
      break;
    }
  }
  return g;
}


function buildBunting(ax: number, az: number, bx: number, bz: number, base: number): THREE.Group {
  const g = new THREE.Group();
  const poleH = 2.4;
  for (const [x, z] of [[ax, az], [bx, bz]]) {
    const pole = rbox(0.14, poleH, 0.14, 0.04, 0x6e5866, 1);
    pole.position.set(x, base + poleH / 2, z);
    g.add(shadowed(pole));
  }
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.floor(len / 0.6);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, -0.42, 0], 3));
  flagGeo.computeVertexNormals();
  const colors = [0xe0605a, 0xffd23f, 0x23d2b5, 0xf06fa4];
  const ang = Math.atan2(bz - az, bx - ax);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 0.5;
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
    flag.position.set(ax + (bx - ax) * t, base + poleH - 0.05 - sag, az + (bz - az) * t);
    flag.rotation.y = -ang;
    flag.castShadow = true;
    g.add(flag);
  }
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([0, 0.5, 1].map(t => new THREE.Vector3(
      ax + (bx - ax) * t, base + poleH - 0.05 - Math.sin(t * Math.PI) * 0.5, az + (bz - az) * t))), 16, 0.025, 4),
    mat(0x5d4a58),
  );
  g.add(rope);
  return g;
}

function buildSkyline(scene: THREE.Object3D, rng: () => number): void {
  // Lower blocks around the playable area, sunk into the mist, so the city keeps going
  const { x0, z0, x1, z1 } = MAP_BOUNDS;
  for (let i = 0; i < 46; i++) {
    const edge = i % 4;
    const w = 5 + rng() * 7, d = 5 + rng() * 7;
    let x = 0, z = 0;
    if (edge === 0) { x = x0 - 6 - rng() * 14; z = z0 + rng() * (z1 - z0); }
    if (edge === 1) { x = x1 + 6 + rng() * 14; z = z0 + rng() * (z1 - z0); }
    if (edge === 2) { z = z0 - 6 - rng() * 12; x = x0 + rng() * (x1 - x0); }
    if (edge === 3) { z = z1 + 6 + rng() * 12; x = x0 + rng() * (x1 - x0); }
    const top = -2.5 - rng() * 6;
    const b = rbox(w, DEPTH, d, 0.45, SIDE_COLORS[i % SIDE_COLORS.length], 1);
    b.position.set(x, top - DEPTH / 2, z);
    scene.add(b);
    const roof = rbox(w - 0.5, 0.1, d - 0.5, 0.05, [0xf3e7c4, 0xeeaa82, 0xc4e6ae, 0xb7e06c][i % 4], 1);
    roof.position.set(x, top + 0.02, z);
    scene.add(roof);
  }
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weak planks: shake while cracking (1), drop away as tumbling debris when collapsed (2),
 * pop back when rebuilt (0). Returns which planks changed state this frame.
 */
export function updatePlanks(world: World, states: number[], dt: number): { i: number; to: number }[] {
  const changes: { i: number; to: number }[] = [];
  world.planks.forEach((pl, i) => {
    const to = states[i] ?? 0;
    const g = pl.group;
    const base = g.userData.base ?? (g.userData.base = g.position.clone());
    if (to !== pl.state) {
      changes.push({ i, to });
      if (to === 2) {
        // Drop a copy as debris; hide the real one until it's rebuilt
        const falling = g.clone();
        world.scene.add(falling);
        world.debris.push({ group: falling, vy: 0, spin: (Math.random() - 0.5) * 3, t: 0 });
        g.visible = false;
      }
      if (to === 0) { g.visible = true; pl.t = 0; }
      pl.state = to;
    }
    pl.t += dt;
    if (pl.state === 1) {
      // Creaking: jitter that grows until it gives way
      const k = 0.02 + Math.min(1, pl.t) * 0.05;
      g.position.set(base.x + (Math.random() - 0.5) * k, base.y - Math.random() * k, base.z + (Math.random() - 0.5) * k);
    } else if (pl.state === 0) {
      g.position.copy(base);
      g.scale.setScalar(Math.min(1, 0.6 + pl.t * 1.6)); // rebuilt: little pop
    }
  });
  for (let i = world.debris.length - 1; i >= 0; i--) {
    const d = world.debris[i];
    d.t += dt;
    d.vy -= 20 * dt;
    d.group.position.y += d.vy * dt;
    d.group.rotation.z += d.spin * dt;
    d.group.rotation.x += d.spin * 0.6 * dt;
    if (d.t > 2.5) { d.group.removeFromParent(); world.debris.splice(i, 1); }
  }
  return changes;
}
