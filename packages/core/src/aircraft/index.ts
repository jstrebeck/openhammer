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
