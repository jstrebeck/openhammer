import { describe, it, expect } from 'vitest';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { rollDice } from '../../dice/index';
import type { GameState } from '../../types/index';

function setupShootingState(): GameState {
  let state = createInitialGameState();
  const attacker = makePlayer({ id: 'p1', name: 'Attacker' });
  const defender = makePlayer({ id: 'p2', name: 'Defender' });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: attacker } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: defender } });

  const attackerModel = makeModel({
    id: 'am1', unitId: 'au1', name: 'Marine', position: { x: 10, y: 10 },
  });
  const attackerUnit = makeUnit({
    id: 'au1', name: 'Intercessors', playerId: 'p1', modelIds: ['am1'],
    weapons: [{ id: 'w1', name: 'Bolt Rifle', type: 'ranged', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: [] }],
  });
  state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: attackerUnit, models: [attackerModel] } });

  const defenderModel1 = makeModel({
    id: 'dm1', unitId: 'du1', name: 'Ork Boy', position: { x: 20, y: 10 },
    stats: { move: 6, toughness: 4, save: 5, wounds: 1, leadership: 7, objectiveControl: 1 },
    wounds: 1, maxWounds: 1,
  });
  const defenderModel2 = makeModel({
    id: 'dm2', unitId: 'du1', name: 'Ork Boy', position: { x: 20, y: 12 },
    stats: { move: 6, toughness: 4, save: 5, wounds: 1, leadership: 7, objectiveControl: 1 },
    wounds: 1, maxWounds: 1,
  });
  const defenderUnit = makeUnit({
    id: 'du1', name: 'Boyz', playerId: 'p2', modelIds: ['dm1', 'dm2'],
  });
  state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: defenderUnit, models: [defenderModel1, defenderModel2] } });

  // Declare shooting
  state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'au1' } });
  state = gameReducer(state, {
    type: 'ASSIGN_WEAPON_TARGETS',
    payload: { assignments: [{ modelId: 'am1', weaponId: 'w1', targetUnitId: 'du1' }] },
  });

  return state;
}

describe('Pending Saves - Shooting', () => {
  it('RESOLVE_SHOOTING_ATTACK creates a PendingSave entry', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    expect(state.shootingState.pendingSaves).toHaveLength(1);
    const ps = state.shootingState.pendingSaves[0];
    expect(ps.wounds).toBe(2);
    expect(ps.ap).toBe(-1);
    expect(ps.damage).toBe('1');
    expect(ps.targetUnitId).toBe('du1');
    expect(ps.attackingPlayerId).toBe('p1');
    expect(ps.defendingPlayerId).toBe('p2');
    expect(ps.resolved).toBe(false);
    expect(ps.weaponName).toBe('Bolt Rifle');
  });

  it('RESOLVE_SHOOTING_ATTACK with 0 wounds does not create PendingSave', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(0, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 0, woundRoll, wounds: 0,
      },
    });

    expect(state.shootingState.pendingSaves).toHaveLength(0);
  });

  it('COMPLETE_SHOOTING is blocked with unresolved pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const stateAfter = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'au1' } });
    expect(stateAfter.shootingState.activeShootingUnit).toBe('au1');
  });
});

describe('Pending Saves - Fight', () => {
  it('RESOLVE_MELEE_ATTACK creates a PendingSave entry in fightState', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1', abilities: [] }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 }, wounds: 2, maxWounds: 2 });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(3, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 3, woundRoll, wounds: 2,
      },
    });

    expect(state.fightState.pendingSaves).toHaveLength(1);
    const ps = state.fightState.pendingSaves[0];
    expect(ps.wounds).toBe(2);
    expect(ps.ap).toBe(-1);
    expect(ps.defendingPlayerId).toBe('p2');
  });

  it('COMPLETE_FIGHT is blocked with unresolved pending saves', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1', abilities: [] }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 } });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    // Set up fight state with current fighter
    state = { ...state, fightState: { ...state.fightState, currentFighter: 'au1' } };

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const stateAfter = gameReducer(state, { type: 'COMPLETE_FIGHT', payload: { unitId: 'au1' } });
    expect(stateAfter.fightState.activeAttacks.length).toBeGreaterThan(0);
  });
});

