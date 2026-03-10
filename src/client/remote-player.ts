import type { PlayerState } from '../shared/protocol';
import { PlayerVisuals } from './player-visuals';

interface BufferedState {
  timestamp: number;
  state: PlayerState;
}

const INTERPOLATION_DELAY = 100; // ms behind real-time

export class RemotePlayer {
  visuals: PlayerVisuals;
  private buffer: BufferedState[] = [];

  constructor(visuals: PlayerVisuals) {
    this.visuals = visuals;
  }

  pushState(state: PlayerState): void {
    this.buffer.push({ timestamp: performance.now(), state });
    // Keep last 10 states
    if (this.buffer.length > 10) this.buffer.shift();
  }

  update(dt: number): void {
    const renderTime = performance.now() - INTERPOLATION_DELAY;

    // Find the two states to interpolate between
    let prev: BufferedState | null = null;
    let next: BufferedState | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].timestamp <= renderTime && this.buffer[i + 1].timestamp >= renderTime) {
        prev = this.buffer[i];
        next = this.buffer[i + 1];
        break;
      }
    }

    if (prev && next) {
      const range = next.timestamp - prev.timestamp;
      const t = range > 0 ? (renderTime - prev.timestamp) / range : 0;

      const x = prev.state.x + (next.state.x - prev.state.x) * t;
      const z = prev.state.z + (next.state.z - prev.state.z) * t;

      this.visuals.setPosition(x, z);
      // Use the facing angle from the closer state
      this.visuals.setRotation(t < 0.5 ? prev.state.facingAngle : next.state.facingAngle);
    } else if (this.buffer.length > 0) {
      // Extrapolate from last known state
      const last = this.buffer[this.buffer.length - 1].state;
      this.visuals.setPosition(last.x, last.z);
      this.visuals.setRotation(last.facingAngle);
    }

    this.visuals.update(dt);
  }

  triggerTagEffect(): void {
    const last = this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].state : null;
    const angle = last ? last.facingAngle : 0;
    this.visuals.triggerTagEffect(angle);
  }
}
