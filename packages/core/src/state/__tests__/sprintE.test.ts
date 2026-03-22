import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { makeModel, makeUnit, makePlayer, makeTransport, makeAircraftUnit } from '../../test-helpers';
import { EMBARKED_POSITION, isEmbarkedPosition } from '../../transport/index';
import { canReRoll, rollOff } from '../../dice/index';
import { canChargeAircraft } from '../../aircraft/index';
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
    makeModel({ id: m.id, unitId, position: { x: m.x, y: m.y } }),
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

function addTransport(
  state: GameState,
  transportId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({ id: m.id, unitId: transportId, position: { x: m.x, y: m.y }, baseSizeMm: 60, baseSizeInches: 60 / 25.4 }),
  );
  const unit = makeTransport({
    id: transportId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

function addAircraft(
  state: GameState,
  unitId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({ id: m.id, unitId, position: { x: m.x, y: m.y }, moveCharacteristic: 20 }),
  );
  const unit = makeAircraftUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

// ===============================================
// Phase 18: Transports
// ===============================================

describe('Phase 18: Transports', () => {
  describe('EMBARK', () => {
    it('unit within 3" can embark — models move off-board', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      // Place infantry unit within 3" of transport
      state = addUnit(state, 'squad-1', 'p1', [
        { id: 'sm1', x: 11, y: 10 },
        { id: 'sm2', x: 12, y: 10 },
      ]);

      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      // Models should be at off-board position
      expect(isEmbarkedPosition(state.models['sm1'].position)).toBe(true);
      expect(isEmbarkedPosition(state.models['sm2'].position)).toBe(true);
      // Unit should be tracked in embarkedUnits
      expect(state.embarkedUnits['transport-1']).toContain('squad-1');
      // Should be in embarkedThisPhase
      expect(state.turnTracking.embarkedThisPhase).toContain('squad-1');
    });

    it('blocks embark when unit is outside 3"', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      // Place infantry unit far from transport
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 30, y: 30 }]);

      const before = state;
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      expect(state.embarkedUnits['transport-1']).toBeUndefined();
      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type === 'message' && lastLog.text).toContain('[BLOCKED]');
    });

    it('blocks embark when transport is at capacity', () => {
      let state = setupTwoPlayerGame();
      // Transport with capacity 2
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }], { transportCapacity: 2 });
      // First unit with 2 models — fills capacity
      state = addUnit(state, 'squad-1', 'p1', [
        { id: 'sm1', x: 11, y: 10 },
        { id: 'sm2', x: 12, y: 10 },
      ]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      // Second unit trying to embark
      state = addUnit(state, 'squad-2', 'p1', [{ id: 'sm3', x: 11, y: 10 }]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-2', transportId: 'transport-1' } });

      expect(state.embarkedUnits['transport-1']).toEqual(['squad-1']); // only first unit
    });

    it('blocks embark when unit has disembarked this phase', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 11, y: 10 }]);

      // Embark first
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });
      // Advance phase to clear embarkedThisPhase
      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      // Disembark
      state = gameReducer(state, { type: 'DISEMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1', positions: { 'sm1': { x: 11, y: 10 } } } });
      // Try to embark again same phase
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      // Should be blocked — unit is in disembarkedThisPhase
      expect(state.embarkedUnits['transport-1']?.includes('squad-1')).toBeFalsy();
    });
  });

  describe('DISEMBARK', () => {
    it('valid placement within 3" succeeds — models appear on board', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [
        { id: 'sm1', x: 11, y: 10 },
      ]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });
      expect(isEmbarkedPosition(state.models['sm1'].position)).toBe(true);

      // Advance phase so embarkedThisPhase resets
      state = gameReducer(state, { type: 'ADVANCE_PHASE' });

      state = gameReducer(state, {
        type: 'DISEMBARK',
        payload: { unitId: 'squad-1', transportId: 'transport-1', positions: { 'sm1': { x: 12, y: 10 } } },
      });

      expect(state.models['sm1'].position).toEqual({ x: 12, y: 10 });
      expect(state.embarkedUnits['transport-1']).toEqual([]);
      expect(state.turnTracking.disembarkedThisPhase).toContain('squad-1');
    });

    it('blocks disembark when transport advanced', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 11, y: 10 }]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });
      state = gameReducer(state, { type: 'ADVANCE_PHASE' });

      // Transport declares advance
      state = {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { ...state.turnTracking.unitMovement, 'transport-1': 'advance' },
        },
      };

      state = gameReducer(state, {
        type: 'DISEMBARK',
        payload: { unitId: 'squad-1', transportId: 'transport-1', positions: { 'sm1': { x: 12, y: 10 } } },
      });

      // Should still be embarked
      expect(state.embarkedUnits['transport-1']).toContain('squad-1');
    });

    it('blocks disembark when unit embarked this phase', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 11, y: 10 }]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      // Try to disembark same phase
      state = gameReducer(state, {
        type: 'DISEMBARK',
        payload: { unitId: 'squad-1', transportId: 'transport-1', positions: { 'sm1': { x: 12, y: 10 } } },
      });

      expect(state.embarkedUnits['transport-1']).toContain('squad-1');
    });
  });

  describe('RESOLVE_DESTROYED_TRANSPORT', () => {
    it('casualties applied, survivors battle-shocked', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [
        { id: 'sm1', x: 11, y: 10 },
        { id: 'sm2', x: 12, y: 10 },
        { id: 'sm3', x: 13, y: 10 },
      ]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      state = gameReducer(state, {
        type: 'RESOLVE_DESTROYED_TRANSPORT',
        payload: {
          transportId: 'transport-1',
          casualties: ['sm1'], // 1 killed
          survivorPositions: {
            'sm2': { x: 11, y: 10 },
            'sm3': { x: 12, y: 10 },
          },
        },
      });

      // Casualty should be destroyed
      expect(state.models['sm1'].status).toBe('destroyed');
      expect(state.models['sm1'].wounds).toBe(0);
      // Survivors should be positioned
      expect(state.models['sm2'].position).toEqual({ x: 11, y: 10 });
      expect(state.models['sm3'].position).toEqual({ x: 12, y: 10 });
      // Survivors should be battle-shocked
      expect(state.battleShocked).toContain('squad-1');
      // Unit should no longer be in embarkedUnits
      expect(state.embarkedUnits['transport-1']).toBeUndefined();
    });
  });

  describe('embarkedThisPhase resets', () => {
    it('resets on ADVANCE_PHASE', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 11, y: 10 }]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });
      expect(state.turnTracking.embarkedThisPhase).toContain('squad-1');

      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(state.turnTracking.embarkedThisPhase).toEqual([]);
    });
  });

  describe('embarkedUnits persists across turns', () => {
    it('embarked units stay embarked after NEXT_TURN', () => {
      let state = setupTwoPlayerGame();
      state = addTransport(state, 'transport-1', 'p1', [{ id: 'tm1', x: 10, y: 10 }]);
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 11, y: 10 }]);
      state = gameReducer(state, { type: 'EMBARK', payload: { unitId: 'squad-1', transportId: 'transport-1' } });

      state = gameReducer(state, { type: 'NEXT_TURN' });

      expect(state.embarkedUnits['transport-1']).toContain('squad-1');
      expect(isEmbarkedPosition(state.models['sm1'].position)).toBe(true);
    });
  });
});