describe('RESOLVE_PENDING_SAVES', () => {
  it('resolves saves and applies damage to models', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll1 = rollDice(1, 6, 'Save', 4);
    const saveRoll2 = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll: saveRoll1, saved: false, damageApplied: 1 },
          { targetModelId: 'dm2', saveRoll: saveRoll2, saved: false, damageApplied: 1 },
        ],
      },
    });

    expect(state.models['dm1'].status).toBe('destroyed');
    expect(state.models['dm2'].status).toBe('destroyed');
    const resolved = state.shootingState.pendingSaves.find(ps => ps.id === pendingSave.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.results).toHaveLength(2);
  });

  it('saved rolls do not apply damage', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll1 = rollDice(1, 6, 'Save', 4);
    const saveRoll2 = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll: saveRoll1, saved: true, damageApplied: 0 },
          { targetModelId: 'dm2', saveRoll: saveRoll2, saved: true, damageApplied: 0 },
        ],
      },
    });

    expect(state.models['dm1'].status).toBe('active');
    expect(state.models['dm2'].status).toBe('active');
    expect(state.models['dm1'].wounds).toBe(1);
  });

  it('COMPLETE_SHOOTING succeeds after all saves resolved', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: true, damageApplied: 0 },
          { targetModelId: 'dm2', saveRoll, saved: true, damageApplied: 0 },
        ],
      },
    });

    state = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'au1' } });
    expect(state.shootingState.activeShootingUnit).toBeNull();
    expect(state.shootingState.unitsShot).toContain('au1');
  });

  it('marks the linked AttackSequence as resolved', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
          { targetModelId: 'dm2', saveRoll, saved: true, damageApplied: 0 },
        ],
      },
    });

    const attack = state.shootingState.activeAttacks.find(a => a.id === pendingSave.attackSequenceId);
    expect(attack?.resolved).toBe(true);
    expect(attack?.woundAllocations).toHaveLength(2);
  });

  it('resolves pending saves in fightState (melee)', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: 0, damage: '1', abilities: [] }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 }, wounds: 2, maxWounds: 2 });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.fightState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 3);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
        ],
      },
    });

    expect(state.models['dm1'].status).toBe('destroyed');
    expect(state.fightState.pendingSaves[0].resolved).toBe(true);
  });

  it('rejects RESOLVE_PENDING_SAVES for non-existent ID', () => {
    let state = setupShootingState();
    const saveRoll = rollDice(1, 6, 'Save', 4);

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: 'non-existent-id',
        results: [{ targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 }],
      },
    });

    expect(state.models['dm1'].wounds).toBe(stateBefore.models['dm1'].wounds);
  });

  it('rejects RESOLVE_PENDING_SAVES for already-resolved saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 1, woundRoll, wounds: 1,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [{ targetModelId: 'dm1', saveRoll, saved: true, damageApplied: 0 }],
      },
    });

    const stateAfter = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [{ targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 }],
      },
    });

    expect(stateAfter.models['dm1'].status).toBe('active');
  });
});

describe('Phase/turn transition gating', () => {
  it('blocks ADVANCE_PHASE with unresolved shooting pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 1,
      },
    });

    const phaseBefore = state.turnState.currentPhaseIndex;
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    expect(state.turnState.currentPhaseIndex).toBe(phaseBefore);
  });

  it('blocks NEXT_TURN with unresolved pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 1,
      },
    });

    const turnBefore = state.turnState.roundNumber;
    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(state.turnState.roundNumber).toBe(turnBefore);
  });
});

export { setupShootingState };
