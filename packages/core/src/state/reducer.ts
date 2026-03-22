import type { GameState } from '../types/index';
import {
  createEmptyTurnTracking,
  createEmptyShootingState,
  createEmptyChargeState,
  createEmptyFightState,
  CORE_STRATAGEMS,
} from '../types/index';
import type { GameAction } from './actions';
import { getEdition } from '../rules/registry';
import type { ActionCategory } from '../rules/RulesEdition';
import { distance, distanceBetweenModels, checkCoherency, isWithinRange, getModelBoundingBox, doesPathCrossModel, closestEnemyModel, distanceToPoint } from '../measurement/index';
import { isUnitInEngagementRange, getEngagementShootingMode, getEngagedEnemyUnits, weaponHasAbility, getWoundAllocationTarget } from '../combat/index';
import { pointInPolygon } from '../los/index';
import { canEmbark, canDisembark, EMBARKED_POSITION, getEmbarkedModelCount, getTransportForUnit } from '../transport/index';
import { isAircraftUnit, validateAircraftMovement, AIRCRAFT_MOVE_DISTANCE, canChargeAircraft } from '../aircraft/index';

// --- Phase validation helpers ---

/** Map each action type to its action category */
function getActionCategory(actionType: string): ActionCategory | null {
  switch (actionType) {
    // Movement actions
    case 'MOVE_MODEL':
    case 'ROTATE_MODEL':
    case 'DECLARE_MOVEMENT':
    case 'ROLL_ADVANCE':
    case 'COMMIT_MOVEMENT':
    case 'EMBARK':
    case 'DISEMBARK':
    case 'AIRCRAFT_MOVE':
    case 'AIRCRAFT_OFF_BOARD':
    case 'SET_HOVER_MODE':
    case 'SURGE_MOVE':
      return 'movement';

    // Shooting actions
    case 'DECLARE_SHOOTING':
    case 'ASSIGN_WEAPON_TARGETS':
    case 'RESOLVE_SHOOTING_ATTACK':
    case 'RESOLVE_SAVE_ROLL':
    case 'APPLY_DAMAGE':
    case 'COMPLETE_SHOOTING':
    case 'RESOLVE_HAZARDOUS':
      return 'shooting';

    // Charge actions
    case 'DECLARE_CHARGE':
    case 'ROLL_CHARGE':
    case 'COMMIT_CHARGE_MOVE':
    case 'FAIL_CHARGE':
      return 'charge';

    // Fight actions
    case 'INITIALIZE_FIGHT_PHASE':
    case 'SELECT_UNIT_TO_FIGHT':
    case 'PILE_IN':
    case 'RESOLVE_MELEE_ATTACK':
    case 'CONSOLIDATE':
    case 'COMPLETE_FIGHT':
      return 'fight';

    // Setup/placement actions — always allowed
    case 'PLACE_MODEL':
    case 'REMOVE_MODEL':
    case 'ADD_UNIT':
    case 'REMOVE_UNIT':
    case 'IMPORT_ARMY':
    case 'ADD_PLAYER':
    case 'PLACE_TERRAIN':
    case 'REMOVE_TERRAIN':
    case 'UPDATE_TERRAIN':
    case 'ADD_DEPLOYMENT_ZONE':
    case 'REMOVE_DEPLOYMENT_ZONE':
    case 'PLACE_OBJECTIVE':
    case 'REMOVE_OBJECTIVE':
    case 'UPDATE_OBJECTIVE':
      return 'setup';

    // Admin actions — always allowed
    case 'ADVANCE_PHASE':
    case 'NEXT_TURN':
    case 'SET_BOARD_SIZE':
    case 'SET_EDITION':
    case 'ROLL_DICE':
    case 'SET_COMMAND_POINTS':
    case 'LOG_MESSAGE':
    case 'SET_RULES_CONFIG':
    case 'SET_MODEL_WOUNDS':
    case 'ACTIVATE_UNIT':
    case 'COMPLETE_UNIT_ACTIVATION':
    case 'START_COMMAND_PHASE':
    case 'RESOLVE_BATTLE_SHOCK':
    case 'CALCULATE_OBJECTIVE_CONTROL':
    case 'UPDATE_SCORE':
    case 'USE_STRATAGEM':
    case 'SET_UNIT_IN_RESERVES':
    case 'ARRIVE_FROM_RESERVES':
    case 'RESOLVE_DESTROYED_TRANSPORT':
    case 'APPLY_MORTAL_WOUNDS':
    case 'ROLL_OFF':
    case 'RESOLVE_DEADLY_DEMISE':
    case 'SCOUT_MOVE':
    case 'DEPLOY_INFILTRATORS':
    case 'ATTACH_LEADER':
    case 'DETACH_LEADER':
    case 'APPLY_COMMAND_REROLL':
    case 'RESOLVE_TANK_SHOCK':
    case 'RESOLVE_GRENADE':
    case 'CHECK_END_OF_TURN_COHERENCY':
    case 'RESOLVE_DESPERATE_ESCAPE':
    case 'ADD_PERSISTING_EFFECT':
    case 'REMOVE_PERSISTING_EFFECT':
      return 'admin';

    // Overwatch uses shooting actions out-of-phase
    case 'RESOLVE_OVERWATCH':
      return 'shooting';

    // Heroic Intervention uses charge actions out-of-phase
    case 'RESOLVE_HEROIC_INTERVENTION':
      return 'charge';

    default:
      return null;
  }
}

