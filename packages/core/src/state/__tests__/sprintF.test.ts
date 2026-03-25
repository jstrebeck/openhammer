import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { makeModel, makeUnit, makePlayer, makeAircraftUnit } from '../../test-helpers';
import { doesPathCrossModel } from '../../measurement/index';
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

/** Set the current phase index (0=command, 1=movement, 2=shooting, 3=charge, 4=fight) */
function setPhase(state: GameState, phaseIndex: number): GameState {
  return {
    ...state,
    turnState: { ...state.turnState, currentPhaseIndex: phaseIndex },
  };
}

/** Enable movement range enforcement only (not phase restrictions, to avoid blocking cross-phase test actions) */
function enforceMovement(state: GameState): GameState {
  return {
    ...state,
    rulesConfig: { ...state.rulesConfig, movementRange: 'enforce' },
  };
}

/** Enable phase restrictions enforcement */
function enforcePhaseRestrictions(state: GameState): GameState {
  return {
    ...state,
    rulesConfig: { ...state.rulesConfig, phaseRestrictions: 'enforce' },
  };
}

// ===============================================
// Phase 21: Movement & Combat Validation
// ===============================================

describe('Phase 21: Movement & Combat Validation', () => {
  // --- Path collision detection (measurement utility) ---

  describe('doesPathCrossModel', () => {
    it('detects path crossing through a model base', () => {
      const obstacle = makeModel({ id: 'obs', position: { x: 10, y: 10 } });
      const result = doesPathCrossModel({ x: 5, y: 10 }, { x: 15, y: 10 }, obstacle);
      expect(result).toBe(true);
    });

    it('returns false when path misses the model', () => {
      const obstacle = makeModel({ id: 'obs', position: { x: 10, y: 10 } });
      const result = doesPathCrossModel({ x: 5, y: 20 }, { x: 15, y: 20 }, obstacle);
      expect(result).toBe(false);
    });

    it('returns false for zero-length path', () => {
      const obstacle = makeModel({ id: 'obs', position: { x: 10, y: 10 } });
      const result = doesPathCrossModel({ x: 5, y: 5 }, { x: 5, y: 5 }, obstacle);
      expect(result).toBe(false);
    });
  });

  // --- FLY movement ---

  describe('FLY movement', () => {
    it('FLY unit can move through enemy models', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1); // Movement phase

      // FLY unit at (10, 10), enemy at (15, 10)
      state = addUnit(state, 'fly-unit', 'p1', [{ id: 'fly-m1', x: 10, y: 10 }], {
        name: 'Jump Pack',
        keywords: ['INFANTRY', 'FLY'],
      });
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'enemy-m1', x: 15, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'fly-unit', moveType: 'normal' },
      });

      // Move through enemy area but end far from engagement range
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'fly-unit', positions: { 'fly-m1': { x: 13, y: 14 } } },
      });

      // Should succeed (FLY skips path collision)
      expect(result.models['fly-m1'].position).toEqual({ x: 13, y: 14 });
    });

    it('non-FLY unit blocked from moving through enemy models', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1); // Movement phase

      // Infantry at (10, 10), enemy at (13, 10), moving to (16, 10) — path crosses enemy
      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'inf-m1', x: 10, y: 10 }], {
        name: 'Intercessors',
        keywords: ['INFANTRY'],
      });
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'enemy-m1', x: 13, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'inf-unit', moveType: 'normal' },
      });

      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'inf-unit', positions: { 'inf-m1': { x: 16, y: 10 } } },
      });

      // Should be blocked
      expect(result.models['inf-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e => e.type === 'message' && e.text.includes('[BLOCKED]'))).toBe(true);
    });
  });

  // --- Charge move validation ---

  describe('Charge move validation', () => {
    it('charge move blocked if distance exceeds charge roll', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 3); // Charge phase

      state = addUnit(state, 'charge-unit', 'p1', [{ id: 'ch-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'target-unit', 'p2', [{ id: 'tgt-m1', x: 20, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_CHARGE',
        payload: { unitId: 'charge-unit', targetUnitIds: ['target-unit'] },
      });

      state = gameReducer(state, {
        type: 'ROLL_CHARGE',
        payload: {
          unitId: 'charge-unit',
          roll: { id: 'r1', dice: [2, 3], sides: 6, purpose: 'Charge', timestamp: Date.now() },
          total: 5,
        },
      });

      // Try to move 8" — should be blocked (rolled 5)
      const result = gameReducer(state, {
        type: 'COMMIT_CHARGE_MOVE',
        payload: { unitId: 'charge-unit', positions: { 'ch-m1': { x: 18, y: 10 } } },
      });

      expect(result.models['ch-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e => e.type === 'message' && e.text.includes('[BLOCKED]'))).toBe(true);
    });

    it('charge must end in Engagement Range of all declared targets', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 3); // Charge phase

      state = addUnit(state, 'charge-unit', 'p1', [{ id: 'ch-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'target-a', 'p2', [{ id: 'tgt-a1', x: 15, y: 10 }]);
      state = addUnit(state, 'target-b', 'p2', [{ id: 'tgt-b1', x: 15, y: 20 }]);

      state = gameReducer(state, {
        type: 'DECLARE_CHARGE',
        payload: { unitId: 'charge-unit', targetUnitIds: ['target-a', 'target-b'] },
      });

      state = gameReducer(state, {
        type: 'ROLL_CHARGE',
        payload: {
          unitId: 'charge-unit',
          roll: { id: 'r1', dice: [6, 6], sides: 6, purpose: 'Charge', timestamp: Date.now() },
          total: 12,
        },
      });

      // Move to be in ER of target-a but NOT target-b (>10" away from target-b)
      const result = gameReducer(state, {
        type: 'COMMIT_CHARGE_MOVE',
        payload: { unitId: 'charge-unit', positions: { 'ch-m1': { x: 14.3, y: 10 } } },
      });

      expect(result.models['ch-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('Must end in Engagement Range')
      )).toBe(true);
    });

    it('successful charge move when all conditions met', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 3); // Charge phase

      state = addUnit(state, 'charge-unit', 'p1', [{ id: 'ch-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'target-unit', 'p2', [{ id: 'tgt-m1', x: 14, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_CHARGE',
        payload: { unitId: 'charge-unit', targetUnitIds: ['target-unit'] },
      });

      state = gameReducer(state, {
        type: 'ROLL_CHARGE',
        payload: {
          unitId: 'charge-unit',
          roll: { id: 'r1', dice: [4, 4], sides: 6, purpose: 'Charge', timestamp: Date.now() },
          total: 8,
        },
      });

      // Move right next to target — within engagement range
      // 32mm base = ~1.26" diameter = ~0.63" radius
      // Position (13.2, 10) to (14, 10) = 0.8" center-to-center, edge = 0.8-1.26 < 0 (overlapping)
      const result = gameReducer(state, {
        type: 'COMMIT_CHARGE_MOVE',
        payload: { unitId: 'charge-unit', positions: { 'ch-m1': { x: 13.2, y: 10 } } },
      });

      expect(result.models['ch-m1'].position).toEqual({ x: 13.2, y: 10 });
      expect(result.chargeState.successfulCharges).toContain('charge-unit');
    });
  });

  // --- Pile In validation ---

  describe('Pile In validation', () => {
    it('pile-in must end closer to closest enemy', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 12, y: 10 }]);

      // Move AWAY from enemy — should be blocked
      const result = gameReducer(state, {
        type: 'PILE_IN',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 8, y: 10 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('must end closer')
      )).toBe(true);
    });

    it('pile-in closer to enemy succeeds', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 14, y: 10 }]);

      const result = gameReducer(state, {
        type: 'PILE_IN',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 12, y: 10 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 12, y: 10 });
    });

    it('pile-in blocked if exceeds 3"', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 20, y: 10 }]);

      // Move 5" — exceeds 3" max
      const result = gameReducer(state, {
        type: 'PILE_IN',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 15, y: 10 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('max is 3')
      )).toBe(true);
    });
  });

  // --- Consolidate validation ---

  describe('Consolidate validation', () => {
    it('consolidate moves toward enemy succeeds', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 14, y: 10 }]);

      const result = gameReducer(state, {
        type: 'CONSOLIDATE',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 12, y: 10 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 12, y: 10 });
    });

    it('consolidate moves toward objective when no closer enemy', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      // Enemy is behind us
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 5, y: 10 }]);

      // Objective ahead
      state = {
        ...state,
        objectives: {
          'obj-1': { id: 'obj-1', position: { x: 20, y: 10 }, number: 1 },
        },
      };

      // Move away from enemy but toward objective
      const result = gameReducer(state, {
        type: 'CONSOLIDATE',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 13, y: 10 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 13, y: 10 });
    });

    it('consolidate blocked if not moving toward enemy or objective', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'fight-unit', 'p1', [{ id: 'f-m1', x: 10, y: 10 }]);
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 14, y: 10 }]);

      // Move perpendicular — not closer to enemy, no objective
      const result = gameReducer(state, {
        type: 'CONSOLIDATE',
        payload: { unitId: 'fight-unit', positions: { 'f-m1': { x: 10, y: 13 } } },
      });

      expect(result.models['f-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('must consolidate closer')
      )).toBe(true);
    });
  });

  // --- Melee target eligibility ---

  describe('Melee target eligibility', () => {
    it('melee target reachable via base-to-base chain', () => {
      let state = setupTwoPlayerGame();
      state = enforcePhaseRestrictions(state);
      state = setPhase(state, 4); // Fight phase

      // Attacker at (10,10), chain link at (10.5,10), target at (11,10)
      // All in base-to-base contact (32mm base ≈ 1.26", centers <1.26" apart)
      state = addUnit(state, 'attack-unit', 'p1', [{ id: 'a-m1', x: 10, y: 10 }], {
        name: 'Attackers',
        weapons: [{ id: 'w1', name: 'Chainsword', type: 'melee', attacks: 3, skill: 3, strength: 4, ap: 0, damage: 1, abilities: [] }],
      });
      state = addUnit(state, 'chain-unit', 'p1', [{ id: 'c-m1', x: 10.5, y: 10 }], {
        name: 'Chain Link',
      });
      state = addUnit(state, 'target-unit', 'p2', [{ id: 't-m1', x: 11, y: 10 }], {
        name: 'Targets',
      });

      const result = gameReducer(state, {
        type: 'RESOLVE_MELEE_ATTACK',
        payload: {
          attackingUnitId: 'attack-unit',
          attackingModelId: 'a-m1',
          weaponId: 'w1',
          weaponName: 'Chainsword',
          targetUnitId: 'target-unit',
          numAttacks: 3,
          hitRoll: { id: 'r1', dice: [4, 5, 3], sides: 6, threshold: 3, purpose: 'To Hit', timestamp: Date.now() },
          hits: 3,
          woundRoll: { id: 'r2', dice: [4, 5, 3], sides: 6, threshold: 4, purpose: 'To Wound', timestamp: Date.now() },
          wounds: 2,
        },
      });

      // Should succeed via base-to-base chain
      expect(result.fightState.activeAttacks.length).toBe(1);
    });
  });

  // --- Aircraft engagement range exemption ---

  describe('Aircraft engagement range exemption', () => {
    it('non-FLY unit cannot end in Engagement Range of AIRCRAFT', () => {
      let state = setupTwoPlayerGame();
      state = enforceMovement(state);
      state = setPhase(state, 1); // Movement phase

      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'inf-m1', x: 10, y: 10 }], {
        keywords: ['INFANTRY'],
      });
      state = addAircraft(state, 'aircraft-unit', 'p2', [{ id: 'air-m1', x: 14, y: 10 }]);

      state = gameReducer(state, {
        type: 'DECLARE_MOVEMENT',
        payload: { unitId: 'inf-unit', moveType: 'normal' },
      });

      // Try to end within 1" of aircraft
      // (14, 10) to (13.5, 10) = 0.5" center-to-center, edge-to-edge < 0 (overlap) — within ER
      const result = gameReducer(state, {
        type: 'COMMIT_MOVEMENT',
        payload: { unitId: 'inf-unit', positions: { 'inf-m1': { x: 13.5, y: 10 } } },
      });

      expect(result.models['inf-m1'].position).toEqual({ x: 10, y: 10 });
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('AIRCRAFT')
      )).toBe(true);
    });
  });
});
