import type { GameState, Unit, Enhancement } from '../types/index';

/**
 * Validate that all units in a player's army share at least one faction keyword.
 * Returns error strings if validation fails.
 */
export function validateFactionKeywords(state: GameState, playerId: string): string[] {
  const errors: string[] = [];
  const playerUnits = Object.values(state.units).filter(u => u.playerId === playerId);

  if (playerUnits.length === 0) return errors;

  // Collect all faction keywords per unit (keywords starting with "FACTION:" prefix or matching factionKeyword)
  // In 10th Edition, faction keywords are typically the army's shared faction.
  // We check that every unit has the declared faction keyword.
  const factionKeyword = state.playerFactionKeywords[playerId];
  if (!factionKeyword) return errors; // No faction keyword set, skip validation

  for (const unit of playerUnits) {
    if (!unit.keywords.includes(factionKeyword)) {
      errors.push(`Unit "${unit.name}" (${unit.id}) does not have faction keyword "${factionKeyword}"`);
    }
  }

  return errors;
}

/**
 * Validate that the army's total points do not exceed the points limit.
 * Returns error strings if validation fails.
 */
export function validatePointsLimit(state: GameState, playerId: string): string[] {
  const errors: string[] = [];
  if (state.pointsLimit === undefined) return errors;

  const playerUnits = Object.values(state.units).filter(u => u.playerId === playerId);
  const totalPoints = playerUnits.reduce((sum, u) => sum + (u.points ?? 0), 0);

  // Add enhancement points
  const enhancementPoints = state.enhancements.reduce((sum, e) => sum + e.pointsCost, 0);

  const armyTotal = totalPoints + enhancementPoints;

  if (armyTotal > state.pointsLimit) {
    errors.push(`Army total (${armyTotal} pts) exceeds points limit (${state.pointsLimit} pts)`);
  }

  return errors;
}

/**
 * Validate that units placed in Strategic Reserves do not exceed 25% of total army points.
 * Fortifications cannot be placed in Strategic Reserves.
 * Returns error strings if validation fails.
 */
export function validateStrategicReservesCap(state: GameState, playerId: string): string[] {
  const errors: string[] = [];
  const playerUnits = Object.values(state.units).filter(u => u.playerId === playerId);
  const totalPoints = playerUnits.reduce((sum, u) => sum + (u.points ?? 0), 0);

  if (totalPoints === 0) return errors;

  // Find units in reserves belonging to this player
  const reserveUnits = Object.values(state.reserves)
    .filter(r => {
      const unit = state.units[r.unitId];
      return unit && unit.playerId === playerId;
    });

  let reservePoints = 0;
  for (const reserve of reserveUnits) {
    const unit = state.units[reserve.unitId];
    if (!unit) continue;

    // Fortifications cannot be in Strategic Reserves
    if (unit.keywords.includes('FORTIFICATION')) {
      errors.push(`Fortification "${unit.name}" cannot be placed in Strategic Reserves`);
    }

    reservePoints += unit.points ?? 0;
  }

  const maxReservePoints = Math.floor(totalPoints * 0.25);
  if (reservePoints > maxReservePoints) {
    errors.push(`Strategic Reserves (${reservePoints} pts) exceeds 25% cap (${maxReservePoints} pts of ${totalPoints} total)`);
  }

  return errors;
}

/**
 * Validate enhancements: max 1 per model, each enhancement used only once, CHARACTER-only.
 * Returns error strings if validation fails.
 */
