import type { GameState } from '../types/index';
import type { GameAction } from './actions';

export type SubReducer = (state: GameState, action: GameAction) => GameState | null;

export function appendLog(log: GameState['log'], entry: GameState['log']['entries'][number]): GameState['log'] {
  return { entries: [...log.entries, entry] };
}
