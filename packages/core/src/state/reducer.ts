import type { GameState } from '../types/index';
import {
  createEmptyTurnTracking,
  createEmptyShootingState,
  createEmptyChargeState,
  createEmptyFightState,
  createEmptyDeploymentState,
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
import { commandReducer } from './reducers/commandReducer';
import { movementReducer } from './reducers/movementReducer';
import { shootingReducer } from './reducers/shootingReducer';
import { fightReducer } from './reducers/fightReducer';
import { stratagemReducer } from './reducers/stratagemReducer';
import { distanceBetweenModels, checkCoherency, isWithinRange, distanceToPoint } from '../measurement/index';
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

  const commandResult = commandReducer(state, action);
  if (commandResult !== null) return commandResult;

  const movementResult = movementReducer(state, action);
  if (movementResult !== null) return movementResult;

  const shootingResult = shootingReducer(state, action);
  if (shootingResult !== null) return shootingResult;

  const fightResult = fightReducer(state, action);
  if (fightResult !== null) return fightResult;

  const stratagemResult = stratagemReducer(state, action);
  if (stratagemResult !== null) return stratagemResult;

  switch (action.type) {
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


