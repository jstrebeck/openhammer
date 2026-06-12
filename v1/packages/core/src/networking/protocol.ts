import type { GameState } from '../types/index';
import type { GameAction } from '../state/actions';

/** Roles a connected client can have */
export type PlayerRole = 'player1' | 'player2' | 'spectator';

/** Messages sent from client to server */
export type ClientMessage =
  | { type: 'CREATE_ROOM'; payload: { playerName: string } }
  | { type: 'JOIN_ROOM'; payload: { roomId: string; playerName: string } }
  | { type: 'DISPATCH_ACTION'; payload: { action: GameAction } }
  | { type: 'CHAT'; payload: { text: string } }
  | { type: 'REQUEST_STATE' };

/** Messages sent from server to client */
export type ServerMessage =
  | { type: 'ROOM_CREATED'; payload: { roomId: string; role: PlayerRole; playerId: string } }
  | { type: 'ROOM_JOINED'; payload: { roomId: string; role: PlayerRole; playerId: string } }
  | { type: 'STATE_SNAPSHOT'; payload: { state: GameState } }
  | { type: 'ACTION_BROADCAST'; payload: { action: GameAction; fromPlayerId: string } }
  | { type: 'PLAYER_CONNECTED'; payload: { playerName: string; role: PlayerRole } }
  | { type: 'PLAYER_DISCONNECTED'; payload: { playerName: string; role: PlayerRole } }
  | { type: 'CHAT_BROADCAST'; payload: { playerName: string; text: string; timestamp: number } }
  | { type: 'ERROR'; payload: { message: string } };
