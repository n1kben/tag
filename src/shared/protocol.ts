import type { Body, Role } from './sim';
import type { NadeKind } from './constants';

export type Phase = 'hide' | 'seek' | 'end';

// ── Client → Server ───────────────────────────────────────────────────────
export type ClientMessage =
  | { type: 'create_room'; practice?: boolean }
  | { type: 'join_room'; roomId: string }
  | { type: 'profile'; name?: string; character?: number }
  | { type: 'ready' }
  | { type: 'add_bot' }
  | { type: 'remove_bot' }
  | { type: 'leave' }
  | { type: 'ping'; t: number }
  // One message per 60Hz client tick; the server consumes exactly one per tick per player
  | { type: 'input'; seq: number; mx: number; mz: number; b: number };

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

/** A player as other clients see it. Hiders out of a seeker's sight are left out entirely. */
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
  lunge: number; // >0 while stabbing (drives the slash anim)
  rang: boolean; // holding the boomerang
  aiming: number; // hider grenade charge 0..1 (0 = not aiming)
  bush: boolean;
}

export interface NetProjectile {
  id: number;
  kind: NadeKind | 'rang';
  x: number; y: number; z: number;
  owner: number;
}

export interface NetSmoke { id: number; x: number; y: number; z: number; t: number }

export interface Snapshot {
  type: 'snap';
  tick: number;
  phase: Phase;
  timeLeft: number;
  ack: number; // last input seq processed for the receiver
  me: (Body & { hp: number; alive: boolean; role: Role; frozen: number; chilled: number; blind: number; rangHeld: boolean; rangUnlocked: boolean; nades: Record<NadeKind, number>; nadeSel: NadeKind }) | null;
  players: NetPlayer[];
  projectiles: NetProjectile[];
  smokes: NetSmoke[];
}

export type GameEvent =
  | { k: 'stab'; by: number }
  | { k: 'hurt'; id: number; hp: number; cause: 'stab' | 'fall' | 'boom' | 'rang' }
  | { k: 'kill'; id: number; by: number | null; cause: 'stab' | 'backstab' | 'fall' | 'void' | 'boom' | 'rang'; x: number; y: number; z: number; dx: number; dz: number }
  | { k: 'throw'; by: number; kind: NadeKind | 'rang' }
  | { k: 'det'; kind: NadeKind; x: number; y: number; z: number; hits: number[] }
  | { k: 'catch'; id: number }
  | { k: 'bounce'; x: number; y: number; z: number };

export type ServerMessage =
  | { type: 'welcome'; roomId: string; playerId: number; practice: boolean }
  | { type: 'lobby'; players: LobbyPlayer[]; inMatch: boolean; lastStandings?: Standing[] }
  | { type: 'match_start'; roster: LobbyPlayer[]; rounds: number }
  | { type: 'round_start'; round: number; roles: Record<number, Role>; rangUnlocked: boolean }
  | { type: 'round_end'; round: number; winner: Role; swap: boolean; standings: Standing[]; rangNext: boolean }
  | { type: 'match_end'; standings: Standing[] }
  | Snapshot
  | { type: 'ev'; events: GameEvent[] }
  | { type: 'error'; msg: string }
  | { type: 'pong'; t: number };
