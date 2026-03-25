import type { GameState } from '../types/index';
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
