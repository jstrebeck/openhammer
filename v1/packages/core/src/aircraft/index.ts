import type { GameState, Unit } from '../types/index';
import { distance } from '../measurement/index';
import type { Point } from '../types/geometry';

/** Standard aircraft move distance in 10th Edition */
export const AIRCRAFT_MOVE_DISTANCE = 20;

/** Check if a unit is an aircraft (has AIRCRAFT keyword and is not in hover mode) */
export function isAircraftUnit(unit: Unit, state: GameState): boolean {
  return unit.keywords.includes('AIRCRAFT') && !state.hoverModeUnits.includes(unit.id);
}

/** Check if a unit has the FLY keyword */
export function hasFly(unit: Unit): boolean {
  return unit.keywords.includes('FLY');
}

/** Validate aircraft movement (must be exactly 20" in a straight line) */
export function validateAircraftMovement(
  state: GameState,
  unitId: string,
  endPosition: Point,
): { valid: boolean; offBoard: boolean; reason?: string } {
  const unit = state.units[unitId];
  if (!unit) return { valid: false, offBoard: false, reason: 'Unit not found' };

  // Get the first active model's position as the unit position
  const activeModels = unit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');
  if (activeModels.length === 0) return { valid: false, offBoard: false, reason: 'No active models' };

  const startPos = activeModels[0].position;
  const moveDist = distance(startPos, endPosition);

  // Check if movement goes off board
  if (endPosition.x < 0 || endPosition.x > state.board.width ||
      endPosition.y < 0 || endPosition.y > state.board.height) {
    return { valid: true, offBoard: true };
  }

  // Must move exactly 20" (with tolerance)
  if (Math.abs(moveDist - AIRCRAFT_MOVE_DISTANCE) > 0.5) {
    return { valid: false, offBoard: false, reason: `Aircraft must move exactly ${AIRCRAFT_MOVE_DISTANCE}" (moved ${moveDist.toFixed(1)}")` };
  }

  return { valid: true, offBoard: false };
}

/** Check if a unit can charge an aircraft target */
export function canChargeAircraft(attackingUnit: Unit): { allowed: boolean; reason?: string } {
  if (!hasFly(attackingUnit)) {
    return { allowed: false, reason: 'Only units with FLY can charge AIRCRAFT' };
  }
  return { allowed: true };
}

/** Check if a unit can fight an aircraft in melee */
export function canFightAircraft(attackingUnit: Unit): { allowed: boolean; reason?: string } {
  if (!hasFly(attackingUnit)) {
    return { allowed: false, reason: 'Only units with FLY can fight AIRCRAFT in melee' };
  }
  return { allowed: true };
}

// ===== Sprint K: Aircraft Combat Restrictions =====

/**
 * Check if an AIRCRAFT unit can declare a charge.
 * AIRCRAFT cannot charge — always blocked.
 */
export function canAircraftCharge(unit: Unit, state: GameState): { allowed: boolean; reason?: string } {
  if (isAircraftUnit(unit, state)) {
    return { allowed: false, reason: 'AIRCRAFT cannot declare charges' };
  }
  return { allowed: true };
}

/**
 * Check if an AIRCRAFT unit can Pile In or Consolidate.
 * AIRCRAFT cannot Pile In or Consolidate.
 */
export function canAircraftPileInOrConsolidate(unit: Unit, state: GameState): { allowed: boolean; reason?: string } {
  if (isAircraftUnit(unit, state)) {
    return { allowed: false, reason: 'AIRCRAFT cannot Pile In or Consolidate' };
  }
  return { allowed: true };
}

/**
 * Check if an AIRCRAFT can fight a target unit in melee.
 * AIRCRAFT can only fight units with FLY keyword.
 */
export function canAircraftFightTarget(
  attackingUnit: Unit,
  targetUnit: Unit,
  state: GameState,
): { allowed: boolean; reason?: string } {
  if (isAircraftUnit(attackingUnit, state)) {
    if (!hasFly(targetUnit)) {
      return { allowed: false, reason: 'AIRCRAFT can only fight units with FLY keyword' };
    }
  }
  return { allowed: true };
}

/**
 * Filter enemies for Pile In / Consolidate closest-enemy calculation.
 * Ignore AIRCRAFT units unless the piling-in model has FLY.
 */
export function filterEnemiesForPileIn(
  enemies: Array<{ model: import('../types/index').Model; unit: Unit }>,
  pilingInUnit: Unit,
  state: GameState,
): Array<{ model: import('../types/index').Model; unit: Unit }> {
  const hasFlyKeyword = hasFly(pilingInUnit);
  return enemies.filter(e => {
    if (isAircraftUnit(e.unit, state) && !hasFlyKeyword) {
      return false; // Ignore AIRCRAFT unless we have FLY
    }
    return true;
  });
}

/**
 * Check if an aircraft movement would take it off the board edge.
 * If it can't complete the 20" straight-line within the board, it goes to Strategic Reserves.
 */
export function shouldAircraftGoToReserves(
  state: GameState,
  unitId: string,
  endPosition: Point,
): boolean {
  return (
    endPosition.x < 0 || endPosition.x > state.board.width ||
    endPosition.y < 0 || endPosition.y > state.board.height
  );
}
