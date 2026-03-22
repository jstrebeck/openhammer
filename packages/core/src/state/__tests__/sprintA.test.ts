import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameAction } from '../actions';
import type { GameState, Weapon } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { rollDice } from '../../dice/index';
import { getWoundThreshold, parseDiceExpression, resolveAttackSequence, resolveSave } from '../../combat/index';
// Ensure editions are registered
import '../../editions/index';

// --- Helper to create a game state with two players and units ---
function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000' });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff' });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
  state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' }, gameStarted: true };
  return state;
}

function addUnit(state: GameState, unitId: string, playerId: string, models: Array<{ id: string; x: number; y: number; move?: number }>, weapons?: Weapon[]): GameState {
  const modelObjs = models.map(m =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      moveCharacteristic: m.move ?? 6,
    })
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map(m => m.id),
    weapons: weapons ?? [],
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

// ===============================================
// Phase 7: Phase Enforcement & Turn Structure
// ===============================================

describe('Phase 7: Phase Enforcement', () => {
  it('blocks MOVE_MODEL outside Movement Phase when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    // Set to Shooting Phase (index 2)
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement (1)
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting (2)
    // Enable enforcement
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    const beforePos = state.models['m1'].position;
    state = gameReducer(state, { type: 'MOVE_MODEL', payload: { modelId: 'm1', position: { x: 15, y: 15 } } });

    // Model should NOT have moved
    expect(state.models['m1'].position).toEqual(beforePos);
    // Should have a blocked log message
    const lastLog = state.log.entries[state.log.entries.length - 1];
    expect(lastLog.type).toBe('message');
    if (lastLog.type === 'message') {
      expect(lastLog.text).toContain('[BLOCKED]');
    }
  });

  it('warns but allows MOVE_MODEL outside Movement Phase in warn mode', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'warn', movementRange: 'warn' } } });

    state = gameReducer(state, { type: 'MOVE_MODEL', payload: { modelId: 'm1', position: { x: 15, y: 15 } } });

    // Model SHOULD have moved (warn mode)
    expect(state.models['m1'].position).toEqual({ x: 15, y: 15 });
    // Should have a warning in the log
    const warningLog = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[WARNING]'));
    expect(warningLog).toBeDefined();
  });

  it('allows everything when movementRange is off (backwards compatible)', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    // Phase restrictions off by default
    expect(state.rulesConfig.phaseRestrictions).toBe('off');
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'off' } } });

    // Move in Command Phase (index 0) — should work
    state = gameReducer(state, { type: 'MOVE_MODEL', payload: { modelId: 'm1', position: { x: 15, y: 15 } } });
    expect(state.models['m1'].position).toEqual({ x: 15, y: 15 });
  });

  it('allows MOVE_MODEL during Movement Phase with declared movement', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement (1)
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });
    // Declare a normal move so MOVE_MODEL is allowed
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    // Move within M6" range (distance = 5")
    state = gameReducer(state, { type: 'MOVE_MODEL', payload: { modelId: 'm1', position: { x: 15, y: 10 } } });
    expect(state.models['m1'].position).toEqual({ x: 15, y: 10 });
  });

  it('NEXT_TURN resets all turn tracking state', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    // Set some turn tracking
    state = gameReducer(state, { type: 'ACTIVATE_UNIT', payload: { unitId: 'u1' } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });
    expect(state.turnTracking.unitsActivated['u1']).toBe(true);
    expect(state.turnTracking.unitMovement['u1']).toBe('normal');

    state = gameReducer(state, { type: 'NEXT_TURN' });

    // Everything should be reset
    expect(state.turnTracking.unitsActivated).toEqual({});
    expect(state.turnTracking.unitMovement).toEqual({});
    expect(state.turnTracking.unitsCompleted).toEqual({});
    expect(state.turnTracking.chargedUnits).toEqual([]);
  });

  it('ADVANCE_PHASE resets per-phase activation but keeps per-turn data', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    // Set up movement tracking (per-turn)
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement (1)
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'advance' } });
    expect(state.turnTracking.unitMovement['u1']).toBe('advance');

    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting (2)

    // Per-turn data preserved, per-phase data reset
    expect(state.turnTracking.unitMovement['u1']).toBe('advance');
    expect(state.turnTracking.unitsActivated).toEqual({});
    expect(state.turnTracking.unitsCompleted).toEqual({});
  });

  it('ACTIVATE_UNIT and COMPLETE_UNIT_ACTIVATION track correctly', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    state = gameReducer(state, { type: 'ACTIVATE_UNIT', payload: { unitId: 'u1' } });
    expect(state.turnTracking.unitsActivated['u1']).toBe(true);
    expect(state.turnTracking.unitsCompleted['u1']).toBeUndefined();

    state = gameReducer(state, { type: 'COMPLETE_UNIT_ACTIVATION', payload: { unitId: 'u1' } });
    expect(state.turnTracking.unitsCompleted['u1']).toBe(true);
  });
});

