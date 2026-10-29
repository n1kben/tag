// Juice: puffs, swooshes, juice splats, grenade blasts, screen shake + hitstop.
import * as THREE from 'three';
import {
  FROST_RADIUS, NADE_THROW_SPEED, NADE_THROW_UP, NADE_MIN_CHARGE, NADE_GRAVITY, type NadeKind,
} from '../shared/constants';
import { FULL_MAP, type GameMap } from '../shared/map';
import { mat } from './world';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  fade: boolean;
}

const sphere = new THREE.IcosahedronGeometry(1, 1);
const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const arcGeo = new THREE.RingGeometry(0.55, 1.05, 24, 1, -1.2, 2.4);

export const NADE_COLORS: Record<NadeKind, number> = { flash: 0xfff2a8, frost: 0x8fe3ff };

export class Fx {
  private parts: Particle[] = [];
  private projectiles = new Map<number, THREE.Object3D>();
  private arc: THREE.Mesh[] = [];
  shake = 0;
  map: GameMap = FULL_MAP; // set by the game when a match's map loads
  hitstop = 0;
  zoomPunch = 0;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 18; i++) {
      const dot = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
      dot.scale.setScalar(0.07);
      dot.visible = false;
      scene.add(dot);
      this.arc.push(dot);
    }
  }

  private spawn(color: number, pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, opts: Partial<Pick<Particle, 'grow' | 'gravity' | 'fade'>> & { geo?: THREE.BufferGeometry; basic?: boolean } = {}): Particle {
    const material = opts.basic === false
      ? mat(color, { transparent: true, cache: false })
      : new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(opts.geo ?? sphere, material);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    const p: Particle = { mesh, vel, life, max: life, grow: opts.grow ?? 0, gravity: opts.gravity ?? 0, fade: opts.fade ?? true };
    this.parts.push(p);
    return p;
  }

  puff(x: number, y: number, z: number, n = 6, color = 0xffffff, size = 0.16): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      this.spawn(color, new THREE.Vector3(x, y + 0.08, z), new THREE.Vector3(Math.cos(a) * 1.6, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.6), size * (0.7 + Math.random() * 0.6), 0.35 + Math.random() * 0.2, { grow: 0.45 });
    }
  }

  juice(x: number, y: number, z: number, color: number, dirX = 0, dirZ = 0, n = 22): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      const v = new THREE.Vector3(Math.cos(a) * sp + dirX * 4, 3 + Math.random() * 5, Math.sin(a) * sp + dirZ * 4);
      this.spawn(color, new THREE.Vector3(x, y + 0.5, z), v, 0.06 + Math.random() * 0.08, 0.6 + Math.random() * 0.4, { gravity: 20, fade: true });
    }
  }

  /** White crescent swoosh in front of a stabbing seeker. */
  slash(x: number, y: number, z: number, facing: number): void {
    const m = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = facing - Math.PI / 2;
    m.position.set(x + Math.sin(facing) * 0.4, y + 0.55, z + Math.cos(facing) * 0.4);
    m.scale.setScalar(0.7);
    this.scene.add(m);
    this.parts.push({ mesh: m, vel: new THREE.Vector3(Math.sin(facing) * 2, 0, Math.cos(facing) * 2), life: 0.14, max: 0.14, grow: 2, gravity: 0, fade: true });
  }

  ring(x: number, y: number, z: number, color: number, radius: number, life = 0.45): void {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.06, z);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    this.parts.push({ mesh: m, vel: new THREE.Vector3(), life, max: life, grow: (radius - 0.2) / life, gravity: 0, fade: true });
  }

  detonate(kind: NadeKind, x: number, y: number, z: number, near: number): void {
    const p = new THREE.Vector3(x, y + 0.3, z);
    if (kind === 'flash') {
      this.spawn(0xffffff, p, new THREE.Vector3(), 0.4, 0.35, { grow: 18 });
      this.spawn(0xfff2a8, p, new THREE.Vector3(), 0.3, 0.5, { grow: 10 });
      this.ring(x, y, z, 0xffffff, 5, 0.4);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.spawn(0xfff6c4, p.clone(), new THREE.Vector3(Math.cos(a) * 9, 2 + Math.random() * 3, Math.sin(a) * 9), 0.08, 0.3);
      }
    } else if (kind === 'frost') {
      this.ring(x, y, z, 0x8fe3ff, FROST_RADIUS, 0.5);
      this.ring(x, y, z, 0xffffff, FROST_RADIUS * 0.7, 0.35);
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5;
        this.spawn(i % 2 ? 0xbfeaff : 0xffffff, p.clone(), new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp), 0.1 + Math.random() * 0.1, 0.7, { gravity: 14, basic: false, geo: shardGeo });
      }
    }
    this.addShake(0.2 * near);
  }

  addShake(a: number): void {
    this.shake = Math.min(0.8, this.shake + a);
  }

  /** Boomerang Fu-style impact freeze: the whole scene holds for a beat. */
  freeze(seconds: number, punch = 0.06): void {
    this.hitstop = Math.max(this.hitstop, seconds);
    this.zoomPunch = Math.max(this.zoomPunch, punch);
  }

  syncProjectiles(list: { id: number; kind: NadeKind; x: number; y: number; z: number }[], dt: number): void {
    const live = new Set(list.map(p => p.id));
    for (const [id, o] of this.projectiles) {
      if (!live.has(id)) { o.removeFromParent(); this.projectiles.delete(id); }
    }
    for (const pr of list) {
      let o = this.projectiles.get(pr.id);
      if (!o) {
        o = makeNade(pr.kind);
        this.scene.add(o);
        this.projectiles.set(pr.id, o);
        o.position.set(pr.x, pr.y, pr.z);
      }
      o.position.lerp(new THREE.Vector3(pr.x, pr.y, pr.z), Math.min(1, dt * 25));
      o.rotation.x += dt * 8;
    }
  }

  /** Dotted throw arc for a hider charging a grenade (local player only). */
  showArc(x: number, y: number, z: number, facing: number, vx: number, vz: number, charge: number): void {
    const fx = Math.sin(facing), fz = Math.cos(facing);
    const c = NADE_MIN_CHARGE + charge * (1 - NADE_MIN_CHARGE);
    let px = x + fx * 0.4, py = y + 0.9, pz = z + fz * 0.4;
    let ux = fx * NADE_THROW_SPEED * c + vx * 0.5, uz = fz * NADE_THROW_SPEED * c + vz * 0.5, uy = NADE_THROW_UP * (0.6 + 0.4 * c);
    const step = 0.05;
    let hidden = false;
    for (let i = 0; i < this.arc.length; i++) {
      for (let k = 0; k < 2; k++) {
        uy -= NADE_GRAVITY * step;
        px += ux * step; py += uy * step; pz += uz * step;
      }
      if (py < this.map.heightAt(px, pz)) hidden = true;
      const dot = this.arc[i];
      dot.visible = !hidden;
      dot.position.set(px, py, pz);
      dot.scale.setScalar(0.07 * (1 - i / this.arc.length * 0.5));
    }
  }

  hideArc(): void {
    for (const d of this.arc) d.visible = false;
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        (p.mesh.material as THREE.Material).dispose();
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(p.gravity ? 1 : Math.exp(-5 * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.gravity) {
        const g = this.map.heightAt(p.mesh.position.x, p.mesh.position.z);
        if (p.mesh.position.y < g + 0.04 && p.mesh.position.y > g - 0.5) {
          p.mesh.position.y = g + 0.04;
          p.vel.set(p.vel.x * 0.3, 0, p.vel.z * 0.3);
        }
      }
      const s = p.mesh.scale.x + p.grow * dt; // grow is in world units per second
      p.mesh.scale.setScalar(Math.max(0.001, s));
      if (p.fade) (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (p.life / p.max) * 1.5);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.zoomPunch = Math.max(0, this.zoomPunch - dt * 0.4);
  }
}

const nadeGeo = new THREE.IcosahedronGeometry(0.17, 1);
const capGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8);
const shardGeo = new THREE.OctahedronGeometry(1);

function makeNade(kind: NadeKind): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(nadeGeo, mat(NADE_COLORS[kind]));
  const cap = new THREE.Mesh(capGeo, mat(0x5d4a58));
  cap.position.y = 0.17;
  g.add(body, cap);
  return g;
}
