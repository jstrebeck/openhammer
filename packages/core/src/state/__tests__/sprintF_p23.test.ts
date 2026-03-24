import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DeploymentZone } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { unitHasStealth, unitHasAbility, getUnitAbilityValue, parseWeaponAbility } from '../../combat/abilities';
import { resolveAttackSequence } from '../../combat/attackPipeline';
// getAttachedUnitWoundTarget moved to combat/__tests__/woundAllocation.test.ts
import { validateDeepStrikeArrival, validateInfiltratorsDeployment, validateScoutMove, validateStrategicReservesArrival } from '../../deployment/validators';
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
// Phase 23: Unit Abilities & Attached Units
// ===============================================

describe('Phase 23: Unit Abilities & Attached Units', () => {

  // --- Deadly Demise ---

  describe('Deadly Demise', () => {
    it('on destruction, rolls D6 and inflicts mortal wounds on 6', () => {
      let state = setupTwoPlayerGame();

      // Destroyed vehicle at (10,10), enemy within 6" at (14,10)
      state = addUnit(state, 'vehicle', 'p1', [{ id: 'v1', x: 10, y: 10 }], {
        name: 'Leman Russ',
        keywords: ['VEHICLE'],
        abilities: ['DEADLY DEMISE D3'],
      });
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 14, y: 10, wounds: 3, maxWounds: 3 }]);

      // Roll a 6 — mortal wounds triggered (say 2 mortal wounds from D3)
      const result = gameReducer(state, {
        type: 'RESOLVE_DEADLY_DEMISE',
        payload: {
          unitId: 'vehicle',
          roll: { id: 'r1', dice: [6], sides: 6, purpose: 'Deadly Demise', timestamp: Date.now() },
          mortalWounds: 2,
        },
      });

      // Enemy should have taken 2 mortal wounds (3 - 2 = 1 wound remaining)
      expect(result.models['e1'].wounds).toBe(1);
    });

    it('no mortal wounds on non-6 roll', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'vehicle', 'p1', [{ id: 'v1', x: 10, y: 10 }], {
        name: 'Leman Russ',
        abilities: ['DEADLY DEMISE D3'],
      });
      state = addUnit(state, 'enemy', 'p2', [{ id: 'e1', x: 14, y: 10, wounds: 3, maxWounds: 3 }]);

      const result = gameReducer(state, {
        type: 'RESOLVE_DEADLY_DEMISE',
        payload: {
          unitId: 'vehicle',
          roll: { id: 'r1', dice: [3], sides: 6, purpose: 'Deadly Demise', timestamp: Date.now() },
          mortalWounds: 0,
        },
      });

      expect(result.models['e1'].wounds).toBe(3); // Unchanged
    });
  });

  // --- Deep Strike ---

  describe('Deep Strike', () => {
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

  describe('Infiltrators', () => {
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

  describe('Scout', () => {
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

    it('SCOUT_MOVE action applies positions', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'scout-unit', 'p1', [{ id: 's1', x: 10, y: 10 }], {
        abilities: ['SCOUT 6"'],
      });

      const result = gameReducer(state, {
        type: 'SCOUT_MOVE',
        payload: { unitId: 'scout-unit', positions: { 's1': { x: 14, y: 10 } } },
      });

      expect(result.models['s1'].position).toEqual({ x: 14, y: 10 });
    });
  });

  // --- Stealth ---

  describe('Stealth', () => {
    it('unitHasStealth returns true for units with STEALTH ability', () => {
      const unit = makeUnit({ abilities: ['STEALTH'] });
      expect(unitHasStealth(unit)).toBe(true);
    });

    it('unitHasStealth returns false without STEALTH', () => {
      const unit = makeUnit({ abilities: [] });
      expect(unitHasStealth(unit)).toBe(false);
    });

    it('-1 to Hit for ranged attacks vs Stealth is implied by hit modifier system', () => {
      // Stealth is a target-side modifier that callers apply externally
      // The combat system supports hit modifiers via AttackContext
      // Here we verify the unit ability detection works correctly
      const unit = makeUnit({ abilities: ['STEALTH'] });
      expect(unitHasAbility(unit, 'STEALTH')).toBe(true);
    });
  });

  // --- Leader & Attached Units ---

  describe('Attached Units (Leader + Bodyguard)', () => {
    it('Leader attaches to Bodyguard unit', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'leader', 'p1', [{ id: 'l1', x: 10, y: 10 }], {
        name: 'Captain',
        keywords: ['INFANTRY', 'CHARACTER'],
      });
      state = addUnit(state, 'bodyguard', 'p1', [
        { id: 'bg1', x: 11, y: 10 },
        { id: 'bg2', x: 12, y: 10 },
      ], {
        name: 'Intercessors',
        keywords: ['INFANTRY'],
      });

      const result = gameReducer(state, {
        type: 'ATTACH_LEADER',
        payload: { leaderUnitId: 'leader', bodyguardUnitId: 'bodyguard' },
      });

      expect(result.attachedUnits['leader']).toBe('bodyguard');
    });

    it('non-CHARACTER cannot be Leader', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'notleader', 'p1', [{ id: 'nl1', x: 10, y: 10 }], {
        name: 'Marine',
        keywords: ['INFANTRY'], // No CHARACTER
      });
      state = addUnit(state, 'bodyguard', 'p1', [{ id: 'bg1', x: 11, y: 10 }]);

      const result = gameReducer(state, {
        type: 'ATTACH_LEADER',
        payload: { leaderUnitId: 'notleader', bodyguardUnitId: 'bodyguard' },
      });

      expect(result.attachedUnits['notleader']).toBeUndefined();
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('CHARACTER')
      )).toBe(true);
    });

    // Wound allocation tests (Bodyguard absorbs, Precision overrides) moved to combat/__tests__/woundAllocation.test.ts
  });

  // --- Strategic Reserves ---

  describe('Strategic Reserves', () => {
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
