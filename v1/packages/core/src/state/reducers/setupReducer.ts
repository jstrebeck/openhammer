import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';

export const setupReducer: SubReducer = (state, action) => {
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

    case 'IMPORT_ARMY': {
      const newUnits = { ...state.units };
      const newModels = { ...state.models };
      for (const { unit, models } of action.payload.units) {
        newUnits[unit.id] = unit;
        for (const model of models) {
          newModels[model.id] = model;
        }
      }
      return { ...state, units: newUnits, models: newModels };
    }

    case 'ADD_PLAYER': {
      const { player } = action.payload;
      return {
        ...state,
        players: { ...state.players, [player.id]: player },
      };
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

    case 'SET_RULES_CONFIG': {
      return {
        ...state,
        rulesConfig: { ...state.rulesConfig, ...action.payload.config },
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

    case 'ATTACH_LEADER': {
      const { leaderUnitId, bodyguardUnitId } = action.payload;
      const leaderUnit = state.units[leaderUnitId];
      const bodyguardUnit = state.units[bodyguardUnitId];
      if (!leaderUnit || !bodyguardUnit) return state;

      // Leader must have CHARACTER keyword
      if (!leaderUnit.keywords.includes('CHARACTER')) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${leaderUnit.name} must have CHARACTER keyword to be a Leader`,
            timestamp: Date.now(),
          }),
        };
      }

      // Must be same player
      if (leaderUnit.playerId !== bodyguardUnit.playerId) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Leader and Bodyguard must belong to the same player`,
            timestamp: Date.now(),
          }),
        };
      }

      // One Leader cap: check if bodyguard already has a leader attached
      for (const [existingLeaderId, existingBodyguardId] of Object.entries(state.attachedUnits)) {
        if (existingBodyguardId === bodyguardUnitId) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${bodyguardUnit.name} already has a Leader attached (${state.units[existingLeaderId]?.name ?? existingLeaderId})`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Check if this leader is already attached somewhere
      if (state.attachedUnits[leaderUnitId]) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${leaderUnit.name} is already attached to another unit`,
            timestamp: Date.now(),
          }),
        };
      }

      return {
        ...state,
        attachedUnits: { ...state.attachedUnits, [leaderUnitId]: bodyguardUnitId },
        log: appendLog(state.log, {
          type: 'message',
          text: `${leaderUnit.name} attached to ${bodyguardUnit.name} as Leader`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'DETACH_LEADER': {
      const { leaderUnitId } = action.payload;
      const leaderUnit = state.units[leaderUnitId];
      if (!leaderUnit) return state;

      const newAttached = { ...state.attachedUnits };
      delete newAttached[leaderUnitId];

      return {
        ...state,
        attachedUnits: newAttached,
        log: appendLog(state.log, {
          type: 'message',
          text: `${leaderUnit.name} detached from Bodyguard unit`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