// ===============================================
// Phase 19: Aircraft & Reserves
// ===============================================

describe('Phase 19: Aircraft & Reserves', () => {
  describe('SET_UNIT_IN_RESERVES', () => {
    it('places unit in reserves with models off-board', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 10 }]);

      state = gameReducer(state, {
        type: 'SET_UNIT_IN_RESERVES',
        payload: { unitId: 'aircraft-1', reserveType: 'aircraft', availableFromRound: 2 },
      });

      expect(state.reserves['aircraft-1']).toBeDefined();
      expect(state.reserves['aircraft-1'].type).toBe('aircraft');
      expect(state.reserves['aircraft-1'].availableFromRound).toBe(2);
      expect(isEmbarkedPosition(state.models['am1'].position)).toBe(true);
    });
  });

  describe('ARRIVE_FROM_RESERVES', () => {
    it('arrives with valid positioning when round >= availableFromRound', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 10 }]);
      state = gameReducer(state, {
        type: 'SET_UNIT_IN_RESERVES',
        payload: { unitId: 'aircraft-1', reserveType: 'aircraft', availableFromRound: 2 },
      });

      // Set round to 2
      state = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };

      state = gameReducer(state, {
        type: 'ARRIVE_FROM_RESERVES',
        payload: { unitId: 'aircraft-1', positions: { 'am1': { x: 30, y: 22 } } },
      });

      expect(state.models['am1'].position).toEqual({ x: 30, y: 22 });
      expect(state.reserves['aircraft-1']).toBeUndefined();
      expect(state.turnTracking.unitMovement['aircraft-1']).toBe('normal');
    });

    it('blocks arrival before availableFromRound', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 10 }]);
      state = gameReducer(state, {
        type: 'SET_UNIT_IN_RESERVES',
        payload: { unitId: 'aircraft-1', reserveType: 'aircraft', availableFromRound: 3 },
      });

      // Still round 1
      state = gameReducer(state, {
        type: 'ARRIVE_FROM_RESERVES',
        payload: { unitId: 'aircraft-1', positions: { 'am1': { x: 30, y: 22 } } },
      });

      // Should still be in reserves
      expect(state.reserves['aircraft-1']).toBeDefined();
      expect(isEmbarkedPosition(state.models['am1'].position)).toBe(true);
    });
  });

  describe('AIRCRAFT_MOVE', () => {
    it('moves exactly 20" in a straight line', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 22 }]);

      state = gameReducer(state, {
        type: 'AIRCRAFT_MOVE',
        payload: { unitId: 'aircraft-1', endPosition: { x: 30, y: 22 }, pivotAngle: 90 },
      });

      expect(state.models['am1'].position).toEqual({ x: 30, y: 22 });
      expect(state.models['am1'].facing).toBe(90);
      expect(state.turnTracking.unitsCompleted['aircraft-1']).toBe(true);
    });

    it('blocks when distance is not exactly 20"', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 22 }]);

      state = gameReducer(state, {
        type: 'AIRCRAFT_MOVE',
        payload: { unitId: 'aircraft-1', endPosition: { x: 15, y: 22 }, pivotAngle: 90 },
      });

      // Should not have moved
      expect(state.models['am1'].position).toEqual({ x: 10, y: 22 });
      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type === 'message' && lastLog.text).toContain('[BLOCKED]');
    });
  });

  describe('AIRCRAFT_OFF_BOARD', () => {
    it('moves aircraft to Strategic Reserves', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 22 }]);

      state = gameReducer(state, {
        type: 'AIRCRAFT_OFF_BOARD',
        payload: { unitId: 'aircraft-1' },
      });

      expect(state.reserves['aircraft-1']).toBeDefined();
      expect(state.reserves['aircraft-1'].type).toBe('strategic');
      expect(state.reserves['aircraft-1'].availableFromRound).toBe(state.turnState.roundNumber + 1);
      expect(isEmbarkedPosition(state.models['am1'].position)).toBe(true);
    });
  });

  describe('SET_HOVER_MODE', () => {
    it('hover mode tracked in state', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 22 }]);

      state = gameReducer(state, {
        type: 'SET_HOVER_MODE',
        payload: { unitId: 'aircraft-1', hover: true },
      });

      expect(state.hoverModeUnits).toContain('aircraft-1');
    });

    it('exiting hover mode removes from list', () => {
      let state = setupTwoPlayerGame();
      state = addAircraft(state, 'aircraft-1', 'p1', [{ id: 'am1', x: 10, y: 22 }]);
      state = gameReducer(state, { type: 'SET_HOVER_MODE', payload: { unitId: 'aircraft-1', hover: true } });
      state = gameReducer(state, { type: 'SET_HOVER_MODE', payload: { unitId: 'aircraft-1', hover: false } });

      expect(state.hoverModeUnits).not.toContain('aircraft-1');
    });
  });

  describe('canChargeAircraft utility', () => {
    it('FLY units can charge aircraft', () => {
      const flyUnit = makeUnit({ keywords: ['INFANTRY', 'FLY'] });
      expect(canChargeAircraft(flyUnit).allowed).toBe(true);
    });

    it('non-FLY units cannot charge aircraft', () => {
      const infantryUnit = makeUnit({ keywords: ['INFANTRY'] });
      expect(canChargeAircraft(infantryUnit).allowed).toBe(false);
    });
  });
});

