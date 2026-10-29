// Boomerang Fu-style food characters built from primitives: soft rounded bodies, big glossy
// black eyes, mitten hands, stubby feet. Plus the signature "sliced in half" death.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mat, addMist } from './world';
import type { GameMap } from '../shared/map';
import { COLOR_HIDER, COLOR_SEEKER, type NadeKind } from '../shared/constants';

interface CharDef {
  build(body: THREE.Group): void;
  eyeY: number; // eye height
  faceZ: number; // eye depth (front surface)
  eyeGap: number;
  headY: number; // bandana height
  headR: number; // bandana radius
  limb: number; // hand/foot colour
  inside: number; // revealed when sliced
  juice: number; // particle colour
}

const m = (color: number) => mat(color);

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(geo, m(color));
  me.position.set(x, y, z);
  return me;
}

function rounded(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, r);
}

function wedge(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.4, 0.42);
  s.lineTo(0.4, 0.42);
  s.lineTo(0, -0.38);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.09, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -0.15);
  return g;
}

export const CHAR_DEFS: CharDef[] = [
  { // Milk
    build: b => {
      b.add(mesh(rounded(0.62, 0.66, 0.52, 0.1), 0xffffff, 0, 0.47, 0));
      b.add(mesh(rounded(0.64, 0.2, 0.54, 0.06), 0x6aa6f2, 0, 0.86, 0));
      const roof = mesh(new THREE.ConeGeometry(0.36, 0.22, 4), 0x6aa6f2, 0, 1.06, 0);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1.2, 1, 1);
      b.add(roof);
      b.add(mesh(rounded(0.4, 0.14, 0.04, 0.03), 0x9cc6f8, 0, 0.3, 0.26));
    },
    eyeY: 0.6, faceZ: 0.27, eyeGap: 0.13, headY: 0.82, headR: 0.36, limb: 0x6aa6f2, inside: 0xf6f8ff, juice: 0xffffff,
  },
  { // Melon
    build: b => {
      const rind = mesh(wedge(), 0x46a650, 0, 0.5, -0.02);
      rind.scale.set(1.08, 1.06, 0.9);
      rind.position.y = 0.48;
      b.add(rind);
      const flesh = mesh(wedge(), 0xf0505c, 0, 0.52, 0.02);
      b.add(flesh);
      const band = mesh(rounded(0.92, 0.07, 0.5, 0.03), 0xc3ec8f, 0, 0.98, 0);
      b.add(band);
      for (const [x, y] of [[-0.18, 0.75], [0.17, 0.78], [0, 0.4], [-0.1, 0.55], [0.12, 0.53]]) {
        const seed = mesh(new THREE.SphereGeometry(0.03, 6, 4), 0x2b2236, x, y, 0.25);
        seed.scale.set(0.7, 1.2, 0.5);
        b.add(seed);
      }
    },
    eyeY: 0.66, faceZ: 0.26, eyeGap: 0.14, headY: 0.95, headR: 0.47, limb: 0x46a650, inside: 0xff7a85, juice: 0xf0505c,
  },
  { // Carrot
    build: b => {
      const cone = mesh(new THREE.ConeGeometry(0.34, 0.8, 18), 0xf58a38, 0, 0.5, 0);
      cone.rotation.x = Math.PI;
      b.add(cone);
      b.add(mesh(new THREE.SphereGeometry(0.34, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xf58a38, 0, 0.9, 0));
      for (let i = 0; i < 3; i++) {
        const leaf = mesh(new THREE.ConeGeometry(0.07, 0.36, 6), 0x5cc35a, (i - 1) * 0.1, 1.28, 0);
        leaf.rotation.z = (i - 1) * 0.5;
        b.add(leaf);
      }
      for (const y of [0.55, 0.38]) b.add(mesh(rounded(0.3, 0.025, 0.02, 0.01), 0xd86e25, 0.05, y, 0.25));
    },
    eyeY: 0.78, faceZ: 0.3, eyeGap: 0.13, headY: 1.08, headR: 0.3, limb: 0xd86e25, inside: 0xffb36b, juice: 0xf58a38,
  },
  { // Eggplant
    build: b => {
      const body = mesh(new THREE.SphereGeometry(0.4, 22, 16), 0x7d4fb8, 0, 0.5, 0);
      body.scale.set(0.95, 1.15, 0.9);
      b.add(body);
      const cap = mesh(new THREE.ConeGeometry(0.3, 0.22, 7), 0x5cb04a, 0, 0.98, 0);
      cap.rotation.x = Math.PI;
      b.add(cap);
      b.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 6), 0x5cb04a, 0, 1.12, 0));
    },
    eyeY: 0.66, faceZ: 0.34, eyeGap: 0.14, headY: 0.92, headR: 0.33, limb: 0x5f3a94, inside: 0xeee6c6, juice: 0x9c72d6,
  },
  { // Banana
    build: b => {
      const body = mesh(new THREE.CapsuleGeometry(0.27, 0.5, 8, 16), 0xffd84a, 0, 0.56, 0);
      body.rotation.z = 0.12;
      b.add(body);
      const tip = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.14, 8), 0x6e5232, 0.07, 1.14, 0);
      tip.rotation.z = 0.12;
      b.add(tip);
      b.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), 0x6e5232, -0.04, 0.17, 0.12));
    },
    eyeY: 0.72, faceZ: 0.26, eyeGap: 0.13, headY: 0.98, headR: 0.27, limb: 0xe5b52c, inside: 0xfff2c4, juice: 0xffe27a,
  },
  { // Donut
    build: b => {
      b.add(mesh(new THREE.TorusGeometry(0.3, 0.17, 14, 28), 0xe8b06a, 0, 0.5, 0));
      const icing = mesh(new THREE.TorusGeometry(0.3, 0.18, 14, 28, Math.PI * 1.15), 0xff7eb6, 0, 0.5, 0.01);
      icing.rotation.z = -0.07 * Math.PI;
      b.add(icing);
      const sprinkles = [0xffffff, 0x6fd6ff, 0xffe347, 0x8a6bf0];
      for (let i = 0; i < 8; i++) {
        const a = 0.15 + (i / 8) * Math.PI * 0.95;
        const sp = mesh(rounded(0.07, 0.025, 0.025, 0.01), sprinkles[i % 4], Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.17);
        sp.rotation.z = i * 1.3;
        b.add(sp);
      }
    },
    eyeY: 0.8, faceZ: 0.17, eyeGap: 0.13, headY: 0.98, headR: 0.2, limb: 0xd9984f, inside: 0xf7d9a8, juice: 0xff7eb6,
  },
  { // Avocado
    build: b => {
      const skin = mesh(new THREE.SphereGeometry(0.4, 22, 16), 0x4f9a3a, 0, 0.5, 0);
      skin.scale.set(0.92, 1.18, 0.86);
      b.add(skin);
      const face = mesh(new THREE.SphereGeometry(0.34, 22, 16), 0xd8ec92, 0, 0.48, 0.07);
      face.scale.set(0.92, 1.14, 0.8);
      b.add(face);
      b.add(mesh(new THREE.SphereGeometry(0.13, 16, 12), 0x8a5a35, 0, 0.36, 0.3));
    },
    eyeY: 0.68, faceZ: 0.33, eyeGap: 0.13, headY: 0.95, headR: 0.31, limb: 0x3e7e2e, inside: 0xd8ec92, juice: 0xb7d96a,
  },
  { // Sushi
    build: b => {
      b.add(mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.5, 24), 0xfafafa, 0, 0.38, 0));
      b.add(mesh(new THREE.CylinderGeometry(0.345, 0.36, 0.2, 24), 0x2e3448, 0, 0.26, 0));
      const fish = mesh(rounded(0.62, 0.2, 0.62, 0.09), 0xff8a6a, 0, 0.72, 0);
      b.add(fish);
      for (const x of [-0.15, 0.05, 0.22]) b.add(mesh(rounded(0.04, 0.03, 0.6, 0.01), 0xffc2ac, x, 0.83, 0));
    },
    eyeY: 0.5, faceZ: 0.34, eyeGap: 0.13, headY: 0.8, headR: 0.34, limb: 0x2e3448, inside: 0xfafafa, juice: 0xff8a6a,
  },
  { // Coffee
    build: b => {
      b.add(mesh(new THREE.CylinderGeometry(0.32, 0.29, 0.62, 24), 0xfdfbf6, 0, 0.42, 0));
      b.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 24), 0x7a4a2e, 0, 0.72, 0));
      const handle = mesh(new THREE.TorusGeometry(0.13, 0.04, 8, 16), 0xfdfbf6, 0.33, 0.45, 0);
      b.add(handle);
      b.add(mesh(rounded(0.62, 0.08, 0.02, 0.02), 0xc9a27c, 0, 0.6, 0.31));
    },
    eyeY: 0.45, faceZ: 0.32, eyeGap: 0.13, headY: 0.74, headR: 0.33, limb: 0xc9a27c, inside: 0x7a4a2e, juice: 0x7a4a2e,
  },
  { // Popsicle
    build: b => {
      b.add(mesh(rounded(0.54, 0.78, 0.34, 0.2), 0x4fd6c8, 0, 0.6, 0));
      b.add(mesh(rounded(0.55, 0.16, 0.35, 0.07), 0xff7eb6, 0, 0.92, 0));
      b.add(mesh(rounded(0.09, 0.28, 0.05, 0.02), 0xe8c08a, 0, 0.12, 0));
    },
    eyeY: 0.62, faceZ: 0.18, eyeGap: 0.13, headY: 0.95, headR: 0.31, limb: 0x38b4a8, inside: 0xb9f3ec, juice: 0x4fd6c8,
  },
];

