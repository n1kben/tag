import {
  PLAYER_ACCELERATION, PLAYER_MAX_SPEED, PLAYER_FRICTION,
  ARENA_WIDTH, ARENA_HEIGHT, PLAYER_SIZE, BUMP_RECOIL,
} from './constants';

export interface PhysicsState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
}

export interface InputState {
  dx: number; // -1, 0, 1
  dz: number; // -1, 0, 1
  tag: boolean;
}

export function stepPhysics(state: PhysicsState, input: InputState, dt: number): void {
  // Normalize diagonal input
  let dx = input.dx;
  let dz = input.dz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0) {
    dx /= len;
    dz /= len;
  }

  // Accelerate
  state.vx += dx * PLAYER_ACCELERATION * dt;
  state.vz += dz * PLAYER_ACCELERATION * dt;

  // Framerate-independent friction
  const frictionFactor = Math.pow(PLAYER_FRICTION, dt * 60);
  state.vx *= frictionFactor;
  state.vz *= frictionFactor;

  // Clamp speed
  const speed = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
  if (speed > PLAYER_MAX_SPEED) {
    const scale = PLAYER_MAX_SPEED / speed;
    state.vx *= scale;
    state.vz *= scale;
  } else if (speed < 0.01) {
    state.vx = 0;
    state.vz = 0;
  }

  // Move
  state.x += state.vx * dt;
  state.z += state.vz * dt;

  // Clamp to arena bounds
  const halfW = ARENA_WIDTH / 2 - PLAYER_SIZE / 2;
  const halfH = ARENA_HEIGHT / 2 - PLAYER_SIZE / 2;
  if (state.x < -halfW) { state.x = -halfW; state.vx = 0; }
  if (state.x > halfW) { state.x = halfW; state.vx = 0; }
  if (state.z < -halfH) { state.z = -halfH; state.vz = 0; }
  if (state.z > halfH) { state.z = halfH; state.vz = 0; }

  // Update facing angle
  if (speed > 0.1) {
    state.facingAngle = Math.atan2(-state.vx, -state.vz);
  }
}

/**
 * Resolve overlap between two players with position separation and recoil velocity.
 * Call after both players have been stepped.
 */
export function resolvePlayerCollision(a: PhysicsState, b: PhysicsState): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  const minDist = PLAYER_SIZE; // diameter = two radii touching

  if (distSq >= minDist * minDist || distSq < 0.0001) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;

  // Separate equally
  const overlap = minDist - dist;
  const half = overlap / 2;
  a.x -= nx * half;
  a.z -= nz * half;
  b.x += nx * half;
  b.z += nz * half;

  // Recoil: push both players apart along the collision normal
  // Scale by how much relative velocity is going into the collision
  const relVx = a.vx - b.vx;
  const relVz = a.vz - b.vz;
  const relDot = relVx * nx + relVz * nz;

  // Only apply if players are moving towards each other
  if (relDot > 0) {
    a.vx -= nx * relDot;
    a.vz -= nz * relDot;
    b.vx += nx * relDot;
    b.vz += nz * relDot;
  }

  // Always add a bump impulse so it feels punchy
  a.vx -= nx * BUMP_RECOIL;
  a.vz -= nz * BUMP_RECOIL;
  b.vx += nx * BUMP_RECOIL;
  b.vz += nz * BUMP_RECOIL;
}
