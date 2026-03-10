import * as THREE from 'three';
import {
  PLAYER_SIZE, PLAYER_ACCELERATION, PLAYER_MAX_SPEED, PLAYER_FRICTION,
  COLOR_PLAYER, TAG_COOLDOWN, TAG_SHAKE_DURATION, TAG_SHAKE_INTENSITY,
  TAG_PARTICLE_COUNT, TAG_PARTICLE_SPEED, TAG_PARTICLE_LIFE, TAG_PARTICLE_SIZE,
} from './constants';

export interface PlayerKeys {
  up: string;
  down: string;
  left: string;
  right: string;
  tag: string;
}

export const WASD_KEYS: PlayerKeys = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', tag: 'Space',
};

export const ARROW_KEYS: PlayerKeys = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', tag: 'Slash',
};

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

export class Player {
  mesh: THREE.Mesh;
  velocity = new THREE.Vector2(0, 0);
  private keys: PlayerKeys;
  private altKeys: PlayerKeys | null;
  private pressed: Set<string>;
  private halfSize: number;
  private scene: THREE.Scene;
  private color: number;

  private facingAngle = 0; // radians, 0 = facing -Z

  // Tag action state
  private tagCooldownTimer = 0;
  private shakeTimer = 0;
  private basePosition = new THREE.Vector3();
  private particles: Particle[] = [];
  private tagPressed = false;

