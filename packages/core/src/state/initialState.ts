import type { GameState } from '../types/index';
import {
  DEFAULT_RULES_CONFIG,
  createEmptyTurnTracking,
  createEmptyShootingState,
  createEmptyChargeState,
  createEmptyFightState,
  createEmptyDeploymentState,
} from '../types/index';
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
    turnTracking: createEmptyTurnTracking(),
    shootingState: createEmptyShootingState(),
    chargeState: createEmptyChargeState(),
    fightState: createEmptyFightState(),
    battleShocked: [],
    score: {},
    stratagemsUsedThisPhase: [],
    gameStarted: false,
    embarkedUnits: {},
    reserves: {},
    hoverModeUnits: [],
    weaponsFired: {},
    attachedUnits: {},
    log: { entries: [] },
    rulesConfig: { ...DEFAULT_RULES_CONFIG },
    smokescreenUnits: [],
    goToGroundUnits: [],
    epicChallengeUnits: [],
    cpGainedThisRound: {},
    persistingEffects: [],
    // Sprint H: Pre-Game Setup
    setupPhase: 'muster',
    enhancements: [],
    deploymentState: createEmptyDeploymentState(),
    // Sprint I: Mission System & Game Lifecycle
    maxBattleRounds: 5,
    scoringLog: [],
    secondaryObjectives: {},
  };
}
