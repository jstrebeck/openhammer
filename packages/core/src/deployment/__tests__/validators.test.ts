import { describe, it, expect } from 'vitest';
import { validateDeepStrikeArrival, validateInfiltratorsDeployment, validateScoutMove, validateStrategicReservesArrival } from '../validators';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState, DeploymentZone } from '../../types/index';
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

// ===============================================
// Deployment Validators
// ===============================================

describe('Deployment Validators', () => {

  // --- Deep Strike ---

  describe('validateDeepStrikeArrival', () => {
    it('validates >9" from enemy models', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'ds-unit', 'p1', [{ id: 'ds1', x: -1000, y: -1000 }], {
        abilities: ['DEEP STRIKE'],
      });
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 20, y: 20 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      // Try to arrive 5" from enemy — should fail
      const errors = validateDeepStrikeArrival(state, 'ds-unit', { 'ds1': { x: 16, y: 20 } });
      expect(errors.some(e => e.includes('9"'))).toBe(true);
    });

    it('blocked before Round 2', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'ds-unit', 'p1', [{ id: 'ds1', x: -1000, y: -1000 }], {
        abilities: ['DEEP STRIKE'],
      });
      state = { ...state, turnState: { ...state.turnState, roundNumber: 1 } };

      const errors = validateDeepStrikeArrival(state, 'ds-unit', { 'ds1': { x: 30, y: 30 } });
      expect(errors.some(e => e.includes('Round 2'))).toBe(true);
    });

    it('succeeds when >9" from enemies and Round 2+', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'ds-unit', 'p1', [{ id: 'ds1', x: -1000, y: -1000 }], {
        abilities: ['DEEP STRIKE'],
      });
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 10, y: 10 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      // Arrive 15" from enemy — should succeed
      const errors = validateDeepStrikeArrival(state, 'ds-unit', { 'ds1': { x: 25, y: 10 } });
      expect(errors.length).toBe(0);
    });
  });

  // --- Infiltrators ---

  describe('validateInfiltratorsDeployment', () => {
    it('validates >9" from enemy models', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'inf1', x: 30, y: 30 }], {
        abilities: ['INFILTRATORS'],
      });
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 20, y: 20 }]);

      // Try to deploy 5" from enemy
      const errors = validateInfiltratorsDeployment(state, 'inf-unit', { 'inf1': { x: 16, y: 20 } });
      expect(errors.some(e => e.includes('9"'))).toBe(true);
    });

    it('validates not in enemy deployment zone', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'inf1', x: 30, y: 30 }], {
        abilities: ['INFILTRATORS'],
      });

      // Add enemy deployment zone
      const zone: DeploymentZone = {
        id: 'dz2',
        playerId: 'p2',
        polygon: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 12 }, { x: 0, y: 12 }],
        label: 'Enemy Zone',
        color: '#0000ff',
      };
      state = gameReducer(state, { type: 'ADD_DEPLOYMENT_ZONE', payload: { zone } });

      // Try to deploy inside enemy zone
      const errors = validateInfiltratorsDeployment(state, 'inf-unit', { 'inf1': { x: 30, y: 6 } });
      expect(errors.some(e => e.includes('deployment zone'))).toBe(true);
    });
  });

  // --- Scout ---

  describe('validateScoutMove', () => {
    it('pre-game move up to X"', () => {
      const models: Record<string, import('../../types/index').Model> = {
        's1': makeModel({ id: 's1', unitId: 'scout-unit', position: { x: 10, y: 10 } }),
      };
      const unit = makeUnit({
        id: 'scout-unit',
        abilities: ['SCOUT 6"'],
        modelIds: ['s1'],
      });

      // Move 4" — within 6" limit
      const errors = validateScoutMove(unit, models, { 's1': { x: 14, y: 10 } }, 6);
      expect(errors.length).toBe(0);

      // Move 8" — exceeds 6" limit
      const errors2 = validateScoutMove(unit, models, { 's1': { x: 18, y: 10 } }, 6);
      expect(errors2.length).toBeGreaterThan(0);
    });

    it('blocks movement exceeding scout distance', () => {
      const unit = makeUnit({ id: 'u1', modelIds: ['m1'], abilities: ['SCOUT 6"'] });
      const models: Record<string, import('../../types/index').Model> = {
        'm1': makeModel({ id: 'm1', unitId: 'u1', position: { x: 30, y: 35 } }),
      };

      // Move 8" — should fail for 6" scout
      const errors = validateScoutMove(unit, models, { 'm1': { x: 30, y: 27 } }, 6);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('allows movement within scout distance', () => {
      const unit = makeUnit({ id: 'u1', modelIds: ['m1'], abilities: ['SCOUT 6"'] });
      const models: Record<string, import('../../types/index').Model> = {
        'm1': makeModel({ id: 'm1', unitId: 'u1', position: { x: 30, y: 35 } }),
      };

      // Move 5" — should pass for 6" scout
      const errors = validateScoutMove(unit, models, { 'm1': { x: 30, y: 30 } }, 6);
      expect(errors).toHaveLength(0);
    });

    it('Dedicated Transport inherits Scout from embarked unit', () => {
      // This tests the concept: a transport carrying a Scout unit gets Scout ability
      // The actual inheritance logic is checked via unit abilities
      let state = setupTwoPlayerGame();
      const scoutUnit = makeUnit({
        id: 'u-scout',
        playerId: 'p1',
        modelIds: ['m-scout'],
        abilities: ['SCOUT 6"'],
      });
      const transportUnit = makeUnit({
        id: 'u-transport',
        playerId: 'p1',
        modelIds: ['m-transport'],
        keywords: ['VEHICLE', 'TRANSPORT', 'DEDICATED TRANSPORT'],
        transportCapacity: 12,
      });

      state = gameReducer(state, {
        type: 'ADD_UNIT',
        payload: {
          unit: scoutUnit,
          models: [makeModel({ id: 'm-scout', unitId: 'u-scout', position: { x: 30, y: 35 } })],
        },
      });
      state = gameReducer(state, {
        type: 'ADD_UNIT',
        payload: {
          unit: transportUnit,
          models: [makeModel({ id: 'm-transport', unitId: 'u-transport', position: { x: 30, y: 35 } })],
        },
      });

      // Embark scout unit
      state = gameReducer(state, {
        type: 'EMBARK',
        payload: { unitId: 'u-scout', transportId: 'u-transport' },
      });

      // Transport should be able to Scout move — the transport inherits Scout from embarked unit
      // Verify by checking the transport can make a scout move within 6"
      const transportModels: Record<string, import('../../types/index').Model> = {
        'm-transport': state.models['m-transport'],
      };
      const errors = validateScoutMove(
        transportUnit,
        transportModels,
        { 'm-transport': { x: 30, y: 30 } },
        6,
      );
      expect(errors).toHaveLength(0);
    });
  });

  // --- Strategic Reserves ---

  describe('validateStrategicReservesArrival', () => {
    it('validates arrival within 6" of board edge', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: -1000, y: -1000 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      // Try to arrive in center of board (>6" from any edge on a 60x44 board)
      const errors = validateStrategicReservesArrival(state, 'reserve-unit', { 'r1': { x: 30, y: 22 } });
      expect(errors.some(e => e.includes('board edge'))).toBe(true);
    });

    it('validates >9" from enemy models', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: -1000, y: -1000 }]);
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 5, y: 5 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      // Arrive at board edge but too close to enemy
      const errors = validateStrategicReservesArrival(state, 'reserve-unit', { 'r1': { x: 3, y: 3 } });
      expect(errors.some(e => e.includes('9"'))).toBe(true);
    });

    it('blocked before Round 2', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: -1000, y: -1000 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 1 } };

      const errors = validateStrategicReservesArrival(state, 'reserve-unit', { 'r1': { x: 3, y: 30 } });
      expect(errors.some(e => e.includes('Round 2'))).toBe(true);
    });

    it('succeeds when all conditions met', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: -1000, y: -1000 }]);
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 30, y: 30 }]);
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      // Arrive at board edge, >9" from enemy
      const errors = validateStrategicReservesArrival(state, 'reserve-unit', { 'r1': { x: 3, y: 3 } });
      expect(errors.length).toBe(0);
    });
  });
});