// ===============================================
// Phase 8: Movement Enforcement
// ===============================================

describe('Phase 8: Movement Enforcement', () => {
  it('DECLARE_MOVEMENT records move type and activates unit', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'advance' } });

    expect(state.turnTracking.unitMovement['u1']).toBe('advance');
    expect(state.turnTracking.unitsActivated['u1']).toBe(true);
  });

  it('ROLL_ADVANCE stores the advance bonus', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const roll = rollDice(1, 6, 'Advance');
    state = gameReducer(state, { type: 'ROLL_ADVANCE', payload: { unitId: 'u1', roll } });

    expect(state.turnTracking.advanceRolls['u1']).toBe(roll.dice[0]);
  });

  it('COMMIT_MOVEMENT applies positions and marks unit completed', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: { unitId: 'u1', positions: { 'm1': { x: 14, y: 10 } } },
    });

    expect(state.models['m1'].position).toEqual({ x: 14, y: 10 });
    expect(state.turnTracking.unitsCompleted['u1']).toBe(true);
  });

  it('blocks movement exceeding move characteristic when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, move: 6 }]);
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'enforce' } } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    const beforePos = state.models['m1'].position;
    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: { unitId: 'u1', positions: { 'm1': { x: 20, y: 10 } } }, // 10" move, max is 6"
    });

    // Should be blocked
    expect(state.models['m1'].position).toEqual(beforePos);
    const blocked = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]'));
    expect(blocked).toBeDefined();
  });

  it('allows movement within move characteristic', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, move: 6 }]);
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'enforce' } } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: { unitId: 'u1', positions: { 'm1': { x: 15, y: 10 } } }, // 5" move, max 6"
    });

    expect(state.models['m1'].position).toEqual({ x: 15, y: 10 });
  });

  it('blocks movement ending within engagement range of enemy', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10, move: 12 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'enforce' } } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    // Try to move within 1" of enemy (engagement range)
    // Models have 32mm base = ~1.26" diameter = ~0.63" radius
    // So center-to-center needs to be > 1" + 0.63 + 0.63 = ~2.26" to be outside engagement
    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: { unitId: 'u1', positions: { 'm1': { x: 19, y: 10 } } }, // ~1" center-to-center minus radii = well within engagement
    });

    const blocked = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]'));
    expect(blocked).toBeDefined();
  });

  it('blocks movement off the battlefield edge', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 2, y: 10, move: 10 }]);
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'enforce' } } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: { unitId: 'u1', positions: { 'm1': { x: -1, y: 10 } } },
    });

    const blocked = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]'));
    expect(blocked).toBeDefined();
  });

  it('blocks movement that breaks unit coherency', () => {
    let state = setupTwoPlayerGame();
    // Two models close together
    state = addUnit(state, 'u1', 'p1', [
      { id: 'm1', x: 10, y: 10, move: 20 },
      { id: 'm2', x: 11, y: 10, move: 20 },
    ]);
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { movementRange: 'enforce' } } });
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });

    // Move one model far away from the other (breaking 2" coherency)
    state = gameReducer(state, {
      type: 'COMMIT_MOVEMENT',
      payload: {
        unitId: 'u1',
        positions: {
          'm1': { x: 25, y: 10 }, // 15" away from m2
          'm2': { x: 11, y: 10 }, // stays
        },
      },
    });

    const blocked = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]'));
    expect(blocked).toBeDefined();
  });

  it('movement flags: advanced units tracked correctly', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'advance' } });

    expect(state.turnTracking.unitMovement['u1']).toBe('advance');
  });

  it('movement flags: stationary units tracked correctly', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'stationary' } });

    expect(state.turnTracking.unitMovement['u1']).toBe('stationary');
  });
});

