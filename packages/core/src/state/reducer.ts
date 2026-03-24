import type { GameState } from '../types/index';
import {
  COMBINED_REGIMENT_ORDERS,
} from '../types/index';
import type { GameAction } from './actions';
import { isActionAllowedInPhase } from './actionValidation';
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
import { deploymentReducer } from './reducers/deploymentReducer';
import { lifecycleReducer } from './reducers/lifecycleReducer';
import { distanceBetweenModels } from '../measurement/index';

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

  const deploymentResult = deploymentReducer(state, action);
  if (deploymentResult !== null) return deploymentResult;

  const lifecycleResult = lifecycleReducer(state, action);
  if (lifecycleResult !== null) return lifecycleResult;

  switch (action.type) {
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

    default:
      return state;
  }
}


