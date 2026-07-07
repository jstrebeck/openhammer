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
  | { type: 'setReserves'; player: PlayerIndex; unitId: string; kind: 'none' | 'strategic' | 'deepStrike' }
  | { type: 'attachLeader'; player: PlayerIndex; leaderUnitId: string; bodyguardUnitId: string | null }
  | { type: 'scoutMove'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  | { type: 'chooseDetachment'; player: PlayerIndex; detachmentId: string }
  | { type: 'setPaintedArmy'; player: PlayerIndex; painted: boolean }
  | {
      type: 'assignEnhancement';
      player: PlayerIndex;
      unitId: string;
      enhancementId: string | null;
    }
  // --- movement ---
  | {
      type: 'startMove';
      player: PlayerIndex;
      unitId: string;
      kind: 'normal' | 'advance' | 'fallBack' | 'stationary';
    }
  | { type: 'commitMove'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  | { type: 'cancelMove'; player: PlayerIndex; unitId: string }
  | { type: 'deployReserves'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  // --- shooting ---
  | {
      type: 'declareShoot';
      player: PlayerIndex;
      unitId: string;
      assignments: ShootingAssignment[];
    }
  | { type: 'resolveSaves'; player: PlayerIndex }
  | {
      type: 'allocateWound';
      player: PlayerIndex;
      modelId: string;
      useInvulnerable?: boolean;
    }
  // --- charge ---
  | { type: 'declareCharge'; player: PlayerIndex; unitId: string; targetIds: string[] }
  | { type: 'commitCharge'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  | { type: 'failCharge'; player: PlayerIndex; unitId: string }
  // --- fight ---
  | { type: 'selectFighter'; player: PlayerIndex; unitId: string }
  | { type: 'pileIn'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  | {
      type: 'declareMelee';
      player: PlayerIndex;
      unitId: string;
      assignments: ShootingAssignment[];
    }
  | { type: 'consolidate'; player: PlayerIndex; unitId: string; positions: ModelPlacement[] }
  // --- activated faction mechanics (Orders, spotter pairings...) ---
  | {
      type: 'useAbility';
      player: PlayerIndex;
      abilityId: string;
      unitId: string;
      targetUnitId?: string;
      secondTargetUnitId?: string;
    }
  // --- stratagem windows ---
  | { type: 'useStratagem'; player: PlayerIndex; stratagemId: string; targetUnitId?: string }
  | {
      type: 'passWindow';
      player: PlayerIndex;
      dontAskAgainThisPhase?: boolean;
    };

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
