import type { GameState } from '../types/index';
import { DEFAULT_RULES_CONFIG } from '../types/index';
import { DEFAULT_EDITION_ID } from '../rules/registry';

export function createInitialGameState(options?: {
  editionId?: string;
  boardWidth?: number;
  boardHeight?: number;
}): GameState {
  return {
    id: crypto.randomUUID(),
    editionId: options?.editionId ?? DEFAULT_EDITION_ID,
    board: {
      width: options?.boardWidth ?? 60,
      height: options?.boardHeight ?? 44,
    },
    models: {},
    units: {},
    players: {},
    terrain: {},
    deploymentZones: {},
    objectives: {},
    turnState: {
      roundNumber: 1,
      activePlayerId: '',
      currentPhaseIndex: 0,
    },
    log: { entries: [] },
    rulesConfig: { ...DEFAULT_RULES_CONFIG },
  };
}
