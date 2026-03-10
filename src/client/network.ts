import type { ClientMessage, ServerMessage } from '../shared/protocol';

export type MessageHandler = (msg: ServerMessage) => void;

export class Network {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('Connected to server');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
