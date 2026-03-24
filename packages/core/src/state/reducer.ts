import type { GameState } from '../types/index';
import {
  createEmptyTurnTracking,
  createEmptyShootingState,
  createEmptyChargeState,
  createEmptyFightState,
  createEmptyDeploymentState,
  CORE_STRATAGEMS,
  COMBINED_REGIMENT_ORDERS,
  SETUP_PHASE_ORDER,
} from '../types/index';
import type { SetupPhase } from '../types/index';
import { validateDeploymentPosition, validateArmy } from '../army-list/armyValidation';
import type { GameAction } from './actions';
import { getEdition } from '../rules/registry';
import { getActionCategory, isActionAllowedInPhase } from './actionValidation';
import { appendLog } from './helpers';
import { setupReducer } from './reducers/setupReducer';
import { chargeReducer } from './reducers/chargeReducer';
import { transportReducer } from './reducers/transportReducer';
import { aircraftReducer } from './reducers/aircraftReducer';
import { distance, distanceBetweenModels, checkCoherency, isWithinRange, getModelBoundingBox, doesPathCrossModel, closestEnemyModel, distanceToPoint, getPivotCost } from '../measurement/index';
import { isUnitInEngagementRange, getEngagementShootingMode, getEngagedEnemyUnits, weaponHasAbility, getWoundAllocationTarget } from '../combat/index';
import { pointInPolygon } from '../los/index';
import { isAircraftUnit } from '../aircraft/index';
import { evaluateScoring } from '../missions/index';

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

  const setupResult = setupReducer(state, action);
  if (setupResult !== null) return setupResult;

  const chargeResult = chargeReducer(state, action);
  if (chargeResult !== null) return chargeResult;

  const transportResult = transportReducer(state, action);
  if (transportResult !== null) return transportResult;

  const aircraftResult = aircraftReducer(state, action);
  if (aircraftResult !== null) return aircraftResult;

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
              const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic, moveType);
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
        // Clear orders and officer tracking on phase change
        activeOrders: {},
        officersUsedThisPhase: [],
        // Clear guided targets when entering OWN Shooting phase (For the Greater Good expires)
        guidedTargets: newPhase?.id === 'shooting'
          ? (() => {
              const { [state.turnState.activePlayerId]: _, ...rest } = state.guidedTargets;
              return rest;
            })()
          : state.guidedTargets,
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
        activeOrders: {},
        officersUsedThisPhase: [],
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

      const detachmentStratagems = state.playerDetachments[playerId]?.stratagems ?? [];
      const stratagem = CORE_STRATAGEMS.find(s => s.id === stratagemId)
        ?? detachmentStratagems.find(s => s.id === stratagemId);
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

    // ===== Combined Regiment: Orders =====

    case 'ISSUE_ORDER': {
      const { officerUnitId, targetUnitId, orderId } = action.payload;
      const officerUnit = state.units[officerUnitId];
      const targetUnit = state.units[targetUnitId];
      if (!officerUnit || !targetUnit) return state;

      // Validate: officer must have OFFICER keyword
      if (!officerUnit.keywords.some(k => k.toUpperCase() === 'OFFICER')) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} is not an OFFICER`, timestamp: Date.now() }) };
      }

      // Validate: same player
      if (officerUnit.playerId !== targetUnit.playerId) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] Cannot issue orders to enemy units`, timestamp: Date.now() }) };
      }

      // Validate: officer hasn't already issued an order this phase
      if (state.officersUsedThisPhase.includes(officerUnitId)) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} has already issued an order this phase`, timestamp: Date.now() }) };
      }

      // Validate: valid order ID
      const orderDef = COMBINED_REGIMENT_ORDERS.find(o => o.id === orderId);
      if (!orderDef) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] Unknown order: ${orderId}`, timestamp: Date.now() }) };
      }

      // Validate: target unit doesn't already have an order
      if (state.activeOrders[targetUnitId]) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${targetUnit.name} already has an order`, timestamp: Date.now() }) };
      }

      // Validate: officer within 6" of target (check closest models)
      const officerModels = officerUnit.modelIds.map(id => state.models[id]).filter(m => m && m.status === 'active');
      const targetModels = targetUnit.modelIds.map(id => state.models[id]).filter(m => m && m.status === 'active');
      let withinRange = false;
      for (const om of officerModels) {
        for (const tm of targetModels) {
          if (om && tm && distanceBetweenModels(om, tm) <= 6) {
            withinRange = true;
            break;
          }
        }
        if (withinRange) break;
      }
      if (!withinRange) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} is not within 6" of ${targetUnit.name}`, timestamp: Date.now() }) };
      }

      let newState: GameState = {
        ...state,
        activeOrders: { ...state.activeOrders, [targetUnitId]: orderId },
        officersUsedThisPhase: [...state.officersUsedThisPhase, officerUnitId],
        log: appendLog(state.log, {
          type: 'message',
          text: `${officerUnit.name} issues "${orderDef.name}" to ${targetUnit.name}`,
          timestamp: Date.now(),
        }),
      };

      // Duty and Honour: create a persisting effect for the 4+ invulnerable save
      if (orderId === 'duty-and-honour') {
        newState = {
          ...newState,
          persistingEffects: [
            ...newState.persistingEffects,
            {
              id: crypto.randomUUID(),
              type: 'duty-and-honour',
              targetUnitId,
              sourceId: officerUnitId,
              expiresAt: { type: 'turn_end' },
              data: { invulnSave: 4 },
            },
          ],
        };
      }

      return newState;
    }

    // ===== T'au Empire: For the Greater Good =====

    case 'DESIGNATE_GUIDED_TARGET': {
      const { targetUnitId } = action.payload;
      const activePlayerId = state.turnState.activePlayerId;

      // Validate: active player has T'AU EMPIRE faction keyword
      const factionKw = state.playerFactionKeywords[activePlayerId];
      if (!factionKw || factionKw.toUpperCase() !== "T'AU EMPIRE") {
        return { ...state, log: appendLog(state.log, { type: 'message', text: "[BLOCKED] Only T'au Empire players can designate guided targets", timestamp: Date.now() }) };
      }

      // Validate: target unit exists and is an enemy
      const targetUnit = state.units[targetUnitId];
      if (!targetUnit) return state;
      if (targetUnit.playerId === activePlayerId) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: '[BLOCKED] Cannot designate a friendly unit as guided target', timestamp: Date.now() }) };
      }

      return {
        ...state,
        guidedTargets: { ...state.guidedTargets, [activePlayerId]: targetUnitId },
        log: appendLog(state.log, {
          type: 'message',
          text: `For the Greater Good: ${targetUnit.name} designated as guided target`,
          timestamp: Date.now(),
        }),
      };
    }

    // ===== Phase 8: Movement =====

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

    // ===== Sprint I: Mission System & Game Lifecycle =====

    case 'SET_MISSION': {
      const { mission } = action.payload;

      // Create deployment zones from mission definition, mapping roles to player IDs
      const newZones: Record<string, import('../types/index').DeploymentZone> = {};
      for (const zone of mission.deploymentMap) {
        const playerId = zone.role === 'attacker' ? state.attackerId : state.defenderId;
        const player = playerId ? state.players[playerId] : undefined;
        const zoneId = crypto.randomUUID();
        newZones[zoneId] = {
          id: zoneId,
          playerId: playerId ?? '',
          polygon: zone.polygon,
          label: zone.label,
          color: player?.color ?? (zone.role === 'attacker' ? '#3b82f6' : '#ef4444'),
        };
      }

      // Create objectives from mission definition
      const newObjectives: Record<string, import('../types/index').ObjectiveMarker> = {};
      for (const obj of mission.objectivePlacements) {
        const objId = crypto.randomUUID();
        newObjectives[objId] = {
          id: objId,
          position: obj.position,
          number: obj.number,
          label: obj.label,
        };
      }

      return {
        ...state,
        mission,
        board: { width: mission.battlefieldSize.width, height: mission.battlefieldSize.height },
        deploymentZones: newZones,
        objectives: newObjectives,
        maxBattleRounds: mission.maxBattleRounds,
        log: appendLog(state.log, {
          type: 'message',
          text: `Mission set: ${mission.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SELECT_SECONDARY': {
      const { playerId, conditionIds } = action.payload;
      return {
        ...state,
        secondaryObjectives: {
          ...state.secondaryObjectives,
          [playerId]: conditionIds,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `Player ${state.players[playerId]?.name ?? playerId} selected ${conditionIds.length} secondary objectives`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'END_TURN': {
      // End-of-turn sequence:
      // 1. Clear turn-scoped effects (charge bonus, movement flags)
      // 2. Calculate objective control (inline)
      // 3. Evaluate end-of-turn scoring

      // Step 1: Clear turn-scoped effects on turnTracking
      const clearedTracking: import('../types/index').TurnTracking = {
        ...state.turnTracking,
        unitsActivated: {},
        unitsCompleted: {},
        embarkedThisPhase: [],
        disembarkedThisPhase: [],
        surgeMoveUsedThisPhase: {},
      };

      // Step 2: Calculate objective control (same logic as CALCULATE_OBJECTIVE_CONTROL)
      const updatedObjectives = { ...state.objectives };
      const editionForOC = getEdition(state.editionId);
      if (editionForOC) {
        for (const obj of Object.values(updatedObjectives)) {
          const ocByPlayer: Record<string, number> = {};
          for (const model of Object.values(state.models)) {
            if (model.status === 'destroyed') continue;
            const unit = state.units[model.unitId];
            if (!unit) continue;
            const dist = distanceToPoint(model, obj.position);
            if (dist <= 3) {
              const isBattleShocked = state.battleShocked.includes(unit.id);
              const oc = isBattleShocked ? 0 : model.stats.objectiveControl;
              ocByPlayer[unit.playerId] = (ocByPlayer[unit.playerId] ?? 0) + oc;
            }
          }
          const playerEntries = Object.entries(ocByPlayer).filter(([, oc]) => oc > 0);
          if (playerEntries.length === 0) {
            updatedObjectives[obj.id] = { ...obj, controllingPlayerId: undefined };
          } else if (playerEntries.length === 1) {
            updatedObjectives[obj.id] = { ...obj, controllingPlayerId: playerEntries[0][0] };
          } else {
            const maxOC = Math.max(...playerEntries.map(([, oc]) => oc));
            const winners = playerEntries.filter(([, oc]) => oc === maxOC);
            updatedObjectives[obj.id] = {
              ...obj,
              controllingPlayerId: winners.length === 1 ? winners[0][0] : undefined,
            };
          }
        }
      }

      // Step 3: Evaluate end-of-turn scoring
      const stateForScoring: GameState = { ...state, objectives: updatedObjectives, turnTracking: clearedTracking };
      const turnScoring = evaluateScoring(stateForScoring, 'end_of_turn');
      const newScore = { ...state.score };
      for (const [pid, delta] of Object.entries(turnScoring.scoreDeltas)) {
        newScore[pid] = (newScore[pid] ?? 0) + delta;
      }

      return {
        ...state,
        turnTracking: clearedTracking,
        objectives: updatedObjectives,
        score: newScore,
        scoringLog: [...state.scoringLog, ...turnScoring.entries],
        // Clear phase-duration effects
        smokescreenUnits: [],
        goToGroundUnits: [],
        epicChallengeUnits: [],
        outOfPhaseAction: undefined,
        persistingEffects: state.persistingEffects.filter(e => e.expiresAt.type !== 'phase_end' && e.expiresAt.type !== 'turn_end'),
        log: appendLog(state.log, {
          type: 'message',
          text: `End of turn for ${state.players[state.turnState.activePlayerId]?.name ?? 'Unknown'}` +
            (turnScoring.entries.length > 0
              ? `. VP scored: ${turnScoring.entries.map(e => `${state.players[e.playerId]?.name ?? e.playerId} +${e.vpScored} (${e.conditionName})`).join(', ')}`
              : ''),
          timestamp: Date.now(),
        }),
      };
    }

    case 'END_BATTLE_ROUND': {
      // End-of-battle-round sequence:
      // 1. Score VP per mission (end_of_round conditions)
      // 2. Clear round-scoped effects
      // 3. Increment round counter
      // 4. Check final round

      // Step 1: Evaluate end-of-round scoring
      const roundScoring = evaluateScoring(state, 'end_of_round');
      const roundScore = { ...state.score };
      for (const [pid, delta] of Object.entries(roundScoring.scoreDeltas)) {
        roundScore[pid] = (roundScore[pid] ?? 0) + delta;
      }

      // Step 2: Check if this is the final round
      const isLastRound = state.turnState.roundNumber >= state.maxBattleRounds;

      // Step 3: Clear round-scoped effects and advance
      const playerIds = Object.keys(state.players);
      const newActivePlayer = state.firstTurnPlayerId ?? playerIds[0] ?? '';

      let newState: GameState = {
        ...state,
        score: roundScore,
        scoringLog: [...state.scoringLog, ...roundScoring.entries],
        // Increment round if not last
        turnState: isLastRound ? state.turnState : {
          roundNumber: state.turnState.roundNumber + 1,
          activePlayerId: newActivePlayer,
          currentPhaseIndex: 0,
        },
        // Reset all per-turn tracking for new round
        turnTracking: isLastRound ? state.turnTracking : createEmptyTurnTracking(),
        shootingState: isLastRound ? state.shootingState : createEmptyShootingState(),
        chargeState: isLastRound ? state.chargeState : createEmptyChargeState(),
        fightState: isLastRound ? state.fightState : createEmptyFightState(),
        stratagemsUsedThisPhase: isLastRound ? state.stratagemsUsedThisPhase : [],
        smokescreenUnits: [],
        goToGroundUnits: [],
        epicChallengeUnits: [],
        outOfPhaseAction: undefined,
        cpGainedThisRound: isLastRound ? state.cpGainedThisRound : {},
        // Clear round-end persisting effects
        persistingEffects: state.persistingEffects.filter(e => {
          if (e.expiresAt.type === 'phase_end' || e.expiresAt.type === 'turn_end') return false;
          if (e.expiresAt.type === 'round_end') return false;
          return true;
        }),
        log: appendLog(state.log, {
          type: 'message',
          text: `End of Battle Round ${state.turnState.roundNumber}` +
            (roundScoring.entries.length > 0
              ? `. VP scored: ${roundScoring.entries.map(e => `${state.players[e.playerId]?.name ?? e.playerId} +${e.vpScored} (${e.conditionName})`).join(', ')}`
              : '') +
            (isLastRound ? '. Final round complete!' : ''),
          timestamp: Date.now(),
        }),
      };

      // If final round, auto-trigger end of battle
      if (isLastRound) {
        newState = gameReducer(newState, { type: 'END_BATTLE', payload: { reason: 'max_rounds' } });
      }

      return newState;
    }

    case 'END_BATTLE': {
      const { reason } = action.payload;

      // 1. Undeployed Reserves count as destroyed
      const updatedModels = { ...state.models };
      const destroyedReserveUnits: string[] = [];
      for (const [unitId, reserve] of Object.entries(state.reserves)) {
        const unit = state.units[unitId];
        if (!unit) continue;
        destroyedReserveUnits.push(unit.name);
        for (const modelId of unit.modelIds) {
          const model = updatedModels[modelId];
          if (model && model.status !== 'destroyed') {
            updatedModels[modelId] = { ...model, status: 'destroyed', wounds: 0 };
          }
        }
      }

      // 2. Evaluate end-of-battle scoring
      const battleScoring = evaluateScoring({ ...state, models: updatedModels }, 'end_of_battle');
      const finalScores: Record<string, number> = { ...state.score };
      for (const [pid, delta] of Object.entries(battleScoring.scoreDeltas)) {
        finalScores[pid] = (finalScores[pid] ?? 0) + delta;
      }

      // 3. Determine winner
      const playerIds = Object.keys(state.players);
      let winnerId: string | null = null;
      if (playerIds.length >= 2) {
        const scores = playerIds.map(pid => ({ pid, vp: finalScores[pid] ?? 0 }));
        scores.sort((a, b) => b.vp - a.vp);
        if (scores[0].vp > scores[1].vp) {
          winnerId = scores[0].pid;
        }
        // else tie = draw (winnerId stays null)
      }

      return {
        ...state,
        models: updatedModels,
        score: finalScores,
        scoringLog: [...state.scoringLog, ...battleScoring.entries],
        gameResult: {
          winnerId,
          finalScores,
          reason,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `Battle ended (${reason})!` +
            (destroyedReserveUnits.length > 0 ? ` Reserves destroyed: ${destroyedReserveUnits.join(', ')}.` : '') +
            (winnerId
              ? ` Winner: ${state.players[winnerId]?.name ?? winnerId} (${finalScores[winnerId] ?? 0} VP)`
              : ` Result: Draw (${playerIds.map(p => `${state.players[p]?.name ?? p}: ${finalScores[p] ?? 0}`).join(', ')})`),
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
    const maxDist = edition.getMaxMoveDistance(model.moveCharacteristic, moveType);
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