// ===============================================
// Phase 20: Mortal Wounds & Edge Cases
// ===============================================

describe('Phase 20: Mortal Wounds & Edge Cases', () => {
  describe('APPLY_MORTAL_WOUNDS', () => {
    it('directly damages without saves', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p2', [
        { id: 'sm1', x: 10, y: 10 },
      ]);

      state = gameReducer(state, {
        type: 'APPLY_MORTAL_WOUNDS',
        payload: { targetUnitId: 'squad-1', mortalWounds: 1, source: 'Smite' },
      });

      expect(state.models['sm1'].wounds).toBe(1); // 2 max - 1 = 1
    });

    it('spills mortal wounds to next model', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p2', [
        { id: 'sm1', x: 10, y: 10 },
        { id: 'sm2', x: 12, y: 10 },
      ]);

      // 3 mortal wounds should kill first model (2W) and damage second (1W)
      state = gameReducer(state, {
        type: 'APPLY_MORTAL_WOUNDS',
        payload: { targetUnitId: 'squad-1', mortalWounds: 3, source: 'Psychic' },
      });

      expect(state.models['sm1'].wounds).toBe(0);
      expect(state.models['sm1'].status).toBe('destroyed');
      expect(state.models['sm2'].wounds).toBe(1);
    });

    it('handles mortal wounds exceeding all model wounds', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p2', [
        { id: 'sm1', x: 10, y: 10 },
      ]);

      state = gameReducer(state, {
        type: 'APPLY_MORTAL_WOUNDS',
        payload: { targetUnitId: 'squad-1', mortalWounds: 10, source: 'Devastating' },
      });

      expect(state.models['sm1'].wounds).toBe(0);
      expect(state.models['sm1'].status).toBe('destroyed');
    });
  });

  describe('Re-roll tracking', () => {
    it('canReRoll returns true for normal rolls', () => {
      const roll = { id: '1', dice: [3], sides: 6, purpose: 'test', timestamp: 0 };
      expect(canReRoll(roll)).toBe(true);
    });

    it('canReRoll returns false for re-rolled dice', () => {
      const roll = { id: '1', dice: [3], sides: 6, purpose: 'test', timestamp: 0, reRolled: true };
      expect(canReRoll(roll)).toBe(false);
    });
  });

  describe('ROLL_OFF', () => {
    it('records roll-off result in log', () => {
      let state = setupTwoPlayerGame();
      const roll1 = { id: 'r1', dice: [5], sides: 6, purpose: 'Roll-off', timestamp: Date.now() };
      const roll2 = { id: 'r2', dice: [3], sides: 6, purpose: 'Roll-off', timestamp: Date.now() };

      state = gameReducer(state, {
        type: 'ROLL_OFF',
        payload: { player1Id: 'p1', player2Id: 'p2', player1Roll: roll1, player2Roll: roll2, winnerId: 'p1' },
      });

      const messages = state.log.entries.filter(e => e.type === 'message');
      const rollOffMsg = messages.find(e => e.type === 'message' && e.text.includes('Roll-off'));
      expect(rollOffMsg).toBeDefined();
      if (rollOffMsg && rollOffMsg.type === 'message') {
        expect(rollOffMsg.text).toContain('Player 1 wins');
      }
    });

    it('tie results in null winnerId', () => {
      let state = setupTwoPlayerGame();
      const roll1 = { id: 'r1', dice: [4], sides: 6, purpose: 'Roll-off', timestamp: Date.now() };
      const roll2 = { id: 'r2', dice: [4], sides: 6, purpose: 'Roll-off', timestamp: Date.now() };

      state = gameReducer(state, {
        type: 'ROLL_OFF',
        payload: { player1Id: 'p1', player2Id: 'p2', player1Roll: roll1, player2Roll: roll2, winnerId: null },
      });

      const messages = state.log.entries.filter(e => e.type === 'message');
      const rollOffMsg = messages.find(e => e.type === 'message' && e.text.includes('Tie'));
      expect(rollOffMsg).toBeDefined();
    });
  });

  describe('rollOff utility', () => {
    it('produces a winner', () => {
      const result = rollOff('p1', 'p2');
      expect(['p1', 'p2']).toContain(result.winnerId);
      expect(result.rolls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('SURGE_MOVE', () => {
    it('succeeds when valid', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 10, y: 10 }]);

      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 13, y: 10 } } },
      });

      expect(state.models['sm1'].position).toEqual({ x: 13, y: 10 });
      expect(state.turnTracking.surgeMoveUsedThisPhase['squad-1']).toBe(true);
    });

    it('blocked when battle-shocked', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['squad-1'] };

      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 13, y: 10 } } },
      });

      expect(state.models['sm1'].position).toEqual({ x: 10, y: 10 }); // unmoved
    });

    it('blocked when in engagement range', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 10, y: 10 }]);
      // Place enemy model within 1" (engagement range)
      state = addUnit(state, 'enemy-1', 'p2', [{ id: 'em1', x: 10.5, y: 10 }]);

      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 13, y: 10 } } },
      });

      expect(state.models['sm1'].position).toEqual({ x: 10, y: 10 }); // unmoved
    });

    it('only one surge move per phase per unit', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 10, y: 10 }]);

      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 13, y: 10 } } },
      });

      // Second surge should be blocked
      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 16, y: 10 } } },
      });

      expect(state.models['sm1'].position).toEqual({ x: 13, y: 10 }); // stayed at first surge position
    });

    it('surgeMoveUsedThisPhase resets on ADVANCE_PHASE', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'squad-1', 'p1', [{ id: 'sm1', x: 10, y: 10 }]);
      state = gameReducer(state, {
        type: 'SURGE_MOVE',
        payload: { unitId: 'squad-1', positions: { 'sm1': { x: 13, y: 10 } } },
      });
      expect(state.turnTracking.surgeMoveUsedThisPhase['squad-1']).toBe(true);

      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(state.turnTracking.surgeMoveUsedThisPhase).toEqual({});
    });
  });
});
