import type { ClientMessage, ServerMessage } from '../shared/protocol';

export class Network {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private outbox: ClientMessage[] = [];
  rtt = 0; // smoothed round-trip time in ms
  onClose: (() => void) | null = null;

  constructor(private handler: (msg: ServerMessage) => void) {}

  /** Sends now, or once the socket opens (connecting on demand). */
  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    if (msg.type === 'input') return; // stale inputs are useless
    this.outbox.push(msg);
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) this.connect();
  }

  private connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      for (const m of this.outbox) ws.send(JSON.stringify(m));
      this.outbox = [];
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 500);
    };
    ws.onmessage = event => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        const sample = performance.now() - msg.t;
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3;
        return;
      }
      this.handler(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) {
        this.ws = null;
        this.onClose?.();
      }
    };
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.outbox = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    ws?.close();
  }
}
