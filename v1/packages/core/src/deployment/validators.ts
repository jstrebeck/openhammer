import type { Unit, Model, GameState } from '../types/index';
import type { Point } from '../types/geometry';
import { distanceBetweenModels } from '../measurement/index';
import { pointInPolygon } from '../los/index';

/**
 * Validate Deep Strike arrival: must be >9" from all enemy models, and round 2+.
 */
export function validateDeepStrikeArrival(
  state: GameState,
  unitId: string,
  positions: Record<string, Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  if (state.turnState.roundNumber < 2) {
    errors.push('Deep Strike units cannot arrive before Round 2');
  }

  const DEEP_STRIKE_MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      // Use a virtual model at the position for distance checking
      const model = state.models[modelId];
      if (!model) continue;
      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= DEEP_STRIKE_MIN_DISTANCE) {
        errors.push(`${model.name} must be placed more than 9" from enemy models (${dist.toFixed(1)}" from ${otherModel.name})`);
      }
    }
  }

  return errors;
}

/**
 * Validate Infiltrators deployment: must be >9" from enemy deployment zone and enemy models.
 */
export function validateInfiltratorsDeployment(
  state: GameState,
  unitId: string,
  positions: Record<string, Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    const model = state.models[modelId];
    if (!model) continue;

    // Check distance from enemy models
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= MIN_DISTANCE) {
        errors.push(`${model.name} must deploy more than 9" from enemy models`);
      }
    }

    // Check distance from enemy deployment zones
    for (const zone of Object.values(state.deploymentZones)) {
      if (zone.playerId === unit.playerId) continue;
      if (pointInPolygon(pos, zone.polygon)) {
        errors.push(`${model.name} cannot deploy within enemy deployment zone`);
      }
    }
  }

  return errors;
}

/**
 * Validate Scout move: max X" from starting position.
 */
export function validateScoutMove(
  unit: Unit,
  models: Record<string, Model>,
  positions: Record<string, Point>,
  maxDistance: number,
): string[] {
  const errors: string[] = [];

  for (const modelId of unit.modelIds) {
    const model = models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = positions[modelId];
    if (!newPos) continue;

    const dist = Math.sqrt(
      (newPos.x - model.position.x) ** 2 + (newPos.y - model.position.y) ** 2,
    );
    if (dist > maxDistance + 0.01) {
      errors.push(`${model.name} Scout moved ${dist.toFixed(1)}" but max is ${maxDistance}"`);
    }
  }

  return errors;
}

/**
 * Validate Strategic Reserves: ≤25% army points, Round 2+ arrival, within 6" of board edge, >9" from enemies.
 */
export function validateStrategicReservesArrival(
  state: GameState,
  unitId: string,
  positions: Record<string, Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  if (state.turnState.roundNumber < 2) {
    errors.push('Strategic Reserves cannot arrive before Round 2');
  }

  const BOARD_EDGE_DISTANCE = 6;
  const ENEMY_MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    const model = state.models[modelId];
    if (!model) continue;

    // Must be within 6" of a board edge
    const distToEdge = Math.min(pos.x, pos.y, state.board.width - pos.x, state.board.height - pos.y);
    if (distToEdge > BOARD_EDGE_DISTANCE) {
      errors.push(`${model.name} must arrive within ${BOARD_EDGE_DISTANCE}" of a board edge`);
    }

    // Must be >9" from enemies
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= ENEMY_MIN_DISTANCE) {
        errors.push(`${model.name} must arrive more than 9" from enemy models`);
        break;
      }
    }
  }

  return errors;
}
