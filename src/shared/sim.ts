import {
  PLAYER_RADIUS, STEP_HEIGHT, RUN_SPEED, GROUND_ACCEL, GROUND_DECEL, AIR_CONTROL, GRAVITY, FALL_GRAVITY,
  JUMP_VELOCITY, JUMP_CUT, COYOTE_TIME, JUMP_BUFFER, JUMP_COOLDOWN, STAB_COOLDOWN, LUNGE_SPEED, LUNGE_TIME,
  CHILL_SPEED, AIM_SPEED,
} from './constants';
import type { GameMap } from './map';

export const BTN_JUMP = 1;
export const BTN_ACTION = 2; // seeker: slash · hider: hold to aim grenade, release to throw
export const BTN_ALT = 4; // hider: switch grenade

export interface Input {
  mx: number; // stick, -1..1, already length ≤ 1
  mz: number;
  b: number; // button bitmask
}

export type Role = 'hider' | 'seeker';

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  facing: number; // radians, 0 = +z (towards camera)
  grounded: boolean;
  airTime: number; // since leaving ground (coyote)
  groundTime: number; // since landing (jump cooldown)
  jumpBuf: number;
  rising: boolean; // in a jump that can still be cut short by releasing Space
  attackCd: number;
  lunge: number;
  prevB: number;
}

/** Per-player conditions the sim needs that are owned by the server (frozen, chilled, role). */
export interface Status {
  role: Role;
  frozen: boolean;
  chilled: boolean;
  locked: boolean; // hide phase for seekers / dead / round over
}

export interface StepEvents {
  jumped: boolean;
  landed: number; // impact speed (0 = no landing this step)
  lunged: boolean;
  pressed: number; // buttons that went down this step
  released: number;
}

export function newBody(map: GameMap, x: number, z: number): Body {
  return {
    x, y: map.heightAt(x, z), z, vx: 0, vy: 0, vz: 0, facing: 0,
    grounded: true, airTime: 0, groundTime: 1, jumpBuf: 0, rising: false,
    attackCd: 0, lunge: 0, prevB: 0,
  };
}