  constructor(
    scene: THREE.Scene,
    keys: PlayerKeys,
    pressed: Set<string>,
    color: number = COLOR_PLAYER,
    startPos: THREE.Vector3 = new THREE.Vector3(0, PLAYER_SIZE / 2, 0),
    altKeys: PlayerKeys | null = null,
  ) {
    this.keys = keys;
    this.altKeys = altKeys;
    this.pressed = pressed;
    this.halfSize = PLAYER_SIZE / 2;
    this.scene = scene;
    this.color = color;

    const geo = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    const mat = new THREE.MeshStandardMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(startPos);
    scene.add(this.mesh);

    // Front indicator — small bright box on the -Z face
    const noseSize = PLAYER_SIZE * 0.25;
    const noseGeo = new THREE.BoxGeometry(noseSize, noseSize, noseSize);
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, 0, -(PLAYER_SIZE / 2 + noseSize / 2));
    this.mesh.add(nose);
  }

  private tryTag(): void {
    const has = (k: string) => this.pressed.has(k);
    const alt = this.altKeys;
    const tagDown = has(this.keys.tag) || (alt !== null && has(alt.tag));

    if (tagDown && !this.tagPressed && this.tagCooldownTimer <= 0) {
      this.tagCooldownTimer = TAG_COOLDOWN;
      this.shakeTimer = TAG_SHAKE_DURATION;
      this.basePosition.copy(this.mesh.position);
      this.spawnParticles();
    }
    this.tagPressed = tagDown;
  }

  private spawnParticles(): void {
    const pos = this.mesh.position;
    const particleMat = new THREE.MeshBasicMaterial({ color: this.color });
    const particleGeo = new THREE.BoxGeometry(TAG_PARTICLE_SIZE, TAG_PARTICLE_SIZE, TAG_PARTICLE_SIZE);

    // Forward direction from facing angle (facing -Z when angle=0)
    const fwdX = -Math.sin(this.facingAngle);
    const fwdZ = -Math.cos(this.facingAngle);

    // Spawn position slightly in front of the player
    const spawnX = pos.x + fwdX * (PLAYER_SIZE * 0.6);
    const spawnZ = pos.z + fwdZ * (PLAYER_SIZE * 0.6);

    for (let i = 0; i < TAG_PARTICLE_COUNT; i++) {
      // Cone spread: ±45 degrees around facing direction
      const spread = (Math.random() - 0.5) * Math.PI * 0.5;
      const particleAngle = this.facingAngle + spread;
      const dirX = -Math.sin(particleAngle);
      const dirZ = -Math.cos(particleAngle);
      const elevAngle = (Math.random() - 0.3) * Math.PI * 0.4;
      const speed = TAG_PARTICLE_SPEED * (0.5 + Math.random() * 0.5);

      const mesh = new THREE.Mesh(particleGeo, particleMat);
      mesh.position.set(spawnX, pos.y, spawnZ);
      mesh.scale.setScalar(0.5 + Math.random() * 0.5);
      this.scene.add(mesh);

      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          dirX * Math.cos(elevAngle) * speed,
          Math.sin(elevAngle) * speed + 2,
          dirZ * Math.cos(elevAngle) * speed,
        ),
        life: TAG_PARTICLE_LIFE * (0.7 + Math.random() * 0.3),
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= 15 * dt; // gravity
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 10;
      p.mesh.rotation.z += dt * 8;
      const t = p.life / TAG_PARTICLE_LIFE;
      p.mesh.scale.setScalar(t);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      (p.mesh.material as THREE.MeshBasicMaterial).transparent = true;
    }
  }

  private shakeOffsetX = 0;
  private shakeOffsetZ = 0;

  private applyShake(dt: number): void {
    // Remove previous frame's shake offset
    this.mesh.position.x -= this.shakeOffsetX;
    this.mesh.position.z -= this.shakeOffsetZ;
    this.shakeOffsetX = 0;
    this.shakeOffsetZ = 0;

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const intensity = TAG_SHAKE_INTENSITY * Math.max(0, this.shakeTimer / TAG_SHAKE_DURATION);
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * intensity;
      this.shakeOffsetZ = (Math.random() - 0.5) * 2 * intensity;
      this.mesh.position.x += this.shakeOffsetX;
      this.mesh.position.z += this.shakeOffsetZ;
    }
  }

  update(dt: number, walls: THREE.Box3[]): void {
    // Remove previous shake offset before physics
    this.mesh.position.x -= this.shakeOffsetX;
    this.mesh.position.z -= this.shakeOffsetZ;
    this.shakeOffsetX = 0;
    this.shakeOffsetZ = 0;

    // Cooldown
    if (this.tagCooldownTimer > 0) this.tagCooldownTimer -= dt;

    // Tag action
    this.tryTag();

    // 1. Build input direction
    const inputDir = new THREE.Vector2(0, 0);
    const has = (k: string) => this.pressed.has(k);
    const alt = this.altKeys;
    if (has(this.keys.up) || (alt && has(alt.up))) inputDir.y -= 1;
    if (has(this.keys.down) || (alt && has(alt.down))) inputDir.y += 1;
    if (has(this.keys.left) || (alt && has(alt.left))) inputDir.x -= 1;
    if (has(this.keys.right) || (alt && has(alt.right))) inputDir.x += 1;
    if (inputDir.length() > 0) inputDir.normalize();

    // 2. Accelerate
    this.velocity.x += inputDir.x * PLAYER_ACCELERATION * dt;
    this.velocity.y += inputDir.y * PLAYER_ACCELERATION * dt;

    // 3. Framerate-independent friction
    const frictionFactor = Math.pow(PLAYER_FRICTION, dt * 60);
    this.velocity.x *= frictionFactor;
    this.velocity.y *= frictionFactor;

    // 4. Clamp speed
    const speed = this.velocity.length();
    if (speed > PLAYER_MAX_SPEED) {
      this.velocity.normalize().multiplyScalar(PLAYER_MAX_SPEED);
    } else if (speed < 0.01) {
      this.velocity.set(0, 0);
    }

    // 5. AABB collision — axis-separated resolution
    const pos = this.mesh.position;

    // Try X axis
    const newX = pos.x + this.velocity.x * dt;
    const playerBoxX = new THREE.Box3(
      new THREE.Vector3(newX - this.halfSize, 0, pos.z - this.halfSize),
      new THREE.Vector3(newX + this.halfSize, PLAYER_SIZE, pos.z + this.halfSize),
    );
    let collidedX = false;
    for (const wall of walls) {
      if (playerBoxX.intersectsBox(wall)) {
        collidedX = true;
        break;
      }
    }
    if (!collidedX) {
      pos.x = newX;
    } else {
      this.velocity.x = 0;
    }

    // Try Z axis
    const newZ = pos.z + this.velocity.y * dt;
    const playerBoxZ = new THREE.Box3(
      new THREE.Vector3(pos.x - this.halfSize, 0, newZ - this.halfSize),
      new THREE.Vector3(pos.x + this.halfSize, PLAYER_SIZE, newZ + this.halfSize),
    );
    let collidedZ = false;
    for (const wall of walls) {
      if (playerBoxZ.intersectsBox(wall)) {
        collidedZ = true;
        break;
      }
    }
    if (!collidedZ) {
      pos.z = newZ;
    } else {
      this.velocity.y = 0;
    }

    // Rotate to face movement direction
    if (this.velocity.length() > 0.1) {
      this.facingAngle = Math.atan2(-this.velocity.x, -this.velocity.y);
      this.mesh.rotation.y = this.facingAngle;
    }

    // Shake effect (visual only)
    this.applyShake(dt);

    // Particles
    this.updateParticles(dt);
  }
}