// ── A character instance ──────────────────────────────────────────────────

export interface AnimState {
  speed: number;
  vy: number;
  grounded: boolean;
  lunge: number;
  aiming: number; // 0..1 grenade charge
  frozen: boolean;
  chilled: boolean;
  ground?: number; // world y of the surface below (for the blob shadow); defaults to the feet
}

const NADE_COLORS: Record<NadeKind, number> = { flash: 0xfff2a8, frost: 0x8fe3ff };

export class Character {
  readonly root = new THREE.Group(); // positioned at feet, rotated to facing
  readonly body = new THREE.Group(); // squash/stretch pivot
  readonly def: CharDef;
  private visual = new THREE.Group(); // food body only (used for the slice)
  private eyes = new THREE.Group();
  private handL: THREE.Mesh;
  private handR: THREE.Mesh;
  private footL: THREE.Mesh;
  private footR: THREE.Mesh;
  private knife = new THREE.Group();
  private bandana = new THREE.Group();
  private nade: THREE.Mesh;
  private ring: THREE.Mesh;
  private shadow = new THREE.Group(); // blob shadow + team ring, pinned to the surface below
  private ice: THREE.Mesh;
  private phase = 0;
  private squash = 0;
  private blinkT = 2 + Math.random() * 3;
  private wasGrounded = true;
  private t = 0;

