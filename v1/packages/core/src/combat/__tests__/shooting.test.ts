import { describe, it, expect } from 'vitest';
import { canUnitShootWithAbilities, isUnitInEngagementRange, getEngagedEnemyUnits, getEngagementShootingMode } from '../shooting';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState, Weapon } from '../../types/index';
import '../../editions/index';

// ===== Test Helpers =====

function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000', commandPoints: 5 });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff', commandPoints: 5 });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
  state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };
  return state;
}

function addUnit(
  state: GameState,
  unitId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
    }),
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

const bolter: Weapon = {
  id: 'w-bolter', name: 'Bolt Rifle', type: 'ranged', range: 24,
  attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1, abilities: [],
};

const pistol: Weapon = {
  id: 'w-pistol', name: 'Bolt Pistol', type: 'ranged', range: 12,
  attacks: 1, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['PISTOL'],
};

// ===============================================
// Assault weapon ability (from sprintC)
// ===============================================

describe('Assault weapon ability', () => {
  it('canUnitShootWithAbilities: allows Assault weapons after Advance', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Assault Bolter', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['ASSAULT'] },
    ];
    const result = canUnitShootWithAbilities('advance', weapons);
    expect(result.allowed).toBe(true);
    expect(result.assaultOnly).toBe(true);
  });

  it('canUnitShootWithAbilities: blocks non-Assault weapons after Advance', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Heavy Bolter', type: 'ranged', range: 36, attacks: 3, skill: 4, strength: 5, ap: -1, damage: 2, abilities: ['HEAVY'] },
    ];
    const result = canUnitShootWithAbilities('advance', weapons);
    expect(result.allowed).toBe(false);
  });

  it('canUnitShootWithAbilities: always blocks after Fall Back', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Assault Bolter', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['ASSAULT'] },
    ];
    const result = canUnitShootWithAbilities('fall_back', weapons);
    expect(result.allowed).toBe(false);
  });

  it('canUnitShootWithAbilities: allows normal move', () => {
    const result = canUnitShootWithAbilities('normal', []);
    expect(result.allowed).toBe(true);
  });
});

// ===============================================
// Big Guns Never Tire (from sprintF_p22)
// ===============================================

describe('Big Guns Never Tire', () => {
  it('VEHICLE in ER can only target engaged units (Big Guns targeting restriction)', () => {
    const unit = makeUnit({
      id: 'vehicle',
      playerId: 'p1',
      keywords: ['VEHICLE'],
      weapons: [bolter],
    });

    const mode = getEngagementShootingMode(unit);
    expect(mode).toBe('big_guns');
  });
});

// ===============================================
// Pistols (from sprintF_p22)
// ===============================================

describe('Pistols', () => {
  it('getEngagementShootingMode identifies pistol mode correctly', () => {
    const unit = makeUnit({
      keywords: ['INFANTRY'],
      weapons: [pistol],
    });
    expect(getEngagementShootingMode(unit)).toBe('pistols');
  });

  it('MONSTER/VEHICLE with Pistols gets both mode', () => {
    const unit = makeUnit({
      keywords: ['VEHICLE'],
      weapons: [pistol, bolter],
    });
    expect(getEngagementShootingMode(unit)).toBe('both');
  });
});

// ===============================================
// Engagement range helpers (from sprintF_p22)
// ===============================================

describe('Engagement range helpers', () => {
  it('isUnitInEngagementRange detects engaged unit', () => {
    let state = setupTwoPlayerGame();
    // Units within 1" (engagement range)
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11, y: 10 }]);

    const unit = state.units['u1'];
    expect(isUnitInEngagementRange(unit, state, 1)).toBe(true);
  });

  it('getEngagedEnemyUnits returns engaged enemy unit IDs', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11, y: 10 }]);
    state = addUnit(state, 'u3', 'p2', [{ id: 'm3', x: 30, y: 10 }]); // Far away

    const engaged = getEngagedEnemyUnits(state.units['u1'], state, 1);
    expect(engaged).toContain('u2');
    expect(engaged).not.toContain('u3');
  });
});
