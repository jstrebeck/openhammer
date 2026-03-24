import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { isAircraftUnit, validateAircraftMovement, AIRCRAFT_MOVE_DISTANCE } from '../../aircraft/index';
import { EMBARKED_POSITION } from '../../transport/index';

export const aircraftReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 19: Aircraft & Reserves =====

    case 'SET_UNIT_IN_RESERVES': {
      const { unitId, reserveType, availableFromRound } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Move models off-board
      const newModels = { ...state.models };
      for (const modelId of unit.modelIds) {
        const model = newModels[modelId];
        if (model && model.status === 'active') {
          newModels[modelId] = { ...model, position: { ...EMBARKED_POSITION } };
        }
      }

      return {
        ...state,
        models: newModels,
        reserves: {
          ...state.reserves,
          [unitId]: { unitId, type: reserveType, availableFromRound },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} placed in ${reserveType === 'aircraft' ? 'Aircraft' : reserveType === 'deep_strike' ? 'Deep Strike' : 'Strategic'} Reserves (available round ${availableFromRound}+)`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ARRIVE_FROM_RESERVES': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      const reserve = state.reserves[unitId];
      if (!reserve) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${unit.name} is not in reserves`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check round availability
      if (state.turnState.roundNumber < reserve.availableFromRound) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${unit.name} cannot arrive until round ${reserve.availableFromRound}`,
            timestamp: Date.now(),
          }),
        };
      }

      // Apply positions
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Remove from reserves
      const { [unitId]: _removed, ...remainingReserves } = state.reserves;

      return {
        ...state,
        models: newModels,
        reserves: remainingReserves,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { ...state.turnTracking.unitMovement, [unitId]: 'normal' },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} arrives from ${reserve.type === 'aircraft' ? 'Aircraft' : reserve.type === 'deep_strike' ? 'Deep Strike' : 'Strategic'} Reserves`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SET_HOVER_MODE': {
      const { unitId, hover } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      if (hover) {
        return {
          ...state,
          hoverModeUnits: [...state.hoverModeUnits.filter(id => id !== unitId), unitId],
          log: appendLog(state.log, {
            type: 'message',
            text: `${unit.name} enters Hover mode (M=20", loses AIRCRAFT behavior)`,
            timestamp: Date.now(),
          }),
        };
      } else {
        return {
          ...state,
          hoverModeUnits: state.hoverModeUnits.filter(id => id !== unitId),
          log: appendLog(state.log, {
            type: 'message',
            text: `${unit.name} exits Hover mode`,
            timestamp: Date.now(),
          }),
        };
      }
    }

    case 'AIRCRAFT_MOVE': {
      const { unitId, endPosition, pivotAngle } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      const validation = validateAircraftMovement(state, unitId, endPosition);
      if (!validation.valid) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${validation.reason}`,
            timestamp: Date.now(),
          }),
        };
      }

      if (validation.offBoard) {
        // Redirect to off-board using this sub-reducer directly
        return aircraftReducer(state, { type: 'AIRCRAFT_OFF_BOARD', payload: { unitId } }) ?? state;
      }

      // Apply position and facing to all models
      const newModels = { ...state.models };
      for (const modelId of unit.modelIds) {
        const model = newModels[modelId];
        if (model && model.status === 'active') {
          newModels[modelId] = { ...model, position: endPosition, facing: pivotAngle };
        }
      }

      return {
        ...state,
        models: newModels,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { ...state.turnTracking.unitMovement, [unitId]: 'normal' },
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} makes aircraft move`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'AIRCRAFT_OFF_BOARD': {
      const { unitId } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Move models off-board
      const newModels = { ...state.models };
      for (const modelId of unit.modelIds) {
        const model = newModels[modelId];
        if (model && model.status === 'active') {
          newModels[modelId] = { ...model, position: { ...EMBARKED_POSITION } };
        }
      }

      return {
        ...state,
        models: newModels,
        reserves: {
          ...state.reserves,
          [unitId]: {
            unitId,
            type: 'strategic',
            availableFromRound: state.turnState.roundNumber + 1,
          },
        },
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} moves off the battlefield — enters Strategic Reserves`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