  constructor(readonly character: number) {
    this.def = CHAR_DEFS[character % CHAR_DEFS.length];
    const d = this.def;
    d.build(this.visual);
    this.body.add(this.visual);

    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), m(0x1d1a2b));
      eye.scale.set(1, 1.15, 0.55);
      eye.position.set(s * d.eyeGap / 2 + s * 0.02, d.eyeY, d.faceZ);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.035, 0.04, 0.07);
      eye.add(glint);
      this.eyes.add(eye);
    }
    this.body.add(this.eyes);

    this.handL = mesh(new THREE.SphereGeometry(0.1, 12, 10), d.limb);
    this.handR = mesh(new THREE.SphereGeometry(0.1, 12, 10), d.limb);
    this.footL = mesh(new THREE.SphereGeometry(0.11, 12, 8), d.limb);
    this.footR = mesh(new THREE.SphereGeometry(0.11, 12, 8), d.limb);
    for (const f of [this.footL, this.footR]) f.scale.set(1, 0.6, 1.35);
    this.root.add(this.body, this.footL, this.footR);
    this.body.add(this.handL, this.handR);

    // Seeker gear: kitchen knife, red bandana
    const blade = mesh(rounded(0.05, 0.08, 0.34, 0.02), 0xe9edf7, 0, 0, 0.2);
    const handle = mesh(rounded(0.06, 0.07, 0.14, 0.02), 0x6e4a3a, 0, 0, 0.0);
    this.knife.add(blade, handle);
    this.handR.add(this.knife);
    const band = mesh(new THREE.TorusGeometry(d.headR + 0.02, 0.045, 8, 28), 0xe5484d, 0, d.headY - 0.05, 0);
    band.rotation.x = Math.PI / 2;
    const tail1 = mesh(rounded(0.07, 0.04, 0.26, 0.02), 0xe5484d, 0.06, d.headY - 0.1, -d.headR - 0.12);
    tail1.rotation.set(0.6, 0.35, 0);
    const tail2 = mesh(rounded(0.07, 0.04, 0.22, 0.02), 0xe5484d, -0.06, d.headY - 0.12, -d.headR - 0.1);
    tail2.rotation.set(0.7, -0.35, 0);
    this.bandana.add(band, tail1, tail2);
    this.body.add(this.bandana);

    this.nade = mesh(new THREE.SphereGeometry(0.12, 12, 10), 0xffffff);
    this.handR.add(this.nade);

    // Team ring on the floor
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.46, 32),
      new THREE.MeshBasicMaterial({ color: COLOR_HIDER, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    // Soft blob straight below you: shows exactly where a jump will land, like platformer drop shadows
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x3b2a5c, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.shadow.add(blob, this.ring);
    this.root.add(this.shadow);

    const iceMat = new THREE.MeshLambertMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.55, emissive: 0x335577 });
    addMist(iceMat);
    this.ice = new THREE.Mesh(rounded(0.95, 1.25, 0.95, 0.18), iceMat);
    this.ice.position.y = 0.6;
    this.root.add(this.ice);

    this.setRole('hider');
  }

  setRole(role: 'hider' | 'seeker'): void {
    const seeker = role === 'seeker';
    this.knife.visible = seeker;
    this.bandana.visible = seeker;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(seeker ? COLOR_SEEKER : COLOR_HIDER);
  }

  setNade(kind: NadeKind | null): void {
    this.nade.visible = kind !== null;
    if (kind) this.nade.material = mat(NADE_COLORS[kind]);
  }

  setRingVisible(v: boolean): void {
    this.ring.visible = v;
  }

  /** Called when landing so the squash can kick in even if we never saw grounded=false. */
  land(impact: number): void {
    this.squash = Math.min(1, impact / 10);
  }

  update(dt: number, a: AnimState): void {
    this.t += dt;
    const d = this.def;

    if (a.grounded && !this.wasGrounded) this.land(Math.max(4, -a.vy));
    this.wasGrounded = a.grounded;

    // Waddle: phase advances with speed; bob, foot steps and hand swing all hang off it
    const moving = a.speed > 0.4 && a.grounded && !a.frozen;
    this.phase += dt * (moving ? 6 + a.speed * 1.4 : 0);
    const s = Math.sin(this.phase);
    const bob = moving ? Math.abs(s) * 0.07 : Math.sin(this.t * 2.5) * 0.008;

    // Squash on landing, stretch while rising/falling
    this.squash = Math.max(0, this.squash - dt * 5);
    const air = a.grounded ? 0 : THREE.MathUtils.clamp(Math.abs(a.vy) * 0.025, 0, 0.18);
    const sq = this.squash * 0.28 - air;
    const lungeK = a.lunge > 0 ? 1 : 0;
    this.body.scale.set(1 + sq * 0.6, 1 - sq + lungeK * 0.06, 1 + sq * 0.6 + lungeK * 0.1);
    this.body.position.y = bob + (a.grounded ? 0 : 0.04);
    this.body.rotation.x = Math.min(0.25, a.speed * 0.025) + lungeK * 0.25;
    this.body.rotation.z = moving ? s * 0.06 : 0;

    // Feet
    const step = moving ? 0.13 : 0;
    this.footL.position.set(-0.16, 0.06 + (moving ? Math.max(0, s) * 0.08 : 0), step * s + 0.03);
    this.footR.position.set(0.16, 0.06 + (moving ? Math.max(0, -s) * 0.08 : 0), -step * s + 0.03);
    if (!a.grounded) { this.footL.position.y = 0.0; this.footR.position.y = 0.0; }

    // Hands: swing while walking, thrust while stabbing, wind up while aiming a grenade
    const handY = d.eyeY - 0.22;
    this.handL.position.set(-0.42, handY + (moving ? -s * 0.03 : 0), moving ? -s * 0.14 : 0.04);
    this.handR.position.set(0.42, handY + (moving ? s * 0.03 : 0), moving ? s * 0.14 : 0.04);
    if (a.lunge > 0) {
      this.handR.position.set(0.22, handY + 0.05, 0.55);
    } else if (a.aiming > 0) {
      this.handR.position.set(0.36, handY + 0.32 + a.aiming * 0.1, -0.25 - a.aiming * 0.15);
    }
    this.knife.rotation.x = a.lunge > 0 ? 0 : -0.5;
    this.knife.position.set(0, 0, 0.02);
    this.nade.visible = this.nade.visible && a.aiming > 0;

    // Shadow sits on the surface below and shrinks/fades the higher you are
    const ground = a.ground ?? this.root.position.y;
    const height = Math.max(0, this.root.position.y - ground);
    this.shadow.visible = Number.isFinite(ground) && height < 6;
    this.shadow.position.y = Number.isFinite(ground) ? ground - this.root.position.y : 0;
    this.shadow.scale.setScalar(Math.max(0.45, 1 - height * 0.18));

    // Blink
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
    this.eyes.scale.y = a.frozen ? 1 : blink;

    this.ice.visible = a.frozen;
    if (a.frozen) this.ice.rotation.y = Math.sin(this.t * 0.5) * 0.04;
  }

  setOpacity(o: number): void {
    this.root.traverse(c => {
      const me = c as THREE.Mesh;
      if (!me.isMesh || me === this.ring || me === this.ice) return;
      const ma = me.material as THREE.Material;
      if (o < 1 && !ma.userData.own) {
        const own = ma.clone();
        addMist(own);
        own.userData.own = true;
        me.material = own;
      }
      const cur = me.material as THREE.Material;
      if (cur.userData.own) { cur.transparent = o < 1; cur.opacity = o; }
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    // Geometries are per-instance; shared cached materials (userData.own unset) stay alive
    this.root.traverse(o => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      me.geometry.dispose();
      const ma = me.material as THREE.Material;
      if (ma.userData.own || me === this.ring || me === this.ice) ma.dispose();
    });
  }

  /** The food body without gear, for the slice effect and lobby portraits. */
  cloneVisual(): THREE.Group {
    const g = new THREE.Group();
    g.add(this.visual.clone(), this.eyes.clone());
    return g;
  }
}

