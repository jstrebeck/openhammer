import type { GameState } from '../types/index';

// ===== Stratagem Combat Integration =====

/**
 * Get hit and save modifiers for a target unit affected by Smokescreen.
 * Smokescreen grants Stealth (-1 to Hit) and Benefit of Cover (+1 save).
 */
export function getSmokescreenModifiers(state: GameState, targetUnitId: string): {
  hitModifier: number;
  coverSaveModifier: number;
} {
  if (state.stratagemEffects.smokescreenUnits.includes(targetUnitId)) {
    return { hitModifier: -1, coverSaveModifier: 1 };
  }
  return { hitModifier: 0, coverSaveModifier: 0 };
}

/**
 * Get save modifiers for a target unit affected by Go to Ground.
 * Go to Ground grants 6+ invulnerable save and Benefit of Cover (+1 save).
 */
export function getGoToGroundModifiers(state: GameState, targetUnitId: string): {
  coverSaveModifier: number;
  bonusInvulnSave: number | undefined;
} {
  if (state.stratagemEffects.goToGroundUnits.includes(targetUnitId)) {
    return { coverSaveModifier: 1, bonusInvulnSave: 6 };
  }
  return { coverSaveModifier: 0, bonusInvulnSave: undefined };
}

/**
 * Check if an attacking unit's CHARACTER model gains Precision from Epic Challenge.
 * Epic Challenge grants Precision to CHARACTER melee attacks — bypasses Bodyguard allocation.
 */
export function isEpicChallengePrecision(state: GameState, attackingUnitId: string): boolean {
  return state.stratagemEffects.epicChallengeUnits.includes(attackingUnitId);
}

/**
 * Combine all stratagem-based save modifiers for a target unit.
 * Returns the combined coverSaveModifier and best bonusInvulnSave.
 */
export function getStratagemSaveModifiers(state: GameState, targetUnitId: string): {
  coverSaveModifier: number;
  bonusInvulnSave: number | undefined;
} {
  const smoke = getSmokescreenModifiers(state, targetUnitId);
  const ground = getGoToGroundModifiers(state, targetUnitId);

  // Cover bonuses are not cumulative — take the best one (max +1 from any source)
  const coverSaveModifier = Math.max(smoke.coverSaveModifier, ground.coverSaveModifier);
  const bonusInvulnSave = ground.bonusInvulnSave;

  return { coverSaveModifier, bonusInvulnSave };
}

/**
 * Get the combined hit modifier from stratagems for a target unit.
 * Currently only Smokescreen grants Stealth (-1 to Hit).
 */
export function getStratagemHitModifier(state: GameState, targetUnitId: string): number {
  const smoke = getSmokescreenModifiers(state, targetUnitId);
  return smoke.hitModifier;
}
