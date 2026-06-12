import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { rollDice } from '../../dice/index';
import '../../editions/index';

function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000', commandPoints: 0 });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff', commandPoints: 0 });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
  state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };
  return state;
}

function addUnit(
  state: GameState,
  unitId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number; leadership?: number; oc?: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
      stats: {
        move: 6,
        toughness: 4,
        save: 3,
        wounds: m.maxWounds ?? 2,
        leadership: m.leadership ?? 6,
        objectiveControl: m.oc ?? 2,
      },
    }),
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    startingStrength: models.length,
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

// ===============================================
// Phase 12: Command Phase & Battle-shock
// ===============================================

describe('Phase 12: Command Phase & Battle-shock', () => {
  describe('START_COMMAND_PHASE', () => {
    it('grants both players 1 CP', () => {
      let state = setupTwoPlayerGame();
      expect(state.players['p1'].commandPoints).toBe(0);
      expect(state.players['p2'].commandPoints).toBe(0);

      state = gameReducer(state, { type: 'START_COMMAND_PHASE' });

      expect(state.players['p1'].commandPoints).toBe(1);
      expect(state.players['p2'].commandPoints).toBe(1);
    });

    it('logs CP gain for each player', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'START_COMMAND_PHASE' });

      const cpLogs = state.log.entries.filter((e) => e.type === 'cp_change');
      expect(cpLogs).toHaveLength(2);
    });

    it('clears battle-shocked status for active player units', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 30, y: 10 }]);

      // Battle-shock both units
      state = { ...state, battleShocked: ['u1', 'u2'] };

      // Active player is p1, so p1's units should clear
      state = gameReducer(state, { type: 'START_COMMAND_PHASE' });

      expect(state.battleShocked).not.toContain('u1');
      expect(state.battleShocked).toContain('u2'); // p2's unit stays shocked
    });
  });

  describe('Below Half-strength detection', () => {
    it('multi-model unit: below half when fewer than half starting strength remain', () => {
      let state = setupTwoPlayerGame();
      // 4 model unit, kill 3 → 1 active = below half of 4
      state = addUnit(state, 'u1', 'p1', [
        { id: 'm1', x: 10, y: 10 },
        { id: 'm2', x: 11, y: 10 },
        { id: 'm3', x: 12, y: 10 },
        { id: 'm4', x: 13, y: 10 },
      ]);

      // Destroy 3 models
      state = gameReducer(state, { type: 'SET_MODEL_WOUNDS', payload: { modelId: 'm2', wounds: 0 } });
      state = gameReducer(state, { type: 'SET_MODEL_WOUNDS', payload: { modelId: 'm3', wounds: 0 } });
      state = gameReducer(state, { type: 'SET_MODEL_WOUNDS', payload: { modelId: 'm4', wounds: 0 } });

      const unit = state.units['u1'];
      const activeModels = unit.modelIds.filter((id) => state.models[id]?.status === 'active');
      const startStr = unit.startingStrength ?? unit.modelIds.length;

      expect(activeModels.length).toBe(1);
      expect(activeModels.length < startStr / 2).toBe(true);
    });

    it('single model unit: below half when wounds < half max', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, wounds: 3, maxWounds: 10 }]);

      const model = state.models['m1'];
      expect(model.wounds < model.maxWounds / 2).toBe(true);
    });
  });

  describe('RESOLVE_BATTLE_SHOCK', () => {
    it('passes when 2D6 >= Leadership', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, leadership: 6 }]);

      // Simulate passing roll (total >= 6)
      const roll = { ...rollDice(2, 6, 'Battle-shock'), dice: [4, 3] }; // total = 7
      state = gameReducer(state, {
        type: 'RESOLVE_BATTLE_SHOCK',
        payload: { unitId: 'u1', roll, passed: true },
      });

      expect(state.battleShocked).not.toContain('u1');
      const passLog = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('passes Battle-shock'),
      );
      expect(passLog).toBeDefined();
    });

    it('fails when 2D6 < Leadership — unit becomes battle-shocked', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, leadership: 6 }]);

      const roll = { ...rollDice(2, 6, 'Battle-shock'), dice: [2, 2] }; // total = 4
      state = gameReducer(state, {
        type: 'RESOLVE_BATTLE_SHOCK',
        payload: { unitId: 'u1', roll, passed: false },
      });

      expect(state.battleShocked).toContain('u1');
      const failLog = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('fails Battle-shock'),
      );
      expect(failLog).toBeDefined();
    });

    it('does not duplicate unit ID if already battle-shocked', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['u1'] };

      const roll = rollDice(2, 6, 'Battle-shock');
      state = gameReducer(state, {
        type: 'RESOLVE_BATTLE_SHOCK',
        payload: { unitId: 'u1', roll, passed: false },
      });

      expect(state.battleShocked.filter((id) => id === 'u1')).toHaveLength(1);
    });
  });

  describe('Battle-shocked effects', () => {
    it('battle-shocked status persists across phases until cleared', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['u1'] };

      // Advance through several phases
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // movement
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // shooting

      expect(state.battleShocked).toContain('u1');
    });

    it('battle-shocked persists across NEXT_TURN', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['u1'] };

      state = gameReducer(state, { type: 'NEXT_TURN' });

      // Should still be shocked — cleared by START_COMMAND_PHASE, not NEXT_TURN
      expect(state.battleShocked).toContain('u1');
    });
  });
});

