import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, PersistingEffect } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { TerrainPiece } from '../../types/terrain';
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

function setPhase(state: GameState, phaseIndex: number): GameState {
  return {
    ...state,
    turnState: { ...state.turnState, currentPhaseIndex: phaseIndex },
  };
}

function enforceMovement(state: GameState): GameState {
  return {
    ...state,
    rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' },
  };
}

function addTerrain(state: GameState, terrain: TerrainPiece): GameState {
  return gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain } });
}

function makeRuins(id: string, x: number, y: number, w: number, h: number, height: number): TerrainPiece {
  const hw = w / 2;
  const hh = h / 2;
  return {
    id,
    polygon: [
      { x: x - hw, y: y - hh },
      { x: x + hw, y: y - hh },
      { x: x + hw, y: y + hh },
      { x: x - hw, y: y + hh },
    ],
    height,
    traits: ['ruins', 'breachable', 'obscuring'],
    label: 'Ruins',
  };
}

function makeBarricade(id: string, x: number, y: number, w: number, h: number): TerrainPiece {
  const hw = w / 2;
  const hh = h / 2;
  return {
    id,
    polygon: [
      { x: x - hw, y: y - hh },
      { x: x + hw, y: y - hh },
      { x: x + hw, y: y + hh },
      { x: x - hw, y: y + hh },
    ],
    height: 2,
    traits: ['defensible'],
    label: 'Barricade',
  };
}

function makeLowTerrain(id: string, x: number, y: number, w: number, h: number): TerrainPiece {
  const hw = w / 2;
  const hh = h / 2;
  return {
    id,
    polygon: [
      { x: x - hw, y: y - hh },
      { x: x + hw, y: y - hh },
      { x: x + hw, y: y + hh },
      { x: x - hw, y: y + hh },
    ],
    height: 1,
    traits: [],
    label: 'Hill',
  };
}

// ===============================================
// Phase 26: Terrain Movement
// ===============================================

