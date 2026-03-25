import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import {
  distance,
  distanceBetweenModels,
  checkCoherency,
  getModelBoundingBox,
  doesPathCrossModel,
  closestEnemyModel,
  getPivotCost,
} from '../../measurement/index';
import { getEdition } from '../../rules/registry';
import { isAircraftUnit } from '../../aircraft/index';
import { pointInPolygon } from '../../los/index';
import type { GameState } from '../../types/index';
import type { RulesEdition } from '../../rules/RulesEdition';
import type { Point } from '../../types/geometry';
import type { MoveType } from '../../types/index';
import { getOrderMovementBonus } from '../../combat/factionModifiers';

export const movementReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'MOVE_MODEL': {
      const { modelId, position } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;

      // Once the game has started (first START_COMMAND_PHASE), enforce movement rules
      const gameStarted = state.gameStarted;
      if (gameStarted && state.rulesConfig.movementRange !== 'off' && model.unitId) {
        const edition = getEdition(state.editionId);
        if (edition) {
          const currentPhase = edition.phases[state.turnState.currentPhaseIndex];

          // Block MOVE_MODEL entirely outside movement phase
          if (currentPhase?.id !== 'movement') {
            if (state.rulesConfig.movementRange === 'enforce') {
              return state; // silently reject
            }
            // warn mode
            state = {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[WARNING] Model movement outside Movement phase`,
                timestamp: Date.now(),
              }),
            };
          } else {
            // In movement phase — enforce declared movement distance
            const moveType = state.turnTracking.unitMovement[model.unitId];
            if (!moveType) {
              // No movement declared yet — block the move
              if (state.rulesConfig.movementRange === 'enforce') {
                return state;
              }
            } else if (moveType === 'stationary') {
              // Stationary units cannot move at all
              if (state.rulesConfig.movementRange === 'enforce') {
                return state;
              }
            } else {
              const orderMoveBonus = getOrderMovementBonus(state, model.unitId);
              const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic + orderMoveBonus, moveType);
              const advanceBonus = moveType === 'advance' ? (state.turnTracking.advanceRolls[model.unitId] ?? 0) : 0;
              const totalAllowed = maxDist + advanceBonus;

              // Use the original position from DECLARE_MOVEMENT (not current position)
              // to correctly measure total distance moved during this activation
              const originPos = state.turnTracking.preMovementPositions[modelId] ?? model.position;
              const distMoved = distance(originPos, position);

              if (distMoved > totalAllowed + 0.01) {
                if (state.rulesConfig.movementRange === 'enforce') {
                  // Clamp to max distance from original position
                  const ratio = totalAllowed / distMoved;
                  const clampedPosition = {
                    x: originPos.x + (position.x - originPos.x) * ratio,
                    y: originPos.y + (position.y - originPos.y) * ratio,
                  };
                  return {
                    ...state,
                    models: {
                      ...state.models,
                      [modelId]: { ...model, position: clampedPosition },
                    },
                  };
                }
                // warn mode — allow but log
                state = {
                  ...state,
                  log: appendLog(state.log, {
                    type: 'message',
                    text: `[WARNING] ${model.name} moved ${distMoved.toFixed(1)}" but max is ${totalAllowed.toFixed(1)}"`,
                    timestamp: Date.now(),
                  }),
                };
              }
            }
          }
        }
      }

      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: { ...model, position },
        },
      };
    }

    case 'ROTATE_MODEL': {
      const { modelId, facing } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;
      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: { ...model, facing },
        },
      };
    }

    case 'DECLARE_MOVEMENT': {
      const { unitId, moveType } = action.payload;
      const declUnit = state.units[unitId];
      if (!declUnit) return state;

      // Capture original model positions for movement distance validation
      const preMovementPositions = { ...state.turnTracking.preMovementPositions };
      for (const modelId of declUnit.modelIds) {
        const model = state.models[modelId];
        if (model && model.status === 'active') {
          preMovementPositions[modelId] = { ...model.position };
        }
      }

      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { ...state.turnTracking.unitMovement, [unitId]: moveType },
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
          preMovementPositions,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${declUnit.name} declared ${moveType === 'fall_back' ? 'Fall Back' : moveType === 'stationary' ? 'Remain Stationary' : moveType === 'advance' ? 'Advance' : 'Normal'} move`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ROLL_ADVANCE': {
      const { unitId, roll } = action.payload;
      if (!state.units[unitId]) return state;
      const advanceTotal = roll.dice.reduce((a, b) => a + b, 0);
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          advanceRolls: { ...state.turnTracking.advanceRolls, [unitId]: advanceTotal },
        },
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };
    }

    case 'COMMIT_MOVEMENT': {
      const { unitId, positions, facings } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      const edition = getEdition(state.editionId);
      if (!edition) return state;

      const moveType = state.turnTracking.unitMovement[unitId] ?? 'normal';

      // Validate movement if enforcement is on
      if (state.rulesConfig.movementRange !== 'off') {
        const errors = validateMovement(state, unitId, moveType, positions, edition, facings);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Movement invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          // warn mode
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Movement: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Apply positions and facings
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          const newFacing = facings?.[modelId];
          newModels[modelId] = {
            ...model,
            position: pos,
            ...(newFacing !== undefined ? { facing: newFacing } : {}),
          };
        }
      }

      return {
        ...state,
        models: newModels,
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    case 'SURGE_MOVE': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Check: not already used this phase
      if (state.turnTracking.surgeMoveUsedThisPhase[unitId]) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${unit.name} already used surge move this phase`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: not battle-shocked
      if (state.battleShocked.includes(unitId)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${unit.name} is Battle-shocked — cannot surge move`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: not within engagement range of enemies
      const edition = getEdition(state.editionId);
      if (edition) {
        const engagementRange = edition.getEngagementRange();
        const unitModels = unit.modelIds
          .map(id => state.models[id])
          .filter(m => m && m.status === 'active');

        for (const um of unitModels) {
          if (!um) continue;
          for (const otherModel of Object.values(state.models)) {
            if (otherModel.status === 'destroyed') continue;
            const otherUnit = state.units[otherModel.unitId];
            if (!otherUnit || otherUnit.playerId === unit.playerId) continue;
            if (distanceBetweenModels(um, otherModel) <= engagementRange) {
              return {
                ...state,
                log: appendLog(state.log, {
                  type: 'message',
                  text: `[BLOCKED] ${unit.name} is within Engagement Range — cannot surge move`,
                  timestamp: Date.now(),
                }),
              };
            }
          }
        }
      }

      // Apply positions
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      return {
        ...state,
        models: newModels,
        turnTracking: {
          ...state.turnTracking,
          surgeMoveUsedThisPhase: { ...state.turnTracking.surgeMoveUsedThisPhase, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} makes a surge move`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};

function validateMovement(
  state: GameState,
  unitId: string,
  moveType: MoveType,
  newPositions: Record<string, Point>,
  edition: RulesEdition,
  newFacings?: Record<string, number>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const engagementRange = edition.getEngagementRange();
  const coherencyRange = edition.getCoherencyRange();
  const unitHasFly = unit.keywords.includes('FLY');
  const unitIsMonsterOrVehicle = unit.keywords.includes('MONSTER') || unit.keywords.includes('VEHICLE');

  // Check each model's movement distance
  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    // Use original position from DECLARE_MOVEMENT for distance calculation
    const originPos = state.turnTracking.preMovementPositions[modelId] ?? model.position;
    const distMoved = distance(originPos, newPos);
    const orderMoveBonus = getOrderMovementBonus(state, unitId);
    const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic + orderMoveBonus, moveType);
    const advanceBonus = moveType === 'advance' ? (state.turnTracking.advanceRolls[unitId] ?? 0) : 0;
    let totalAllowed = maxDist + advanceBonus;

    // Pivot cost: if facing changed, deduct pivot cost from movement budget
    if (newFacings && newFacings[modelId] !== undefined) {
      const facingChanged = Math.abs(newFacings[modelId] - model.facing) > 0.01;
      if (facingChanged) {
        const pivotCost = getPivotCost(model, unit.keywords);
        totalAllowed -= pivotCost;
      }
    }

    if (distMoved > totalAllowed + 0.01) { // small epsilon for floating point
      errors.push(`${model.name} moved ${distMoved.toFixed(1)}" but max is ${totalAllowed.toFixed(1)}"`);
    }

    // Check battlefield edge — use axis-aligned bounding box of the rotated shape
    const bbox = getModelBoundingBox(model, newPos);
    if (bbox.minX < 0 || bbox.maxX > state.board.width ||
        bbox.minY < 0 || bbox.maxY > state.board.height) {
      errors.push(`${model.name} would be off the battlefield edge`);
    }

    // Path-based collision: non-FLY units cannot move through enemy models
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      if (otherModel.id === modelId) continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit) continue;

      const isEnemy = otherUnit.playerId !== unit.playerId;
      const isFriendlyMonsterVehicle = !isEnemy &&
        (otherUnit.keywords.includes('MONSTER') || otherUnit.keywords.includes('VEHICLE'));

      if (isEnemy) {
        // FLY units can move through enemy models
        if (!unitHasFly && doesPathCrossModel(originPos, newPos, otherModel)) {
          errors.push(`${model.name} cannot move through enemy model ${otherModel.name} (no FLY)`);
        }
      } else if (isFriendlyMonsterVehicle && otherUnit.id !== unitId) {
        // Only FLY MONSTER/VEHICLE can move through friendly MONSTER/VEHICLE
        if (!(unitHasFly && unitIsMonsterOrVehicle) && doesPathCrossModel(originPos, newPos, otherModel)) {
          errors.push(`${model.name} cannot move through friendly ${otherModel.name} (need FLY + MONSTER/VEHICLE)`);
        }
      }
    }

    // Terrain movement restrictions
    const canEnterRuins = unit.keywords.includes('INFANTRY') ||
      unit.keywords.includes('BEASTS') || unitHasFly;

    const terrainPieces = Object.values(state.terrain);
    for (const terrain of terrainPieces) {
      const endsInTerrain = pointInPolygon(newPos, terrain.polygon);

      // Ruins restriction: only INFANTRY, BEASTS, and FLY can enter
      if (endsInTerrain && (terrain.traits.includes('ruins') || terrain.traits.includes('breachable'))) {
        if (!canEnterRuins) {
          errors.push(`${model.name} cannot enter ${terrain.label || 'ruins'} (requires INFANTRY, BEASTS, or FLY)`);
        }
      }

      // Terrain height movement cost: >2" terrain costs vertical distance
      if (terrain.height > 2) {
        const startsInTerrain = pointInPolygon(originPos, terrain.polygon);
        if (!startsInTerrain && endsInTerrain) {
          // Climbing up: add terrain height to distance moved
          const adjustedDist = distMoved + terrain.height;
          if (adjustedDist > totalAllowed + 0.01) {
            errors.push(`${model.name} must climb ${terrain.height}" to enter ${terrain.label || 'terrain'} (total ${adjustedDist.toFixed(1)}" exceeds ${totalAllowed.toFixed(1)}")`);
          }
        } else if (startsInTerrain && !endsInTerrain) {
          // Climbing down: add terrain height
          const adjustedDist = distMoved + terrain.height;
          if (adjustedDist > totalAllowed + 0.01) {
            errors.push(`${model.name} must descend ${terrain.height}" to leave ${terrain.label || 'terrain'} (total ${adjustedDist.toFixed(1)}" exceeds ${totalAllowed.toFixed(1)}")`);
          }
        }
      }
    }

    // Check ending within engagement range of enemies (not allowed for normal/advance moves)
    if (moveType === 'normal' || moveType === 'advance') {
      for (const otherModel of Object.values(state.models)) {
        if (otherModel.status === 'destroyed') continue;
        const otherUnit = state.units[otherModel.unitId];
        if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

        // Aircraft engagement range exemption: can move within ER of AIRCRAFT but cannot end within it
        // (this check already blocks ending within ER — the exemption is that you can pass through)
        // Skip aircraft from this check only if the unit itself is not trying to end within ER
        const isAircraft = isAircraftUnit(otherUnit, state);

        // Use new position for distance check
        const virtualModel = { ...model, position: newPos };
        const edgeDist = distanceBetweenModels(virtualModel, otherModel);
        if (edgeDist <= engagementRange) {
          if (isAircraft) {
            errors.push(`${model.name} cannot end within engagement range of AIRCRAFT ${otherModel.name}`);
          } else {
            errors.push(`${model.name} would end within engagement range of ${otherModel.name}`);
          }
        }
      }
    }
  }

  // Check coherency after move
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    // Build a temporary models record with new positions
    const tempModels: Record<string, import('../../types/index').Model> = {};
    for (const modelId of activeModelIds) {
      const model = state.models[modelId];
      if (model) {
        tempModels[modelId] = newPositions[modelId]
          ? { ...model, position: newPositions[modelId] }
          : model;
      }
    }

    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, tempModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency (${coherency.failingModelIds.length} model(s) out of range)`);
    }
  }

  return errors;
}
