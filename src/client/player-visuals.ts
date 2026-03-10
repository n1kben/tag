import * as THREE from 'three';
import {
  PLAYER_SIZE, TAG_PARTICLE_COUNT, TAG_PARTICLE_SPEED,
  TAG_PARTICLE_LIFE, TAG_PARTICLE_SIZE,
  TAG_SHAKE_DURATION, TAG_SHAKE_INTENSITY,
} from '../shared/constants';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

export class PlayerVisuals {
  mesh: THREE.Mesh;
  private scene: THREE.Scene;
  private color: number;
  private particles: Particle[] = [];
  private shakeTimer = 0;
  private shakeOffsetX = 0;
  private shakeOffsetZ = 0;

  constructor(scene: THREE.Scene, color: number) {
    this.scene = scene;
    this.color = color;

    const geo = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    const mat = new THREE.MeshStandardMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, PLAYER_SIZE / 2, 0);
    scene.add(this.mesh);

    // Front indicator
    const noseSize = PLAYER_SIZE * 0.25;
    const noseGeo = new THREE.BoxGeometry(noseSize, noseSize, noseSize);
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, 0, -(PLAYER_SIZE / 2 + noseSize / 2));
    this.mesh.add(nose);
  }

  setPosition(x: number, z: number): void {
    this.mesh.position.x = x + this.shakeOffsetX;
    this.mesh.position.z = z + this.shakeOffsetZ;
  }

  setRotation(facingAngle: number): void {
    this.mesh.rotation.y = facingAngle;
  }

  triggerTagEffect(facingAngle: number): void {
    this.shakeTimer = TAG_SHAKE_DURATION;
    this.spawnParticles(facingAngle);
  }

  update(dt: number): void {
    // Shake
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

    // Particles
    this.updateParticles(dt);
  }

  destroy(): void {
    this.scene.remove(this.mesh);
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.particles = [];
  }

  private spawnParticles(facingAngle: number): void {
    const pos = this.mesh.position;
    const particleMat = new THREE.MeshBasicMaterial({ color: this.color });
    const particleGeo = new THREE.BoxGeometry(TAG_PARTICLE_SIZE, TAG_PARTICLE_SIZE, TAG_PARTICLE_SIZE);

    const fwdX = -Math.sin(facingAngle);
    const fwdZ = -Math.cos(facingAngle);
    const spawnX = pos.x + fwdX * (PLAYER_SIZE * 0.6);
    const spawnZ = pos.z + fwdZ * (PLAYER_SIZE * 0.6);

    for (let i = 0; i < TAG_PARTICLE_COUNT; i++) {
      const spread = (Math.random() - 0.5) * Math.PI * 0.5;
      const particleAngle = facingAngle + spread;
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
      p.velocity.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 10;
      p.mesh.rotation.z += dt * 8;
      const t = p.life / TAG_PARTICLE_LIFE;
      p.mesh.scale.setScalar(t);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      (p.mesh.material as THREE.MeshBasicMaterial).transparent = true;
    }
  }
}
