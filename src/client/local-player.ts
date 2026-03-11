import { stepPhysics, resolvePlayerCollision, PhysicsState, InputState } from '../shared/physics';
import { TAG_COOLDOWN } from '../shared/constants';
import type { PlayerState } from '../shared/protocol';
import { Network } from './network';
import { PlayerVisuals } from './player-visuals';

interface PendingInput {
  seq: number;
  input: InputState;
  dt: number;
}

export class LocalPlayer {
  visuals: PlayerVisuals;
  private network: Network;
  private state: PhysicsState;
  private pendingInputs: PendingInput[] = [];
  private seq = 0;
  private pressed: Set<string>;
  private predictedState: PhysicsState;
  private remoteState: PhysicsState | null = null;
  private tagCooldown = 0;
  private tagWasPressed = false;
  private isIt = false;

  constructor(visuals: PlayerVisuals, network: Network, pressed: Set<string>, startX: number, startZ: number) {
    this.visuals = visuals;
    this.network = network;
    this.pressed = pressed;
    this.state = { x: startX, z: startZ, vx: 0, vz: 0, facingAngle: 0 };
    this.predictedState = { ...this.state };
  }

  update(dt: number): void {
    // Build input from keys
    const input = this.buildInput();
    this.seq++;

    // Send to server
    this.network.send({
      type: 'input',
      seq: this.seq,
      dx: input.dx,
      dz: input.dz,
      tag: input.tag,
    });

    // Fire tag effect locally on key press (only when "it", with cooldown)
    if (this.tagCooldown > 0) this.tagCooldown -= dt;
    if (input.tag && !this.tagWasPressed && this.tagCooldown <= 0 && this.isIt) {
      this.tagCooldown = TAG_COOLDOWN;
      this.visuals.triggerTagEffect(this.predictedState.facingAngle);
    }
    this.tagWasPressed = input.tag;

    // Apply locally (prediction)
    stepPhysics(this.predictedState, input, dt);
    if (this.remoteState) {
      resolvePlayerCollision(this.predictedState, { ...this.remoteState });
    }
    this.pendingInputs.push({ seq: this.seq, input, dt });

    // Update visuals
    this.visuals.setPosition(this.predictedState.x, this.predictedState.z);
    this.visuals.setRotation(this.predictedState.facingAngle);
    this.visuals.update(dt);
  }

  get pendingCount(): number {
    return this.pendingInputs.length;
  }

  setIsIt(isIt: boolean): void {
    this.isIt = isIt;
  }

  setRemoteState(state: PlayerState): void {
    this.remoteState = { ...state };
  }

  reconcile(serverState: PlayerState, lastProcessedSeq: number): void {
    // Set authoritative state
    this.state = { ...serverState };

    // Remove acknowledged inputs
    this.pendingInputs = this.pendingInputs.filter(p => p.seq > lastProcessedSeq);

    // Re-apply unacknowledged inputs (including collision so it matches prediction)
    const reconciled: PhysicsState = { ...this.state };
    for (const pending of this.pendingInputs) {
      stepPhysics(reconciled, pending.input, pending.dt);
      if (this.remoteState) {
        resolvePlayerCollision(reconciled, { ...this.remoteState });
      }
    }

    // Snap or lerp to reconciled position
    const dx = reconciled.x - this.predictedState.x;
    const dz = reconciled.z - this.predictedState.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > 0.3) {
      // Snap — bump recoil causes sharp position changes, trust server
      this.predictedState = { ...reconciled };
    } else {
      // Small correction — blend smoothly
      const t = 0.5;
      this.predictedState.x += (reconciled.x - this.predictedState.x) * t;
      this.predictedState.z += (reconciled.z - this.predictedState.z) * t;
      this.predictedState.vx = reconciled.vx;
      this.predictedState.vz = reconciled.vz;
      this.predictedState.facingAngle = reconciled.facingAngle;
    }
  }

  triggerTagEffect(): void {
    this.visuals.triggerTagEffect(this.predictedState.facingAngle);
  }

  private buildInput(): InputState {
    let dx = 0;
    let dz = 0;
    let tag = false;

    if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) dz = -1;
    if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) dz = 1;
    if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) dx = -1;
    if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) dx = 1;
    if (this.pressed.has('Space') || this.pressed.has('Slash')) tag = true;

    return { dx, dz, tag };
  }
}
