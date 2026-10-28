import {
  PLAYER_RADIUS, STEP_HEIGHT, RUN_SPEED, GROUND_RESPONSE, AIR_RESPONSE, GRAVITY, JUMP_VELOCITY,
  COYOTE_TIME, JUMP_BUFFER, BHOP_WINDOW, BHOP_GAIN, BHOP_MAX, STAB_COOLDOWN, LUNGE_SPEED, LUNGE_TIME,
  CHILL_SPEED, AIM_SPEED,
} from './constants';
import { SOLIDS, heightAt } from './map';

export const BTN_JUMP = 1;
export const BTN_ACTION = 2; // seeker: stab · hider: hold to aim grenade, release to throw
export const BTN_ALT = 4; // seeker: boomerang (when unlocked) · hider: cycle grenade

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
  groundTime: number; // since landing (bhop window)
  jumpBuf: number;
  hop: number; // bunny-hop speed multiplier
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

export function newBody(x: number, z: number): Body {
  return {
    x, y: heightAt(x, z), z, vx: 0, vy: 0, vz: 0, facing: 0,
    grounded: true, airTime: 0, groundTime: 1, jumpBuf: 0, hop: 1,
    attackCd: 0, lunge: 0, prevB: 0,
  };
}

export function stepBody(s: Body, input: Input, st: Status, dt: number): StepEvents {
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

  // Horizontal: velocity chases the stick target (slidey on ground, floaty in air)
  if (s.lunge <= 0) {
    // Hiders charging a throw shuffle slowly so the stick can aim (Boomerang Fu charge-throw)
    const aiming = st.role === 'hider' && (input.b & BTN_ACTION) !== 0;
    const speedMul = (st.chilled ? CHILL_SPEED : 1) * (aiming ? AIM_SPEED : 1);
    const cap = RUN_SPEED * speedMul * s.hop;
    const tx = mx * cap, tz = mz * cap;
    if (s.grounded) {
      const k = 1 - Math.exp(-GROUND_RESPONSE * dt);
      s.vx += (tx - s.vx) * k;
      s.vz += (tz - s.vz) * k;
    } else if (len > 0.2) {
      // Air control only adds; it never bleeds hop speed (strafe-jump friendly)
      const k = 1 - Math.exp(-AIR_RESPONSE * dt);
      const nvx = s.vx + (tx - s.vx) * k;
      const nvz = s.vz + (tz - s.vz) * k;
      const oldSpeed = Math.hypot(s.vx, s.vz);
      const newSpeed = Math.hypot(nvx, nvz);
      const scale = newSpeed > oldSpeed && newSpeed > cap ? Math.max(oldSpeed, cap) / newSpeed : 1;
      s.vx = nvx * scale;
      s.vz = nvz * scale;
    }
  }
  if (st.frozen) { s.vx = 0; s.vz = 0; }

  // Jump with buffer + coyote time; landing inside the bhop window keeps building speed
  if (canAct && (ev.pressed & BTN_JUMP)) s.jumpBuf = JUMP_BUFFER;
  else s.jumpBuf = Math.max(0, s.jumpBuf - dt);
  if (s.grounded) s.groundTime += dt; else s.airTime += dt;
  if (s.grounded && s.groundTime > BHOP_WINDOW) s.hop = Math.max(1, s.hop - dt * 2);

  if (s.jumpBuf > 0 && (s.grounded || s.airTime < COYOTE_TIME) && s.vy <= 0.01) {
    if (s.groundTime <= BHOP_WINDOW && Math.hypot(s.vx, s.vz) > RUN_SPEED * 0.8) {
      s.hop = Math.min(BHOP_MAX, s.hop * BHOP_GAIN);
    }
    s.vy = JUMP_VELOCITY;
    s.grounded = false;
    s.airTime = COYOTE_TIME;
    s.jumpBuf = 0;
    ev.jumped = true;
  }

  // Integrate horizontal, then push out of anything taller than a step
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  collideWalls(s);

  // Vertical
  const ground = heightAt(s.x, s.z);
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
    s.vy -= GRAVITY * dt;
    const ny = s.y + s.vy * dt;
    if (s.vy <= 0 && ny <= ground && s.y >= ground - STEP_HEIGHT) {
      ev.landed = -s.vy;
      s.y = ground;
      s.vy = 0;
      s.grounded = true;
      s.groundTime = 0;
    } else {
      s.y = ny;
    }
  }

  return ev;
}

function collideWalls(s: Body): void {
  const r = PLAYER_RADIUS;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const w of SOLIDS) {
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
