import type { PlayerIndex, ShootingAssignment, UnitState } from '../types/state.js';

export interface ModelPlacement {
  modelId: string;
  x: number;
  y: number;
}

/**
 * Serializable actions. The server validates every action against the
 * acting player's identity and the rules before applying — clients only
 * ever propose. Every member carries `player` so the server can overwrite
 * it with the authenticated seat and reject out-of-turn proposals.
 */
export type GameAction =
  | { type: 'advanceStep'; player: PlayerIndex }
  | { type: 'concede'; player: PlayerIndex }
  // --- setup ---
  | { type: 'loadRoster'; player: PlayerIndex; units: UnitState[] }
  | { type: 'performRollOff'; player: PlayerIndex }
  | { type: 'chooseRole'; player: PlayerIndex; role: 'attacker' | 'defender' }
  | { type: 'deployUnit'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  // --- movement ---
  | {
      type: 'startMove';
      player: PlayerIndex;
      unitId: string;
      kind: 'normal' | 'advance' | 'fallBack' | 'stationary';
    }
  | { type: 'commitMove'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  | { type: 'cancelMove'; player: PlayerIndex; unitId: string }
  // --- shooting ---
  | {
      type: 'declareShoot';
      player: PlayerIndex;
      unitId: string;
      assignments: ShootingAssignment[];
    }
  | { type: 'resolveSaves'; player: PlayerIndex };

export type ActionResult =
  | { ok: true; state: import('../types/state.js').GameState }
  | { ok: false; error: string; code: ActionErrorCode };

export type ActionErrorCode =
  | 'OUT_OF_TURN'
  | 'PENDING_DECISION'
  | 'GAME_ENDED'
  | 'ILLEGAL'
  | 'UNKNOWN_ACTION';

export function reject(error: string, code: ActionErrorCode = 'ILLEGAL'): ActionResult {
  return { ok: false, error, code };
}
