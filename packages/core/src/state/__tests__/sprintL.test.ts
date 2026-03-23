import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import {
  resolveSimultaneousOrder,
  isOutOfPhaseAction,
  shouldTriggerPhaseAbility,
  canReinforcementMove,
  clampDamageToWounds,
} from '../../sequencing/index';
import type { SimultaneousRule } from '../../sequencing/index';
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

// ===== Tests =====

describe('Sprint L — Sequencing & Edge Cases (Phase 36)', () => {
  describe('Active player simultaneous rule order respected', () => {
    it('active player rules resolved first during turn', () => {
      const rules: SimultaneousRule[] = [
        { id: 'r1', name: 'Enemy Ability', ownerPlayerId: 'p2' },
        { id: 'r2', name: 'Active Ability', ownerPlayerId: 'p1' },
        { id: 'r3', name: 'Another Active', ownerPlayerId: 'p1' },
      ];

      const ordered = resolveSimultaneousOrder(rules, 'p1', 'during_turn');
      expect(ordered[0].ownerPlayerId).toBe('p1');
      expect(ordered[1].ownerPlayerId).toBe('p1');
      expect(ordered[2].ownerPlayerId).toBe('p2');
    });

    it('roll-off winner goes first between turns', () => {
      const rules: SimultaneousRule[] = [
        { id: 'r1', name: 'P1 Ability', ownerPlayerId: 'p1' },
        { id: 'r2', name: 'P2 Ability', ownerPlayerId: 'p2' },
      ];

      const ordered = resolveSimultaneousOrder(rules, 'p1', 'between_turns', 'p2');
      expect(ordered[0].ownerPlayerId).toBe('p2');
      expect(ordered[1].ownerPlayerId).toBe('p1');
    });

    it('single rule returns unchanged', () => {
      const rules: SimultaneousRule[] = [
        { id: 'r1', name: 'Only Rule', ownerPlayerId: 'p1' },
      ];
      const ordered = resolveSimultaneousOrder(rules, 'p1', 'during_turn');
      expect(ordered).toHaveLength(1);
      expect(ordered[0].id).toBe('r1');
    });
  });

  describe('Out-of-phase: Fire Overwatch doesn\'t trigger phase abilities', () => {
    it('out-of-phase action detected', () => {
      let state = setupTwoPlayerGame();
      state = {
        ...state,
        outOfPhaseAction: { stratagemId: 'fire-overwatch', playerId: 'p1' },
      };
      expect(isOutOfPhaseAction(state)).toBe(true);
    });

    it('normal action is not out-of-phase', () => {
      const state = setupTwoPlayerGame();
      expect(isOutOfPhaseAction(state)).toBe(false);
    });

    it('phase abilities should NOT trigger during out-of-phase action', () => {
      let state = setupTwoPlayerGame();
      state = {
        ...state,
        outOfPhaseAction: { stratagemId: 'fire-overwatch', playerId: 'p1' },
      };
      expect(shouldTriggerPhaseAbility(state, 'shooting')).toBe(false);
    });

    it('phase abilities should trigger during normal phase', () => {
      const state = setupTwoPlayerGame();
      expect(shouldTriggerPhaseAbility(state, 'shooting')).toBe(true);
    });
  });

  describe('Reinforcements count as Normal Move', () => {
    it('unit arriving from reserves is set to normal move type', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: -1000, y: -1000 }]);
      state = {
        ...state,
        reserves: { 'reserve-unit': { unitId: 'reserve-unit', type: 'strategic', availableFromRound: 2 } },
        turnState: { ...state.turnState, roundNumber: 2 },
      };

      state = gameReducer(state, {
        type: 'ARRIVE_FROM_RESERVES',
        payload: { unitId: 'reserve-unit', positions: { r1: { x: 10, y: 10 } } },
      });

      // Should have 'normal' move type
      expect(state.turnTracking.unitMovement['reserve-unit']).toBe('normal');
    });

    it('reinforcements cannot make additional moves', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'reserve-unit', 'p1', [{ id: 'r1', x: 10, y: 10 }]);
      // Simulate reinforcement: has normal move but no pre-movement positions
      state = {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { 'reserve-unit': 'normal' },
        },
      };

      const result = canReinforcementMove(state, 'reserve-unit');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('additional moves');
    });
  });

  describe('Excess damage from single attack lost when model destroyed', () => {
    it('damage clamped to remaining wounds', () => {
      expect(clampDamageToWounds(5, 2)).toBe(2);
      expect(clampDamageToWounds(1, 3)).toBe(1);
      expect(clampDamageToWounds(3, 3)).toBe(3);
    });

    it('excess damage does not carry over in APPLY_DAMAGE', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'target', 'p2', [
        { id: 't1', x: 20, y: 20 },
        { id: 't2', x: 21, y: 20 },
      ]);

      // Apply 10 damage to model with 2 wounds — excess lost
      state = gameReducer(state, {
        type: 'APPLY_DAMAGE',
        payload: { modelId: 't1', damage: 10, source: 'test' },
      });
      expect(state.models['t1'].wounds).toBe(0);
      expect(state.models['t1'].status).toBe('destroyed');
      // Second model should be unaffected — excess damage lost
      expect(state.models['t2'].wounds).toBe(2);
      expect(state.models['t2'].status).toBe('active');
    });
  });
});
