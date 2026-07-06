import type { PlayerIndex } from '../types/state.js';

/**
 * Serializable actions. The server validates every action against the
 * acting player's identity and the rules before applying — clients only
 * ever propose. The union grows as vertical slices land; every member
 * must carry `player` so out-of-turn proposals can be rejected generically.
 */
export type GameAction =
  | { type: 'advanceStep'; player: PlayerIndex }
  | { type: 'concede'; player: PlayerIndex };

export type ActionResult =
  | { ok: true; state: import('../types/state.js').GameState }
  | { ok: false; error: string; code: ActionErrorCode };

export type ActionErrorCode =
  | 'OUT_OF_TURN'
  | 'PENDING_DECISION'
  | 'GAME_ENDED'
  | 'ILLEGAL'
  | 'UNKNOWN_ACTION';
