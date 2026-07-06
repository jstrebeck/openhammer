import type { CoreParameters, Datasheet, EditionDef } from './types/content.js';
import type { GameState, PlayerState, UnitState } from './types/state.js';
import type { ContentAccess, HookContext } from './effects/context.js';
import type { ReducerEnv, RulesContent } from './state/env.js';

/** 10e-shaped parameters for tests (mirrors edition.json values). */
export const testParams: CoreParameters = {
  engagementRangeHorizontal: 1,
  engagementRangeVertical: 5,
  coherencyDistanceHorizontal: 2,
  coherencyDistanceVertical: 5,
  coherencyTwoNeighboursAt: 7,
  objectiveControlRangeHorizontal: 3,
  objectiveControlRangeVertical: 5,
  chargeRange: 12,
  pileInDistance: 3,
  consolidateDistance: 3,
  modifierCaps: { hit: 1, wound: 1, saveImprovement: 1 },
  coverIneligibleSaveAtOrBelow: 3,
  cpPerCommandPhase: 1,
  maxExtraCpPerRound: 1,
  battleShockDice: '2D6',
  desperateEscapeFailOn: 2,
  deepStrikeDistance: 9,
  reservesMaxPointsFraction: 0.25,
  defaultCriticalHitOn: 6,
  defaultCriticalWoundOn: 6,
};

export function makePlayer(index: 0 | 1): PlayerState {
  return {
    index,
    name: `Player ${index + 1}`,
    factionId: `faction-${index}`,
    detachmentId: `detachment-${index}`,
    cp: 0,
    extraCpThisRound: 0,
    vp: 0,
    vpLog: [],
    stratagemsUsedThisPhase: [],
    paintedArmy: false,
  };
}

export function makeUnit(partial: Partial<UnitState> & Pick<UnitState, 'id' | 'owner'>): UnitState {
  return {
    datasheetId: 'test-datasheet',
    name: partial.id,
    models: [],
    startingStrength: partial.models?.length ?? 1,
    loadout: {},
    weapons: {},
    battleShocked: false,
    tokens: [],
    reserves: 'none',
    embarkedIn: null,
    attachedTo: null,
    leaderOf: null,
    enhancementId: null,
    isWarlord: false,
    oneShotFired: [],
    turnFlags: {
      moveKind: null,
      advanceRoll: null,
      chargeRoll: null,
      chargeTargets: [],
      hasShot: false,
      hasFought: false,
      fightsFirst: false,
      arrivedFromReserves: false,
    },
    ...partial,
  };
}

export function makeState(partial: Partial<GameState> = {}): GameState {
  return {
    contentVersions: {},
    editionId: 'test-edition',
    missionId: 'test-mission',
    deploymentMapId: 'test-map',
    enforcement: { movement: 'enforce', targeting: 'enforce', coherency: 'enforce', stratagems: 'enforce' },
    phase: 'shooting',
    step: null,
    round: 1,
    activePlayer: 0,
    firstPlayer: 0,
    players: [makePlayer(0), makePlayer(1)],
    units: {},
    board: { width: 60, height: 44, terrain: [], objectives: [], deploymentZones: [] },
    activeEffects: [],
    usage: { counts: {} },
    setup: null,
    pendingMove: null,
    shooting: null,
    charge: null,
    fight: null,
    windowQueue: [],
    pendingDecision: null,
    rng: { seed: 1, counter: 0 },
    log: [],
    actionSeq: 0,
    result: null,
    ...partial,
  };
}

export function makeContentAccess(datasheets: Record<string, Datasheet> = {}): ContentAccess {
  return {
    getDatasheet: (id) => datasheets[id],
    getUnitKeywords: (state, unitId) => {
      const unit = state.units[unitId];
      if (!unit) return [];
      const ds = datasheets[unit.datasheetId];
      return [...(ds?.keywords ?? []), ...(ds?.factionKeywords ?? []), ...unit.tokens];
    },
  };
}

/** A 10e-shaped test edition matching the real pack's phase structure. */
export const testEdition: EditionDef = {
  id: 'test-edition',
  name: 'Test Edition',
  version: 'test',
  schemaVersion: 1,
  battleRounds: 5,
  phases: [
    {
      id: 'command',
      name: 'Command Phase',
      kind: 'command',
      steps: [
        { id: 'command', name: 'Command', kind: 'command' },
        { id: 'battleShock', name: 'Battle-shock', kind: 'battleShock' },
      ],
    },
    {
      id: 'movement',
      name: 'Movement Phase',
      kind: 'movement',
      steps: [
        { id: 'moveUnits', name: 'Move Units', kind: 'moveUnits' },
        { id: 'reinforcements', name: 'Reinforcements', kind: 'reinforcements' },
      ],
    },
    {
      id: 'shooting',
      name: 'Shooting Phase',
      kind: 'shooting',
      steps: [{ id: 'shoot', name: 'Shoot', kind: 'shoot' }],
    },
    {
      id: 'charge',
      name: 'Charge Phase',
      kind: 'charge',
      steps: [{ id: 'charge', name: 'Charge', kind: 'charge' }],
    },
    {
      id: 'fight',
      name: 'Fight Phase',
      kind: 'fight',
      steps: [
        { id: 'fightsFirst', name: 'Fights First', kind: 'fightsFirst' },
        { id: 'remainingCombats', name: 'Remaining Combats', kind: 'remainingCombats' },
      ],
    },
  ],
  parameters: testParams,
};

export function makeRulesContent(
  overrides: Partial<RulesContent> & { datasheets?: Record<string, Datasheet> } = {},
): RulesContent {
  const { datasheets, ...rest } = overrides;
  const access = makeContentAccess(datasheets ?? {});
  return {
    edition: testEdition,
    getDatasheet: access.getDatasheet,
    getUnitKeywords: access.getUnitKeywords,
    getWeaponAbility: () => ({ effects: [], flags: [] }),
    getCoreAbility: () => ({ effects: [] }),
    effectOrder: {},
    ...rest,
  };
}

export function makeEnv(
  overrides: Partial<RulesContent> & { datasheets?: Record<string, Datasheet> } = {},
): ReducerEnv {
  return { content: makeRulesContent(overrides) };
}

export function makeContext(partial: Partial<HookContext> = {}): HookContext {
  const state = partial.state ?? makeState();
  return {
    state,
    content: makeContentAccess(),
    activePlayer: state.activePlayer,
    phase: state.phase,
    ...partial,
  };
}
