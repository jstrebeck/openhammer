import type { GameState } from '../types/index';
import { isEmbarkedPosition } from '../transport/index';
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
import { pendingSavesReducer } from './reducers/pendingSavesReducer';
import { fightReducer } from './reducers/fightReducer';
import { stratagemReducer } from './reducers/stratagemReducer';
import { deploymentReducer } from './reducers/deploymentReducer';
import { lifecycleReducer } from './reducers/lifecycleReducer';
import { factionReducer } from './reducers/factionReducer';

const subReducers: SubReducer[] = [
  setupReducer,
  movementReducer,
  shootingReducer,
  pendingSavesReducer,
  chargeReducer,
  fightReducer,
  commandReducer,
  stratagemReducer,
  transportReducer,
  aircraftReducer,
  deploymentReducer,
  lifecycleReducer,
  factionReducer,
];

/**
 * Detects units whose last active model was destroyed by this action and records
 * where they were (centroid of their models' positions before the action).
 * Catches every damage path centrally — saves, mortal wounds, hazardous, deadly demise, etc.
 */
function trackDestroyedUnits(before: GameState, after: GameState): GameState {
  if (before.models === after.models) return after;

  const hasActiveModel = (state: GameState, modelIds: string[]): boolean =>
    modelIds.some(id => state.models[id]?.status === 'active');

  let newRecords: GameState['turnTracking']['unitsDestroyedThisTurn'] | null = null;
  for (const unitId of Object.keys(before.units)) {
    const unit = before.units[unitId];
    if (!after.units[unitId]) continue; // administratively removed, not destroyed in battle
    if (!hasActiveModel(before, unit.modelIds)) continue; // already dead
    if (hasActiveModel(after, unit.modelIds)) continue; // still alive

    if (after.turnTracking.unitsDestroyedThisTurn.some(r => r.unitId === unitId)) continue;

    // Centroid of the unit's on-board positions before the action
    const positions = unit.modelIds
      .map(id => before.models[id])
      .filter(m => m && m.status === 'active' && !isEmbarkedPosition(m.position))
      .map(m => m!.position);
    if (positions.length === 0) continue; // embarked/off-board — no meaningful position

    const centroid = {
      x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
      y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
    };
    newRecords = newRecords ?? [...after.turnTracking.unitsDestroyedThisTurn];
    newRecords.push({ unitId, playerId: unit.playerId, position: centroid });
  }

  if (!newRecords) return after;
  return {
    ...after,
    turnTracking: { ...after.turnTracking, unitsDestroyedThisTurn: newRecords },
  };
}

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
    if (result !== null) return trackDestroyedUnits(state, result);
  }
  return state;
}