// ── Sliced-in-half death ──────────────────────────────────────────────────

interface Half {
  obj: THREE.Group;
  plane: THREE.Plane;
  localPlane: THREE.Plane;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rest: boolean;
}

export class SliceDeath {
  private halves: Half[] = [];
  private t = 0;
  done = false;

  constructor(private scene: THREE.Scene, private map: GameMap, ch: Character, x: number, y: number, z: number, facing: number, dirX: number, dirZ: number) {
    // Diagonal cut straight through the face, like a sword slash in the trailer; halves
    // fly apart along the cut normal and get shoved along the hit direction
    const tilt = 0.45;
    const localN0 = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt), 0);
    const center = 0.5;
    for (const side of [1, -1]) {
      const obj = new THREE.Group();
      const visual = ch.cloneVisual();
      visual.position.y = -center;
      obj.add(visual);
      obj.position.set(x, y + center, z);
      obj.rotation.y = facing;
      obj.updateMatrixWorld(true);
      const localPlane = new THREE.Plane(localN0.clone().multiplyScalar(side), 0);
      const plane = localPlane.clone().applyMatrix4(obj.matrixWorld);
      const n = localN0.clone().applyQuaternion(obj.quaternion);
      const meshes: THREE.Mesh[] = [];
      visual.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
      for (const me of meshes) {
        const front = (me.material as THREE.Material).clone() as THREE.MeshLambertMaterial;
        front.clippingPlanes = [plane];
        front.clipShadows = true;
        addMist(front);
        me.material = front;
        // Back faces in the food's inside colour fill the cut like a solid cross-section
        const inner = new THREE.MeshBasicMaterial({ color: ch.def.inside, side: THREE.BackSide, clippingPlanes: [plane] });
        const cap = new THREE.Mesh(me.geometry, inner);
        cap.position.copy(me.position);
        cap.rotation.copy(me.rotation);
        cap.scale.copy(me.scale);
        me.parent!.add(cap);
      }
      const vel = n.clone().multiplyScalar(side * 2.4).add(new THREE.Vector3(dirX * 2, 4.5, dirZ * 2));
      const spin = new THREE.Vector3(dirX, 0, dirZ).multiplyScalar(side * 7).add(new THREE.Vector3(0, side * 3, 0));
      scene.add(obj);
      this.halves.push({ obj, plane, localPlane, vel, spin, rest: false });
    }
  }

  update(dt: number): void {
    this.t += dt;
    for (const h of this.halves) {
      if (!h.rest) {
        h.vel.y -= 20 * dt;
        h.obj.position.addScaledVector(h.vel, dt);
        h.obj.rotation.x += h.spin.x * dt;
        h.obj.rotation.y += h.spin.y * dt;
        h.obj.rotation.z += h.spin.z * dt;
        const g = this.map.heightAt(h.obj.position.x, h.obj.position.z);
        if (h.obj.position.y < g + 0.2 && h.vel.y < 0 && h.obj.position.y > g - 0.5) {
          h.obj.position.y = g + 0.2;
          h.vel.multiplyScalar(0.35);
          h.vel.y = -h.vel.y * 0.5;
          h.spin.multiplyScalar(0.4);
          if (Math.abs(h.vel.y) < 0.6) h.rest = true;
        }
      }
      h.obj.updateMatrixWorld(true);
      h.plane.copy(h.localPlane).applyMatrix4(h.obj.matrixWorld);
      if (this.t > 2.6) h.obj.scale.setScalar(Math.max(0.001, 1 - (this.t - 2.6) * 3));
    }
    if (this.t > 3) {
      for (const h of this.halves) {
        h.obj.removeFromParent();
        // Geometry is shared with the living character's clone source; only the slice materials are ours
        h.obj.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) (me.material as THREE.Material).dispose(); });
      }
      this.done = true;
    }
  }
}
