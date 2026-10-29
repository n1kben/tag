// UDP for gameplay. Each player can open a WebRTC data channel next to their WebSocket:
// unreliable and unordered, carrying snapshots down and inputs up, so a lost packet is just
// gone instead of stalling everything behind it the way TCP does. Signalling (offer, answer,
// ICE candidates) goes over the player's WebSocket, which also stays in charge of everything
// that must arrive (lobby, rounds, events) and carries snapshots until the channel opens or
// if UDP can't get through at all.
//
// Env: RTC=off disables it. RTC_PORT (default 40000) is the one UDP port every peer shares
// (ICE UDP mux), so a firewall only needs that port open. RTC_STUN (e.g.
// stun:stun.l.google.com:19302) only if the server sits behind NAT.
import nodeDataChannel, { type DataChannel, type PeerConnection } from 'node-datachannel';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/protocol';

const ENABLED = process.env.RTC !== 'off';
const PORT = Number(process.env.RTC_PORT) || 40000;
const STUN = process.env.RTC_STUN ? [process.env.RTC_STUN] : [];

interface Link { pc: PeerConnection; dc: DataChannel; open: boolean }
const links = new Map<WebSocket, Link>();

/**
 * Client asked for UDP: offer it a data channel. `send` goes back over the WebSocket;
 * `onPacket` gets everything the client sends on the channel.
 */
export function rtcStart(ws: WebSocket, send: (msg: ServerMessage) => void, onPacket: (data: Buffer) => void): void {
  if (!ENABLED) return;
  rtcClose(ws);
  let pc: PeerConnection;
  try {
    pc = new nodeDataChannel.PeerConnection('player', {
      iceServers: STUN,
      enableIceUdpMux: true, // every peer on one port
      portRangeBegin: PORT,
      portRangeEnd: PORT,
    });
  } catch (err) {
    console.error('rtc: peer connection failed', err);
    return;
  }
  pc.onLocalDescription((sdp, type) => send({ type: 'rtc_offer', sdp, sdpType: type }));
  pc.onLocalCandidate((candidate, mid) => send({ type: 'rtc_ice', candidate, mid }));
  pc.onStateChange(state => {
    if (state === 'failed' || state === 'closed') rtcClose(ws);
  });
  // Snapshots and inputs: no retransmits, no ordering (each carries its own tick / seq)
  const dc = pc.createDataChannel('game', { unordered: true, maxRetransmits: 0 });
  const link: Link = { pc, dc, open: false };
  dc.onOpen(() => { link.open = true; });
  dc.onClosed(() => { link.open = false; });
  dc.onError(() => { link.open = false; });
  dc.onMessage(msg => { if (typeof msg !== 'string') onPacket(Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer)); });
  links.set(ws, link);
}

/** The client's answer and ICE candidates. */
export function rtcSignal(ws: WebSocket, msg: { type: 'rtc_answer'; sdp: string } | { type: 'rtc_ice'; candidate: string; mid: string }): void {
  const link = links.get(ws);
  if (!link) return;
  try {
    if (msg.type === 'rtc_answer') link.pc.setRemoteDescription(String(msg.sdp), 'answer');
    else link.pc.addRemoteCandidate(String(msg.candidate), String(msg.mid));
  } catch {
    rtcClose(ws); // garbage from the client: just stay on the WebSocket
  }
}

/** Sends over UDP if this player's channel is open; false means use the WebSocket. */
export function rtcSend(ws: WebSocket, bytes: Uint8Array): boolean {
  const link = links.get(ws);
  if (!link?.open) return false;
  try {
    return link.dc.sendMessageBinary(bytes);
  } catch {
    link.open = false;
    return false;
  }
}

export function rtcClose(ws: WebSocket): void {
  const link = links.get(ws);
  if (!link) return;
  links.delete(ws);
  link.open = false;
  try { link.dc.close(); } catch { /* already gone */ }
  try { link.pc.close(); } catch { /* already gone */ }
}
