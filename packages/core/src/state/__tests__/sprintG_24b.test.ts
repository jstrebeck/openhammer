import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DiceRoll } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { getPivotCost } from '../../measurement/index';
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
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number; baseShape?: import('../../types/index').BaseShape; move?: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
      baseShape: m.baseShape ?? { type: 'circle', diameterMm: 32 },
      baseSizeMm: m.baseShape?.type === 'circle' ? m.baseShape.diameterMm : 32,
      baseSizeInches: (m.baseShape?.type === 'circle' ? m.baseShape.diameterMm : 32) / 25.4,
      moveCharacteristic: m.move ?? 6,
      stats: { ...makeModel().stats, move: m.move ?? 6 },
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

function setPhase(state: GameState, phaseIndex: number): GameState {
  return {
    ...state,
    turnState: { ...state.turnState, currentPhaseIndex: phaseIndex },
  };
}

function makeDiceRoll(dice: number[], purpose: string, threshold?: number): DiceRoll {
  return {
    id: crypto.randomUUID(),
    dice,
    sides: 6,
    threshold,
    purpose,
    timestamp: Date.now(),
  };
}

// ===============================================
// Phase 24b: Pivot Rules
// ===============================================

describe('Phase 24b: Pivot Rules', () => {
  describe('getPivotCost', () => {
    it('round base (circle) = 0" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'circle', diameterMm: 32 },
      });
      expect(getPivotCost(model, ['INFANTRY'])).toBe(0);
    });

    it('non-round base (oval) = 1" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'oval', widthMm: 75, heightMm: 42 },
      });
      expect(getPivotCost(model, ['INFANTRY'])).toBe(1);
    });

    it('non-round base (rect) = 1" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'rect', widthMm: 60, heightMm: 35 },
      });
      expect(getPivotCost(model, ['INFANTRY'])).toBe(1);
    });

    it('MONSTER non-round base = 2" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'oval', widthMm: 120, heightMm: 92 },
      });
      expect(getPivotCost(model, ['MONSTER'])).toBe(2);
    });

    it('VEHICLE non-round base = 2" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'rect', widthMm: 130, heightMm: 80 },
      });
      expect(getPivotCost(model, ['VEHICLE'])).toBe(2);
    });

    it('round base VEHICLE >32mm with flight stand = 2" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'circle', diameterMm: 60 },
      });
      expect(getPivotCost(model, ['VEHICLE', 'FLY'], { hasFlightStand: true })).toBe(2);
    });

    it('round base VEHICLE >32mm without flight stand = 0" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'circle', diameterMm: 60 },
      });
      expect(getPivotCost(model, ['VEHICLE'])).toBe(0);
    });

    it('round base VEHICLE ≤32mm with flight stand = 0" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'circle', diameterMm: 32 },
      });
      expect(getPivotCost(model, ['VEHICLE', 'FLY'], { hasFlightStand: true })).toBe(0);
    });

    it('MONSTER/VEHICLE with round base = 0" pivot cost', () => {
      const model = makeModel({
        baseShape: { type: 'circle', diameterMm: 100 },
      });
      expect(getPivotCost(model, ['MONSTER', 'VEHICLE'])).toBe(0);
    });
  });

  describe('Pivot cost in movement validation', () => {
    it('round base model can pivot without movement cost', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1); // Movement phase
      state = { ...state, rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' } };

      // Round base model with M6 at position (10,10) facing 0°
      state = addUnit(state, 'unit1', 'p1', [
        { id: 'm1', x: 10, y: 10, baseShape: { type: 'circle', diameterMm: 32 }, move: 6 },
      ], { name: 'Marines' });

      // Declare normal movement
      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      // Move exactly 6" and pivot — should succeed (round = 0" pivot cost)
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'unit1',
          positions: { 'm1': { x: 16, y: 10 } }, // 6" horizontal
          facings: { 'm1': 90 }, // pivoted 90°
        },
      });

      // Should succeed — model moved to new position
      expect(result.models['m1'].position).toEqual({ x: 16, y: 10 });
      expect(result.models['m1'].facing).toBe(90);
    });

    it('non-round base model incurs 1" pivot cost', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1);
      state = { ...state, rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' } };

      // Oval base model with M6 at position (10,10)
      state = addUnit(state, 'unit1', 'p1', [
        { id: 'm1', x: 10, y: 10, baseShape: { type: 'oval', widthMm: 75, heightMm: 42 }, move: 6 },
      ], { name: 'Cavalry' });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      // Try to move exactly 6" and pivot — should be BLOCKED (1" pivot cost → only 5" allowed)
      const blocked = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'unit1',
          positions: { 'm1': { x: 16, y: 10 } }, // 6" horizontal
          facings: { 'm1': 90 }, // pivoted
        },
      });

      const lastLog = blocked.log.entries[blocked.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('BLOCKED');
      }

      // Move 5" with pivot — should succeed (1" pivot + 5" = 6" budget)
      const success = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'unit1',
          positions: { 'm1': { x: 15, y: 10 } }, // 5" horizontal
          facings: { 'm1': 90 },
        },
      });

      expect(success.models['m1'].position).toEqual({ x: 15, y: 10 });
      expect(success.models['m1'].facing).toBe(90);
    });

    it('VEHICLE non-round base incurs 2" pivot cost', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1);
      state = { ...state, rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' } };

      // Rect base VEHICLE with M10
      state = addUnit(state, 'tank', 'p1', [
        { id: 't1', x: 10, y: 10, baseShape: { type: 'rect', widthMm: 130, heightMm: 80 }, move: 10 },
      ], { name: 'Leman Russ', keywords: ['VEHICLE'] });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'tank', moveType: 'normal' },
      });

      // Move 9" with pivot — should be BLOCKED (2" pivot + 9" > 10")
      const blocked = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'tank',
          positions: { 't1': { x: 19, y: 10 } }, // 9"
          facings: { 't1': 45 },
        },
      });

      const lastLog = blocked.log.entries[blocked.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('BLOCKED');
      }

      // Move 8" with pivot — should succeed (2" pivot + 8" = 10" budget)
      const success = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'tank',
          positions: { 't1': { x: 18, y: 10 } }, // 8"
          facings: { 't1': 45 },
        },
      });

      expect(success.models['t1'].position).toEqual({ x: 18, y: 10 });
      expect(success.models['t1'].facing).toBe(45);
    });

    it('no pivot cost when facing does not change', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1);
      state = { ...state, rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' } };

      // Non-round base VEHICLE with M10 — no facing change should mean no cost
      state = addUnit(state, 'tank', 'p1', [
        { id: 't1', x: 10, y: 10, baseShape: { type: 'rect', widthMm: 130, heightMm: 80 }, move: 10 },
      ], { name: 'Leman Russ', keywords: ['VEHICLE'] });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'tank', moveType: 'normal' },
      });

      // Move full 10" with same facing (0°) — should succeed
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'tank',
          positions: { 't1': { x: 20, y: 10 } }, // 10"
          facings: { 't1': 0 }, // same facing
        },
      });

      expect(result.models['t1'].position).toEqual({ x: 20, y: 10 });
    });

    it('no pivot cost when facings not provided (backward compatibility)', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1);
      state = { ...state, rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' } };

      // Non-round base model — but facings not provided, so no pivot cost applied
      state = addUnit(state, 'unit1', 'p1', [
        { id: 'm1', x: 10, y: 10, baseShape: { type: 'rect', widthMm: 60, heightMm: 35 }, move: 6 },
      ], { name: 'Cavalry' });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      // Move full 6" without facings — should succeed (backward compat)
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'unit1',
          positions: { 'm1': { x: 16, y: 10 } },
        },
      });

      expect(result.models['m1'].position).toEqual({ x: 16, y: 10 });
    });

    it('COMMIT_MOVEMENT applies facing to model', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1);

      state = addUnit(state, 'unit1', 'p1', [
        { id: 'm1', x: 10, y: 10, move: 6 },
      ], { name: 'Marines' });

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'unit1', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: {
          unitId: 'unit1',
          positions: { 'm1': { x: 14, y: 10 } },
          facings: { 'm1': 180 },
        },
      });

      expect(result.models['m1'].facing).toBe(180);
    });
  });
});