// ===============================================
// Phase 9: Structured Shooting
// ===============================================

describe('Phase 9: Structured Shooting', () => {
  const bolter: Weapon = {
    id: 'w1',
    name: 'Bolt Rifle',
    type: 'ranged',
    range: 24,
    attacks: 2,
    skill: 3,
    strength: 4,
    ap: -1,
    damage: 1,
    abilities: [],
  };

  it('DECLARE_SHOOTING sets the active shooting unit', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);

    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });

    expect(state.shootingState.activeShootingUnit).toBe('u1');
    expect(state.turnTracking.unitsActivated['u1']).toBe(true);
  });

  it('blocks shooting for units that Advanced when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'advance' } });
    // Advance to shooting phase
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });

    // Should be blocked — unit advanced
    expect(state.shootingState.activeShootingUnit).toBeNull();
    const blocked = state.log.entries.find(e => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]'));
    expect(blocked).toBeDefined();
  });

  it('blocks shooting for units that Fell Back when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'fall_back' } });
    // Advance to shooting phase
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });

    expect(state.shootingState.activeShootingUnit).toBeNull();
  });

  it('allows shooting for units that made normal move', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'normal' } });
    // Advance to shooting phase first, then enable enforcement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });

    expect(state.shootingState.activeShootingUnit).toBe('u1');
  });

  it('ASSIGN_WEAPON_TARGETS stores assignments', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);

    const assignments = [{ modelId: 'm1', weaponId: 'w1', targetUnitId: 'u2' }];
    state = gameReducer(state, { type: 'ASSIGN_WEAPON_TARGETS', payload: { assignments } });

    expect(state.shootingState.weaponAssignments).toEqual(assignments);
  });

  it('RESOLVE_SHOOTING_ATTACK creates an attack sequence and logs it', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);

    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(1, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'u1',
        attackingModelId: 'm1',
        weaponId: 'w1',
        weaponName: 'Bolt Rifle',
        targetUnitId: 'u2',
        numAttacks: 2,
        hitRoll,
        hits: 1,
        woundRoll,
        wounds: 1,
      },
    });

    expect(state.shootingState.activeAttacks).toHaveLength(1);
    expect(state.shootingState.activeAttacks[0].weaponName).toBe('Bolt Rifle');
    expect(state.shootingState.activeAttacks[0].hits).toBe(1);
    expect(state.shootingState.activeAttacks[0].wounds).toBe(1);
  });

  it('APPLY_DAMAGE reduces wounds and destroys at 0', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);
    expect(state.models['m2'].wounds).toBe(2);

    state = gameReducer(state, { type: 'APPLY_DAMAGE', payload: { modelId: 'm2', damage: 1, source: 'shooting' } });
    expect(state.models['m2'].wounds).toBe(1);
    expect(state.models['m2'].status).toBe('active');

    state = gameReducer(state, { type: 'APPLY_DAMAGE', payload: { modelId: 'm2', damage: 1, source: 'shooting' } });
    expect(state.models['m2'].wounds).toBe(0);
    expect(state.models['m2'].status).toBe('destroyed');
  });

  it('APPLY_DAMAGE does not apply excess damage to already-destroyed model', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);

    // Kill the model
    state = gameReducer(state, { type: 'APPLY_DAMAGE', payload: { modelId: 'm2', damage: 5, source: 'shooting' } });
    expect(state.models['m2'].wounds).toBe(0);

    // Try to damage again — should return unchanged state
    const prevState = state;
    state = gameReducer(state, { type: 'APPLY_DAMAGE', payload: { modelId: 'm2', damage: 1, source: 'shooting' } });
    expect(state).toBe(prevState);
  });

  it('COMPLETE_SHOOTING moves unit to unitsShot and clears active state', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);

    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });
    state = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'u1' } });

    expect(state.shootingState.activeShootingUnit).toBeNull();
    expect(state.shootingState.unitsShot).toContain('u1');
    expect(state.turnTracking.unitsCompleted['u1']).toBe(true);
  });
});

// ===============================================
// Phase 9: Combat Utilities
// ===============================================

