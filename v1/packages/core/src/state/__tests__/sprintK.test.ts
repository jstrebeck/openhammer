import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { makeModel, makeUnit, makePlayer, makeAircraftUnit } from '../../test-helpers';
import {
  canAircraftCharge,
  canAircraftPileInOrConsolidate,
  canAircraftFightTarget,
  filterEnemiesForPileIn,
  shouldAircraftGoToReserves,
  isAircraftUnit,
} from '../../aircraft/index';
import { isModelDestroyedInTransport } from '../../transport/index';
// canAttachLeader, doesAttachedUnitDestructionCountAsDestroyed, getRevertedStartingStrength
// moved to combat/__tests__/woundAllocation.test.ts
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

describe('Sprint K — Aircraft & Transport Completion (Phase 35)', () => {
  describe('AIRCRAFT cannot charge', () => {
    it('blocks AIRCRAFT from declaring charges', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p1', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      const unit = state.units['aircraft-1'];
      const result = canAircraftCharge(unit, state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('AIRCRAFT cannot');
    });

    it('allows non-AIRCRAFT to charge', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'infantry-1', 'p1', [{ id: 'i1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      const unit = state.units['infantry-1'];
      const result = canAircraftCharge(unit, state);
      expect(result.allowed).toBe(true);
    });

    it('AIRCRAFT in hover mode CAN charge (not treated as AIRCRAFT)', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p1', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = { ...state, hoverModeUnits: ['aircraft-1'] };
      const unit = state.units['aircraft-1'];
      // In hover mode, isAircraftUnit returns false
      expect(isAircraftUnit(unit, state)).toBe(false);
      const result = canAircraftCharge(unit, state);
      expect(result.allowed).toBe(true);
    });
  });

  describe('AIRCRAFT can only fight FLY', () => {
    it('AIRCRAFT can fight FLY units', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p1', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = addUnit(state, 'fly-enemy', 'p2', [{ id: 'f1', x: 11, y: 10 }], {
        keywords: ['INFANTRY', 'FLY'],
      });
      const result = canAircraftFightTarget(state.units['aircraft-1'], state.units['fly-enemy'], state);
      expect(result.allowed).toBe(true);
    });

    it('AIRCRAFT cannot fight non-FLY units', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p1', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = addUnit(state, 'ground-enemy', 'p2', [{ id: 'g1', x: 11, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      const result = canAircraftFightTarget(state.units['aircraft-1'], state.units['ground-enemy'], state);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Pile In ignores AIRCRAFT (unless FLY)', () => {
    it('filters out AIRCRAFT when piling-in unit lacks FLY', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p2', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = addUnit(state, 'infantry-1', 'p2', [{ id: 'i1', x: 12, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      const pilingInUnit = makeUnit({ id: 'piler', keywords: ['INFANTRY'] });

      const enemies = [
        { model: state.models['a1'], unit: state.units['aircraft-1'] },
        { model: state.models['i1'], unit: state.units['infantry-1'] },
      ];

      const filtered = filterEnemiesForPileIn(enemies, pilingInUnit, state);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].unit.id).toBe('infantry-1');
    });

    it('includes AIRCRAFT when piling-in unit has FLY', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'aircraft-1', 'p2', [{ id: 'a1', x: 10, y: 10 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      const pilingInUnit = makeUnit({ id: 'piler', keywords: ['INFANTRY', 'FLY'] });

      const enemies = [
        { model: state.models['a1'], unit: state.units['aircraft-1'] },
      ];

      const filtered = filterEnemiesForPileIn(enemies, pilingInUnit, state);
      expect(filtered).toHaveLength(1);
    });
  });

  describe('AIRCRAFT to Strategic Reserves when crossing board edge', () => {
    it('detects off-board movement', () => {
      const state = setupTwoPlayerGame();
      expect(shouldAircraftGoToReserves(state, 'any', { x: -1, y: 10 })).toBe(true);
      expect(shouldAircraftGoToReserves(state, 'any', { x: 61, y: 10 })).toBe(true);
      expect(shouldAircraftGoToReserves(state, 'any', { x: 10, y: -1 })).toBe(true);
      expect(shouldAircraftGoToReserves(state, 'any', { x: 10, y: 45 })).toBe(true);
    });

    it('on-board movement stays on board', () => {
      const state = setupTwoPlayerGame();
      expect(shouldAircraftGoToReserves(state, 'any', { x: 30, y: 22 })).toBe(false);
    });
  });

  describe('Destroyed transport distance tiers', () => {
    it('within 3": destroyed on roll of 1', () => {
      expect(isModelDestroyedInTransport(1, 2)).toBe(true);
      expect(isModelDestroyedInTransport(2, 2)).toBe(false);
    });

    it('within 6": destroyed on roll of 1–3', () => {
      expect(isModelDestroyedInTransport(1, 5)).toBe(true);
      expect(isModelDestroyedInTransport(3, 5)).toBe(true);
      expect(isModelDestroyedInTransport(4, 5)).toBe(false);
    });

    it('beyond 6": model survives', () => {
      expect(isModelDestroyedInTransport(1, 7)).toBe(false);
    });
  });

  // Attached unit destruction VP and Surviving unit reverts tests
  // moved to combat/__tests__/woundAllocation.test.ts

  describe('Cannot attach more than one Leader', () => {
    it('blocks second leader attachment', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'leader-1', 'p1', [{ id: 'l1', x: 10, y: 10 }], {
        keywords: ['CHARACTER', 'INFANTRY'],
      });
      state = addUnit(state, 'leader-2', 'p1', [{ id: 'l2', x: 12, y: 10 }], {
        keywords: ['CHARACTER', 'INFANTRY'],
      });
      state = addUnit(state, 'bodyguard-1', 'p1', [{ id: 'b1', x: 11, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      // Attach first leader
      state = gameReducer(state, {
        type: 'ATTACH_LEADER',
        payload: { leaderUnitId: 'leader-1', bodyguardUnitId: 'bodyguard-1' },
      });
      expect(state.attachedUnits['leader-1']).toBe('bodyguard-1');

      // Try to attach second leader to same bodyguard — should be blocked
      state = gameReducer(state, {
        type: 'ATTACH_LEADER',
        payload: { leaderUnitId: 'leader-2', bodyguardUnitId: 'bodyguard-1' },
      });
      expect(state.attachedUnits['leader-2']).toBeUndefined();
      // Check that log has blocked message
      const lastEntry = state.log.entries[state.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('[BLOCKED]');
      }
    });

    // canAttachLeader helper test moved to combat/__tests__/woundAllocation.test.ts
  });
});
