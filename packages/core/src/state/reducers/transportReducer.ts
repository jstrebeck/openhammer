import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { canEmbark, canDisembark, EMBARKED_POSITION } from '../../transport/index';

export const transportReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 18: Transports =====

    case 'EMBARK': {
      const { unitId, transportId } = action.payload;
      const check = canEmbark(state, unitId, transportId);
      if (!check.allowed) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot embark: ${check.reason}`,
            timestamp: Date.now(),
          }),
        };
      }

      const unit = state.units[unitId]!;
      const transport = state.units[transportId]!;

      // Move models to off-board position
      const newModels = { ...state.models };
      for (const modelId of unit.modelIds) {
        const model = newModels[modelId];
        if (model && model.status === 'active') {
          newModels[modelId] = { ...model, position: { ...EMBARKED_POSITION } };
        }
      }

      // Add to embarkedUnits
      const currentEmbarked = state.embarkedUnits[transportId] ?? [];
      return {
        ...state,
        models: newModels,
        embarkedUnits: {
          ...state.embarkedUnits,
          [transportId]: [...currentEmbarked, unitId],
        },
        turnTracking: {
          ...state.turnTracking,
          embarkedThisPhase: [...state.turnTracking.embarkedThisPhase, unitId],
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} embarks on ${transport.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'DISEMBARK': {
      const { unitId, transportId, positions } = action.payload;
      const check = canDisembark(state, unitId, transportId);
      if (!check.allowed) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot disembark: ${check.reason}`,
            timestamp: Date.now(),
          }),
        };
      }

      const unit = state.units[unitId]!;
      const transport = state.units[transportId]!;

      // Apply positions to models
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Remove from embarkedUnits
      const currentEmbarked = (state.embarkedUnits[transportId] ?? []).filter(id => id !== unitId);

      return {
        ...state,
        models: newModels,
        embarkedUnits: {
          ...state.embarkedUnits,
          [transportId]: currentEmbarked,
        },
        turnTracking: {
          ...state.turnTracking,
          disembarkedThisPhase: [...state.turnTracking.disembarkedThisPhase, unitId],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} disembarks from ${transport.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_DESTROYED_TRANSPORT': {
      const { transportId, casualties, survivorPositions } = action.payload;
      const transport = state.units[transportId];
      if (!transport) return state;

      const embarkedUnitIds = state.embarkedUnits[transportId] ?? [];
      if (embarkedUnitIds.length === 0) return state;

      let newState = { ...state };
      const newModels = { ...newState.models };

      // Apply casualties
      for (const modelId of casualties) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, wounds: 0, status: 'destroyed' };
        }
      }

      // Apply survivor positions
      for (const [modelId, pos] of Object.entries(survivorPositions)) {
        const model = newModels[modelId];
        if (model && model.status === 'active') {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Battle-shock surviving units
      const newBattleShocked = [...newState.battleShocked];
      for (const unitId of embarkedUnitIds) {
        const unit = newState.units[unitId];
        if (!unit) continue;
        const hasActiveSurvivors = unit.modelIds.some(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });
        if (hasActiveSurvivors && !newBattleShocked.includes(unitId)) {
          newBattleShocked.push(unitId);
        }
      }

      // Remove from embarkedUnits
      const { [transportId]: _removed, ...remainingEmbarked } = newState.embarkedUnits;

      return {
        ...newState,
        models: newModels,
        embarkedUnits: remainingEmbarked,
        battleShocked: newBattleShocked,
        log: appendLog(newState.log, {
          type: 'message',
          text: `${transport.name} destroyed! ${casualties.length} embarked model(s) killed. Survivors are Battle-shocked.`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
