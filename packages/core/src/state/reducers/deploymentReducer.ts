import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { validateArmy } from '../../army-list/armyValidation';
import { SETUP_PHASE_ORDER } from '../../types/index';

export const deploymentReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Sprint H: Phase 30 — Army Construction & Validation =====

    case 'DESIGNATE_WARLORD': {
      const { modelId } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;
      return {
        ...state,
        warlordModelId: modelId,
        log: appendLog(state.log, {
          type: 'message',
          text: `${model.name} designated as Warlord`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SET_POINTS_LIMIT': {
      const { pointsLimit } = action.payload;
      return {
        ...state,
        pointsLimit,
        log: appendLog(state.log, {
          type: 'message',
          text: `Points limit set to ${pointsLimit}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SET_FACTION_KEYWORD': {
      const { playerId, keyword } = action.payload;
      return {
        ...state,
        playerFactionKeywords: {
          ...state.playerFactionKeywords,
          [playerId]: keyword,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[playerId]?.name ?? playerId} faction keyword set to "${keyword}"`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SELECT_DETACHMENT': {
      const { playerId, detachment } = action.payload;
      return {
        ...state,
        playerDetachments: {
          ...state.playerDetachments,
          [playerId]: detachment,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[playerId]?.name ?? playerId} selected detachment: ${detachment.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ASSIGN_ENHANCEMENT': {
      const { enhancement, modelId } = action.payload;
      const model = state.models[modelId];
      if (!model) return state;
      const assigned = { ...enhancement, assignedToModelId: modelId };
      return {
        ...state,
        enhancements: [...state.enhancements, assigned],
        log: appendLog(state.log, {
          type: 'message',
          text: `Enhancement "${enhancement.name}" assigned to ${model.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'REMOVE_ENHANCEMENT': {
      const { enhancementId } = action.payload;
      const removed = state.enhancements.find(e => e.id === enhancementId);
      return {
        ...state,
        enhancements: state.enhancements.filter(e => e.id !== enhancementId),
        log: appendLog(state.log, {
          type: 'message',
          text: `Enhancement "${removed?.name ?? enhancementId}" removed`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'VALIDATE_ARMY': {
      const { playerId } = action.payload;
      const errors = validateArmy(state, playerId);
      if (errors.length > 0) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `Army validation: ${errors.length} issue(s) found — ${errors.join('; ')}`,
            timestamp: Date.now(),
          }),
        };
      }
      return {
        ...state,
        log: appendLog(state.log, {
          type: 'message',
          text: 'Army validation passed',
          timestamp: Date.now(),
        }),
      };
    }

    // ===== Sprint H: Phase 31 — Deployment Sequence =====

    case 'DETERMINE_ATTACKER_DEFENDER': {
      const { attackerId, defenderId } = action.payload;
      if (!state.players[attackerId] || !state.players[defenderId]) return state;
      return {
        ...state,
        attackerId,
        defenderId,
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[attackerId].name} is Attacker, ${state.players[defenderId].name} is Defender`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'BEGIN_DEPLOYMENT': {
      const { firstDeployingPlayerId } = action.payload;
      const playerIds = Object.keys(state.players);

      // Build lists of units remaining to deploy for each player
      // Exclude units already in reserves and infiltrators
      const unitsRemaining: Record<string, string[]> = {};
      const infiltratorUnits: string[] = [];

      for (const pid of playerIds) {
        const playerUnits = Object.values(state.units)
          .filter(u => u.playerId === pid)
          .filter(u => !state.reserves[u.id]); // Not in reserves

        const regularUnits: string[] = [];
        for (const unit of playerUnits) {
          if (unit.abilities.some(a => a.toUpperCase().includes('INFILTRATOR'))) {
            infiltratorUnits.push(unit.id);
          } else {
            regularUnits.push(unit.id);
          }
        }
        unitsRemaining[pid] = regularUnits;
      }

      return {
        ...state,
        deploymentState: {
          currentDeployingPlayerId: firstDeployingPlayerId,
          unitsRemaining,
          deploymentStarted: false,
          infiltratorUnits,
          scoutMovesCompleted: [],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `Deployment begins. ${state.players[firstDeployingPlayerId]?.name ?? 'Player'} deploys first.`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'DEPLOY_UNIT': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Apply positions to models
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Remove from deployment state's remaining units
      const ds = state.deploymentState;
      const newUnitsRemaining = { ...ds.unitsRemaining };
      for (const pid of Object.keys(newUnitsRemaining)) {
        newUnitsRemaining[pid] = newUnitsRemaining[pid].filter(id => id !== unitId);
      }

      // Also remove from infiltrator list if applicable
      const newInfiltratorUnits = ds.infiltratorUnits.filter(id => id !== unitId);

      // Alternate to next player, skipping players with no units remaining
      const playerIds = Object.keys(state.players);
      const currentIdx = playerIds.indexOf(ds.currentDeployingPlayerId);

      // Check if deployment is complete (all regular units placed)
      const allRegularDeployed = Object.values(newUnitsRemaining).every(ids => ids.length === 0);
      const allInfiltratorsDeployed = newInfiltratorUnits.length === 0;

      let nextDeployer = ds.currentDeployingPlayerId;
      if (!(allRegularDeployed && allInfiltratorsDeployed)) {
        // Try to alternate to the next player who still has units
        for (let i = 1; i <= playerIds.length; i++) {
          const candidateId = playerIds[(currentIdx + i) % playerIds.length];
          if ((newUnitsRemaining[candidateId]?.length ?? 0) > 0) {
            nextDeployer = candidateId;
            break;
          }
        }
        // If no other player has units, stay on current player (shouldn't happen if allRegularDeployed is false)
      }

      return {
        ...state,
        models: newModels,
        deploymentState: {
          ...ds,
          currentDeployingPlayerId: nextDeployer,
          unitsRemaining: newUnitsRemaining,
          deploymentStarted: true,
          infiltratorUnits: newInfiltratorUnits,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} deployed`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'DETERMINE_FIRST_TURN': {
      const { playerId } = action.payload;
      if (!state.players[playerId]) return state;
      return {
        ...state,
        firstTurnPlayerId: playerId,
        turnState: {
          ...state.turnState,
          activePlayerId: playerId,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[playerId].name} takes the first turn`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_REDEPLOYMENT': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

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
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} redeployed`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ADVANCE_SETUP_PHASE': {
      const currentIdx = SETUP_PHASE_ORDER.indexOf(state.setupPhase);
      if (currentIdx < 0 || currentIdx >= SETUP_PHASE_ORDER.length - 1) return state;
      const nextPhase = SETUP_PHASE_ORDER[currentIdx + 1];
      return {
        ...state,
        setupPhase: nextPhase,
        log: appendLog(state.log, {
          type: 'message',
          text: `Setup phase: ${nextPhase}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SCOUT_MOVE': {
      const { unitId, positions } = action.payload;
      const scoutUnit = state.units[unitId];
      if (!scoutUnit) return state;

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
        deploymentState: {
          ...state.deploymentState,
          scoutMovesCompleted: [...state.deploymentState.scoutMovesCompleted, unitId],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${scoutUnit.name} makes a Scout move`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'DEPLOY_INFILTRATORS': {
      const { unitId, positions } = action.payload;
      const infUnit = state.units[unitId];
      if (!infUnit) return state;

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
        deploymentState: {
          ...state.deploymentState,
          infiltratorUnits: state.deploymentState.infiltratorUnits.filter(id => id !== unitId),
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${infUnit.name} deploys via Infiltrators`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