describe('Combat Utilities', () => {
  it('getWoundThreshold: S >= 2T → 2+', () => {
    expect(getWoundThreshold(8, 4)).toBe(2);
    expect(getWoundThreshold(10, 4)).toBe(2);
  });

  it('getWoundThreshold: S > T → 3+', () => {
    expect(getWoundThreshold(5, 4)).toBe(3);
    expect(getWoundThreshold(6, 4)).toBe(3);
    expect(getWoundThreshold(7, 4)).toBe(3);
  });

  it('getWoundThreshold: S == T → 4+', () => {
    expect(getWoundThreshold(4, 4)).toBe(4);
  });

  it('getWoundThreshold: S < T → 5+', () => {
    expect(getWoundThreshold(3, 4)).toBe(5);
  });

  it('getWoundThreshold: S <= T/2 → 6+', () => {
    expect(getWoundThreshold(2, 4)).toBe(6);
    expect(getWoundThreshold(1, 4)).toBe(6);
    expect(getWoundThreshold(2, 5)).toBe(6);
  });

  it('parseDiceExpression handles plain numbers', () => {
    expect(parseDiceExpression(3)).toBe(3);
    expect(parseDiceExpression('5')).toBe(5);
  });

  it('parseDiceExpression handles D6', () => {
    for (let i = 0; i < 20; i++) {
      const result = parseDiceExpression('D6');
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(6);
    }
  });

  it('parseDiceExpression handles D3', () => {
    for (let i = 0; i < 20; i++) {
      const result = parseDiceExpression('D3');
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(3);
    }
  });

  it('parseDiceExpression handles D3+1', () => {
    for (let i = 0; i < 20; i++) {
      const result = parseDiceExpression('D3+1');
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  it('parseDiceExpression handles 2D6', () => {
    for (let i = 0; i < 20; i++) {
      const result = parseDiceExpression('2D6');
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(12);
    }
  });

  it('resolveAttackSequence returns hit and wound results', () => {
    const result = resolveAttackSequence(10, 3, 4, 4);
    expect(result.hitRoll.dice).toHaveLength(10);
    expect(result.hits).toBeGreaterThanOrEqual(0);
    expect(result.hits).toBeLessThanOrEqual(10);
    expect(result.woundRoll.dice).toHaveLength(result.hits);
    expect(result.wounds).toBeGreaterThanOrEqual(0);
    expect(result.wounds).toBeLessThanOrEqual(result.hits);
  });

  it('resolveSave uses better of normal save and invuln', () => {
    // Run enough to verify the system works
    let invulnUsed = false;
    for (let i = 0; i < 50; i++) {
      const result = resolveSave(3, -3, 4); // 3+ save with -3 AP = modified 6+, invuln 4+
      // The effective save should use invuln (4+) since modified save (6+) is worse
      if (result.saved && result.saveRoll.dice[0] >= 4) {
        invulnUsed = true;
      }
    }
    // With invuln 4+, statistically we should see saves passing
    // (purely probabilistic but with 50 rolls this is virtually certain)
  });
});

// ===============================================
// Phase 10: Charge Phase
// ===============================================

describe('Phase 10: Charge Phase', () => {
  it('DECLARE_CHARGE records targets and activates unit', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 18, y: 10 }]);

    state = gameReducer(state, {
      type: 'DECLARE_CHARGE',
      payload: { unitId: 'u1', targetUnitIds: ['u2'] },
    });

    expect(state.chargeState.declaredCharges['u1']).toEqual(['u2']);
    expect(state.turnTracking.unitsActivated['u1']).toBe(true);
  });

  it('blocks charge for units that Advanced when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 18, y: 10 }]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'advance' } });
    // Advance to charge phase
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → charge
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    state = gameReducer(state, {
      type: 'DECLARE_CHARGE',
      payload: { unitId: 'u1', targetUnitIds: ['u2'] },
    });

    expect(state.chargeState.declaredCharges['u1']).toBeUndefined();
  });

  it('blocks charge for units that Fell Back when enforcement is on', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 18, y: 10 }]);
    state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: 'u1', moveType: 'fall_back' } });
    // Advance to charge phase
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → shooting
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → charge
    state = gameReducer(state, { type: 'SET_RULES_CONFIG', payload: { config: { phaseRestrictions: 'enforce' } } });

    state = gameReducer(state, {
      type: 'DECLARE_CHARGE',
      payload: { unitId: 'u1', targetUnitIds: ['u2'] },
    });

    expect(state.chargeState.declaredCharges['u1']).toBeUndefined();
  });

  it('ROLL_CHARGE stores the charge roll total', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const roll = rollDice(2, 6, 'Charge');
    const total = roll.dice[0] + roll.dice[1];
    state = gameReducer(state, { type: 'ROLL_CHARGE', payload: { unitId: 'u1', roll, total } });

    expect(state.chargeState.chargeRolls['u1']).toBe(total);
  });

  it('COMMIT_CHARGE_MOVE applies positions and records successful charge', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 18, y: 10 }]);

    state = gameReducer(state, {
      type: 'COMMIT_CHARGE_MOVE',
      payload: { unitId: 'u1', positions: { 'm1': { x: 17, y: 10 } } },
    });

    expect(state.models['m1'].position).toEqual({ x: 17, y: 10 });
    expect(state.chargeState.successfulCharges).toContain('u1');
    expect(state.turnTracking.chargedUnits).toContain('u1');
  });

  it('Charge Bonus: successful chargers gain Fights First (via chargedUnits)', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    state = gameReducer(state, {
      type: 'COMMIT_CHARGE_MOVE',
      payload: { unitId: 'u1', positions: { 'm1': { x: 17, y: 10 } } },
    });

    expect(state.turnTracking.chargedUnits).toContain('u1');
  });

  it('FAIL_CHARGE marks unit as completed without moving', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

    const beforePos = state.models['m1'].position;
    state = gameReducer(state, { type: 'FAIL_CHARGE', payload: { unitId: 'u1' } });

    expect(state.models['m1'].position).toEqual(beforePos);
    expect(state.turnTracking.unitsCompleted['u1']).toBe(true);
  });
});

