import type { GameState } from '../types/index';
import { COMBINED_REGIMENT_ORDERS } from '../types/index';
import type { GameAction } from './actions';
import { isActionAllowedInPhase } from './actionValidation';
import { appendLog } from './helpers';
import type { SubReducer } from './helpers';
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

// Temporary inline handler for the 2 faction actions until factionReducer is created
const tempFactionReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'ISSUE_ORDER': {
      const { officerUnitId, targetUnitId, orderId } = action.payload;
      const officerUnit = state.units[officerUnitId];
      const targetUnit = state.units[targetUnitId];
      if (!officerUnit || !targetUnit) return state;

      if (!officerUnit.keywords.some(k => k.toUpperCase() === 'OFFICER')) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} is not an OFFICER`, timestamp: Date.now() }) };
      }
      if (officerUnit.playerId !== targetUnit.playerId) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] Cannot issue orders to enemy units`, timestamp: Date.now() }) };
      }
      if (state.officersUsedThisPhase.includes(officerUnitId)) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} has already issued an order this phase`, timestamp: Date.now() }) };
      }
      const orderDef = COMBINED_REGIMENT_ORDERS.find(o => o.id === orderId);
      if (!orderDef) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] Unknown order: ${orderId}`, timestamp: Date.now() }) };
      }
      if (state.activeOrders[targetUnitId]) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${targetUnit.name} already has an order`, timestamp: Date.now() }) };
      }

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
        log: appendLog(state.log, { type: 'message', text: `${officerUnit.name} issues "${orderDef.name}" to ${targetUnit.name}`, timestamp: Date.now() }),
      };

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

    case 'DESIGNATE_GUIDED_TARGET': {
      const { targetUnitId } = action.payload;
      const activePlayerId = state.turnState.activePlayerId;

      const factionKw = state.playerFactionKeywords[activePlayerId];
      if (!factionKw || factionKw.toUpperCase() !== "T'AU EMPIRE") {
        return { ...state, log: appendLog(state.log, { type: 'message', text: "[BLOCKED] Only T'au Empire players can designate guided targets", timestamp: Date.now() }) };
      }

      const targetUnit = state.units[targetUnitId];
      if (!targetUnit) return state;
      if (targetUnit.playerId === activePlayerId) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: '[BLOCKED] Cannot designate a friendly unit as guided target', timestamp: Date.now() }) };
      }

      return {
        ...state,
        guidedTargets: { ...state.guidedTargets, [activePlayerId]: targetUnitId },
        log: appendLog(state.log, { type: 'message', text: `For the Greater Good: ${targetUnit.name} designated as guided target`, timestamp: Date.now() }),
      };
    }

    default:
      return null;
  }
};

const subReducers: SubReducer[] = [
  setupReducer,
  movementReducer,
  shootingReducer,
  chargeReducer,
  fightReducer,
  commandReducer,
  stratagemReducer,
  transportReducer,
  aircraftReducer,
  deploymentReducer,
  lifecycleReducer,
  tempFactionReducer,
];

export function gameReducer(state: GameState, action: GameAction): GameState {
  const phaseCheck = isActionAllowedInPhase(state, action.type);
  if (!phaseCheck.allowed) {
    if (state.rulesConfig.phaseRestrictions === 'enforce') {
      return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${phaseCheck.reason}`, timestamp: Date.now() }) };
    }
    state = { ...state, log: appendLog(state.log, { type: 'message', text: `[WARNING] ${phaseCheck.reason}`, timestamp: Date.now() }) };
  }

  for (const reducer of subReducers) {
    const result = reducer(state, action);
    if (result !== null) return result;
  }
  return state;
}
