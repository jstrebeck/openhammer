import type {
  BoardState,
  GameState,
  ModelState,
  PlayerIndex,
  PlayerState,
  UnitState,
  WeaponProfile,
} from '@openhammer/core';

/** Minimal-but-complete GameState builders for component tests. */

export function makePlayer(index: PlayerIndex, name: string): PlayerState {
  return {
    index,
    name,
    factionId: 'test',
    detachmentId: 'test',
    cp: 3,
    extraCpThisRound: 0,
    vp: 0,
    vpLog: [],
    stratagemsUsedThisPhase: [],
    paintedArmy: false,
  };
}

export function makeBoard(): BoardState {
  return {
    width: 60,
    height: 44,
    terrain: [],
    objectives: [{ id: 'obj-center', position: { x: 30, y: 22 } }],
    deploymentZones: [
      {
        player: 0,
        polygon: [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 12 },
          { x: 0, y: 12 },
        ],
      },
      {
        player: 1,
        polygon: [
          { x: 0, y: 32 },
          { x: 60, y: 32 },
          { x: 60, y: 44 },
          { x: 0, y: 44 },
        ],
      },
    ],
  };
}

export function makeModel(id: string, overrides: Partial<ModelState> = {}): ModelState {
  return {
    id,
    profileId: 'default',
    position: { x: 10, y: 10 },
    woundsRemaining: 1,
    destroyed: false,
    hasTakenWoundsThisPhase: false,
    ...overrides,
  };
}

export function makeWeapon(id: string, overrides: Partial<WeaponProfile> = {}): WeaponProfile {
  return {
    id,
    name: id,
    kind: 'ranged',
    range: 24,
    attacks: '1',
    skill: 4,
    strength: 4,
    ap: 0,
    damage: '1',
    abilities: [],
    ...overrides,
  };
}

export function makeUnit(
  id: string,
  owner: PlayerIndex,
  overrides: Partial<UnitState> = {},
): UnitState {
  const models = overrides.models ?? [
    makeModel(`${id}-m0`, { position: { x: 10 + owner * 20, y: 10 } }),
    makeModel(`${id}-m1`, { position: { x: 11.5 + owner * 20, y: 10 } }),
  ];
  const weapons = overrides.weapons ?? {};
  const loadout =
    overrides.loadout ??
    Object.fromEntries(models.map((m) => [m.id, Object.keys(weapons)]));
  return {
    id,
    owner,
    datasheetId: 'test/sheet',
    name: `Unit ${id}`,
    startingStrength: models.length,
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
    ...overrides,
    models,
    weapons,
    loadout,
  };
}

export function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    contentVersions: {},
    editionId: 'wh40k-10e',
    missionId: 'test-mission',
    deploymentMapId: 'test-map',
    enforcement: {
      movement: 'enforce',
      targeting: 'enforce',
      coherency: 'enforce',
      stratagems: 'enforce',
    },
    phase: 'command',
    step: 'command',
    round: 1,
    activePlayer: 0,
    firstPlayer: 0,
    players: [makePlayer(0, 'Alice'), makePlayer(1, 'Bob')],
    units: {},
    board: makeBoard(),
    activeEffects: [],
    usage: { counts: {} },
    setup: null,
    pendingMove: null,
    shooting: null,
    pendingDecision: null,
    rng: { seed: 1, counter: 0 },
    log: [],
    actionSeq: 0,
    result: null,
    ...overrides,
  };
}
