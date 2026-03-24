import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { getEdition } from '../../rules/registry';
import { distance, distanceBetweenModels, checkCoherency } from '../../measurement/index';
import { pointInPolygon } from '../../los/index';
import type { GameState, Model } from '../../types/index';
import type { Point } from '../../types/geometry';
import type { RulesEdition } from '../../rules/RulesEdition';

/** Validate a charge move: distance ≤ charge roll, must end in ER of all declared targets, coherency, no ER of non-targets */
function validateChargeMove(
  state: GameState,
  unitId: string,
  newPositions: Record<string, Point>,
  edition: RulesEdition,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const engagementRange = edition.getEngagementRange();
  const coherencyRange = edition.getCoherencyRange();
  const chargeRoll = state.chargeState.chargeRolls[unitId];
  const declaredTargets = state.chargeState.declaredCharges[unitId] ?? [];

  // Only validate distance if a charge roll was actually made
  if (chargeRoll !== undefined) {
    for (const modelId of unit.modelIds) {
      const model = state.models[modelId];
      if (!model || model.status === 'destroyed') continue;
      const newPos = newPositions[modelId];
      if (!newPos) continue;

      const distMoved = distance(model.position, newPos);
      if (distMoved > chargeRoll + 0.01) {
        errors.push(`${model.name} moved ${distMoved.toFixed(1)}" but charge roll was ${chargeRoll}"`);
      }
    }
  }

  // Barricade charge restriction: cannot charge through/over barricades
  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    for (const terrain of Object.values(state.terrain)) {
      if (!terrain.traits.includes('defensible') || terrain.height > 2) continue;
      // Check if charge path crosses the barricade polygon
      const startsIn = pointInPolygon(model.position, terrain.polygon);
      const endsIn = pointInPolygon(newPos, terrain.polygon);
      if (!startsIn && endsIn) {
        errors.push(`${model.name} cannot charge through ${terrain.label || 'barricade'}`);
      }
      // Also check if path crosses through (enters and exits)
      if (!startsIn && !endsIn) {
        // Simple midpoint check for path crossing
        const mid = { x: (model.position.x + newPos.x) / 2, y: (model.position.y + newPos.y) / 2 };
        if (pointInPolygon(mid, terrain.polygon)) {
          errors.push(`${model.name} cannot charge through ${terrain.label || 'barricade'}`);
        }
      }
    }
  }

  // Build temporary model state with new positions
  const tempModels: Record<string, Model> = { ...state.models };
  for (const [modelId, pos] of Object.entries(newPositions)) {
    if (tempModels[modelId]) {
      tempModels[modelId] = { ...tempModels[modelId], position: pos };
    }
  }

  // Only validate targets and non-target ER if a formal charge was declared
  if (declaredTargets.length > 0) {
    // Must end with at least one model in Engagement Range of ALL declared targets
    for (const targetUnitId of declaredTargets) {
      const targetUnit = state.units[targetUnitId];
      if (!targetUnit) continue;
      const targetModels = targetUnit.modelIds
        .map(id => state.models[id])
        .filter(m => m && m.status === 'active');
      const chargingModels = unit.modelIds
        .map(id => tempModels[id])
        .filter(m => m && m.status === 'active');

      const anyInRange = chargingModels.some(cm =>
        targetModels.some(tm => distanceBetweenModels(cm, tm) <= engagementRange)
      );
      if (!anyInRange) {
        errors.push(`Must end in Engagement Range of declared target ${targetUnit.name}`);
      }
    }

    // Cannot end in Engagement Range of non-target enemy units
    for (const otherUnit of Object.values(state.units)) {
      if (otherUnit.playerId === unit.playerId) continue;
      if (declaredTargets.includes(otherUnit.id)) continue;
      const otherModels = otherUnit.modelIds
        .map(id => state.models[id])
        .filter(m => m && m.status === 'active');
      const chargingModels = unit.modelIds
        .map(id => tempModels[id])
        .filter(m => m && m.status === 'active');

      const anyInRange = chargingModels.some(cm =>
        otherModels.some(om => distanceBetweenModels(cm, om) <= engagementRange)
      );
      if (anyInRange) {
        // Check if we were already in ER before the charge — if so, it's OK
        const wasInRange = unit.modelIds
          .map(id => state.models[id])
          .filter(m => m && m.status === 'active')
          .some(cm => otherModels.some(om => distanceBetweenModels(cm, om) <= engagementRange));
        if (!wasInRange) {
          errors.push(`Cannot end in Engagement Range of non-target enemy ${otherUnit.name}`);
        }
      }
    }
  }

  // Coherency after charge
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    const coherencyModels: Record<string, Model> = {};
    for (const mid of activeModelIds) {
      coherencyModels[mid] = tempModels[mid];
    }
    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, coherencyModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency after charge`);
    }
  }

  return errors;
}

export const chargeReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 10: Charge =====

    case 'DECLARE_CHARGE': {
      const { unitId, targetUnitIds } = action.payload;
      if (!state.units[unitId]) return state;

      // Check charge eligibility
      const edition = getEdition(state.editionId);
      if (edition) {
        const moveType = state.turnTracking.unitMovement[unitId];
        const eligibility = edition.canUnitCharge(moveType);
        if (!eligibility.allowed) {
          if (state.rulesConfig.phaseRestrictions === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] ${eligibility.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
          if (state.rulesConfig.phaseRestrictions === 'warn') {
            state = {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[WARNING] ${eligibility.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
        }
      }

      return {
        ...state,
        chargeState: {
          ...state.chargeState,
          declaredCharges: { ...state.chargeState.declaredCharges, [unitId]: targetUnitIds },
        },
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.units[unitId].name} declares charge against ${targetUnitIds.map(id => state.units[id]?.name ?? id).join(', ')}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ROLL_CHARGE': {
      const { unitId, roll, total } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        chargeState: {
          ...state.chargeState,
          chargeRolls: { ...state.chargeState.chargeRolls, [unitId]: total },
        },
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };
    }

    case 'COMMIT_CHARGE_MOVE': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Validate charge move if enforcement is on
      const edition = getEdition(state.editionId);
      if (edition && state.rulesConfig.movementRange !== 'off') {
        const errors = validateChargeMove(state, unitId, positions, edition);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Charge move invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Charge move: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
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
        chargeState: {
          ...state.chargeState,
          successfulCharges: [...state.chargeState.successfulCharges, unitId],
        },
        turnTracking: {
          ...state.turnTracking,
          chargedUnits: [...state.turnTracking.chargedUnits, unitId],
          unitMovement: { ...state.turnTracking.unitMovement, [unitId]: 'stationary' }, // Mark as moved (for tracking)
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} completes charge move — gains Fights First`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'FAIL_CHARGE': {
      const { unitId } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} charge failed — insufficient distance`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
