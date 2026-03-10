// Client → Server messages
export interface CreateRoomMsg {
  type: 'create_room';
  name: string;
}

export interface JoinRoomMsg {
  type: 'join_room';
  roomId: string;
  name: string;
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

export type ClientMessage = CreateRoomMsg | JoinRoomMsg | InputMsg | LeaveMsg;

// Server → Client messages
export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facingAngle: number;
}

export interface RoomCreatedMsg {
  type: 'room_created';
  roomId: string;
  playerId: number; // 0 or 1
}

export interface RoomJoinedMsg {
  type: 'room_joined';
  roomId: string;
  playerId: number;
  opponent: string;
}

export interface OpponentJoinedMsg {
  type: 'opponent_joined';
  opponent: string;
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

export type ServerMessage =
  | RoomCreatedMsg
  | RoomJoinedMsg
  | OpponentJoinedMsg
  | OpponentLeftMsg
  | CountdownMsg
  | StateMsg
  | TagEventMsg
  | GameOverMsg
  | ErrorMsg;