describe('Phase 26: Terrain Movement', () => {
  describe('Terrain height ≤2"', () => {
    it('unit moves over low terrain as if not there', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      // Low hill at (15, 10), unit starts at (10, 10)
      state = addTerrain(state, makeLowTerrain('hill1', 15, 10, 4, 4));
      state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      // Move into the low terrain — should succeed (no vertical cost)
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'unit1', positions: { m1: { x: 15, y: 10 } } },
      });

      expect(result.models['m1'].position).toEqual({ x: 15, y: 10 });
    });
  });

  describe('Terrain height >2"', () => {
    it('adds vertical distance when climbing into tall terrain', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      // Tall ruins (height 5") at (14, 10), unit starts at (10, 10) with M6"
      state = addTerrain(state, makeRuins('ruins1', 14, 10, 4, 4, 5));
      state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      // Moving 4" horizontally + 5" climb = 9" total, exceeds M6"
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'unit1', positions: { m1: { x: 14, y: 10 } } },
      });

      // The model moved 4" horizontally + 5" climb = 9" > M6" — should be blocked
      const lastEntry = result.log.entries[result.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('BLOCKED');
        expect(lastEntry.text).toContain('climb');
      }
    });

    it('allows climbing when total distance is within range', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      // Short ruins (height 3") at (12, 10), unit starts at (10, 10) with M6"
      // 2" horizontal + 3" climb = 5" total, within M6"
      state = addTerrain(state, makeRuins('ruins1', 12, 10, 4, 4, 3));
      state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'unit1', positions: { m1: { x: 12, y: 10 } } },
      });

      // Should succeed (2" + 3" = 5" ≤ 6")
      expect(result.models['m1'].position).toEqual({ x: 12, y: 10 });
    });
  });

  describe('Ruins movement restrictions', () => {
    it('INFANTRY can move through ruins', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      // Ruins at (13, 10), height 3" (so climb cost = 3" + 3" horiz = 6" ≤ M6")
      state = addTerrain(state, makeRuins('ruins1', 13, 10, 4, 4, 3));
      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'inf-m1', x: 10, y: 10 }], {
        name: 'Intercessors',
        keywords: ['INFANTRY'],
      });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'inf-unit', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'inf-unit', positions: { 'inf-m1': { x: 13, y: 10 } } },
      });

      expect(result.models['inf-m1'].position).toEqual({ x: 13, y: 10 });
    });

    it('VEHICLE is blocked from entering ruins', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      state = addTerrain(state, makeRuins('ruins1', 13, 10, 4, 4, 5));
      state = addUnit(state, 'tank-unit', 'p1', [{ id: 'tank-m1', x: 10, y: 10 }], {
        name: 'Leman Russ',
        keywords: ['VEHICLE'],
      });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'tank-unit', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'tank-unit', positions: { 'tank-m1': { x: 13, y: 10 } } },
      });

      // Should be blocked
      const lastEntry = result.log.entries[result.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('BLOCKED');
        expect(lastEntry.text).toContain('INFANTRY');
      }
    });

    it('FLY unit can enter ruins', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1);

      state = addTerrain(state, makeRuins('ruins1', 13, 10, 4, 4, 3));
      state = addUnit(state, 'fly-unit', 'p1', [{ id: 'fly-m1', x: 10, y: 10 }], {
        name: 'Jump Pack',
        keywords: ['VEHICLE', 'FLY'],
      });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'fly-unit', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'fly-unit', positions: { 'fly-m1': { x: 13, y: 10 } } },
      });

      // FLY keyword allows entry (but still costs height)
      // 3" horizontal + 3" climb = 6" ≤ M6"
      expect(result.models['fly-m1'].position).toEqual({ x: 13, y: 10 });
    });
  });

  describe('Barricade charge restrictions', () => {
    it('cannot charge through a barricade', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 3); // Charge phase

      // Barricade between charger and target
      state = addTerrain(state, makeBarricade('barricade1', 15, 10, 6, 1));

      state = addUnit(state, 'charger', 'p1', [{ id: 'ch-m1', x: 10, y: 10 }], {
        name: 'Assault Squad',
      });
      state = addUnit(state, 'target', 'p2', [{ id: 'tg-m1', x: 20, y: 10 }], {
        name: 'Defenders',
      });

      // Declare charge
      state = gameReducer(state, {
        type: 'DECLARE_CHARGE',
        payload: { unitId: 'charger', targetUnitIds: ['target'] },
      });

      // Roll charge (high roll to ensure distance is OK)
      const roll = { id: 'cr1', dice: [6, 6], sides: 6, purpose: 'Charge', timestamp: Date.now() };
      state = gameReducer(state, {
        type: 'ROLL_CHARGE',
        payload: { unitId: 'charger', roll, total: 12 },
      });

      // Try to commit charge move through barricade
      const result = gameReducer(state, {
        type: 'COMMIT_CHARGE_MOVE',
        payload: { unitId: 'charger', positions: { 'ch-m1': { x: 20, y: 10 } } },
      });

      // Should be blocked
      const messages = result.log.entries.filter(e => e.type === 'message');
      const blockedMsg = messages.find(e => e.type === 'message' && e.text.includes('Barricade'));
      expect(blockedMsg).toBeDefined();
      expect(result.models['ch-m1'].position).toEqual({ x: 10, y: 10 }); // not moved
    });
  });
});

// ===============================================
// Phase 26: Persisting Effects
// ===============================================

