import type { GameState, Unit } from '../types/index';

/**
 * Sprint L — Sequencing & Edge Cases (Phase 36)
 *
 * Handles simultaneous rule resolution, out-of-phase restrictions,
 * reinforcements as Normal Move, and excess damage rules.
 */

// ===== Simultaneous Rules Resolution =====

/** Represents a simultaneous rule/ability that needs to be resolved */
export interface SimultaneousRule {
  id: string;
  name: string;
  ownerPlayerId: string;
  /** The effect function to apply — called when the rule is resolved */
  priority?: number;
}

/**
 * Determine the resolution order for simultaneous rules.
 *
 * During a player's turn: the active player chooses the order for their own rules,
 * then the inactive player resolves theirs.
 *
 * Between turns/rounds: players roll off for resolution order.
 *
 * @param rules - All simultaneous rules that need resolving
 * @param activePlayerId - The active player's ID
 * @param timing - Whether this is 'during_turn' or 'between_turns'
 * @param rollOffWinnerId - If between turns, who won the roll-off
 * @returns Rules sorted in resolution order
 */
export function resolveSimultaneousOrder(
  rules: SimultaneousRule[],
  activePlayerId: string,
  timing: 'during_turn' | 'between_turns',
  rollOffWinnerId?: string,
): SimultaneousRule[] {
  if (rules.length <= 1) return rules;

  if (timing === 'during_turn') {
    // Active player's rules first, then inactive player's
    const activeRules = rules.filter(r => r.ownerPlayerId === activePlayerId);
    const inactiveRules = rules.filter(r => r.ownerPlayerId !== activePlayerId);
    return [...activeRules, ...inactiveRules];
  }

  // Between turns/rounds: roll-off winner goes first
  if (rollOffWinnerId) {
    const winnerRules = rules.filter(r => r.ownerPlayerId === rollOffWinnerId);
    const otherRules = rules.filter(r => r.ownerPlayerId !== rollOffWinnerId);
    return [...winnerRules, ...otherRules];
  }

  // No winner specified — return as-is
  return rules;
}

// ===== Out-of-Phase Restrictions =====

/**
 * Check if the current action context is out-of-phase.
 * Out-of-phase actions (e.g., Fire Overwatch) do NOT trigger other rules for that phase.
 * For example, shooting in Overwatch doesn't trigger "start of Shooting Phase" abilities.
 */
export function isOutOfPhaseAction(state: GameState): boolean {
  return state.outOfPhaseAction !== undefined;
}

/**
 * Check if a phase-triggered ability should fire.
 * Returns false if we're in an out-of-phase context.
 */
export function shouldTriggerPhaseAbility(
  state: GameState,
  _abilityPhase: string,
): boolean {
  // Out-of-phase actions don't trigger phase abilities
  if (isOutOfPhaseAction(state)) return false;
  return true;
}

// ===== Reinforcements =====

/**
 * Check if a unit arrived from reserves this turn.
 * Reinforcements count as having made a Normal Move —
 * they can shoot and charge but cannot make additional moves.
 */
export function isReinforcementUnit(state: GameState, unitId: string): boolean {
  // If the unit was in reserves and now has a 'normal' move type,
  // check if it was set by ARRIVE_FROM_RESERVES (which sets movement to 'normal')
  const moveType = state.turnTracking.unitMovement[unitId];
  // Units that arrived from reserves don't have pre-movement positions
  // because they didn't go through DECLARE_MOVEMENT
  if (moveType === 'normal' && !state.turnTracking.preMovementPositions[
    state.units[unitId]?.modelIds[0] ?? ''
  ]) {
    return true;
  }
  return false;
}

/**
 * Check if a unit that arrived from reserves can make additional moves.
 * Reinforcements count as Normal Move — they CANNOT make additional moves.
 */
export function canReinforcementMove(state: GameState, unitId: string): { allowed: boolean; reason?: string } {
  if (isReinforcementUnit(state, unitId)) {
    return { allowed: false, reason: 'Reinforcements cannot make additional moves after arriving' };
  }
  return { allowed: true };
}

/**
 * Check if a unit that arrived from reserves can shoot.
 * Reinforcements CAN shoot.
 */
export function canReinforcementShoot(_state: GameState, _unitId: string): { allowed: boolean } {
  return { allowed: true };
}

/**
 * Check if a unit that arrived from reserves can charge.
 * Reinforcements CAN charge.
 */
export function canReinforcementCharge(_state: GameState, _unitId: string): { allowed: boolean } {
  return { allowed: true };
}

// ===== Excess Damage =====

/**
 * Calculate actual damage applied to a model, clamping to remaining wounds.
 * Excess damage from a single attack is lost when the model is destroyed.
 */
export function clampDamageToWounds(damage: number, currentWounds: number): number {
  return Math.min(damage, currentWounds);
}