/** Check if an action is allowed in the current phase */
function isActionAllowedInPhase(state: GameState, actionType: string): { allowed: boolean; reason?: string } {
  if (state.rulesConfig.phaseRestrictions === 'off') {
    return { allowed: true };
  }

  // Out-of-phase actions (triggered by stratagems like Overwatch, Heroic Intervention, Rapid Ingress) bypass phase validation
  if (state.outOfPhaseAction) {
    return { allowed: true };
  }

  const category = getActionCategory(actionType);
  if (!category || category === 'admin' || category === 'setup') {
    return { allowed: true };
  }

  const edition = getEdition(state.editionId);
  if (!edition) return { allowed: true };

  const phaseActionMap = edition.getPhaseActionMap();
  const currentPhase = edition.phases[state.turnState.currentPhaseIndex];
  if (!currentPhase) return { allowed: true };

  const allowedCategories = phaseActionMap[currentPhase.id] ?? [];
  if (allowedCategories.includes(category)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${actionType} (${category}) is not allowed during ${currentPhase.name}`,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  // Phase restriction check
  const phaseCheck = isActionAllowedInPhase(state, action.type);
  if (!phaseCheck.allowed) {
    if (state.rulesConfig.phaseRestrictions === 'enforce') {
      // Block the action — return state with a warning log
      return {
        ...state,
        log: appendLog(state.log, {
          type: 'message',
          text: `[BLOCKED] ${phaseCheck.reason}`,
          timestamp: Date.now(),
        }),
      };
    }
    // 'warn' mode: log warning but allow the action
    state = {
      ...state,
      log: appendLog(state.log, {
        type: 'message',
        text: `[WARNING] ${phaseCheck.reason}`,
        timestamp: Date.now(),
      }),
    };
  }

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
              const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic, moveType);
              const advanceBonus = moveType === 'advance' ? (state.turnTracking.advanceRolls[model.unitId] ?? 0) : 0;
              const totalAllowed = maxDist + advanceBonus;
              const distMoved = distance(model.position, position);

              if (distMoved > totalAllowed + 0.01) {
                if (state.rulesConfig.movementRange === 'enforce') {
                  // Clamp to max distance
                  const ratio = totalAllowed / distMoved;
                  const clampedPosition = {
                    x: model.position.x + (position.x - model.position.x) * ratio,
                    y: model.position.y + (position.y - model.position.y) * ratio,
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
      if (nextIndex === null) return state;
      const newPhase = edition.phases[nextIndex];
      return {
        ...state,
        turnState: { ...state.turnState, currentPhaseIndex: nextIndex },
        // Reset per-phase activation tracking but keep per-turn data (unitMovement, chargedUnits)
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: {},
          unitsCompleted: {},
          embarkedThisPhase: [],
          disembarkedThisPhase: [],
          surgeMoveUsedThisPhase: {},
        },
        // Reset phase-specific state
        shootingState: createEmptyShootingState(),
        chargeState: nextIndex === edition.phases.findIndex(p => p.id === 'charge')
          ? createEmptyChargeState()
          : state.chargeState,
        fightState: createEmptyFightState(),
        stratagemsUsedThisPhase: [],
        // Clear phase-duration stratagem effects
        smokescreenUnits: [],
        goToGroundUnits: [],
        epicChallengeUnits: [],
        outOfPhaseAction: undefined,
        // Auto-expire persisting effects at phase end
        persistingEffects: state.persistingEffects.filter(e => e.expiresAt.type !== 'phase_end'),
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
        // Reset all per-turn tracking
        turnTracking: createEmptyTurnTracking(),
        shootingState: createEmptyShootingState(),
        chargeState: createEmptyChargeState(),
        fightState: createEmptyFightState(),
        stratagemsUsedThisPhase: [],
        smokescreenUnits: [],
        goToGroundUnits: [],
        epicChallengeUnits: [],
        outOfPhaseAction: undefined,
        cpGainedThisRound: isLastPlayer ? {} : state.cpGainedThisRound,
        // Auto-expire persisting effects at turn/round end
        persistingEffects: state.persistingEffects.filter(e => {
          if (e.expiresAt.type === 'phase_end' || e.expiresAt.type === 'turn_end') return false;
          if (e.expiresAt.type === 'round_end' && isLastPlayer && e.expiresAt.round != null && newRound > e.expiresAt.round) return false;
          return true;
        }),
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

      let clamped = Math.max(0, value);
      let newCpGained = { ...state.cpGainedThisRound };

      // CP cap: max 1 additional CP per battle round from non-Command-Phase sources
      if (clamped > player.commandPoints) {
        const cpGain = clamped - player.commandPoints;
        const alreadyGained = newCpGained[playerId] ?? 0;
        if (alreadyGained >= 1) {
          // Already gained max non-Command-Phase CP this round — cap it
          clamped = player.commandPoints;
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${player.name} cannot gain more CP this battle round (CP cap: +1 per round)`,
              timestamp: Date.now(),
            }),
          };
        }
        const allowedGain = Math.min(cpGain, 1 - alreadyGained);
        clamped = player.commandPoints + allowedGain;
        newCpGained = { ...newCpGained, [playerId]: alreadyGained + allowedGain };
      }

      return {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...player, commandPoints: clamped },
        },
        cpGainedThisRound: newCpGained,
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

    // ===== Phase 7: Phase Enforcement =====

    case 'ACTIVATE_UNIT': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
      };
    }

    case 'COMPLETE_UNIT_ACTIVATION': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    // ===== Phase 12: Command Phase & Battle-shock =====

    case 'START_COMMAND_PHASE': {
      const playerIds = Object.keys(state.players);
      let newState = { ...state };

      // Both players gain 1 CP
      for (const playerId of playerIds) {
        const player = newState.players[playerId];
        if (player) {
          newState = {
            ...newState,
            players: {
              ...newState.players,
              [playerId]: { ...player, commandPoints: player.commandPoints + 1 },
            },
            log: appendLog(newState.log, {
              type: 'cp_change',
              playerId,
              oldValue: player.commandPoints,
              newValue: player.commandPoints + 1,
              reason: 'Command Phase CP gain',
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Clear battle-shocked status for the active player's units
      // (Battle-shock clears at start of owning player's next Command Phase)
      const activePlayerId = newState.turnState.activePlayerId;
      const clearedShocked = newState.battleShocked.filter((unitId) => {
        const unit = newState.units[unitId];
        return unit && unit.playerId !== activePlayerId;
      });

      newState = { ...newState, battleShocked: clearedShocked, gameStarted: true };

      return newState;
    }

    case 'RESOLVE_BATTLE_SHOCK': {
      const { unitId, roll, passed } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (passed) {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `${unit.name} passes Battle-shock test`,
            timestamp: Date.now(),
          }),
        };
      } else {
        // Unit becomes Battle-shocked
        newState = {
          ...newState,
          battleShocked: [...newState.battleShocked.filter((id) => id !== unitId), unitId],
          log: appendLog(newState.log, {
            type: 'message',
            text: `${unit.name} fails Battle-shock test — Battle-shocked! (OC becomes 0)`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    // ===== Phase 14: Objective Control & Scoring =====

    case 'CALCULATE_OBJECTIVE_CONTROL': {
      const edition = getEdition(state.editionId);
      if (!edition) return state;

      const newObjectives = { ...state.objectives };

      for (const [objId, objective] of Object.entries(state.objectives)) {
        // Find models within 3" of the objective
        const controlByPlayer: Record<string, number> = {};

        for (const model of Object.values(state.models)) {
          if (model.status === 'destroyed') continue;
          const unit = state.units[model.unitId];
          if (!unit) continue;

          // Check distance: within 3" of objective (edge-to-point)
          if (!isWithinRange(model, objective.position, 3)) continue;

          // OC is 0 if battle-shocked
          const oc = state.battleShocked.includes(unit.id) ? 0 : model.stats.objectiveControl;
          controlByPlayer[unit.playerId] = (controlByPlayer[unit.playerId] ?? 0) + oc;
        }

        // Determine controller
        const entries = Object.entries(controlByPlayer);
        if (entries.length === 0) {
          newObjectives[objId] = { ...objective, controllingPlayerId: undefined };
        } else {
          entries.sort((a, b) => b[1] - a[1]);
          const highest = entries[0][1];
          const tied = entries.filter(([, v]) => v === highest);
          if (tied.length > 1 || highest === 0) {
            // Contested or no OC
            newObjectives[objId] = { ...objective, controllingPlayerId: undefined };
          } else {
            newObjectives[objId] = { ...objective, controllingPlayerId: tied[0][0] };
          }
        }
      }

      return { ...state, objectives: newObjectives };
    }

    case 'UPDATE_SCORE': {
      const { playerId, delta, reason } = action.payload;
      const oldScore = state.score[playerId] ?? 0;
      const newScore = Math.max(0, oldScore + delta);
      return {
        ...state,
        score: { ...state.score, [playerId]: newScore },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[playerId]?.name ?? playerId} scores ${delta} VP (${reason}) — total: ${newScore}`,
          timestamp: Date.now(),
        }),
      };
    }

    // ===== Phase 16: Stratagems =====

    case 'USE_STRATAGEM': {
      const { stratagemId, playerId, targetUnitId } = action.payload;
      const player = state.players[playerId];
      if (!player) return state;

      const stratagem = CORE_STRATAGEMS.find(s => s.id === stratagemId);
      if (!stratagem) return state;

      // Check: already used this phase?
      if (state.stratagemsUsedThisPhase.includes(stratagemId)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${stratagem.name} already used this phase`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: enough CP?
      if (player.commandPoints < stratagem.cpCost) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Not enough CP for ${stratagem.name} (need ${stratagem.cpCost}, have ${player.commandPoints})`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: cannot target Battle-shocked units (except Insane Bravery)
      if (targetUnitId && stratagemId !== 'insane-bravery' && state.battleShocked.includes(targetUnitId)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot use ${stratagem.name} on a Battle-shocked unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: Battle-shocked units cannot use stratagems (except Insane Bravery)
      if (targetUnitId && stratagemId !== 'insane-bravery') {
        const targetUnit = state.units[targetUnitId];
        if (targetUnit && targetUnit.playerId === playerId && state.battleShocked.includes(targetUnitId)) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] Battle-shocked units cannot use Stratagems`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Check: valid phase
      const edition = getEdition(state.editionId);
      if (edition) {
        const currentPhase = edition.phases[state.turnState.currentPhaseIndex];
        if (currentPhase && !stratagem.phases.includes(currentPhase.id)) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${stratagem.name} cannot be used during ${currentPhase.name}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Deduct CP and record usage
      let newState: GameState = {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...player, commandPoints: player.commandPoints - stratagem.cpCost },
        },
        stratagemsUsedThisPhase: [...state.stratagemsUsedThisPhase, stratagemId],
        log: appendLog(state.log, {
          type: 'message',
          text: `${player.name} uses ${stratagem.name} (${stratagem.cpCost} CP)${targetUnitId ? ` on ${state.units[targetUnitId]?.name ?? targetUnitId}` : ''}`,
          timestamp: Date.now(),
        }),
      };

      // Apply immediate stratagem effects
      switch (stratagemId) {
        case 'insane-bravery': {
          // Auto-pass Battle-shock — remove from battleShocked
          if (targetUnitId && newState.battleShocked.includes(targetUnitId)) {
            newState = {
              ...newState,
              battleShocked: newState.battleShocked.filter(id => id !== targetUnitId),
              log: appendLog(newState.log, {
                type: 'message',
                text: `${newState.units[targetUnitId]?.name ?? targetUnitId} auto-passes Battle-shock test (Insane Bravery)`,
                timestamp: Date.now(),
              }),
            };
          }
          break;
        }

        case 'counter-offensive': {
          // Insert target unit at front of fight eligible list
          if (targetUnitId && newState.fightState.eligibleUnits.length >= 0) {
            const eligEdition = getEdition(newState.editionId);
            if (eligEdition) {
              const engagementRange = eligEdition.getEngagementRange();
              const targetUnit = newState.units[targetUnitId];
              if (targetUnit && isUnitInEngagementRange(targetUnit, newState, engagementRange)) {
                // Remove from eligible list if already there, then add to front
                const filtered = newState.fightState.eligibleUnits.filter(id => id !== targetUnitId);
                newState = {
                  ...newState,
                  fightState: {
                    ...newState.fightState,
                    eligibleUnits: [targetUnitId, ...filtered],
                    nextToSelect: playerId,
                  },
                };
              }
            }
          }
          break;
        }

        case 'epic-challenge': {
          // Mark unit for Precision on CHARACTER melee attacks until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              epicChallengeUnits: [...newState.epicChallengeUnits, targetUnitId],
            };
          }
          break;
        }

        case 'smokescreen': {
          // Grant Benefit of Cover and Stealth until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              smokescreenUnits: [...newState.smokescreenUnits, targetUnitId],
            };
          }
          break;
        }

        case 'go-to-ground': {
          // Grant 6+ invulnerable save and Benefit of Cover until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              goToGroundUnits: [...newState.goToGroundUnits, targetUnitId],
            };
          }
          break;
        }

        case 'rapid-ingress': {
          // Set out-of-phase flag to allow ARRIVE_FROM_RESERVES during opponent's Movement
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'rapid-ingress', playerId },
          };
          break;
        }

        case 'fire-overwatch': {
          // Set out-of-phase flag to allow shooting actions during Movement/Charge
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'fire-overwatch', playerId },
          };
          break;
        }

        case 'heroic-intervention': {
          // Set out-of-phase flag to allow charge move during opponent's Charge
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'heroic-intervention', playerId },
          };
          break;
        }

        // command-reroll, tank-shock, grenade: resolved via separate actions
        default:
          break;
      }

      return newState;
    }

    // ===== Phase 8: Movement =====

    case 'DECLARE_MOVEMENT': {
      const { unitId, moveType } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { ...state.turnTracking.unitMovement, [unitId]: moveType },
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.units[unitId].name} declared ${moveType === 'fall_back' ? 'Fall Back' : moveType === 'stationary' ? 'Remain Stationary' : moveType === 'advance' ? 'Advance' : 'Normal'} move`,
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
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      const edition = getEdition(state.editionId);
      if (!edition) return state;

      const moveType = state.turnTracking.unitMovement[unitId] ?? 'normal';

      // Validate movement if enforcement is on
      if (state.rulesConfig.movementRange !== 'off') {
        const errors = validateMovement(state, unitId, moveType, positions, edition);
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
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    // ===== Phase 9: Shooting =====

    case 'DECLARE_SHOOTING': {
      const { unitId } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Check shooting eligibility based on movement
      const edition = getEdition(state.editionId);
      if (edition) {
        const moveType = state.turnTracking.unitMovement[unitId];
        const eligibility = edition.canUnitShoot(moveType);
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

        // Check engagement range shooting (Big Guns Never Tire / Pistols)
        const engagementRange = edition.getEngagementRange();
        if (isUnitInEngagementRange(unit, state, engagementRange)) {
          const shootingMode = getEngagementShootingMode(unit);
          if (shootingMode === 'none') {
            if (state.rulesConfig.phaseRestrictions === 'enforce') {
              return {
                ...state,
                log: appendLog(state.log, {
                  type: 'message',
                  text: `[BLOCKED] ${unit.name} is in Engagement Range and has no Pistol weapons or MONSTER/VEHICLE keyword`,
                  timestamp: Date.now(),
                }),
              };
            }
          }
        }
      }

      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          activeShootingUnit: unitId,
          weaponAssignments: [],
          activeAttacks: [],
        },
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
      };
    }

    case 'ASSIGN_WEAPON_TARGETS': {
      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          weaponAssignments: action.payload.assignments,
        },
      };
    }

    case 'RESOLVE_SHOOTING_ATTACK': {
      const { attackingUnitId, attackingModelId, weaponId, weaponName, targetUnitId, numAttacks, hitRoll, hits, woundRoll, wounds } = action.payload;

      // One Shot validation: check if this weapon was already fired this battle
      const oneShotKey = `${attackingUnitId}:${weaponId}`;
      const attackingUnit = state.units[attackingUnitId];
      if (attackingUnit) {
        const weapon = attackingUnit.weapons.find(w => w.id === weaponId);
        if (weapon && weaponHasAbility(weapon, 'ONE SHOT') && state.weaponsFired[oneShotKey]) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${weaponName} has ONE SHOT and has already been fired this battle`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      const attack: import('../types/index').AttackSequence = {
        id: crypto.randomUUID(),
        attackingUnitId,
        attackingModelId,
        weaponId,
        weaponName,
        targetUnitId,
        numAttacks,
        hitRoll,
        hits,
        woundRoll,
        wounds,
        woundAllocations: [],
        resolved: false,
      };

      // Track One Shot weapons
      let newWeaponsFired = state.weaponsFired;
      if (attackingUnit) {
        const weapon = attackingUnit.weapons.find(w => w.id === weaponId);
        if (weapon && weaponHasAbility(weapon, 'ONE SHOT')) {
          newWeaponsFired = { ...state.weaponsFired, [oneShotKey]: true };
        }
      }

      return {
        ...state,
        weaponsFired: newWeaponsFired,
        shootingState: {
          ...state.shootingState,
          activeAttacks: [...state.shootingState.activeAttacks, attack],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName}: ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_SAVE_ROLL': {
      const { targetModelId, saveRoll, saved, damageToApply } = action.payload;
      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll: saveRoll, timestamp: Date.now() }),
      };

      if (!saved && damageToApply > 0) {
        // Apply damage to the target model
        newState = gameReducer(newState, {
          type: 'APPLY_DAMAGE',
          payload: { modelId: targetModelId, damage: damageToApply, source: 'shooting' },
        });
      }

      return newState;
    }

    case 'APPLY_DAMAGE': {
      const { modelId, damage, source } = action.payload;
      const model = state.models[modelId];
      if (!model || model.status === 'destroyed') return state;

      const newWounds = Math.max(0, model.wounds - damage);
      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            wounds: newWounds,
            status: newWounds === 0 ? 'destroyed' : 'active',
          },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${model.name} takes ${damage} damage from ${source}${newWounds === 0 ? ' — DESTROYED' : ` (${newWounds}W remaining)`}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'COMPLETE_SHOOTING': {
      const { unitId } = action.payload;
      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          activeShootingUnit: null,
          weaponAssignments: [],
          activeAttacks: [],
          unitsShot: [...state.shootingState.unitsShot, unitId],
        },
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    // --- Phase 22: Hazardous ---

    case 'RESOLVE_HAZARDOUS': {
      const { unitId, weaponId, rolls, destroyedModelIds } = action.payload;
      const hazUnit = state.units[unitId];
      if (!hazUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll' as const,
          roll: rolls,
          timestamp: Date.now(),
        }),
      };

      // Destroy models that rolled 1
      for (const modelId of destroyedModelIds) {
        newState = gameReducer(newState, {
          type: 'APPLY_DAMAGE',
          payload: { modelId, damage: 9999, source: `Hazardous (${hazUnit.weapons.find(w => w.id === weaponId)?.name ?? 'weapon'})` },
        });
      }

      return newState;
    }

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

    // ===== Phase 11: Fight =====

    case 'INITIALIZE_FIGHT_PHASE': {
      // Determine eligible units and fight order
      const edition = getEdition(state.editionId);
      if (!edition) return state;
      const engagementRange = edition.getEngagementRange();

      // Find all units within engagement range of enemies
      const eligibleUnits: string[] = [];
      const allModels = Object.values(state.models).filter(m => m.status === 'active');

      for (const unit of Object.values(state.units)) {
        const unitModels = unit.modelIds
          .map(id => state.models[id])
          .filter(m => m && m.status === 'active');
        if (unitModels.length === 0) continue;

        // Check if any model in this unit is within engagement range of an enemy model
        const isInEngagement = unitModels.some(um =>
          allModels.some(em => {
            if (!em) return false;
            const enemyUnit = state.units[em.unitId];
            if (!enemyUnit || enemyUnit.playerId === unit.playerId) return false;
            return distanceBetweenModels(um, em) <= engagementRange;
          })
        );

        if (isInEngagement) {
          eligibleUnits.push(unit.id);
        }
      }

      // Separate Fights First (charged this turn) from remaining
      const fightsFirstUnits = eligibleUnits.filter(id => state.turnTracking.chargedUnits.includes(id));
      const remainingUnits = eligibleUnits.filter(id => !state.turnTracking.chargedUnits.includes(id));

      // Non-active player selects first
      const playerIds = Object.keys(state.players);
      const activePlayerId = state.turnState.activePlayerId;
      const nonActivePlayerId = playerIds.find(id => id !== activePlayerId) ?? activePlayerId;

      return {
        ...state,
        fightState: {
          fightStep: fightsFirstUnits.length > 0 ? 'fights_first' : 'remaining',
          eligibleUnits: fightsFirstUnits.length > 0 ? fightsFirstUnits : remainingUnits,
          currentFighter: null,
          unitsFought: [],
          nextToSelect: nonActivePlayerId,
          activeAttacks: [],
        },
      };
    }

    case 'SELECT_UNIT_TO_FIGHT': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      if (!state.fightState.eligibleUnits.includes(unitId)) return state;

      // Alternate who selects next
      const playerIds = Object.keys(state.players);
      const currentSelector = state.fightState.nextToSelect;
      const nextSelector = playerIds.find(id => id !== currentSelector) ?? currentSelector;

      return {
        ...state,
        fightState: {
          ...state.fightState,
          currentFighter: unitId,
          eligibleUnits: state.fightState.eligibleUnits.filter(id => id !== unitId),
          nextToSelect: nextSelector,
          activeAttacks: [],
        },
      };
    }

    case 'PILE_IN': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Validate pile-in if enforcement is on
      const pileInEdition = getEdition(state.editionId);
      if (pileInEdition && state.rulesConfig.movementRange !== 'off') {
        const errors = validatePileIn(state, unitId, positions, pileInEdition);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Pile-in invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Pile-in: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

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
          text: `${unit.name} piles in`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_MELEE_ATTACK': {
      const { attackingUnitId, attackingModelId, weaponId, weaponName, targetUnitId, numAttacks, hitRoll, hits, woundRoll, wounds } = action.payload;

      // Validate melee target eligibility
      const meleeEdition = getEdition(state.editionId);
      if (meleeEdition && state.rulesConfig.phaseRestrictions !== 'off') {
        const meleeCheck = isValidMeleeTarget(state, attackingUnitId, targetUnitId, meleeEdition);
        if (!meleeCheck.valid) {
          if (state.rulesConfig.phaseRestrictions === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Melee target invalid: ${meleeCheck.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Melee target: ${meleeCheck.reason}`,
              timestamp: Date.now(),
            }),
          };
        }
      }
      const attack: import('../types/index').AttackSequence = {
        id: crypto.randomUUID(),
        attackingUnitId,
        attackingModelId,
        weaponId,
        weaponName,
        targetUnitId,
        numAttacks,
        hitRoll,
        hits,
        woundRoll,
        wounds,
        woundAllocations: [],
        resolved: false,
      };
      return {
        ...state,
        fightState: {
          ...state.fightState,
          activeAttacks: [...state.fightState.activeAttacks, attack],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName} (melee): ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'CONSOLIDATE': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Validate consolidate if enforcement is on
      const consolEdition = getEdition(state.editionId);
      if (consolEdition && state.rulesConfig.movementRange !== 'off') {
        const errors = validateConsolidate(state, unitId, positions, consolEdition);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Consolidate invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Consolidate: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

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
          text: `${unit.name} consolidates`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'COMPLETE_FIGHT': {
      const { unitId } = action.payload;
      const newUnitsFought = [...state.fightState.unitsFought, unitId];

      // Check if we need to transition from fights_first to remaining
      let newFightState = {
        ...state.fightState,
        currentFighter: null,
        unitsFought: newUnitsFought,
        activeAttacks: [],
      };

      if (newFightState.eligibleUnits.length === 0 && newFightState.fightStep === 'fights_first') {
        // Transition to remaining combats
        const edition = getEdition(state.editionId);
        if (edition) {
          const engagementRange = edition.getEngagementRange();
          const allModels = Object.values(state.models).filter(m => m.status === 'active');

          // Find units in engagement range that haven't fought
          const remainingEligible: string[] = [];
          for (const unit of Object.values(state.units)) {
            if (newUnitsFought.includes(unit.id)) continue;
            const unitModels = unit.modelIds
              .map(id => state.models[id])
              .filter(m => m && m.status === 'active');
            if (unitModels.length === 0) continue;

            const isInEngagement = unitModels.some(um =>
              allModels.some(em => {
                if (!em) return false;
                const enemyUnit = state.units[em.unitId];
                if (!enemyUnit || enemyUnit.playerId === unit.playerId) return false;
                return distanceBetweenModels(um, em) <= engagementRange;
              })
            );

            if (isInEngagement) {
              remainingEligible.push(unit.id);
            }
          }

          newFightState = {
            ...newFightState,
            fightStep: 'remaining',
            eligibleUnits: remainingEligible,
          };
        }
      }

      return {
        ...state,
        fightState: newFightState,
      };
    }

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
        // Redirect to off-board
        return gameReducer(state, { type: 'AIRCRAFT_OFF_BOARD', payload: { unitId } });
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

    // ===== Phase 20: Mortal Wounds & Edge Cases =====

    case 'APPLY_MORTAL_WOUNDS': {
      const { targetUnitId, mortalWounds, source } = action.payload;
      const unit = state.units[targetUnitId];
      if (!unit) return state;

      let newState = { ...state };
      let newModels = { ...newState.models };
      let remaining = mortalWounds;
      let casualties = 0;

      // Get active models sorted by wounds remaining (lowest first = allocate to most damaged)
      const activeModelIds = unit.modelIds.filter(id => {
        const m = newModels[id];
        return m && m.status === 'active';
      });

      // Sort by wounds remaining (ascending) so damage spills efficiently
      const sortedModels = activeModelIds
        .map(id => newModels[id]!)
        .sort((a, b) => a.wounds - b.wounds);

      for (const model of sortedModels) {
        if (remaining <= 0) break;
        const damageToApply = Math.min(remaining, model.wounds);
        const newWounds = model.wounds - damageToApply;
        remaining -= damageToApply;
        if (newWounds === 0) casualties++;

        newModels = {
          ...newModels,
          [model.id]: {
            ...model,
            wounds: newWounds,
            status: newWounds === 0 ? 'destroyed' : 'active',
          },
        };
      }

      return {
        ...newState,
        models: newModels,
        log: appendLog(newState.log, {
          type: 'message',
          text: `${unit.name} suffers ${mortalWounds} mortal wound(s) from ${source}${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ROLL_OFF': {
      const { player1Id, player2Id, player1Roll, player2Roll, winnerId } = action.payload;
      const p1Name = state.players[player1Id]?.name ?? player1Id;
      const p2Name = state.players[player2Id]?.name ?? player2Id;
      const p1Val = player1Roll.dice[0] ?? 0;
      const p2Val = player2Roll.dice[0] ?? 0;

      let resultText: string;
      if (winnerId) {
        const winnerName = state.players[winnerId]?.name ?? winnerId;
        resultText = `Roll-off: ${p1Name} rolls ${p1Val}, ${p2Name} rolls ${p2Val} — ${winnerName} wins`;
      } else {
        resultText = `Roll-off: ${p1Name} rolls ${p1Val}, ${p2Name} rolls ${p2Val} — Tie! Re-roll required`;
      }

      let newLog = appendLog(state.log, { type: 'dice_roll', roll: player1Roll, timestamp: Date.now() });
      newLog = appendLog(newLog, { type: 'dice_roll', roll: player2Roll, timestamp: Date.now() });
      newLog = appendLog(newLog, { type: 'message', text: resultText, timestamp: Date.now() });

      return { ...state, log: newLog };
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

    // ===== Phase 23: Unit Abilities & Attached Units =====

    case 'RESOLVE_DEADLY_DEMISE': {
      const { unitId, roll, mortalWounds } = action.payload;
      const ddUnit = state.units[unitId];
      if (!ddUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll' as const,
          roll,
          timestamp: Date.now(),
        }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds to all enemy units within 6" of the destroyed unit's models
        const ddModels = ddUnit.modelIds
          .map(id => state.models[id])
          .filter(m => m != null);

        for (const otherUnit of Object.values(state.units)) {
          if (otherUnit.playerId === ddUnit.playerId) continue;
          const otherModels = otherUnit.modelIds
            .map(id => state.models[id])
            .filter(m => m && m.status === 'active');
          if (otherModels.length === 0) continue;

          // Check if any model of this unit is within 6" of any model of the destroyed unit
          const within6 = otherModels.some(om =>
            ddModels.some(dm => distanceBetweenModels(dm, om) <= 6)
          );

          if (within6) {
            newState = gameReducer(newState, {
              type: 'APPLY_MORTAL_WOUNDS',
              payload: { targetUnitId: otherUnit.id, mortalWounds, source: `Deadly Demise (${ddUnit.name})` },
            });
          }
        }
      }

      return newState;
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
        log: appendLog(state.log, {
          type: 'message',
          text: `${infUnit.name} deploys via Infiltrators`,
          timestamp: Date.now(),
        }),
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

    // ===== Phase 24: Stratagem Effects =====

    case 'APPLY_COMMAND_REROLL': {
      const { originalRollId, newRoll } = action.payload;

      // Validate the original roll can be re-rolled
      const originalEntry = state.log.entries.find(
        (e) => e.type === 'dice_roll' && e.roll.id === originalRollId,
      );
      if (!originalEntry || originalEntry.type !== 'dice_roll') {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Original roll not found for Command Re-roll`,
            timestamp: Date.now(),
          }),
        };
      }

      if (originalEntry.roll.reRolled) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot re-roll an already re-rolled die (Command Re-roll)`,
            timestamp: Date.now(),
          }),
        };
      }

      // Mark the new roll as a re-roll
      const reRolledDice: import('../types/index').DiceRoll = { ...newRoll, reRolled: true };

      return {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll',
          roll: reRolledDice,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_TANK_SHOCK': {
      const { unitId, targetUnitId, roll } = action.payload;
      const tsUnit = state.units[unitId];
      const tsTarget = state.units[targetUnitId];
      if (!tsUnit || !tsTarget) return state;

      // Validate VEHICLE keyword
      if (!tsUnit.keywords.includes('VEHICLE')) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Tank Shock requires a VEHICLE unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Count mortal wounds (5+ on each die)
      const mortalWounds = roll.dice.filter(d => d >= 5).length;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds inline (reusing APPLY_MORTAL_WOUNDS logic)
        let newModels = { ...newState.models };
        let remaining = mortalWounds;
        let casualties = 0;

        const activeModelIds = tsTarget.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        const sortedModels = activeModelIds
          .map(id => newModels[id]!)
          .sort((a, b) => a.wounds - b.wounds);

        for (const model of sortedModels) {
          if (remaining <= 0) break;
          const damageToApply = Math.min(remaining, model.wounds);
          const newWounds = model.wounds - damageToApply;
          remaining -= damageToApply;
          if (newWounds === 0) casualties++;

          newModels = {
            ...newModels,
            [model.id]: {
              ...model,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' : 'active',
            },
          };
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Tank Shock: ${tsTarget.name} suffers ${mortalWounds} mortal wound(s)${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Tank Shock: no mortal wounds inflicted on ${tsTarget.name}`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    case 'RESOLVE_GRENADE': {
      const { unitId, targetUnitId, roll } = action.payload;
      const grenadeUnit = state.units[unitId];
      const grenadeTarget = state.units[targetUnitId];
      if (!grenadeUnit || !grenadeTarget) return state;

      // Validate GRENADES keyword
      if (!grenadeUnit.keywords.includes('GRENADES')) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Grenade requires a GRENADES unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Count mortal wounds (4+ on each die)
      const mortalWounds = roll.dice.filter(d => d >= 4).length;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds inline
        let newModels = { ...newState.models };
        let remaining = mortalWounds;
        let casualties = 0;

        const activeModelIds = grenadeTarget.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        const sortedModels = activeModelIds
          .map(id => newModels[id]!)
          .sort((a, b) => a.wounds - b.wounds);

        for (const model of sortedModels) {
          if (remaining <= 0) break;
          const damageToApply = Math.min(remaining, model.wounds);
          const newWounds = model.wounds - damageToApply;
          remaining -= damageToApply;
          if (newWounds === 0) casualties++;

          newModels = {
            ...newModels,
            [model.id]: {
              ...model,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' : 'active',
            },
          };
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Grenade: ${grenadeTarget.name} suffers ${mortalWounds} mortal wound(s)${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Grenade: no mortal wounds inflicted on ${grenadeTarget.name}`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    case 'RESOLVE_OVERWATCH': {
      const { attackingUnitId, targetUnitId, hitRoll, hits, woundRoll, wounds } = action.payload;
      const owUnit = state.units[attackingUnitId];
      const owTarget = state.units[targetUnitId];
      if (!owUnit || !owTarget) return state;

      // Validate: only unmodified 6s count as hits
      const validHits = hitRoll.dice.filter(d => d === 6).length;
      const effectiveHits = Math.min(hits, validHits);

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll: hitRoll, timestamp: Date.now() }),
      };

      newState = {
        ...newState,
        log: appendLog(newState.log, {
          type: 'message',
          text: `Fire Overwatch: ${owUnit.name} fires at ${owTarget.name} — ${effectiveHits} hit(s) (only 6s count), ${wounds} wound(s)`,
          timestamp: Date.now(),
        }),
      };

      if (woundRoll.dice.length > 0) {
        newState = {
          ...newState,
          log: appendLog(newState.log, { type: 'dice_roll', roll: woundRoll, timestamp: Date.now() }),
        };
      }

      // Clear out-of-phase action after overwatch resolves
      newState = { ...newState, outOfPhaseAction: undefined };

      return newState;
    }

    case 'RESOLVE_HEROIC_INTERVENTION': {
      const { unitId, targetUnitId, positions } = action.payload;
      const hiUnit = state.units[unitId];
      const hiTarget = state.units[targetUnitId];
      if (!hiUnit || !hiTarget) return state;

      // Apply positions (charge move)
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Track as a charge
      let newState: GameState = {
        ...state,
        models: newModels,
        turnTracking: {
          ...state.turnTracking,
          chargedUnits: [...state.turnTracking.chargedUnits, unitId],
        },
        // Clear out-of-phase action
        outOfPhaseAction: undefined,
        log: appendLog(state.log, {
          type: 'message',
          text: `Heroic Intervention: ${hiUnit.name} charges ${hiTarget.name}`,
          timestamp: Date.now(),
        }),
      };

      return newState;
    }

    // ===== Phase 25: Morale & Coherency Cleanup =====

    case 'CHECK_END_OF_TURN_COHERENCY': {
      const coherencyEdition = getEdition(state.editionId);
      if (!coherencyEdition) return state;

      const coherencyRange = coherencyEdition.getCoherencyRange();
      let newState = { ...state };
      let newModels = { ...newState.models };

      for (const unit of Object.values(newState.units)) {
        const activeModelIds = unit.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        if (activeModelIds.length <= 1) continue;

        // Determine min neighbors: 1 for ≤5 models, 2 for >5
        const minNeighbors = activeModelIds.length > 5 ? 2 : 1;

        let check = checkCoherency(activeModelIds, newModels, coherencyRange, minNeighbors);

        // Iteratively remove failing models until coherent
        const removedModelIds: string[] = [];
        let remainingIds = [...activeModelIds];

        while (!check.inCoherency && check.failingModelIds.length > 0 && remainingIds.length > 1) {
          // Remove the first failing model (farthest from coherent group)
          const toRemove = check.failingModelIds[0];
          const model = newModels[toRemove];
          if (model) {
            newModels = {
              ...newModels,
              [toRemove]: { ...model, status: 'destroyed', wounds: 0 },
            };
            removedModelIds.push(toRemove);
          }

          remainingIds = remainingIds.filter(id => id !== toRemove);
          if (remainingIds.length <= 1) break;

          const newMinNeighbors = remainingIds.length > 5 ? 2 : 1;
          check = checkCoherency(remainingIds, newModels, coherencyRange, newMinNeighbors);
        }

        if (removedModelIds.length > 0) {
          const removedNames = removedModelIds.map(id => newModels[id]?.name ?? id).join(', ');
          newState = {
            ...newState,
            log: appendLog(newState.log, {
              type: 'message',
              text: `End-of-turn coherency: ${unit.name} loses ${removedModelIds.length} model(s) (${removedNames})`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      return { ...newState, models: newModels };
    }

    case 'RESOLVE_DESPERATE_ESCAPE': {
      const { unitId, roll, destroyedModelIds } = action.payload;
      const deUnit = state.units[unitId];
      if (!deUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      // Destroy the specified models (1-2 on D6 per model)
      if (destroyedModelIds.length > 0) {
        const newModels = { ...newState.models };
        for (const modelId of destroyedModelIds) {
          const model = newModels[modelId];
          if (model) {
            newModels[modelId] = { ...model, status: 'destroyed', wounds: 0 };
          }
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Desperate Escape: ${deUnit.name} loses ${destroyedModelIds.length} model(s) while Falling Back`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Desperate Escape: ${deUnit.name} successfully Falls Back with no casualties`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    // ===== Phase 26: Persisting Effects =====

    case 'ADD_PERSISTING_EFFECT': {
      const { effect } = action.payload;
      return {
        ...state,
        persistingEffects: [...state.persistingEffects, effect],
        log: appendLog(state.log, {
          type: 'message',
          text: `Effect added: ${effect.type} on ${state.units[effect.targetUnitId]?.name ?? effect.targetUnitId}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'REMOVE_PERSISTING_EFFECT': {
      const { effectId } = action.payload;
      const removed = state.persistingEffects.find(e => e.id === effectId);
      return {
        ...state,
        persistingEffects: state.persistingEffects.filter(e => e.id !== effectId),
        log: appendLog(state.log, {
          type: 'message',
          text: `Effect removed: ${removed?.type ?? effectId}`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return state;
  }
}

// ===== Movement Validation =====

function validateMovement(
  state: GameState,
  unitId: string,
  moveType: import('../types/index').MoveType,
  newPositions: Record<string, import('../types/geometry').Point>,
  edition: import('../rules/RulesEdition').RulesEdition,
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

    const distMoved = distance(model.position, newPos);
    const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic, moveType);
    const advanceBonus = moveType === 'advance' ? (state.turnTracking.advanceRolls[unitId] ?? 0) : 0;
    const totalAllowed = maxDist + advanceBonus;

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
        if (!unitHasFly && doesPathCrossModel(model.position, newPos, otherModel)) {
          errors.push(`${model.name} cannot move through enemy model ${otherModel.name} (no FLY)`);
        }
      } else if (isFriendlyMonsterVehicle && otherUnit.id !== unitId) {
        // Only FLY MONSTER/VEHICLE can move through friendly MONSTER/VEHICLE
        if (!(unitHasFly && unitIsMonsterOrVehicle) && doesPathCrossModel(model.position, newPos, otherModel)) {
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
        const startsInTerrain = pointInPolygon(model.position, terrain.polygon);
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
    const tempModels: Record<string, import('../types/index').Model> = {};
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

/** Validate a charge move: distance ≤ charge roll, must end in ER of all declared targets, coherency, no ER of non-targets */
function validateChargeMove(
  state: GameState,
  unitId: string,
  newPositions: Record<string, import('../types/geometry').Point>,
  edition: import('../rules/RulesEdition').RulesEdition,
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
  const tempModels: Record<string, import('../types/index').Model> = { ...state.models };
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
    const coherencyModels: Record<string, import('../types/index').Model> = {};
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

/** Validate a Pile In move: each model must end closer to closest enemy, max 3", coherency */
function validatePileIn(
  state: GameState,
  unitId: string,
  newPositions: Record<string, import('../types/geometry').Point>,
  edition: import('../rules/RulesEdition').RulesEdition,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const coherencyRange = edition.getCoherencyRange();
  const PILE_IN_DISTANCE = 3;

  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    // Max 3" move
    const distMoved = distance(model.position, newPos);
    if (distMoved > PILE_IN_DISTANCE + 0.01) {
      errors.push(`${model.name} pile-in moved ${distMoved.toFixed(1)}" but max is ${PILE_IN_DISTANCE}"`);
    }

    // Must end closer to the closest enemy model
    const closestBefore = closestEnemyModel(model.position, unit.playerId, state.models, state.units);
    const closestAfter = closestEnemyModel(newPos, unit.playerId, state.models, state.units);
    if (closestBefore && closestAfter && distMoved > 0.01) {
      if (closestAfter.distance >= closestBefore.distance - 0.01) {
        errors.push(`${model.name} must end closer to the closest enemy model after pile-in`);
      }
    }
  }

  // Coherency after pile-in
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    const tempModels: Record<string, import('../types/index').Model> = {};
    for (const mid of activeModelIds) {
      const m = state.models[mid];
      if (m) {
        tempModels[mid] = newPositions[mid] ? { ...m, position: newPositions[mid] } : m;
      }
    }
    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, tempModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency after pile-in`);
    }
  }

  return errors;
}

/** Validate a Consolidate move: same as pile-in but with objective marker fallback */
function validateConsolidate(
  state: GameState,
  unitId: string,
  newPositions: Record<string, import('../types/geometry').Point>,
  edition: import('../rules/RulesEdition').RulesEdition,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const coherencyRange = edition.getCoherencyRange();
  const CONSOLIDATE_DISTANCE = 3;

  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    // Max 3" move
    const distMoved = distance(model.position, newPos);
    if (distMoved > CONSOLIDATE_DISTANCE + 0.01) {
      errors.push(`${model.name} consolidate moved ${distMoved.toFixed(1)}" but max is ${CONSOLIDATE_DISTANCE}"`);
    }

    if (distMoved < 0.01) continue; // No movement, skip direction check

    // Must end closer to closest enemy OR nearest objective
    const closestBefore = closestEnemyModel(model.position, unit.playerId, state.models, state.units);
    const closestAfter = closestEnemyModel(newPos, unit.playerId, state.models, state.units);
    const hasObjectives = Object.keys(state.objectives).length > 0;

    // If no enemies and no objectives, only enforce distance (no direction constraint)
    if (!closestBefore && !hasObjectives) continue;

    let movedCloserToEnemy = false;
    if (closestBefore && closestAfter) {
      movedCloserToEnemy = closestAfter.distance < closestBefore.distance - 0.01;
    }

    let movedCloserToObjective = false;
    if (!movedCloserToEnemy) {
      for (const obj of Object.values(state.objectives)) {
        const distBefore = distance(model.position, obj.position);
        const distAfter = distance(newPos, obj.position);
        if (distAfter < distBefore - 0.01) {
          movedCloserToObjective = true;
          break;
        }
      }
    }

    if (!movedCloserToEnemy && !movedCloserToObjective) {
      errors.push(`${model.name} must consolidate closer to an enemy model or objective marker`);
    }
  }

  // Coherency after consolidate
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    const tempModels: Record<string, import('../types/index').Model> = {};
    for (const mid of activeModelIds) {
      const m = state.models[mid];
      if (m) {
        tempModels[mid] = newPositions[mid] ? { ...m, position: newPositions[mid] } : m;
      }
    }
    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, tempModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency after consolidate`);
    }
  }

  return errors;
}

/** Check if a melee target is valid: within Engagement Range or reachable via friendly base-to-base chain */
function isValidMeleeTarget(
  state: GameState,
  attackingUnitId: string,
  targetUnitId: string,
  edition: import('../rules/RulesEdition').RulesEdition,
): { valid: boolean; reason?: string } {
  const attackingUnit = state.units[attackingUnitId];
  const targetUnit = state.units[targetUnitId];
  if (!attackingUnit || !targetUnit) return { valid: false, reason: 'Unit not found' };
  if (attackingUnit.playerId === targetUnit.playerId) return { valid: false, reason: 'Cannot attack friendly units' };

  const engagementRange = edition.getEngagementRange();
  const attackerModels = attackingUnit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');
  const targetModels = targetUnit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');

  if (attackerModels.length === 0 || targetModels.length === 0) {
    return { valid: false, reason: 'No active models' };
  }

  // Direct check: any attacker model within Engagement Range of any target model
  const directContact = attackerModels.some(am =>
    targetModels.some(tm => distanceBetweenModels(am, tm) <= engagementRange)
  );
  if (directContact) return { valid: true };

  // Base-to-base chain: can we reach the target through a chain of friendly models
  // in base-to-base contact?
  const BASE_CONTACT_THRESHOLD = 0.5; // within 0.5" counts as base-to-base

  // BFS from attacker models through friendly models in base-to-base contact
  const visited = new Set<string>();
  const queue: string[] = attackerModels.map(m => m.id);
  for (const id of queue) visited.add(id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = state.models[currentId];
    if (!current) continue;

    // Check if this model is in base-to-base with any target model
    if (targetModels.some(tm => distanceBetweenModels(current, tm) <= BASE_CONTACT_THRESHOLD)) {
      return { valid: true };
    }

    // Find friendly models in base-to-base contact
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      if (visited.has(otherModel.id)) continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId !== attackingUnit.playerId) continue;

      if (distanceBetweenModels(current, otherModel) <= BASE_CONTACT_THRESHOLD) {
        visited.add(otherModel.id);
        queue.push(otherModel.id);
      }
    }
  }

  return { valid: false, reason: `Target ${targetUnit.name} not in Engagement Range or reachable via base-to-base chain` };
}

function appendLog(log: GameState['log'], entry: GameState['log']['entries'][number]): GameState['log'] {
  return { entries: [...log.entries, entry] };
}