export function validateEnhancements(state: GameState): string[] {
  const errors: string[] = [];

  // Track which models have enhancements and which enhancement IDs are used
  const modelEnhancementCount: Record<string, number> = {};
  const usedEnhancementIds = new Set<string>();

  for (const enhancement of state.enhancements) {
    // Each enhancement can only be used once
    if (usedEnhancementIds.has(enhancement.id)) {
      errors.push(`Enhancement "${enhancement.name}" is assigned more than once`);
    }
    usedEnhancementIds.add(enhancement.id);

    if (!enhancement.assignedToModelId) {
      errors.push(`Enhancement "${enhancement.name}" is not assigned to a model`);
      continue;
    }

    // Max 1 enhancement per model
    modelEnhancementCount[enhancement.assignedToModelId] = (modelEnhancementCount[enhancement.assignedToModelId] ?? 0) + 1;
    if (modelEnhancementCount[enhancement.assignedToModelId] > 1) {
      errors.push(`Model "${enhancement.assignedToModelId}" has more than one enhancement assigned`);
    }

    // Enhancement target must be a CHARACTER
    const model = state.models[enhancement.assignedToModelId];
    if (model) {
      const unit = state.units[model.unitId];
      if (unit && !unit.keywords.includes('CHARACTER')) {
        errors.push(`Enhancement "${enhancement.name}" can only be assigned to CHARACTER models, but "${unit.name}" is not a CHARACTER`);
      }

      // Check keyword restrictions
      if (enhancement.eligibleKeywords && enhancement.eligibleKeywords.length > 0) {
        if (unit) {
          const hasAllKeywords = enhancement.eligibleKeywords.every(kw => unit.keywords.includes(kw));
          if (!hasAllKeywords) {
            errors.push(`Enhancement "${enhancement.name}" requires keywords [${enhancement.eligibleKeywords.join(', ')}] but "${unit.name}" is missing some`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate warlord designation: must be a CHARACTER if one exists in the army.
 * Returns error strings if validation fails.
 */
export function validateWarlord(state: GameState, playerId: string): string[] {
  const errors: string[] = [];
  const playerUnits = Object.values(state.units).filter(u => u.playerId === playerId);

  const hasCharacter = playerUnits.some(u => u.keywords.includes('CHARACTER'));

  if (!state.warlordModelId) {
    if (playerUnits.length > 0) {
      errors.push('No Warlord designated');
    }
    return errors;
  }

  const warlordModel = state.models[state.warlordModelId];
  if (!warlordModel) {
    errors.push(`Warlord model "${state.warlordModelId}" not found`);
    return errors;
  }

  const warlordUnit = state.units[warlordModel.unitId];
  if (!warlordUnit || warlordUnit.playerId !== playerId) {
    errors.push('Warlord must belong to your army');
    return errors;
  }

  if (hasCharacter && !warlordUnit.keywords.includes('CHARACTER')) {
    errors.push('Warlord must be a CHARACTER if your army contains CHARACTER models');
  }

  return errors;
}

/**
 * Run all army validation checks for a player.
 * Returns all errors combined.
 */
export function validateArmy(state: GameState, playerId: string): string[] {
  return [
    ...validateFactionKeywords(state, playerId),
    ...validatePointsLimit(state, playerId),
    ...validateStrategicReservesCap(state, playerId),
    ...validateEnhancements(state),
    ...validateWarlord(state, playerId),
  ];
}

/**
 * Validate that a unit is being deployed within a valid deployment zone.
 * Returns error strings if validation fails.
 */
export function validateDeploymentPosition(
  state: GameState,
  unitId: string,
  positions: Record<string, { x: number; y: number }>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) {
    errors.push(`Unit "${unitId}" not found`);
    return errors;
  }

  // Find player's deployment zone
  const playerZones = Object.values(state.deploymentZones).filter(z => z.playerId === unit.playerId);
  if (playerZones.length === 0) {
    errors.push('No deployment zone found for player');
    return errors;
  }

  // Check each model position is within at least one of the player's deployment zones
  for (const [modelId, pos] of Object.entries(positions)) {
    const inZone = playerZones.some(zone => pointInPolygon(pos, zone.polygon));
    if (!inZone) {
      errors.push(`Model "${modelId}" is not within the deployment zone`);
    }
  }

  return errors;
}

// Inline simple point-in-polygon check to avoid circular deps
function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
