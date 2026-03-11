// Client → Server messages
export interface CreateRoomMsg {
  type: 'create_room';
}

export interface JoinRoomMsg {
  type: 'join_room';
  roomId: string;
}

export interface RenameMsg {
  type: 'rename';
  name: string;
}

export interface ReadyMsg {
  type: 'ready';
}

export interface InputMsg {
  type: 'input';
  seq: number;
  dx: number;  // -1, 0, 1
  dz: number;  // -1, 0, 1
  tag: boolean;
}

export interface LeaveMsg {
  type: 'leave';
}

export interface PingMsg {
  type: 'ping';
  t: number; // client timestamp
}

export type ClientMessage = CreateRoomMsg | JoinRoomMsg | RenameMsg | ReadyMsg | InputMsg | LeaveMsg | PingMsg;

// Server → Client messages
export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
}

export interface LobbyPlayer {
  name: string;
  ready: boolean;
}

export interface RoomCreatedMsg {
  type: 'room_created';
  roomId: string;
  playerId: number; // 0 or 1
  name: string;     // auto-generated name
}

export interface RoomJoinedMsg {
  type: 'room_joined';
  roomId: string;
  playerId: number;
  name: string;     // auto-generated name
}

export interface LobbyStateMsg {
  type: 'lobby_state';
  players: (LobbyPlayer | null)[];
  lastResult?: {
    winnerIdx: number;
    stats: {
      player1Name: string;
      player2Name: string;
      player1SurvivalMs: number;
      player2SurvivalMs: number;
      durationMs: number;
    };
  };
}

export interface OpponentLeftMsg {
  type: 'opponent_left';
}

export interface CountdownMsg {
  type: 'countdown';
  seconds: number;
}

export interface StateMsg {
  type: 'state';
  tick: number;
  time: number; // seconds remaining
  it: number;   // which player is "it" (0 or 1)
  p: [PlayerState, PlayerState];
  seq: number;  // last processed input seq for this client
}

export interface TagAttemptMsg {
  type: 'tag_attempt';
  player: number;
}

export interface TagEventMsg {
  type: 'tag_event';
  tagger: number;
  tagged: number;
}

export interface GameOverMsg {
  type: 'game_over';
  winner: number;
  stats: {
    player1Name: string;
    player2Name: string;
    player1SurvivalMs: number;
    player2SurvivalMs: number;
    durationMs: number;
  };
}

export interface ErrorMsg {
  type: 'error';
  msg: string;
}

export interface PongMsg {
  type: 'pong';
  t: number; // echoed client timestamp
}

export type ServerMessage =
  | RoomCreatedMsg
  | RoomJoinedMsg
  | LobbyStateMsg
  | OpponentLeftMsg
  | CountdownMsg
  | StateMsg
  | TagAttemptMsg
  | TagEventMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg;
