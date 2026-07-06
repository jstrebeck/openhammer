import type { BoardState, EnforcementConfig, GameState, PlayerIndex } from '../types/state.js';
import { SETUP_PHASE } from './reducer.js';

export interface NewGameConfig {
  editionId: string;
  missionId: string;
  deploymentMapId: string;
  contentVersions: Record<string, string>;
  board: BoardState;
  players: [NewGamePlayer, NewGamePlayer];
  rngSeed: number;
  enforcement?: EnforcementConfig;
  firstPlayer?: PlayerIndex;
}

export interface NewGamePlayer {
  name: string;
  factionId: string;
  detachmentId: string;
}

/** Rules enforcement defaults to ENFORCE; setup flow offers "Casual (warn)". */
export const DEFAULT_ENFORCEMENT: EnforcementConfig = {
  movement: 'enforce',
  targeting: 'enforce',
  coherency: 'enforce',
  stratagems: 'enforce',
};

export function createInitialGameState(config: NewGameConfig): GameState {
  return {
    contentVersions: config.contentVersions,
    editionId: config.editionId,
    missionId: config.missionId,
    deploymentMapId: config.deploymentMapId,
    enforcement: config.enforcement ?? DEFAULT_ENFORCEMENT,
    phase: SETUP_PHASE,
    step: null,
    round: 0,
    activePlayer: config.firstPlayer ?? 0,
    firstPlayer: config.firstPlayer ?? 0,
    players: [
      {
        index: 0,
        name: config.players[0].name,
        factionId: config.players[0].factionId,
        detachmentId: config.players[0].detachmentId,
        cp: 0,
        extraCpThisRound: 0,
        vp: 0,
        vpLog: [],
        stratagemsUsedThisPhase: [],
        paintedArmy: false,
      },
      {
        index: 1,
        name: config.players[1].name,
        factionId: config.players[1].factionId,
        detachmentId: config.players[1].detachmentId,
        cp: 0,
        extraCpThisRound: 0,
        vp: 0,
        vpLog: [],
        stratagemsUsedThisPhase: [],
        paintedArmy: false,
      },
    ],
    units: {},
    board: config.board,
    activeEffects: [],
    usage: { counts: {} },
    setup: {
      rostersLoaded: [false, false],
      rollOff: null,
      attacker: null,
      deployNext: null,
      readyToStart: false,
    },
    pendingMove: null,
    shooting: null,
    charge: null,
    fight: null,
    windowQueue: [],
    pendingDecision: null,
    rng: { seed: config.rngSeed, counter: 0 },
    log: [],
    actionSeq: 0,
    result: null,
  };
}