export function stepBody(map: GameMap, s: Body, input: Input, st: Status, dt: number): StepEvents {
  const ev: StepEvents = { jumped: false, landed: 0, lunged: false, pressed: 0, released: 0 };
  ev.pressed = input.b & ~s.prevB;
  ev.released = s.prevB & ~input.b;
  s.prevB = input.b;

  s.attackCd = Math.max(0, s.attackCd - dt);
  s.lunge = Math.max(0, s.lunge - dt);

  const canAct = !st.locked && !st.frozen;
  let mx = canAct ? input.mx : 0;
  let mz = canAct ? input.mz : 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (len > 0.2) s.facing = Math.atan2(mx, mz);

  // Stab = short committed lunge (Boomerang Fu slash), server resolves the hit
  if (canAct && st.role === 'seeker' && (ev.pressed & BTN_ACTION) && s.attackCd <= 0) {
    s.attackCd = STAB_COOLDOWN;
    s.lunge = LUNGE_TIME;
    ev.lunged = true;
    const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
    const along = s.vx * fx + s.vz * fz;
    const boost = Math.max(0, LUNGE_SPEED - Math.max(0, along));
    s.vx += fx * boost;
    s.vz += fz * boost;
  }

  // Horizontal: snap up to speed, short slide when letting go, near-full steering in the air
  if (s.lunge <= 0) {
    // Hiders charging a throw shuffle slowly so the stick can aim (Boomerang Fu charge-throw)
    const aiming = st.role === 'hider' && (input.b & BTN_ACTION) !== 0;
    const speedMul = (st.chilled ? CHILL_SPEED : 1) * (aiming ? AIM_SPEED : 1);
    const cap = RUN_SPEED * speedMul;
    const tx = mx * cap, tz = mz * cap;
    if (s.grounded) {
      const k = 1 - Math.exp(-(len > 0.2 ? GROUND_ACCEL : GROUND_DECEL) * dt);
      s.vx += (tx - s.vx) * k;
      s.vz += (tz - s.vz) * k;
    } else if (len > 0.2) {
      // Steer freely, but never brake below the speed you jumped with
      const k = 1 - Math.exp(-AIR_CONTROL * dt);
      const oldSpeed = Math.hypot(s.vx, s.vz);
      s.vx += (tx - s.vx) * k;
      s.vz += (tz - s.vz) * k;
      const newSpeed = Math.hypot(s.vx, s.vz);
      const keep = Math.min(oldSpeed, cap);
      if (newSpeed < keep && newSpeed > 1e-6) { s.vx *= keep / newSpeed; s.vz *= keep / newSpeed; }
    }
  }
  if (st.frozen) { s.vx = 0; s.vz = 0; }

  // Jump with buffer + coyote time, and a cooldown after landing. A press during the cooldown
  // (or just before touching down) is held and fires the moment the cooldown ends.
  if (s.grounded) s.groundTime += dt; else s.airTime += dt;
  const coolingDown = s.grounded && s.groundTime < JUMP_COOLDOWN;
  if (canAct && (ev.pressed & BTN_JUMP)) s.jumpBuf = JUMP_BUFFER;
  else if (!coolingDown) s.jumpBuf = Math.max(0, s.jumpBuf - dt);

  if (s.jumpBuf > 0 && !coolingDown && (s.grounded || s.airTime < COYOTE_TIME) && s.vy <= 0.01) {
    s.vy = JUMP_VELOCITY;
    s.rising = true;
    s.grounded = false;
    s.airTime = COYOTE_TIME;
    s.jumpBuf = 0;
    ev.jumped = true;
  }

  // Variable height: let go of Space on the way up for a short hop
  if (s.rising && (!(input.b & BTN_JUMP) || s.vy <= 0)) {
    if (s.vy > 0) s.vy *= JUMP_CUT;
    s.rising = false;
  }

  // Integrate horizontal, then push out of anything taller than a step
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  collideWalls(map, s);

  // Vertical
  const ground = map.heightAt(s.x, s.z);
  if (s.grounded) {
    if (ground >= s.y - STEP_HEIGHT && ground <= s.y + STEP_HEIGHT) {
      s.y = ground; // follow steps and small drops
      s.vy = 0;
    } else {
      s.grounded = false; // walked off an edge
      s.airTime = 0;
    }
  }
  if (!s.grounded) {
    s.vy -= (s.vy > 0 ? GRAVITY : FALL_GRAVITY) * dt;
    const ny = s.y + s.vy * dt;
    if (s.vy <= 0 && ny <= ground && s.y >= ground - STEP_HEIGHT) {
      ev.landed = -s.vy;
      s.y = ground;
      s.vy = 0;
      s.grounded = true;
      s.rising = false;
      s.groundTime = 0;
    } else {
      s.y = ny;
    }
  }

  return ev;
}

function collideWalls(map: GameMap, s: Body): void {
  const r = PLAYER_RADIUS;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const w of map.solids) {
      if (w.top <= s.y + STEP_HEIGHT) continue;
      const cx = Math.max(w.x0, Math.min(s.x, w.x1));
      const cz = Math.max(w.z0, Math.min(s.z, w.z1));
      const dx = s.x - cx, dz = s.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        s.x = cx + nx * r;
        s.z = cz + nz * r;
        const vn = s.vx * nx + s.vz * nz;
        if (vn < 0) { s.vx -= vn * nx; s.vz -= vn * nz; }
      } else {
        // Centre is inside the box: leave by the shallowest side
        const pen = [s.x - w.x0, w.x1 - s.x, s.z - w.z0, w.z1 - s.z];
        const m = pen.indexOf(Math.min(...pen));
        if (m === 0) { s.x = w.x0 - r; s.vx = Math.min(0, s.vx); }
        if (m === 1) { s.x = w.x1 + r; s.vx = Math.max(0, s.vx); }
        if (m === 2) { s.z = w.z0 - r; s.vz = Math.min(0, s.vz); }
        if (m === 3) { s.z = w.z1 + r; s.vz = Math.max(0, s.vz); }
      }
      moved = true;
    }
    if (!moved) break;
  }
}

export function copyBody(s: Body): Body {
  return { ...s };
}
