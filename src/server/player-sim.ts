import { PhysicsState, InputState } from '../shared/physics';

export interface QueuedInput {
  seq: number;
  input: InputState;
}

export class ServerPlayer {
  name: string;
  state: PhysicsState;
  inputQueue: QueuedInput[] = [];
  lastProcessedSeq = 0;
  tagCooldown = 0;
  immunityTimer = 0;
  survivalTimeMs = 0; // time spent NOT being "it"

  constructor(name: string, x: number, z: number) {
    this.name = name;
    this.state = { x, z, vx: 0, vz: 0, facingAngle: 0 };
  }
}
