import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { TerrainPiece } from '../../types/terrain';

function makeTerrain(overrides: Partial<TerrainPiece> = {}): TerrainPiece {
  return {
    id: 'terrain-1',
    polygon: [
      { x: 10, y: 10 },
      { x: 16, y: 10 },
      { x: 16, y: 14 },
      { x: 10, y: 14 },
    ],
    height: 5,
    traits: ['obscuring', 'breachable'],
    label: 'Ruins',
    ...overrides,
  };
}

describe('terrain reducer actions', () => {
  it('places terrain', () => {
    const state = createInitialGameState();
    const terrain = makeTerrain();
    const next = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain } });
    expect(next.terrain['terrain-1']).toEqual(terrain);
  });

  it('does not mutate previous state when placing', () => {
    const state = createInitialGameState();
    gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain: makeTerrain() } });
    expect(state.terrain['terrain-1']).toBeUndefined();
  });

  it('removes terrain', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain: makeTerrain() } });
    state = gameReducer(state, { type: 'REMOVE_TERRAIN', payload: { terrainId: 'terrain-1' } });
    expect(state.terrain['terrain-1']).toBeUndefined();
  });

  it('returns unchanged state when removing nonexistent terrain', () => {
    const state = createInitialGameState();
    const next = gameReducer(state, { type: 'REMOVE_TERRAIN', payload: { terrainId: 'nope' } });
    expect(next).toBe(state);
  });

  it('updates terrain traits', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain: makeTerrain() } });
    state = gameReducer(state, {
      type: 'UPDATE_TERRAIN',
      payload: { terrainId: 'terrain-1', changes: { traits: ['dense'] } },
    });
    expect(state.terrain['terrain-1'].traits).toEqual(['dense']);
  });

  it('updates terrain height', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain: makeTerrain() } });
    state = gameReducer(state, {
      type: 'UPDATE_TERRAIN',
      payload: { terrainId: 'terrain-1', changes: { height: 10 } },
    });
    expect(state.terrain['terrain-1'].height).toBe(10);
  });

  it('updates terrain label', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain: makeTerrain() } });
    state = gameReducer(state, {
      type: 'UPDATE_TERRAIN',
      payload: { terrainId: 'terrain-1', changes: { label: 'Big Ruins' } },
    });
    expect(state.terrain['terrain-1'].label).toBe('Big Ruins');
  });

  it('returns unchanged state when updating nonexistent terrain', () => {
    const state = createInitialGameState();
    const next = gameReducer(state, {
      type: 'UPDATE_TERRAIN',
      payload: { terrainId: 'nope', changes: { height: 99 } },
    });
    expect(next).toBe(state);
  });
});
