import type { Unit, Model, GameState } from '../types/index';

// ===== Wound Allocation =====

/**
 * Get the model that should receive wound allocation next.
 * Rules: allocate to already-wounded models first.
 */
export function getWoundAllocationTarget(unit: Unit, models: Record<string, Model>): Model | null {
  const activeModels = unit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (activeModels.length === 0) return null;

  // Already-wounded models first (wounds < maxWounds)
  const wounded = activeModels.filter(m => m.wounds < m.maxWounds);
  if (wounded.length > 0) {
    // Pick the one with fewest wounds remaining
    return wounded.sort((a, b) => a.wounds - b.wounds)[0];
  }

  // Otherwise, any active model
  return activeModels[0];
}

/**
 * Get wound allocation target in an Attached unit (Leader + Bodyguard).
 * Bodyguard models absorb wounds first; CHARACTER protected unless Precision.
 */
export function getAttachedUnitWoundTarget(
  leaderUnit: Unit,
  bodyguardUnit: Unit,
  models: Record<string, Model>,
  precision: boolean,
): Model | null {
  if (precision) {
    // Precision: target CHARACTER (leader) models
    const leaderModels = leaderUnit.modelIds
      .map(id => models[id])
      .filter((m): m is Model => m != null && m.status === 'active');
    if (leaderModels.length > 0) {
      const wounded = leaderModels.filter(m => m.wounds < m.maxWounds);
      return wounded.length > 0
        ? wounded.sort((a, b) => a.wounds - b.wounds)[0]
        : leaderModels[0];
    }
  }

  // Normal: bodyguard models absorb first
  const bodyguardModels = bodyguardUnit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (bodyguardModels.length > 0) {
    const wounded = bodyguardModels.filter(m => m.wounds < m.maxWounds);
    return wounded.length > 0
      ? wounded.sort((a, b) => a.wounds - b.wounds)[0]
      : bodyguardModels[0];
  }

  // No bodyguard left — fall through to leader
  const leaderModels = leaderUnit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');
  return leaderModels.length > 0 ? leaderModels[0] : null;
}

/**
 * Check if a bodyguard unit already has a leader attached.
 * Enforces max one Leader CHARACTER per Attached unit.
 */
export function canAttachLeader(
  state: GameState,
  leaderUnitId: string,
  bodyguardUnitId: string,
): { allowed: boolean; reason?: string } {
  const leaderUnit = state.units[leaderUnitId];
  if (!leaderUnit) return { allowed: false, reason: 'Leader unit not found' };

  if (!leaderUnit.keywords.includes('CHARACTER')) {
    return { allowed: false, reason: 'Only CHARACTER units can be attached as Leader' };
  }

  const bodyguardUnit = state.units[bodyguardUnitId];
  if (!bodyguardUnit) return { allowed: false, reason: 'Bodyguard unit not found' };

  if (leaderUnit.playerId !== bodyguardUnit.playerId) {
    return { allowed: false, reason: 'Leader and Bodyguard must belong to the same player' };
  }

  // Check if bodyguard already has a leader
  for (const [existingLeaderId, existingBodyguardId] of Object.entries(state.attachedUnits)) {
    if (existingBodyguardId === bodyguardUnitId) {
      return { allowed: false, reason: `${bodyguardUnit.name} already has a Leader attached (${state.units[existingLeaderId]?.name})` };
    }
  }

  // Check if this leader is already attached somewhere
  if (state.attachedUnits[leaderUnitId]) {
    return { allowed: false, reason: `${leaderUnit.name} is already attached to another unit` };
  }

  return { allowed: true };
}

/**
 * Check if destroying a unit in an attached pair (Leader or Bodyguard)
 * counts as destroying a unit for VP purposes.
 */
export function doesAttachedUnitDestructionCountAsDestroyed(
  state: GameState,
  destroyedUnitId: string,
): boolean {
  // If this unit is a leader or bodyguard in an attached pair, destruction counts
  if (state.attachedUnits[destroyedUnitId]) return true; // Was a leader
  for (const bodyguardId of Object.values(state.attachedUnits)) {
    if (bodyguardId === destroyedUnitId) return true; // Was a bodyguard
  }
  return false;
}

/**
 * When one unit in an attached pair is destroyed, the surviving unit
 * reverts to its original Starting Strength.
 */
export function getRevertedStartingStrength(unit: Unit): number {
  return unit.modelIds.length; // Original model count from the unit definition
}
