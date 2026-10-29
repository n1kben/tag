// The connection to the server: a WebSocket for everything, plus (when the network allows)
// a WebRTC data channel for the 30-60Hz traffic, snapshots down and inputs up, over UDP so a
// lost packet doesn't stall the ones behind it. See src/server/rtc.ts. ?udp=0 turns it off.
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { decodeSnapshot, encodeInputs, type WireInput } from '../shared/wire';

const INPUT_REDUNDANCY = 3; // each UDP packet repeats the newest few inputs

export class Network {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private outbox: ClientMessage[] = [];
  rtt = 0; // smoothed round-trip time in ms
  onClose: (() => void) | null = null;

  constructor(private handler: (msg: ServerMessage) => void) {}

  /** How snapshots and inputs are travelling right now. */
  get transport(): 'udp' | 'ws' {
    return this.dc?.readyState === 'open' ? 'udp' : 'ws';
  }

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

  /** The newest inputs (oldest first): over UDP the last few together, else just the newest. */
  sendInputs(recent: WireInput[]): void {
    if (!recent.length) return;
    if (this.dc?.readyState === 'open') {
      this.dc.send(encodeInputs(recent.slice(-INPUT_REDUNDANCY)) as Uint8Array<ArrayBuffer>);
      return;
    }
    const i = recent[recent.length - 1];
    this.send({ type: 'input', seq: i.seq, mx: i.mx, mz: i.mz, b: i.b, v: i.v });
  }

  private connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer'; // snapshots arrive binary
    this.ws = ws;
    ws.onopen = () => {
      for (const m of this.outbox) ws.send(JSON.stringify(m));
      this.outbox = [];
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 500);
      const udp = new URLSearchParams(location.search).get('udp') !== '0';
      if (udp && typeof RTCPeerConnection !== 'undefined') this.send({ type: 'rtc_start' });
    };
    ws.onmessage = event => {
      let msg: ServerMessage;
      try {
        msg = event.data instanceof ArrayBuffer ? decodeSnapshot(event.data) : JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        const sample = performance.now() - msg.t;
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3;
        return;
      }
      if (msg.type === 'rtc_offer') { void this.answer(msg.sdp); return; }
      if (msg.type === 'rtc_ice') { void this.pc?.addIceCandidate({ candidate: msg.candidate, sdpMid: msg.mid }).catch(() => {}); return; }
      this.handler(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.closeRtc();
      if (this.ws === ws) {
        this.ws = null;
        this.onClose?.();
      }
    };
  }

  /** The server offered a data channel: accept it. If it never opens we just stay on the WebSocket. */
  private async answer(sdp: string): Promise<void> {
    this.closeRtc();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.onicecandidate = e => {
      if (e.candidate?.candidate) this.send({ type: 'rtc_ice', candidate: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
    };
    pc.ondatachannel = e => {
      const dc = e.channel;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = ev => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        try { this.handler(decodeSnapshot(ev.data)); } catch { /* corrupt packet: drop it */ }
      };
      this.dc = dc;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.closeRtc();
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: 'rtc_answer', sdp: answer.sdp ?? '' });
    } catch {
      this.closeRtc();
    }
  }

  private closeRtc(): void {
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.outbox = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.closeRtc();
    ws?.close();
  }
}
