import type { Model, Unit, Player, ModelStats } from './types/index';

export const DEFAULT_STATS: ModelStats = {
  move: 6,
  toughness: 4,
  save: 3,
  wounds: 2,
  leadership: 6,
  objectiveControl: 2,
};

export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'model-1',
    unitId: 'unit-1',
    name: 'Marine',
    position: { x: 10, y: 10 },
    baseSizeMm: 32,
    baseSizeInches: 32 / 25.4,
    baseShape: { type: 'circle', diameterMm: 32 },
    facing: 0,
    wounds: 2,
    maxWounds: 2,
    moveCharacteristic: 6,
    stats: { ...DEFAULT_STATS },
    status: 'active',
    ...overrides,
  };
}

export function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    name: 'Intercessors',
    playerId: 'player-1',
    modelIds: ['model-1'],
    keywords: ['INFANTRY'],
    abilities: [],
    weapons: [],
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    name: 'Player 1',
    color: '#3b82f6',
    commandPoints: 0,
    ...overrides,
  };
}

export function makeTransport(overrides: Partial<Unit> = {}): Unit {
  return makeUnit({
    name: 'Rhino',
    keywords: ['VEHICLE', 'TRANSPORT'],
    transportCapacity: 12,
    ...overrides,
  });
}

export function makeAircraftUnit(overrides: Partial<Unit> = {}): Unit {
  return makeUnit({
    name: 'Stormraven',
    keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
    ...overrides,
  });
}
