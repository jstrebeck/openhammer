import type { GameState } from '../types/index';
import { distanceBetweenModels } from '../measurement/index';

/** Off-board position for embarked models */
export const EMBARKED_POSITION = { x: -1000, y: -1000 };

/** Check if a model is at the embarked off-board position */
export function isEmbarkedPosition(pos: { x: number; y: number }): boolean {
  return pos.x <= -999 && pos.y <= -999;
}

/** Get total number of embarked models across all units in a transport */
export function getEmbarkedModelCount(state: GameState, transportId: string): number {
  const embarkedUnitIds = state.embarkedUnits[transportId] ?? [];
  let count = 0;
  for (const unitId of embarkedUnitIds) {
    const unit = state.units[unitId];
    if (!unit) continue;
    count += unit.modelIds.filter(id => {
      const m = state.models[id];
      return m && m.status === 'active';
    }).length;
  }
  return count;
}

/** Check if a unit is currently embarked on any transport */
export function getTransportForUnit(state: GameState, unitId: string): string | null {
  for (const [transportId, unitIds] of Object.entries(state.embarkedUnits)) {
    if (unitIds.includes(unitId)) return transportId;
  }
  return null;
}

/** Validate whether a unit can embark on a transport */
export function canEmbark(
  state: GameState,
  unitId: string,
  transportId: string,
): { allowed: boolean; reason?: string } {
  const unit = state.units[unitId];
  const transport = state.units[transportId];
  if (!unit) return { allowed: false, reason: 'Unit not found' };
  if (!transport) return { allowed: false, reason: 'Transport not found' };
  if (transport.transportCapacity == null) return { allowed: false, reason: 'Target is not a transport' };

  // Must be friendly
  if (unit.playerId !== transport.playerId) return { allowed: false, reason: 'Can only embark on friendly transports' };

  // Cannot embark if disembarked this phase
  if (state.turnTracking.disembarkedThisPhase.includes(unitId)) {
    return { allowed: false, reason: 'Unit already disembarked this phase' };
  }

  // Cannot embark if already embarked
  if (getTransportForUnit(state, unitId)) {
    return { allowed: false, reason: 'Unit is already embarked' };
  }

  // Cannot embark a transport with embarked units (no nesting)
  if (unit.transportCapacity != null && Object.keys(state.embarkedUnits[unitId] ?? {}).length > 0) {
    return { allowed: false, reason: 'Cannot embark a transport carrying units' };
  }

  // Keyword restrictions
  if (transport.transportKeywordRestrictions && transport.transportKeywordRestrictions.length > 0) {
    const hasRequiredKeyword = transport.transportKeywordRestrictions.some(kw =>
      unit.keywords.includes(kw)
    );
    if (!hasRequiredKeyword) {
      return { allowed: false, reason: `Unit must have one of: ${transport.transportKeywordRestrictions.join(', ')}` };
    }
  }

  // Check capacity
  const activeModelCount = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  }).length;
  const currentLoad = getEmbarkedModelCount(state, transportId);
  if (currentLoad + activeModelCount > transport.transportCapacity) {
    return { allowed: false, reason: `Transport at capacity (${currentLoad}/${transport.transportCapacity})` };
  }

  // Check distance — all active models must be within 3" of any active transport model
  const transportModels = transport.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');
  const unitModels = unit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');

  for (const um of unitModels) {
    if (!um) continue;
    const withinRange = transportModels.some(tm => tm && distanceBetweenModels(um, tm) <= 3);
    if (!withinRange) {
      return { allowed: false, reason: `${um.name} is not within 3" of the transport` };
    }
  }

  return { allowed: true };
}

// ===== Sprint K: Destroyed Transport Distance Tiers =====

/**
 * Determine if an embarked model is destroyed when its transport is destroyed.
 * 10th Edition rules: roll D6 per model.
 * - Models within 3" of a point: destroyed on 1
 * - Models within 6" of a point: destroyed on 1–3
 *
 * @param dieResult - The D6 roll result
 * @param distanceFromWreck - Distance from the model's disembark point to the wreck
 * @returns true if the model is destroyed
 */
export function isModelDestroyedInTransport(dieResult: number, distanceFromWreck: number): boolean {
  if (distanceFromWreck <= 3) {
    return dieResult <= 1;
  }
  if (distanceFromWreck <= 6) {
    return dieResult <= 3;
  }
  // Beyond 6" — model survives
  return false;
}

/** Validate whether a unit can disembark from a transport */
export function canDisembark(
  state: GameState,
  unitId: string,
  transportId: string,
): { allowed: boolean; reason?: string } {
  const embarkedUnitIds = state.embarkedUnits[transportId] ?? [];
  if (!embarkedUnitIds.includes(unitId)) {
    return { allowed: false, reason: 'Unit is not embarked on this transport' };
  }

  // Cannot disembark if embarked this phase
  if (state.turnTracking.embarkedThisPhase.includes(unitId)) {
    return { allowed: false, reason: 'Unit embarked this phase — cannot disembark' };
  }

  // Cannot disembark if transport advanced or fell back
  const transportMoveType = state.turnTracking.unitMovement[transportId];
  if (transportMoveType === 'advance' || transportMoveType === 'fall_back') {
    return { allowed: false, reason: `Cannot disembark — transport ${transportMoveType === 'advance' ? 'Advanced' : 'Fell Back'}` };
  }

  return { allowed: true };
}
