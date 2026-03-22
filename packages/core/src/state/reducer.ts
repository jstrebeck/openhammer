import type { GameState } from '../types/index';
import type { GameAction } from './actions';
import { getEdition } from '../rules/registry';

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'PLACE_MODEL': {
      const { model } = action.payload;
      return {
        ...state,
        models: { ...state.models, [model.id]: model },
      };
    }

    case 'REMOVE_MODEL': {
      const { modelId } = action.payload;
      const { [modelId]: _removed, ...remainingModels } = state.models;
      // Also remove from parent unit's modelIds
      const model = state.models[modelId];
      if (!model) return state;
      const units = { ...state.units };
      const unit = units[model.unitId];
      if (unit) {
        const updatedModelIds = unit.modelIds.filter((id) => id !== modelId);
        if (updatedModelIds.length === 0) {
          const { [unit.id]: _removedUnit, ...remainingUnits } = units;
          return { ...state, models: remainingModels, units: remainingUnits };
        }
        units[unit.id] = { ...unit, modelIds: updatedModelIds };
      }
      return { ...state, models: remainingModels, units };
    }

    case 'MOVE_MODEL': {
      const { modelId, position } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;
      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: { ...model, position },
        },
      };
    }

    case 'SET_MODEL_WOUNDS': {
      const { modelId, wounds } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;
      const clampedWounds = Math.max(0, Math.min(wounds, model.maxWounds));
      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            wounds: clampedWounds,
            status: clampedWounds === 0 ? 'destroyed' : 'active',
          },
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

    case 'ADD_UNIT': {
      const { unit, models } = action.payload;
      const newModels = { ...state.models };
      for (const model of models) {
        newModels[model.id] = model;
      }
      return {
        ...state,
        units: { ...state.units, [unit.id]: unit },
        models: newModels,
      };
    }

    case 'REMOVE_UNIT': {
      const { unitId } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;
      const newModels = { ...state.models };
      for (const modelId of unit.modelIds) {
        delete newModels[modelId];
      }
      const { [unitId]: _removed, ...remainingUnits } = state.units;
      return { ...state, units: remainingUnits, models: newModels };
    }

    case 'PLACE_TERRAIN': {
      const { terrain } = action.payload;
      return {
        ...state,
        terrain: { ...state.terrain, [terrain.id]: terrain },
      };
    }

    case 'REMOVE_TERRAIN': {
      const { terrainId } = action.payload;
      if (!state.terrain[terrainId]) return state;
      const { [terrainId]: _removed, ...remainingTerrain } = state.terrain;
      return { ...state, terrain: remainingTerrain };
    }

    case 'UPDATE_TERRAIN': {
      const { terrainId, changes } = action.payload;
      const terrain = state.terrain[terrainId];
      if (!terrain) return state;
      return {
        ...state,
        terrain: {
          ...state.terrain,
          [terrainId]: { ...terrain, ...changes },
        },
      };
    }

    case 'ADD_PLAYER': {
      const { player } = action.payload;
      return {
        ...state,
        players: { ...state.players, [player.id]: player },
      };
    }

    case 'ADVANCE_PHASE': {
      const edition = getEdition(state.editionId);
      if (!edition) return state;
      const nextIndex = edition.getNextPhase(state.turnState.currentPhaseIndex);
      if (nextIndex === null) return state; // End of turn — use NEXT_TURN
      const newPhase = edition.phases[nextIndex];
      return {
        ...state,
        turnState: { ...state.turnState, currentPhaseIndex: nextIndex },
        log: appendLog(state.log, {
          type: 'phase_change',
          phase: newPhase?.name ?? `Phase ${nextIndex}`,
          roundNumber: state.turnState.roundNumber,
          playerId: state.turnState.activePlayerId,
          timestamp: Date.now(),
        }),
      };
    }

    case 'NEXT_TURN': {
      const playerIds = Object.keys(state.players);
      const currentIdx = playerIds.indexOf(state.turnState.activePlayerId);
      const isLastPlayer = currentIdx >= playerIds.length - 1;
      const newRound = isLastPlayer ? state.turnState.roundNumber + 1 : state.turnState.roundNumber;
      const newPlayerId = playerIds[(currentIdx + 1) % playerIds.length] ?? '';
      const edition = getEdition(state.editionId);
      const firstPhase = edition?.phases[0];
      return {
        ...state,
        turnState: {
          roundNumber: newRound,
          activePlayerId: newPlayerId,
          currentPhaseIndex: 0,
        },
        log: appendLog(state.log, {
          type: 'phase_change',
          phase: firstPhase?.name ?? 'Phase 0',
          roundNumber: newRound,
          playerId: newPlayerId,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SET_BOARD_SIZE': {
      return {
        ...state,
        board: { width: action.payload.width, height: action.payload.height },
      };
    }

    case 'SET_EDITION': {
      return {
        ...state,
        editionId: action.payload.editionId,
      };
    }

    case 'ROLL_DICE': {
      const { roll } = action.payload;
      return {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };
    }

    case 'SET_COMMAND_POINTS': {
      const { playerId, value, reason } = action.payload;
      const player = state.players[playerId];
      if (!player) return state;
      const clamped = Math.max(0, value);
      return {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...player, commandPoints: clamped },
        },
        log: appendLog(state.log, {
          type: 'cp_change',
          playerId,
          oldValue: player.commandPoints,
          newValue: clamped,
          reason,
          timestamp: Date.now(),
        }),
      };
    }

    case 'LOG_MESSAGE': {
      return {
        ...state,
        log: appendLog(state.log, {
          type: 'message',
          text: action.payload.text,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ADD_DEPLOYMENT_ZONE': {
      const { zone } = action.payload;
      return {
        ...state,
        deploymentZones: { ...state.deploymentZones, [zone.id]: zone },
      };
    }

    case 'REMOVE_DEPLOYMENT_ZONE': {
      const { zoneId } = action.payload;
      if (!state.deploymentZones[zoneId]) return state;
      const { [zoneId]: _removed, ...rest } = state.deploymentZones;
      return { ...state, deploymentZones: rest };
    }

    case 'PLACE_OBJECTIVE': {
      const { objective } = action.payload;
      return {
        ...state,
        objectives: { ...state.objectives, [objective.id]: objective },
      };
    }

    case 'REMOVE_OBJECTIVE': {
      const { objectiveId } = action.payload;
      if (!state.objectives[objectiveId]) return state;
      const { [objectiveId]: _removed, ...rest } = state.objectives;
      return { ...state, objectives: rest };
    }

    case 'UPDATE_OBJECTIVE': {
      const { objectiveId, changes } = action.payload;
      const obj = state.objectives[objectiveId];
      if (!obj) return state;
      return {
        ...state,
        objectives: { ...state.objectives, [objectiveId]: { ...obj, ...changes } },
      };
    }

    case 'SET_RULES_CONFIG': {
      return {
        ...state,
        rulesConfig: { ...state.rulesConfig, ...action.payload.config },
      };
    }

    default:
      return state;
  }
}

function appendLog(log: GameState['log'], entry: GameState['log']['entries'][number]): GameState['log'] {
  return { entries: [...log.entries, entry] };
}
