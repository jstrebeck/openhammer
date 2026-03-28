import type { MoveType } from '../types/index';

export interface Phase {
  id: string;
  name: string;
}

/** Maps phase IDs to the action categories allowed during that phase */
export type PhaseActionMap = Record<string, ActionCategory[]>;

export type ActionCategory =
  | 'movement'     // MOVE_MODEL, DECLARE_MOVEMENT, COMMIT_MOVEMENT, ROLL_ADVANCE
  | 'shooting'     // DECLARE_SHOOTING, ASSIGN_WEAPON_TARGETS, RESOLVE_HIT_ROLL, RESOLVE_WOUND_ROLL, ALLOCATE_WOUND, RESOLVE_PENDING_SAVES, APPLY_DAMAGE
  | 'charge'       // DECLARE_CHARGE, ROLL_CHARGE, COMMIT_CHARGE_MOVE
  | 'fight'        // SELECT_UNIT_TO_FIGHT, PILE_IN, CONSOLIDATE (+ shooting actions for melee attacks)
  | 'setup'        // PLACE_MODEL, REMOVE_MODEL, ADD_UNIT, REMOVE_UNIT, PLACE_TERRAIN, etc.
  | 'admin';       // ADVANCE_PHASE, NEXT_TURN, SET_EDITION, LOG_MESSAGE, SET_RULES_CONFIG, etc.

export interface RulesEdition {
  id: string;
  name: string;
  gameSystem: string;
  phases: Phase[];

  getNextPhase(currentIndex: number): number | null;
  getMaxMoveDistance(moveCharacteristic: number, moveType: MoveType): number;
  getEngagementRange(): number;
  getCoherencyRange(): number;
  getCoherencyMinModels(unitSize: number): number;

  /** Returns which action categories are allowed in each phase */
  getPhaseActionMap(): PhaseActionMap;

  /** Returns the wound roll threshold given attacker S vs target T */
  getWoundThreshold(strength: number, toughness: number): number;

  /** Check if a unit is eligible to shoot based on its movement this turn */
  canUnitShoot(moveType: MoveType | undefined): { allowed: boolean; reason?: string };

  /** Check if a unit is eligible to charge based on its movement this turn */
  canUnitCharge(moveType: MoveType | undefined): { allowed: boolean; reason?: string };
}
