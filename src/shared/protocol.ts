import type { Body, Role } from './sim';
import type { NadeKind } from './constants';

export type Phase = 'start' | 'chase' | 'end';
export type GameMode = 'tag' | 'dm'; // Tag (tag) or free-for-all Deathmatch

// ── Client → Server ───────────────────────────────────────────────────────
export type ClientMessage =
  | { type: 'create_room'; practice?: boolean; mode?: GameMode }
  | { type: 'mode'; mode: GameMode }
  | { type: 'join_room'; roomId: string }
  | { type: 'profile'; name?: string; character?: number }
  | { type: 'ready' }
  | { type: 'add_bot' }
  | { type: 'remove_bot' }
  | { type: 'leave' }
  | { type: 'ping'; t: number }
  // One message per 60Hz client tick, each run exactly once, in order. v = the server tick
  // the client was showing everyone else at (for lag-compensated slashes)
  | { type: 'input'; seq: number; mx: number; mz: number; b: number; v?: number }
  // UDP (WebRTC data channel) setup, signalled over the WebSocket; see src/server/rtc.ts
  | { type: 'rtc_start' }
  | { type: 'rtc_answer'; sdp: string }
  | { type: 'rtc_ice'; candidate: string; mid: string };

// ── Server → Client ───────────────────────────────────────────────────────
export interface LobbyPlayer {
  id: number;
  name: string;
  character: number;
  ready: boolean;
  bot: boolean;
}

export interface Standing {
  id: number;
  name: string;
  character: number;
  score: number;
  kills: number;
  survived: number;
}

/** A player as other clients see it. */
export interface NetPlayer {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  f: number; // facing
  hp: number;
  alive: boolean;
  role: Role;
  frozen: number; // seconds left
  chilled: number;
  lunge: number; // >0 while slashing (drives the slash anim)
  aiming: number; // runner grenade charge 0..1 (0 = not aiming)
  nade: NadeKind | null; // grenade in hand while aiming
  prot: boolean; // spawn protection (deathmatch): blinks, can't be hurt
  stun: number; // seconds left dizzy from a head stomp
}

export interface NetProjectile {
  id: number;
  kind: NadeKind;
  x: number; y: number; z: number;
  owner: number;
}

export interface Snapshot {
  type: 'snap';
  tick: number;
  phase: Phase;
  timeLeft: number;
  ack: number; // last input seq processed for the receiver
  me: (Body & { hp: number; alive: boolean; role: Role; frozen: number; chilled: number; blind: number; nades: Record<NadeKind, number>; nadeSel: NadeKind; respawn: number; stun: number }) | null;
  players: NetPlayer[];
  projectiles: NetProjectile[];
  scores: { id: number; score: number; kills: number }[]; // live points, for the HUD and Tab board
  planks: number[]; // per map.bridges: 0 solid, 1 cracking, 2 collapsed
}

export type KillCause = 'stab' | 'fall' | 'void';

export type GameEvent =
  | { k: 'stab'; by: number }
  | { k: 'hurt'; id: number; hp: number; cause: 'stab' | 'fall' }
  | { k: 'kill'; id: number; by: number | null; cause: KillCause; x: number; y: number; z: number; dx: number; dz: number }
  | { k: 'throw'; by: number; kind: NadeKind }
  | { k: 'det'; kind: NadeKind; x: number; y: number; z: number; hits: number[] }
  | { k: 'bounce'; x: number; y: number; z: number }
  | { k: 'spawn'; id: number; x: number; y: number; z: number }
  | { k: 'stomp'; by: number; id: number; x: number; y: number; z: number }
  | { k: 'refill'; id: number; kind: NadeKind }; // a runner got a grenade back for staying alive

export type ServerMessage =
  | { type: 'welcome'; roomId: string; playerId: number; practice: boolean }
  | { type: 'lobby'; players: LobbyPlayer[]; inMatch: boolean; mode: GameMode; lastStandings?: Standing[] }
  | { type: 'match_start'; roster: LobbyPlayer[]; rounds: number; mode: GameMode; roofs: number[] } // roofs in play (map size)
  | { type: 'round_start'; round: number; roles: Record<number, Role> }
  | { type: 'round_end'; round: number; winner: Role; swap: boolean; standings: Standing[] }
  | { type: 'match_end'; standings: Standing[] }
  | Snapshot
  | { type: 'ev'; tick: number; events: GameEvent[] } // tick: when they happened (clients play them on their render clock)
  | { type: 'error'; msg: string }
  | { type: 'pong'; t: number }
  | { type: 'rtc_offer'; sdp: string; sdpType: string }
  | { type: 'rtc_ice'; candidate: string; mid: string };