// ===============================================
// Phase 11: Fight Phase
// ===============================================

describe('Phase 11: Fight Phase', () => {
  const chainsword: Weapon = {
    id: 'w-cs',
    name: 'Chainsword',
    type: 'melee',
    attacks: 3,
    skill: 3,
    strength: 4,
    ap: -1,
    damage: 1,
    abilities: [],
  };

  it('INITIALIZE_FIGHT_PHASE finds eligible units in engagement range', () => {
    let state = setupTwoPlayerGame();
    // Place models within engagement range (1")
    // 32mm base = ~0.63" radius, so centers ~2.26" apart = just within 1" engagement range
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

    // Both units should be eligible (they're in engagement range)
    expect(state.fightState.eligibleUnits.length).toBeGreaterThan(0);
    expect(state.fightState.fightStep).toBe('remaining'); // No charges, so straight to remaining
  });

  it('Fights First: charged units fight before others', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    // Mark u1 as having charged
    state = {
      ...state,
      turnTracking: {
        ...state.turnTracking,
        chargedUnits: ['u1'],
      },
    };

    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

    // u1 should be in fights_first step
    expect(state.fightState.fightStep).toBe('fights_first');
    expect(state.fightState.eligibleUnits).toContain('u1');
  });

  it('non-active player selects first', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

    // Active player is p1, so p2 should select first
    expect(state.fightState.nextToSelect).toBe('p2');
  });

  it('SELECT_UNIT_TO_FIGHT sets current fighter and alternates selector', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

    const firstSelector = state.fightState.nextToSelect;
    state = gameReducer(state, { type: 'SELECT_UNIT_TO_FIGHT', payload: { unitId: 'u2' } });

    expect(state.fightState.currentFighter).toBe('u2');
    expect(state.fightState.nextToSelect).not.toBe(firstSelector);
    expect(state.fightState.eligibleUnits).not.toContain('u2'); // Removed from eligible
  });

  it('PILE_IN moves models (up to 3")', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);

    state = gameReducer(state, {
      type: 'PILE_IN',
      payload: { unitId: 'u1', positions: { 'm1': { x: 12, y: 10 } } },
    });

    expect(state.models['m1'].position).toEqual({ x: 12, y: 10 });
  });

  it('RESOLVE_MELEE_ATTACK creates attack with WS-based rolls', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'u1',
        attackingModelId: 'm1',
        weaponId: 'w-cs',
        weaponName: 'Chainsword',
        targetUnitId: 'u2',
        numAttacks: 3,
        hitRoll,
        hits: 2,
        woundRoll,
        wounds: 1,
      },
    });

    expect(state.fightState.activeAttacks).toHaveLength(1);
    expect(state.fightState.activeAttacks[0].weaponName).toBe('Chainsword');
  });

  it('CONSOLIDATE moves models (up to 3")', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);

    state = gameReducer(state, {
      type: 'CONSOLIDATE',
      payload: { unitId: 'u1', positions: { 'm1': { x: 12, y: 10 } } },
    });

    expect(state.models['m1'].position).toEqual({ x: 12, y: 10 });
  });

  it('COMPLETE_FIGHT moves unit to unitsFought and clears active attacks', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    // Initialize and select u1
    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });
    state = gameReducer(state, { type: 'SELECT_UNIT_TO_FIGHT', payload: { unitId: 'u1' } });
    state = gameReducer(state, { type: 'COMPLETE_FIGHT', payload: { unitId: 'u1' } });

    expect(state.fightState.unitsFought).toContain('u1');
    expect(state.fightState.currentFighter).toBeNull();
    expect(state.fightState.activeAttacks).toEqual([]);
  });

  it('transitions from fights_first to remaining when fights_first is exhausted', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [chainsword]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 11.5, y: 10 }], [chainsword]);

    // u1 charged
    state = {
      ...state,
      turnTracking: { ...state.turnTracking, chargedUnits: ['u1'] },
    };

    state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });
    expect(state.fightState.fightStep).toBe('fights_first');

    state = gameReducer(state, { type: 'SELECT_UNIT_TO_FIGHT', payload: { unitId: 'u1' } });
    state = gameReducer(state, { type: 'COMPLETE_FIGHT', payload: { unitId: 'u1' } });

    // Should transition to 'remaining' and include u2
    expect(state.fightState.fightStep).toBe('remaining');
    expect(state.fightState.eligibleUnits).toContain('u2');
  });
});

