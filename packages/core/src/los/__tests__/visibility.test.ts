import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../state/initialState';
import type { GameState } from '../../types/index';
import type { TerrainPiece } from '../../types/terrain';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import {
  isModelFullyVisible,
  checkUnitVisibility,
  canTargetWithRangedWeapon,
  checkLineOfSightWithKeywords,
} from '../index';
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
    const model = makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
    });
    modelObjs[m.id] = model;
    modelIds.push(m.id);
  }
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds,
    ...unitOverrides,
  });
  return {
    ...state,
    models: modelObjs,
    units: { ...state.units, [unitId]: unit },
  };
}

function addTerrain(state: GameState, terrain: TerrainPiece): GameState {
  return {
    ...state,
    terrain: { ...state.terrain, [terrain.id]: terrain },
  };
}

// ===== Tests =====

describe('Sprint J — Visibility & Targeting (Phase 34)', () => {
  describe('Fully Visible', () => {
    it('model is fully visible when no terrain or intervening models', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 15, y: 5 }]);

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(true);
    });

    it('model is NOT fully visible when obscuring terrain blocks LoS', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 5,
        traits: ['obscuring'],
        label: 'Wall',
      });

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(false);
    });

    it('model is NOT fully visible when dense terrain is between them', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 3,
        traits: ['dense'],
        label: 'Woods',
      });

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(false);
    });

    it('model is NOT fully visible when an intervening enemy model blocks LoS', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      // Add an intervening enemy model directly between them
      state = addModelsAndUnits(state, 'u3', 'p2', [{ id: 'm3', x: 15, y: 5 }]);

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(false);
    });
  });

  describe('See through own unit', () => {
    it('model is not blocked by other models in its own unit (observer)', () => {
      let state = setupTwoPlayerGame();
      // Observer unit with two models - one behind the other
      state = addModelsAndUnits(state, 'u1', 'p1', [
        { id: 'm1', x: 5, y: 5 },
        { id: 'm1b', x: 10, y: 5 },
      ]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      // m1 looking through m1b at m2 - m1b should NOT block LoS
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(true);
    });

    it('model can see through models in the target unit', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      // Target unit has two models, one in front of the other from observer's perspective
      state = addModelsAndUnits(state, 'u2', 'p2', [
        { id: 'm2a', x: 15, y: 5 },
        { id: 'm2b', x: 20, y: 5 },
      ]);

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      // m2a blocks the path to m2b, but both are in the same unit so it should NOT block
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2b'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(true);
    });
  });

  describe('AIRCRAFT/TOWERING exception', () => {
    it('AIRCRAFT can see over terrain that normally blocks LoS', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 10,
        traits: ['obscuring'],
        label: 'Tall Ruins',
      });

      const los = checkLineOfSightWithKeywords(
        state.models['m1'], state.models['m2'],
        state.terrain, state.units['u1'], state.units['u2'],
      );
      expect(los.clear).toBe(true);
    });

    it('TOWERING model can be seen through terrain', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }], {
        keywords: ['MONSTER', 'TOWERING'],
      });
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 10,
        traits: ['obscuring'],
        label: 'Tall Ruins',
      });

      const los = checkLineOfSightWithKeywords(
        state.models['m1'], state.models['m2'],
        state.terrain, state.units['u1'], state.units['u2'],
      );
      expect(los.clear).toBe(true);
    });

    it('AIRCRAFT is fully visible through terrain', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }], {
        keywords: ['VEHICLE', 'FLY', 'AIRCRAFT'],
      });
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 14, y: 10 }],
        height: 10,
        traits: ['obscuring'],
        label: 'Tall Ruins',
      });

      const allModels = Object.values(state.models).filter(m => m.status === 'active');
      const result = isModelFullyVisible(
        state.models['m1'], state.models['m2'],
        state.terrain, allModels,
        state.units['u1'], state.units['u2'],
      );
      expect(result).toBe(true);
    });
  });

  describe('ER Targeting Restrictions', () => {
    it('cannot target unit in ER of friendlies with ranged non-Pistol non-BGNT weapon', () => {
      let state = setupTwoPlayerGame();
      // Attacker: p1 infantry at (5, 5)
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      // Friendly unit in ER of enemy: p1 unit at (20, 5)
      state = addModelsAndUnits(state, 'u_friendly', 'p1', [{ id: 'm_f', x: 20, y: 5 }]);
      // Enemy target at (20.5, 5) — within 1" of friendly
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 20.5, y: 5 }]);

      const weapon = { abilities: [], type: 'ranged' };
      const result = canTargetWithRangedWeapon(
        state.units['u1'], state.units['u2'], state, weapon, 1,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Engagement Range');
    });

    it('Pistol CAN target unit in ER of friendlies', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u_friendly', 'p1', [{ id: 'm_f', x: 20, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 20.5, y: 5 }]);

      const weapon = { abilities: ['PISTOL'], type: 'ranged' };
      const result = canTargetWithRangedWeapon(
        state.units['u1'], state.units['u2'], state, weapon, 1,
      );
      expect(result.allowed).toBe(true);
    });

    it('MONSTER/VEHICLE can target via Big Guns Never Tire', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }], {
        keywords: ['VEHICLE'],
      });
      state = addModelsAndUnits(state, 'u_friendly', 'p1', [{ id: 'm_f', x: 20, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 20.5, y: 5 }]);

      const weapon = { abilities: [], type: 'ranged' };
      const result = canTargetWithRangedWeapon(
        state.units['u1'], state.units['u2'], state, weapon, 1,
      );
      expect(result.allowed).toBe(true);
    });

    it('Blast weapon CANNOT target unit in ER of friendlies', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }], {
        keywords: ['VEHICLE'], // Even BGNT doesn't help Blast
      });
      state = addModelsAndUnits(state, 'u_friendly', 'p1', [{ id: 'm_f', x: 20, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 20.5, y: 5 }]);

      const weapon = { abilities: ['BLAST'], type: 'ranged' };
      const result = canTargetWithRangedWeapon(
        state.units['u1'], state.units['u2'], state, weapon, 1,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blast');
    });

    it('ranged weapon CAN target unit NOT in ER of friendlies', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      // Enemy far from any friendly
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 30, y: 5 }]);

      const weapon = { abilities: [], type: 'ranged' };
      const result = canTargetWithRangedWeapon(
        state.units['u1'], state.units['u2'], state, weapon, 1,
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('Unit Visibility', () => {
    it('unit is fully visible when all models are fully visible', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [
        { id: 'm2a', x: 25, y: 5 },
        { id: 'm2b', x: 27, y: 5 },
      ]);

      const result = checkUnitVisibility(state.units['u1'], state.units['u2'], state);
      expect(result.status).toBe('fully_visible');
    });

    it('unit is partially visible when some models hidden by terrain', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [
        { id: 'm2a', x: 25, y: 5 },
        { id: 'm2b', x: 25, y: 15 },
      ]);
      // Obscuring terrain blocks one model but not the other
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 20 }, { x: 14, y: 20 }],
        height: 5,
        traits: ['obscuring'],
        label: 'Wall',
      });

      const result = checkUnitVisibility(state.units['u1'], state.units['u2'], state);
      expect(result.status).toBe('partially_visible');
      expect(result.modelVisibility?.['m2a']).toBe('fully_visible');
      expect(result.modelVisibility?.['m2b']).toBe('not_visible');
    });

    it('unit is not visible when all models hidden', () => {
      let state = setupTwoPlayerGame();
      state = addModelsAndUnits(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addModelsAndUnits(state, 'u2', 'p2', [{ id: 'm2', x: 25, y: 5 }]);
      // Large obscuring terrain between them
      state = addTerrain(state, {
        id: 't1',
        polygon: [{ x: 14, y: -5 }, { x: 16, y: -5 }, { x: 16, y: 15 }, { x: 14, y: 15 }],
        height: 10,
        traits: ['obscuring'],
        label: 'Big Wall',
      });

      const result = checkUnitVisibility(state.units['u1'], state.units['u2'], state);
      expect(result.status).toBe('not_visible');
    });
  });
});
