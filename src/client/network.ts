import type { ClientMessage, ServerMessage } from '../shared/protocol';

export type MessageHandler = (msg: ServerMessage) => void;

export class Network {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  rtt = 0; // latest round-trip time in ms

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('Connected to server');
      this.pingInterval = setInterval(() => {
        this.send({ type: 'ping', t: performance.now() });
      }, 1000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        if (msg.type === 'pong') {
          this.rtt = performance.now() - msg.t;
          return;
        }
        this.handler(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('Disconnected from server');
    };

    this.ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