// ===============================================
// Phase 14: Objective Control & Scoring
// ===============================================

describe('Phase 14: Objective Control & Scoring', () => {
  describe('CALCULATE_OBJECTIVE_CONTROL', () => {
    it('assigns control to player with higher OC total', () => {
      let state = setupTwoPlayerGame();

      // Place an objective
      state = gameReducer(state, {
        type: 'PLACE_OBJECTIVE',
        payload: {
          objective: { id: 'obj1', position: { x: 30, y: 22 }, number: 1 },
        },
      });

      // P1: 2 models near objective (OC 2 each = 4 total)
      state = addUnit(state, 'u1', 'p1', [
        { id: 'm1', x: 30, y: 22, oc: 2 },
        { id: 'm2', x: 31, y: 22, oc: 2 },
      ]);

      // P2: 1 model near objective (OC 2 = 2 total)
      state = addUnit(state, 'u2', 'p2', [{ id: 'm3', x: 29, y: 22, oc: 2 }]);

      state = gameReducer(state, { type: 'CALCULATE_OBJECTIVE_CONTROL' });

      expect(state.objectives['obj1'].controllingPlayerId).toBe('p1');
    });

    it('objective is contested when OC totals are tied', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'PLACE_OBJECTIVE',
        payload: {
          objective: { id: 'obj1', position: { x: 30, y: 22 }, number: 1 },
        },
      });

      // Both have OC 2
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 22, oc: 2 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 31, y: 22, oc: 2 }]);

      state = gameReducer(state, { type: 'CALCULATE_OBJECTIVE_CONTROL' });

      expect(state.objectives['obj1'].controllingPlayerId).toBeUndefined();
    });

    it('battle-shocked models have effective OC of 0', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'PLACE_OBJECTIVE',
        payload: {
          objective: { id: 'obj1', position: { x: 30, y: 22 }, number: 1 },
        },
      });

      // P1: 1 model OC 2 but battle-shocked
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 22, oc: 2 }]);
      // P2: 1 model OC 1
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 31, y: 22, oc: 1 }]);

      state = { ...state, battleShocked: ['u1'] };

      state = gameReducer(state, { type: 'CALCULATE_OBJECTIVE_CONTROL' });

      // P1's OC is 0 (shocked), P2's OC is 1 → P2 controls
      expect(state.objectives['obj1'].controllingPlayerId).toBe('p2');
    });

    it('no control when no models are near the objective', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'PLACE_OBJECTIVE',
        payload: {
          objective: { id: 'obj1', position: { x: 30, y: 22 }, number: 1 },
        },
      });

      // Models far from objective (more than 3")
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5, oc: 2 }]);

      state = gameReducer(state, { type: 'CALCULATE_OBJECTIVE_CONTROL' });

      expect(state.objectives['obj1'].controllingPlayerId).toBeUndefined();
    });

    it('models within 3" are counted', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'PLACE_OBJECTIVE',
        payload: {
          objective: { id: 'obj1', position: { x: 30, y: 22 }, number: 1 },
        },
      });

      // Model just within 3" (accounting for base radius ~0.63")
      // Center at 32.5 → edge at ~31.87 → distance to obj center at 30 = ~1.87" (within 3")
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 32.5, y: 22, oc: 2 }]);

      state = gameReducer(state, { type: 'CALCULATE_OBJECTIVE_CONTROL' });

      expect(state.objectives['obj1'].controllingPlayerId).toBe('p1');
    });
  });

  describe('UPDATE_SCORE', () => {
    it('adds VP to a player', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'UPDATE_SCORE',
        payload: { playerId: 'p1', delta: 5, reason: 'Primary' },
      });

      expect(state.score['p1']).toBe(5);
    });

    it('accumulates VP across multiple scoring events', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'UPDATE_SCORE',
        payload: { playerId: 'p1', delta: 5, reason: 'Primary' },
      });
      state = gameReducer(state, {
        type: 'UPDATE_SCORE',
        payload: { playerId: 'p1', delta: 3, reason: 'Secondary' },
      });

      expect(state.score['p1']).toBe(8);
    });

    it('score cannot go below 0', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'UPDATE_SCORE',
        payload: { playerId: 'p1', delta: -5, reason: 'Penalty' },
      });

      expect(state.score['p1']).toBe(0);
    });

    it('logs the scoring event', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'UPDATE_SCORE',
        payload: { playerId: 'p1', delta: 4, reason: 'Hold objective' },
      });

      const scoreLog = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('scores 4 VP'),
      );
      expect(scoreLog).toBeDefined();
    });
  });
});
