// Scene, lighting, camera and the rooftop city, styled after Boomerang Fu's floating-island
// arenas: pastel flat colours, periwinkle cliff sides, pale rims on top edges, soft lavender
// shadows, and walls that fade into a bright mist below.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BUILDINGS, BRIDGES, PROPS, BUSHES, BUNTINGS, MAP_BOUNDS, type Building, type Prop, type RoofStyle,
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
}

export const CAMERA_FOV = 30;
export const CAMERA_PITCH = THREE.MathUtils.degToRad(58);
export const CAMERA_DIST = 31;

export function createWorld(canvasParent: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = MIST.clone();

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 1, 200);

  // Bright sky fill with a lavender ground bounce: shadows come out periwinkle, never grey
  scene.add(new THREE.HemisphereLight(0xf7f8ff, 0xb3b9ee, 1.75));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
  sun.position.set(-12, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const world: World = { scene, camera, renderer, sun };
  buildCity(world);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return world;
}

/** Point the camera at a ground target from the fixed Boomerang Fu-style angle. */
export function aimCamera(world: World, tx: number, ty: number, tz: number, dist = CAMERA_DIST): void {
  const { camera, sun } = world;
  camera.position.set(tx, ty + Math.sin(CAMERA_PITCH) * dist, tz + Math.cos(CAMERA_PITCH) * dist);
  camera.lookAt(tx, ty, tz);
  // Keep the shadow frustum centred on what we're looking at
  sun.position.set(tx - 12, ty + 30, tz + 12);
  sun.target.position.set(tx, ty, tz);
}

// ── City ──────────────────────────────────────────────────────────────────

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse(c => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
  });
  return o;
}

function rbox(w: number, h: number, d: number, r: number, color: number, segs = 3): THREE.Mesh {
  const geo = new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new THREE.Mesh(geo, mat(color));
}

const DEPTH = 34; // how far buildings extend down into the mist

function buildCity(world: World): void {
  const { scene } = world;
  const rng = mulberry(7);

  for (const b of BUILDINGS) buildBuilding(scene, b, rng);
  for (const br of BRIDGES) buildBridge(scene, br);
  for (const p of PROPS) {
    const obj = buildProp(p, rng);
    obj.position.set(p.x, p.base, p.z);
    if (p.rot) obj.rotation.y = p.rot;
    scene.add(shadowed(obj));
  }
  for (const bu of BUSHES) {
    const g = buildBush(bu.r, rng);
    g.position.set(bu.x, bu.base, bu.z);
    scene.add(shadowed(g, true, false));
  }
  for (const bt of BUNTINGS) scene.add(buildBunting(bt.ax, bt.az, bt.bx, bt.bz, bt.base));
  buildSkyline(scene, rng);

  // The far-below street: a flat mist floor so nothing reads as a hard edge
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: MIST }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = MIST_BOTTOM - 2;
  scene.add(floor);
}

function buildBuilding(scene: THREE.Scene, b: Building, rng: () => number): void {
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const style = ROOF[b.style];
  const side = SIDE_COLORS[b.id % SIDE_COLORS.length];

  // Body: rounded column with the same periwinkle sides as the Boomerang Fu cliffs
  const body = rbox(w, DEPTH, d, 0.45, side, 4);
  body.material = mat(side, { emissive: 0x262a52 }); // lift the walls to the trailer's light lavender
  body.position.set(cx, b.h - DEPTH / 2, cz);
  scene.add(shadowed(body));

  // Rim band then roof surface inset: the pale lip around every Boomerang Fu platform
  const rim = rbox(w - 0.06, 0.12, d - 0.06, 0.06, style.rim, 2);
  rim.position.set(cx, b.h - 0.065, cz);
  scene.add(shadowed(rim, false, true));
  const top = rbox(w - 0.7, 0.1, d - 0.7, 0.05, style.top, 2);
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
  const winGeo = new RoundedBoxGeometry(0.9, 1.1, 0.12, 2, 0.08);
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

function buildBridge(scene: THREE.Scene, br: { x0: number; z0: number; x1: number; z1: number; h: number }): void {
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
  scene.add(shadowed(g));
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
    case 'crate':
    case 'crate2': {
      // A 2x2 cluster of Boomerang Fu's purple-brown crates (two layers for crate2)
      const layers = p.kind === 'crate2' ? 2 : 1;
      const s = p.w / 2;
      for (let l = 0; l < layers; l++) {
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const c = new THREE.Group();
          const box = rbox(s - 0.04, 0.68, s - 0.04, 0.07, l === 1 ? 0x86607a : 0x7b5770);
          const band = rbox(s - 0.01, 0.14, s * 0.42, 0.03, 0x9c7790, 1);
          band.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
          box.position.y = 0.34;
          band.position.y = 0.34;
          c.add(box, band);
          c.position.set(ox * s / 2, l * 0.7, oz * s / 2);
          c.rotation.y = (rng() - 0.5) * 0.12;
          g.add(c);
        }
      }
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

function buildBush(r: number, rng: () => number): THREE.Group {
  // Bamboo tufts and round shrubs like the trailer's tall-grass clumps
  const g = new THREE.Group();
  const greens = [0x6cc25a, 0x7fcf62, 0x5db552, 0x8bd86b];
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    const d = r * (0.25 + rng() * 0.45);
    const s = r * (0.45 + rng() * 0.25);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat(greens[i % greens.length]));
    blob.position.set(Math.cos(a) * d, s * 0.8 + rng() * 0.25, Math.sin(a) * d);
    blob.scale.y = 1.1 + rng() * 0.4;
    g.add(blob);
  }
  for (let i = 0; i < 3; i++) {
    const h = 1.5 + rng() * 0.9;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 6), mat(0x7cc35a));
    const a = rng() * Math.PI * 2;
    stalk.position.set(Math.cos(a) * r * 0.4, h / 2, Math.sin(a) * r * 0.4);
    stalk.rotation.z = (rng() - 0.5) * 0.25;
    g.add(stalk);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 4), mat(0x8fd16a));
    leaf.position.set(stalk.position.x + 0.12, h - 0.1, stalk.position.z);
    leaf.rotation.z = -1.0;
    g.add(leaf);
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

function buildSkyline(scene: THREE.Scene, rng: () => number): void {
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
    const b = rbox(w, DEPTH, d, 0.45, SIDE_COLORS[i % SIDE_COLORS.length], 2);
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

