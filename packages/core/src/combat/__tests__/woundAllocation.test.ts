import { describe, it, expect } from 'vitest';
import { getWoundAllocationTarget, getAttachedUnitWoundTarget, canAttachLeader, doesAttachedUnitDestructionCountAsDestroyed, getRevertedStartingStrength } from '../woundAllocation';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState } from '../../types/index';
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
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
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

// ===============================================
// Wound allocation (from sprintF_p22)
// ===============================================

describe('Wound allocation', () => {
  it('must allocate to already-wounded model first', () => {
    const models: Record<string, import('../../types/index').Model> = {
      'm1': makeModel({ id: 'm1', unitId: 'u1', wounds: 1, maxWounds: 2 }), // Already wounded
      'm2': makeModel({ id: 'm2', unitId: 'u1', wounds: 2, maxWounds: 2 }), // Full health
      'm3': makeModel({ id: 'm3', unitId: 'u1', wounds: 2, maxWounds: 2 }), // Full health
    };
    const unit = makeUnit({ id: 'u1', modelIds: ['m1', 'm2', 'm3'] });

    const target = getWoundAllocationTarget(unit, models);
    expect(target).not.toBeNull();
    expect(target!.id).toBe('m1'); // Should pick the wounded model
  });

  it('picks any model when none are wounded', () => {
    const models: Record<string, import('../../types/index').Model> = {
      'm1': makeModel({ id: 'm1', unitId: 'u1', wounds: 2, maxWounds: 2 }),
      'm2': makeModel({ id: 'm2', unitId: 'u1', wounds: 2, maxWounds: 2 }),
    };
    const unit = makeUnit({ id: 'u1', modelIds: ['m1', 'm2'] });

    const target = getWoundAllocationTarget(unit, models);
    expect(target).not.toBeNull();
  });
});

// ===============================================
// Attached Units wound allocation (from sprintF_p23)
// ===============================================

describe('Attached Units wound allocation', () => {
  it('wound allocation: Bodyguard absorbs before CHARACTER', () => {
    const leaderModels: Record<string, import('../../types/index').Model> = {
      'l1': makeModel({ id: 'l1', unitId: 'leader', wounds: 4, maxWounds: 4 }),
    };
    const bodyguardModels: Record<string, import('../../types/index').Model> = {
      ...leaderModels,
      'bg1': makeModel({ id: 'bg1', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
      'bg2': makeModel({ id: 'bg2', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
    };

    const leaderUnit = makeUnit({ id: 'leader', modelIds: ['l1'], keywords: ['CHARACTER'] });
    const bodyguardUnit = makeUnit({ id: 'bodyguard', modelIds: ['bg1', 'bg2'] });

    // Normal allocation — should pick bodyguard first
    const target = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, bodyguardModels, false);
    expect(target).not.toBeNull();
    expect(target!.unitId).toBe('bodyguard');
  });

  it('Precision overrides: allocates to CHARACTER', () => {
    const allModels: Record<string, import('../../types/index').Model> = {
      'l1': makeModel({ id: 'l1', unitId: 'leader', wounds: 4, maxWounds: 4 }),
      'bg1': makeModel({ id: 'bg1', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
    };

    const leaderUnit = makeUnit({ id: 'leader', modelIds: ['l1'], keywords: ['CHARACTER'] });
    const bodyguardUnit = makeUnit({ id: 'bodyguard', modelIds: ['bg1'] });

    // With Precision — should target CHARACTER (leader)
    const target = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, allModels, true);
    expect(target).not.toBeNull();
    expect(target!.unitId).toBe('leader');
  });
});

// ===============================================
// Epic Challenge — Precision bypasses Bodyguard (from sprintG_24a)
// ===============================================

describe('Epic Challenge grants Precision — bypasses Bodyguard allocation', () => {
  it('with Precision=true, wounds go to CHARACTER (leader), not Bodyguard', () => {
    const leaderUnit = makeUnit({
      id: 'leader',
      playerId: 'p1',
      modelIds: ['leader-m1'],
      keywords: ['INFANTRY', 'CHARACTER'],
    });
    const bodyguardUnit = makeUnit({
      id: 'bodyguard',
      playerId: 'p1',
      modelIds: ['bg-m1', 'bg-m2'],
      keywords: ['INFANTRY'],
    });
    const models: Record<string, import('../../types/index').Model> = {
      'leader-m1': makeModel({ id: 'leader-m1', unitId: 'leader', wounds: 4, maxWounds: 4 }),
      'bg-m1': makeModel({ id: 'bg-m1', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
      'bg-m2': makeModel({ id: 'bg-m2', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
    };

    // Without Precision: bodyguard absorbs wounds
    const normalTarget = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, models, false);
    expect(normalTarget?.id).toBe('bg-m1');

    // With Precision (Epic Challenge): CHARACTER takes wounds
    const precisionTarget = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, models, true);
    expect(precisionTarget?.id).toBe('leader-m1');
  });
});

// ===============================================
// Cannot attach more than one Leader (from sprintK)
// ===============================================

describe('Cannot attach more than one Leader', () => {
  it('validates via canAttachLeader helper', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'leader-1', 'p1', [{ id: 'l1', x: 10, y: 10 }], {
      keywords: ['CHARACTER', 'INFANTRY'],
    });
    state = addUnit(state, 'leader-2', 'p1', [{ id: 'l2', x: 12, y: 10 }], {
      keywords: ['CHARACTER', 'INFANTRY'],
    });
    state = addUnit(state, 'bodyguard-1', 'p1', [{ id: 'b1', x: 11, y: 10 }], {
      keywords: ['INFANTRY'],
    });
    state = { ...state, attachedUnits: { 'leader-1': 'bodyguard-1' } };

    const result = canAttachLeader(state, 'leader-2', 'bodyguard-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already has a Leader');
  });
});

// ===============================================
// Attached unit destruction VP (from sprintK)
// ===============================================

describe('Attached unit destruction VP', () => {
  it('destroying Leader counts as destroying a unit', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'leader-1', 'p1', [{ id: 'l1', x: 10, y: 10 }], {
      keywords: ['CHARACTER', 'INFANTRY'],
    });
    state = addUnit(state, 'bodyguard-1', 'p1', [{ id: 'b1', x: 11, y: 10 }], {
      keywords: ['INFANTRY'],
    });
    state = { ...state, attachedUnits: { 'leader-1': 'bodyguard-1' } };

    expect(doesAttachedUnitDestructionCountAsDestroyed(state, 'leader-1')).toBe(true);
  });

  it('destroying Bodyguard counts as destroying a unit', () => {
    let state = setupTwoPlayerGame();
    state = addUnit(state, 'leader-1', 'p1', [{ id: 'l1', x: 10, y: 10 }], {
      keywords: ['CHARACTER', 'INFANTRY'],
    });
    state = addUnit(state, 'bodyguard-1', 'p1', [{ id: 'b1', x: 11, y: 10 }], {
      keywords: ['INFANTRY'],
    });
    state = { ...state, attachedUnits: { 'leader-1': 'bodyguard-1' } };

    expect(doesAttachedUnitDestructionCountAsDestroyed(state, 'bodyguard-1')).toBe(true);
  });
});

// ===============================================
// Surviving unit reverts to original Starting Strength (from sprintK)
// ===============================================

describe('Surviving unit reverts to original Starting Strength', () => {
  it('returns original model count', () => {
    const unit = makeUnit({
      modelIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
    });
    expect(getRevertedStartingStrength(unit)).toBe(5);
  });
});
