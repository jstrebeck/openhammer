import type { Datasheet, GameAction, GameState } from '@openhammer/core';

/**
 * Wire protocol. Clients only ever PROPOSE actions; the server validates
 * against the rules engine and the sender's seat before applying.
 */

export type ClientMessage =
  | { type: 'create'; name: string }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'spectate'; roomId: string; name: string }
  | { type: 'reconnect'; roomId: string; token: string }
  | { type: 'action'; action: GameAction }
  | { type: 'uploadRoster'; roster: unknown }
  | { type: 'chat'; text: string };

export type ServerMessage =
  | { type: 'created'; roomId: string; token: string; playerIndex: 0 }
  | { type: 'joined'; roomId: string; token: string; playerIndex: 0 | 1 }
  | { type: 'spectating'; roomId: string }
  | { type: 'reconnected'; roomId: string; playerIndex: 0 | 1 | null }
  | { type: 'state'; state: GameState }
  | { type: 'rejected'; error: string; code: string }
  | { type: 'imported'; playerIndex: 0 | 1; issues: string[]; unitCount: number }
  | { type: 'content'; datasheets: Record<string, Datasheet> }
  | { type: 'chat'; from: string; text: string; at: number }
  | { type: 'presence'; seats: { name: string; connected: boolean }[]; spectators: number }
  | { type: 'error'; error: string };
