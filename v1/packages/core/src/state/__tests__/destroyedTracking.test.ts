import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState } from '../../types/index';
import '../../editions/index';

function setup(): GameState {
  let state = createInitialGameState();
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p2', name: 'Player 2' }) } });

  const m1 = makeModel({ id: 'm1', unitId: 'u1', position: { x: 10, y: 10 }, wounds: 1, maxWounds: 1 });
  const m2 = makeModel({ id: 'm2', unitId: 'u1', position: { x: 12, y: 10 }, wounds: 1, maxWounds: 1 });
  const unit = makeUnit({ id: 'u1', playerId: 'p2', modelIds: ['m1', 'm2'], startingStrength: 2 });
  state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: [m1, m2] } });
  return state;
}

describe('Destroyed unit tracking (unitsDestroyedThisTurn)', () => {
  it('records a unit when its last model is destroyed, with centroid position', () => {
    let state = setup();

    // 2 mortal wounds kill both 1W models
    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 2, source: 'test' },
    });

    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(1);
    const record = state.turnTracking.unitsDestroyedThisTurn[0];
    expect(record.unitId).toBe('u1');
    expect(record.playerId).toBe('p2');
    expect(record.position).toEqual({ x: 11, y: 10 }); // centroid of (10,10) and (12,10)
  });

  it('does not record a unit that still has active models', () => {
    let state = setup();

    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 1, source: 'test' },
    });

    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(0);
  });

  it('does not duplicate records across subsequent actions', () => {
    let state = setup();
    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 2, source: 'test' },
    });
    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 2, source: 'test' },
    });

    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(1);
  });

  it('clears records on NEXT_TURN', () => {
    let state = setup();
    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 2, source: 'test' },
    });
    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(1);

    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(0);
  });

  it('preserves records across ADVANCE_PHASE within the same turn', () => {
    let state = setup();
    state = gameReducer(state, {
      type: 'APPLY_MORTAL_WOUNDS',
      payload: { targetUnitId: 'u1', mortalWounds: 2, source: 'test' },
    });
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });

    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(1);
  });

  it('does not record administratively removed units', () => {
    let state = setup();
    state = gameReducer(state, { type: 'REMOVE_UNIT', payload: { unitId: 'u1' } });

    expect(state.turnTracking.unitsDestroyedThisTurn).toHaveLength(0);
  });
});