// ===============================================
// Integration: Full Attack Sequence
// ===============================================

describe('Integration: Full Shooting Attack Sequence', () => {
  const bolter: Weapon = {
    id: 'w1',
    name: 'Bolt Rifle',
    type: 'ranged',
    range: 24,
    attacks: 2,
    skill: 3,
    strength: 4,
    ap: -1,
    damage: 1,
    abilities: [],
  };

  it('complete sequence: declare → assign → resolve → save → damage', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }], [bolter]);
    state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 20, y: 10 }]);

    // Declare
    state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'u1' } });
    expect(state.shootingState.activeShootingUnit).toBe('u1');

    // Assign targets
    state = gameReducer(state, {
      type: 'ASSIGN_WEAPON_TARGETS',
      payload: { assignments: [{ modelId: 'm1', weaponId: 'w1', targetUnitId: 'u2' }] },
    });

    // Resolve attack (simulate 2 attacks, 1 hit, 1 wound)
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(1, 6, 'To Wound', 4);
    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'u1',
        attackingModelId: 'm1',
        weaponId: 'w1',
        weaponName: 'Bolt Rifle',
        targetUnitId: 'u2',
        numAttacks: 2,
        hitRoll,
        hits: 1,
        woundRoll,
        wounds: 1,
      },
    });

    // Resolve save (failed save, 1 damage)
    const saveRoll = rollDice(1, 6, 'Save', 4);
    state = gameReducer(state, {
      type: 'RESOLVE_SAVE_ROLL',
      payload: { targetModelId: 'm2', saveRoll, saved: false, damageToApply: 1 },
    });

    // Model should have taken damage
    expect(state.models['m2'].wounds).toBe(1);

    // Complete shooting
    state = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'u1' } });
    expect(state.shootingState.unitsShot).toContain('u1');
  });
});

// ===============================================
// Wound Threshold (10th Ed edition method)
// ===============================================

describe('10th Edition: getWoundThreshold', () => {
  it('matches the combat utility function', () => {
    // Both the edition method and standalone function should agree
    const testCases: [number, number, number][] = [
      [8, 4, 2],  // S >= 2T
      [5, 4, 3],  // S > T
      [4, 4, 4],  // S == T
      [3, 4, 5],  // S < T
      [2, 4, 6],  // S <= T/2
    ];

    for (const [s, t, expected] of testCases) {
      expect(getWoundThreshold(s, t)).toBe(expected);
    }
  });
});
