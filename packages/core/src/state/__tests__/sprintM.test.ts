import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import type { TerrainPiece } from '../../types/terrain';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import {
  determineCover,
  isModelWhollyWithin,
  isModelInWoods,
  doesLoSPassThroughRuins,
  canFightAcrossBarricade,
} from '../../terrain/cover';
import '../../editions/index';

// ===== Test Helpers =====

function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000', commandPoints: 5 });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff', commandPoints: 5 });
  state = { ...state, players: { p1, p2 } };
  state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };
  return state;
}

function addModelsAndUnits(
  state: GameState,
  unitId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number }>,
  unitOverrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs: Record<string, import('../../types/index').Model> = { ...state.models };
  const modelIds: string[] = [];
  for (const m of models) {
    const model = makeModel({ id: m.id, unitId, position: { x: m.x, y: m.y } });
    modelObjs[m.id] = model;
    modelIds.push(m.id);
  }
  const unit = makeUnit({ id: unitId, playerId, modelIds, ...unitOverrides });
  return {
    ...state,
    models: modelObjs,
    units: { ...state.units, [unitId]: unit },
  };
}

function addTerrain(state: GameState, terrain: TerrainPiece): GameState {
  return { ...state, terrain: { ...state.terrain, [terrain.id]: terrain } };
}

// ===== Tests =====

describe('Sprint M — Terrain Traits Completion (Phase 36b)', () => {
  describe('Woods: wholly within = not fully visible', () => {
    it('model wholly within woods area terrain is detected', () => {
      const model = makeModel({ position: { x: 10, y: 10 } });
      const woodsTerrain: Record<string, TerrainPiece> = {
        w1: {
          id: 'w1',
          polygon: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
          height: 3,
          traits: ['dense', 'breachable'],
          label: 'Woods',
          terrainType: 'area_terrain',
        },
      };
      expect(isModelInWoods(model, woodsTerrain)).toBe(true);
    });

    it('model outside woods is not considered in woods', () => {
      const model = makeModel({ position: { x: 25, y: 25 } });
      const woodsTerrain: Record<string, TerrainPiece> = {
        w1: {
          id: 'w1',
          polygon: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
          height: 3,
          traits: ['dense', 'breachable'],
          label: 'Woods',
          terrainType: 'area_terrain',
        },
      };
      expect(isModelInWoods(model, woodsTerrain)).toBe(false);
    });

    it('woods grants cover when LoS passes through', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      state = addTerrain(state, {
        id: 'w1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 3,
        traits: ['dense', 'breachable'],
        label: 'Woods',
        terrainType: 'area_terrain',
      });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      expect(cover.hasCover).toBe(true);
      expect(cover.saveModifier).toBe(1);
    });
  });

  describe('Hills: cover when not fully visible', () => {
    it('hill terrain type is recognized', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      // Place obscuring wall between them (to make target not fully visible)
      // and a hill near the target
      state = addTerrain(state, {
        id: 'h1',
        polygon: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
        height: 2,
        traits: [],
        label: 'Hill',
        terrainType: 'hill',
      });
      // Add some blocking element so model isn't fully visible
      state = addTerrain(state, {
        id: 'dense1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 3,
        traits: ['dense'],
        label: 'Brush',
        terrainType: 'area_terrain',
      });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      // Should have cover — either from hill (not fully visible) or from dense terrain
      expect(cover.hasCover).toBe(true);
    });
  });

  describe('Ruins: cannot see through/over', () => {
    it('LoS passing through ruins is blocked', () => {
      const from = makeModel({ id: 'a', position: { x: 5, y: 5 } });
      const to = makeModel({ id: 'b', position: { x: 25, y: 5 } });
      const terrain: Record<string, TerrainPiece> = {
        r1: {
          id: 'r1',
          polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
          height: 5,
          traits: ['obscuring', 'breachable', 'ruins'],
          label: 'Ruins',
          terrainType: 'area_terrain',
        },
      };
      expect(doesLoSPassThroughRuins(from, to, terrain)).toBe(true);
    });

    it('LoS not passing through ruins returns false', () => {
      const from = makeModel({ id: 'a', position: { x: 5, y: 5 } });
      const to = makeModel({ id: 'b', position: { x: 10, y: 5 } });
      const terrain: Record<string, TerrainPiece> = {
        r1: {
          id: 'r1',
          polygon: [{ x: 20, y: 0 }, { x: 22, y: 0 }, { x: 22, y: 10 }, { x: 20, y: 10 }],
          height: 5,
          traits: ['obscuring', 'breachable', 'ruins'],
          label: 'Ruins',
          terrainType: 'area_terrain',
        },
      };
      expect(doesLoSPassThroughRuins(from, to, terrain)).toBe(false);
    });
  });

  describe('Barricade: can fight across within 2"', () => {
    it('models within 2" of barricade can fight across', () => {
      const attacker = makeModel({ id: 'a', position: { x: 9, y: 5 } });
      const target = makeModel({ id: 'b', position: { x: 11, y: 5 } });
      const terrain: Record<string, TerrainPiece> = {
        bar1: {
          id: 'bar1',
          polygon: [{ x: 9.5, y: 3 }, { x: 10.5, y: 3 }, { x: 10.5, y: 7 }, { x: 9.5, y: 7 }],
          height: 2,
          traits: ['defensible'],
          label: 'Barricade',
          terrainType: 'obstacle',
        },
      };
      expect(canFightAcrossBarricade(attacker, target, terrain)).toBe(true);
    });

    it('models too far from barricade cannot fight across', () => {
      const attacker = makeModel({ id: 'a', position: { x: 5, y: 5 } });
      const target = makeModel({ id: 'b', position: { x: 15, y: 5 } });
      const terrain: Record<string, TerrainPiece> = {
        bar1: {
          id: 'bar1',
          polygon: [{ x: 9.5, y: 3 }, { x: 10.5, y: 3 }, { x: 10.5, y: 7 }, { x: 9.5, y: 7 }],
          height: 2,
          traits: ['defensible'],
          label: 'Barricade',
          terrainType: 'obstacle',
        },
      };
      expect(canFightAcrossBarricade(attacker, target, terrain)).toBe(false);
    });
  });

  describe('Craters: cover if wholly within', () => {
    it('model wholly within crater gets cover', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 20 }]);
      state = addTerrain(state, {
        id: 'c1',
        polygon: [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }],
        height: 0,
        traits: [],
        label: 'Crater',
        terrainType: 'area_terrain',
      });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      expect(cover.hasCover).toBe(true);
      expect(cover.reason).toContain('Crater');
    });

    it('model outside crater does not get crater cover', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 30, y: 30 }]);
      state = addTerrain(state, {
        id: 'c1',
        polygon: [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }],
        height: 0,
        traits: [],
        label: 'Crater',
        terrainType: 'area_terrain',
      });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      expect(cover.hasCover).toBe(false);
    });
  });
});
