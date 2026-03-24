import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DiceRoll, Enhancement, Detachment } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import {
  validateFactionKeywords,
  validatePointsLimit,
  validateStrategicReservesCap,
  validateEnhancements,
  validateWarlord,
  validateArmy,
  validateDeploymentPosition,
} from '../../army-list/armyValidation';
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
  models: Array<{ id: string; x: number; y: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
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
// Phase 30: Army Construction & Validation
// ===============================================

describe('Phase 30: Army Construction & Validation', () => {

  // --- Faction Validation ---

  describe('Faction Validation', () => {
    it('passes when all units share the faction keyword', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'ADEPTUS ASTARTES'],
      });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], {
        keywords: ['VEHICLE', 'ADEPTUS ASTARTES'],
      });
      state = { ...state, playerFactionKeywords: { ...state.playerFactionKeywords, p1: 'ADEPTUS ASTARTES' } };

      const errors = validateFactionKeywords(state, 'p1');
      expect(errors).toHaveLength(0);
    });

    it('fails when a unit is missing the faction keyword', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'ADEPTUS ASTARTES'],
      });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], {
        keywords: ['INFANTRY', 'AELDARI'],
        name: 'Rangers',
      });
      state = { ...state, playerFactionKeywords: { ...state.playerFactionKeywords, p1: 'ADEPTUS ASTARTES' } };

      const errors = validateFactionKeywords(state, 'p1');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Rangers');
      expect(errors[0]).toContain('ADEPTUS ASTARTES');
    });

    it('skips validation when no faction keyword is set', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'ADEPTUS ASTARTES'],
      });

      const errors = validateFactionKeywords(state, 'p1');
      expect(errors).toHaveLength(0);
    });

    it('SET_FACTION_KEYWORD action stores the faction keyword per player', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_FACTION_KEYWORD', payload: { playerId: 'p1', keyword: 'ADEPTUS ASTARTES' } });
      expect(state.playerFactionKeywords['p1']).toBe('ADEPTUS ASTARTES');
    });
  });

  // --- Points Limit ---

  describe('Points Limit', () => {
    it('passes when army total is under the limit', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 100 });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], { points: 150 });
      state = { ...state, pointsLimit: 500 };

      const errors = validatePointsLimit(state, 'p1');
      expect(errors).toHaveLength(0);
    });

    it('fails when army total exceeds the limit', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 300 });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], { points: 250 });
      state = { ...state, pointsLimit: 500 };

      const errors = validatePointsLimit(state, 'p1');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('550');
      expect(errors[0]).toContain('500');
    });

    it('includes enhancement points in total', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 480 });
      state = { ...state, pointsLimit: 500, enhancements: [{ id: 'e1', name: 'Relic', pointsCost: 25 }] };

      const errors = validatePointsLimit(state, 'p1');
      expect(errors).toHaveLength(1); // 480 + 25 = 505 > 500
    });

    it('SET_POINTS_LIMIT action stores the points limit', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_POINTS_LIMIT', payload: { pointsLimit: 2000 } });
      expect(state.pointsLimit).toBe(2000);
    });
  });

  // --- Strategic Reserves Cap ---

  describe('Strategic Reserves Cap', () => {
    it('passes when reserves are within 25% cap', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 300 });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], { points: 100 });
      // u2 in reserves (100pts out of 400 total = 25%, exactly at cap)
      state = {
        ...state,
        reserves: { 'u2': { unitId: 'u2', type: 'strategic', availableFromRound: 2 } },
      };

      const errors = validateStrategicReservesCap(state, 'p1');
      expect(errors).toHaveLength(0);
    });

    it('fails when reserves exceed 25% cap', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 200 });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], { points: 200 });
      // u2 in reserves (200pts out of 400 total = 50%, over 25% cap)
      state = {
        ...state,
        reserves: { 'u2': { unitId: 'u2', type: 'strategic', availableFromRound: 2 } },
      };

      const errors = validateStrategicReservesCap(state, 'p1');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('25%');
    });

    it('blocks Fortifications from Strategic Reserves', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], { points: 400 });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], {
        points: 50,
        keywords: ['FORTIFICATION'],
        name: 'Bunker',
      });
      state = {
        ...state,
        reserves: { 'u2': { unitId: 'u2', type: 'strategic', availableFromRound: 2 } },
      };

      const errors = validateStrategicReservesCap(state, 'p1');
      expect(errors.some(e => e.includes('Fortification'))).toBe(true);
    });
  });

  // --- Enhancement Validation ---

  describe('Enhancement Validation', () => {
    it('passes with valid enhancement assignment', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'CHARACTER'],
      });
      state = {
        ...state,
        enhancements: [{
          id: 'e1',
          name: 'Relic Blade',
          pointsCost: 20,
          assignedToModelId: 'm1',
        }],
      };

      const errors = validateEnhancements(state);
      expect(errors).toHaveLength(0);
    });

    it('fails when same enhancement is used more than once', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = {
        ...state,
        enhancements: [
          { id: 'e1', name: 'Relic', pointsCost: 20, assignedToModelId: 'm1' },
          { id: 'e1', name: 'Relic', pointsCost: 20, assignedToModelId: 'm2' },
        ],
      };

      const errors = validateEnhancements(state);
      expect(errors.some(e => e.includes('more than once'))).toBe(true);
    });

    it('fails when a model has more than one enhancement', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = {
        ...state,
        enhancements: [
          { id: 'e1', name: 'Relic A', pointsCost: 20, assignedToModelId: 'm1' },
          { id: 'e2', name: 'Relic B', pointsCost: 15, assignedToModelId: 'm1' },
        ],
      };

      const errors = validateEnhancements(state);
      expect(errors.some(e => e.includes('more than one enhancement'))).toBe(true);
    });

    it('fails when enhancement is assigned to a non-CHARACTER', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
        name: 'Guardsmen',
      });
      state = {
        ...state,
        enhancements: [{
          id: 'e1',
          name: 'Relic',
          pointsCost: 20,
          assignedToModelId: 'm1',
        }],
      };

      const errors = validateEnhancements(state);
      expect(errors.some(e => e.includes('CHARACTER'))).toBe(true);
    });

    it('ASSIGN_ENHANCEMENT action adds enhancement to state', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = gameReducer(state, {
        type: 'ASSIGN_ENHANCEMENT',
        payload: {
          enhancement: { id: 'e1', name: 'Iron Halo', pointsCost: 25 },
          modelId: 'm1',
        },
      });

      expect(state.enhancements).toHaveLength(1);
      expect(state.enhancements[0].name).toBe('Iron Halo');
      expect(state.enhancements[0].assignedToModelId).toBe('m1');
    });

    it('REMOVE_ENHANCEMENT action removes enhancement from state', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = gameReducer(state, {
        type: 'ASSIGN_ENHANCEMENT',
        payload: {
          enhancement: { id: 'e1', name: 'Iron Halo', pointsCost: 25 },
          modelId: 'm1',
        },
      });
      expect(state.enhancements).toHaveLength(1);

      state = gameReducer(state, { type: 'REMOVE_ENHANCEMENT', payload: { enhancementId: 'e1' } });
      expect(state.enhancements).toHaveLength(0);
    });
  });

  // --- Warlord Designation ---

  describe('Warlord Designation', () => {
    it('stores warlord model ID', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = gameReducer(state, { type: 'DESIGNATE_WARLORD', payload: { modelId: 'm1' } });
      expect(state.warlordModelId).toBe('m1');
    });

    it('validation passes for CHARACTER warlord', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'CHARACTER'],
      });
      state = { ...state, warlordModelId: 'm1' };

      const errors = validateWarlord(state, 'p1');
      expect(errors).toHaveLength(0);
    });

    it('validation fails when warlord is not a CHARACTER but army has CHARACTERs', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 15, y: 10 }], {
        keywords: ['CHARACTER'],
      });
      state = { ...state, warlordModelId: 'm1' };

      const errors = validateWarlord(state, 'p1');
      expect(errors.some(e => e.includes('CHARACTER'))).toBe(true);
    });

    it('validation warns when no warlord is designated', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });

      const errors = validateWarlord(state, 'p1');
      expect(errors.some(e => e.includes('No Warlord'))).toBe(true);
    });
  });

  // --- Detachment Selection ---

  describe('Detachment Selection', () => {
    it('SELECT_DETACHMENT stores the detachment per player', () => {
      let state = setupTwoPlayerGame();
      const detachment: Detachment = {
        id: 'gladius',
        name: 'Gladius Task Force',
        factionId: 'space-marines',
        rules: 'Oath of Moment: select one enemy unit at the start of each turn',
      };
      state = gameReducer(state, { type: 'SELECT_DETACHMENT', payload: { playerId: 'p1', detachment } });

      expect(state.playerDetachments['p1']).toBeDefined();
      expect(state.playerDetachments['p1'].name).toBe('Gladius Task Force');
      expect(state.playerDetachments['p1'].id).toBe('gladius');
    });
  });

  // --- Combined Army Validation ---

  describe('Combined Army Validation (VALIDATE_ARMY action)', () => {
    it('logs validation success when army is valid', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY', 'CHARACTER', 'ADEPTUS ASTARTES'],
        points: 100,
      });
      state = { ...state, playerFactionKeywords: { ...state.playerFactionKeywords, p1: 'ADEPTUS ASTARTES' }, pointsLimit: 500, warlordModelId: 'm1' };

      state = gameReducer(state, { type: 'VALIDATE_ARMY', payload: { playerId: 'p1' } });

      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('passed');
      }
    });

    it('logs validation errors when army has issues', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
        points: 600,
      });
      state = { ...state, pointsLimit: 500, warlordModelId: 'm1' };

      state = gameReducer(state, { type: 'VALIDATE_ARMY', payload: { playerId: 'p1' } });

      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('issue');
      }
    });
  });

  // --- Setup Phase State Machine ---

  describe('Setup Phase State Machine', () => {
    it('starts at muster phase', () => {
      const state = createInitialGameState();
      expect(state.setupPhase).toBe('muster');
    });

    it('advances through setup phases in order', () => {
      let state = createInitialGameState();
      expect(state.setupPhase).toBe('muster');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('createBattlefield');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('determineRoles');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('placeObjectives');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('deploy');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('redeployments');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('determineFirstTurn');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('scoutMoves');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('ready');
    });

    it('does not advance past ready', () => {
      let state = createInitialGameState();
      // Advance to ready
      for (let i = 0; i < 8; i++) {
        state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      }
      expect(state.setupPhase).toBe('ready');

      // Try to advance past ready
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('ready');
    });
  });
});
