import type { GameState } from '../../types/index';
import { COMBINED_REGIMENT_ORDERS } from '../../types/index';
import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { getFactionState } from '../../detachments/registry';
import type { AstraMilitarumState } from '../../detachments/astra-militarum';
import type { TauEmpireState } from '../../detachments/tau-empire';
import { distanceBetweenModels } from '../../measurement/index';

export const factionReducer: SubReducer = (state, action) => {
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

      // Orders cannot be issued to Battle-shocked units
      if (state.battleShocked.includes(targetUnitId)) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${targetUnit.name} is Battle-shocked and cannot receive orders`, timestamp: Date.now() }) };
      }

      const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum') ?? { activeOrders: {}, officersUsedThisPhase: [] };

      if (amState.officersUsedThisPhase.includes(officerUnitId)) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${officerUnit.name} has already issued an order this phase`, timestamp: Date.now() }) };
      }
      const orderDef = COMBINED_REGIMENT_ORDERS.find(o => o.id === orderId);
      if (!orderDef) {
        return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] Unknown order: ${orderId}`, timestamp: Date.now() }) };
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

      // A new order replaces any existing order on the target unit
      const updatedAmState: AstraMilitarumState = {
        activeOrders: { ...amState.activeOrders, [targetUnitId]: orderId },
        officersUsedThisPhase: [...amState.officersUsedThisPhase, officerUnitId],
        orderOwnerPlayerId: officerUnit.playerId,
      };

      const replacedOrder = amState.activeOrders[targetUnitId];
      const logText = replacedOrder
        ? `${officerUnit.name} issues "${orderDef.name}" to ${targetUnit.name} (replaces previous order)`
        : `${officerUnit.name} issues "${orderDef.name}" to ${targetUnit.name}`;

      return {
        ...state,
        factionState: { ...state.factionState, 'astra-militarum': updatedAmState },
        log: appendLog(state.log, { type: 'message', text: logText, timestamp: Date.now() }),
      };
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

      const tauState = getFactionState<TauEmpireState>(state, 'tau-empire') ?? { guidedTargets: {} };

      return {
        ...state,
        factionState: {
          ...state.factionState,
          'tau-empire': { guidedTargets: { ...tauState.guidedTargets, [activePlayerId]: targetUnitId } },
        },
        log: appendLog(state.log, { type: 'message', text: `For the Greater Good: ${targetUnit.name} designated as guided target`, timestamp: Date.now() }),
      };
    }

    default:
      return null;
  }
};