describe('Phase 26: Persisting Effects', () => {
  it('adds and removes persisting effects', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const effect: PersistingEffect = {
      id: 'eff-1',
      type: 'stealth',
      targetUnitId: 'unit1',
      sourceId: 'ability',
      expiresAt: { type: 'phase_end' },
    };

    state = gameReducer(state, {
      type: 'ADD_PERSISTING_EFFECT',
      payload: { effect },
    });

    expect(state.persistingEffects).toHaveLength(1);
    expect(state.persistingEffects[0].type).toBe('stealth');

    const result = gameReducer(state, {
      type: 'REMOVE_PERSISTING_EFFECT',
      payload: { effectId: 'eff-1' },
    });

    expect(result.persistingEffects).toHaveLength(0);
  });

  it('auto-expires phase_end effects on ADVANCE_PHASE', () => {
    let state = setupTwoPlayerGame();
    state = setPhase(state, 1);
    state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const phaseEffect: PersistingEffect = {
      id: 'pe-1',
      type: 'cover_bonus',
      targetUnitId: 'unit1',
      expiresAt: { type: 'phase_end' },
    };
    const turnEffect: PersistingEffect = {
      id: 'te-1',
      type: 'stealth',
      targetUnitId: 'unit1',
      expiresAt: { type: 'turn_end' },
    };

    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect: phaseEffect } });
    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect: turnEffect } });

    expect(state.persistingEffects).toHaveLength(2);

    const result = gameReducer(state, { type: 'ADVANCE_PHASE' });

    // Phase-end effect expired, turn-end effect survives
    expect(result.persistingEffects).toHaveLength(1);
    expect(result.persistingEffects[0].id).toBe('te-1');
  });

  it('auto-expires turn_end effects on NEXT_TURN', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const turnEffect: PersistingEffect = {
      id: 'te-1',
      type: 'stealth',
      targetUnitId: 'unit1',
      expiresAt: { type: 'turn_end' },
    };
    const manualEffect: PersistingEffect = {
      id: 'me-1',
      type: 'buff',
      targetUnitId: 'unit1',
      expiresAt: { type: 'manual' },
    };

    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect: turnEffect } });
    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect: manualEffect } });

    const result = gameReducer(state, { type: 'NEXT_TURN' });

    // Turn-end effect expired, manual effect survives
    expect(result.persistingEffects).toHaveLength(1);
    expect(result.persistingEffects[0].id).toBe('me-1');
  });

  it('persisting effects survive embark/disembark (keyed by unit ID)', () => {
    let state = setupTwoPlayerGame();

    // Create transport and unit
    const transportModels = [makeModel({ id: 'tr-m1', unitId: 'transport1', position: { x: 10, y: 10 }, wounds: 10, maxWounds: 10 })];
    const transport = makeUnit({
      id: 'transport1', playerId: 'p1', modelIds: ['tr-m1'],
      keywords: ['VEHICLE', 'TRANSPORT'], transportCapacity: 12,
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: transport, models: transportModels } });

    state = addUnit(state, 'embarker', 'p1', [{ id: 'emb-m1', x: 11, y: 10 }], {
      keywords: ['INFANTRY'],
    });

    // Add effect to the unit
    const effect: PersistingEffect = {
      id: 'eff-emb',
      type: 'buff',
      targetUnitId: 'embarker',
      expiresAt: { type: 'manual' },
    };
    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect } });
    expect(state.persistingEffects).toHaveLength(1);

    // Embark
    state = gameReducer(state, {
      type: 'EMBARK',
      payload: { unitId: 'embarker', transportId: 'transport1' },
    });

    // Effect should survive (persisting effects are on GameState, not on the unit)
    expect(state.persistingEffects).toHaveLength(1);
    expect(state.persistingEffects[0].targetUnitId).toBe('embarker');
  });

  it('round_end effects expire when round advances', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'unit1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const roundEffect: PersistingEffect = {
      id: 're-1',
      type: 'round_buff',
      targetUnitId: 'unit1',
      expiresAt: { type: 'round_end', round: 1 },
    };

    state = gameReducer(state, { type: 'ADD_PERSISTING_EFFECT', payload: { effect: roundEffect } });

    // P1's turn ends → P2's turn (still round 1)
    state = gameReducer(state, { type: 'NEXT_TURN' });
    // Effect should still exist (round 1 not over yet)
    expect(state.persistingEffects).toHaveLength(1);

    // P2's turn ends → round 2 starts
    const result = gameReducer(state, { type: 'NEXT_TURN' });
    // Effect should be expired (round advanced past 1)
    expect(result.persistingEffects).toHaveLength(0);
  });
});
