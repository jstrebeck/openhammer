import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameAction } from '../actions';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
// Ensure editions are registered
import '../../editions/index';

describe('gameReducer', () => {
  it('places a model', () => {
    const state = createInitialGameState();
    const model = makeModel();
    const next = gameReducer(state, { type: 'PLACE_MODEL', payload: { model } });
    expect(next.models['model-1']).toEqual(model);
  });

  it('does not mutate previous state', () => {
    const state = createInitialGameState();
    const model = makeModel();
    gameReducer(state, { type: 'PLACE_MODEL', payload: { model } });
    expect(state.models['model-1']).toBeUndefined();
  });

  it('removes a model and cleans up unit', () => {
    let state = createInitialGameState();
    const model = makeModel();
    const unit = makeUnit();
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: [model] } });
    state = gameReducer(state, { type: 'REMOVE_MODEL', payload: { modelId: 'model-1' } });
    expect(state.models['model-1']).toBeUndefined();
    expect(state.units['unit-1']).toBeUndefined();
  });

  it('moves a model', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_MODEL', payload: { model: makeModel() } });
    state = gameReducer(state, {
      type: 'MOVE_MODEL',
      payload: { modelId: 'model-1', position: { x: 20, y: 15 } },
    });
    expect(state.models['model-1'].position).toEqual({ x: 20, y: 15 });
  });

  it('sets model wounds and destroys at 0', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_MODEL', payload: { model: makeModel() } });
    state = gameReducer(state, {
      type: 'SET_MODEL_WOUNDS',
      payload: { modelId: 'model-1', wounds: 0 },
    });
    expect(state.models['model-1'].wounds).toBe(0);
    expect(state.models['model-1'].status).toBe('destroyed');
  });

  it('clamps wounds to max', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_MODEL', payload: { model: makeModel() } });
    state = gameReducer(state, {
      type: 'SET_MODEL_WOUNDS',
      payload: { modelId: 'model-1', wounds: 99 },
    });
    expect(state.models['model-1'].wounds).toBe(2);
  });

  it('adds a unit with models', () => {
    const state = createInitialGameState();
    const model1 = makeModel({ id: 'm1' });
    const model2 = makeModel({ id: 'm2' });
    const unit = makeUnit({ modelIds: ['m1', 'm2'] });
    const next = gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: [model1, model2] } });
    expect(next.units['unit-1']).toBeDefined();
    expect(next.models['m1']).toBeDefined();
    expect(next.models['m2']).toBeDefined();
  });

  it('removes a unit and its models', () => {
    let state = createInitialGameState();
    const model = makeModel();
    const unit = makeUnit();
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: [model] } });
    state = gameReducer(state, { type: 'REMOVE_UNIT', payload: { unitId: 'unit-1' } });
    expect(state.units['unit-1']).toBeUndefined();
    expect(state.models['model-1']).toBeUndefined();
  });

  it('adds a player', () => {
    const state = createInitialGameState();
    const player = makePlayer();
    const next = gameReducer(state, { type: 'ADD_PLAYER', payload: { player } });
    expect(next.players['player-1']).toEqual(player);
  });

  it('advances phase', () => {
    const state = createInitialGameState();
    expect(state.turnState.currentPhaseIndex).toBe(0);
    const next = gameReducer(state, { type: 'ADVANCE_PHASE' });
    expect(next.turnState.currentPhaseIndex).toBe(1);
  });

  it('does not advance past last phase', () => {
    let state = createInitialGameState();
    for (let i = 0; i < 5; i++) {
      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    }
    expect(state.turnState.currentPhaseIndex).toBe(5);
    const next = gameReducer(state, { type: 'ADVANCE_PHASE' });
    expect(next.turnState.currentPhaseIndex).toBe(5);
  });

  it('advances to next turn', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1' });
    const p2 = makePlayer({ id: 'p2' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
    state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };

    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(state.turnState.activePlayerId).toBe('p2');
    expect(state.turnState.roundNumber).toBe(1);

    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(state.turnState.activePlayerId).toBe('p1');
    expect(state.turnState.roundNumber).toBe(2);
  });

  it('sets board size', () => {
    const state = createInitialGameState();
    const next = gameReducer(state, {
      type: 'SET_BOARD_SIZE',
      payload: { width: 44, height: 30 },
    });
    expect(next.board).toEqual({ width: 44, height: 30 });
  });

  it('returns unchanged state for unknown action', () => {
    const state = createInitialGameState();
    const next = gameReducer(state, { type: 'UNKNOWN' } as unknown as GameAction);
    expect(next).toBe(state);
  });
});
