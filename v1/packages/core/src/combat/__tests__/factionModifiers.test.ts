import { describe, it, expect } from 'vitest';
import { applyFactionAndDetachmentRules, applyDefensiveDetachmentRules } from '../factionModifiers';
import { makeModel, makeUnit } from '../../test-helpers';
import { resolveAttackSequence } from '../attackPipeline';
import type { AttackContext } from '../attackPipeline';
import type { GameState, Unit, Weapon, Detachment } from '../../types/index';
import { createInitialGameState } from '../../state/initialState';
import { gameReducer } from '../../state/reducer';
import { getFactionState, getAllFactions } from '../../detachments/registry';
import type { AstraMilitarumState } from '../../detachments/astra-militarum';
import type { TauEmpireState } from '../../detachments/tau-empire';
import '../../editions/index';
import '../../detachments/index';

// --- Test Helpers ---

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w1',
    name: 'Lasgun',
    type: 'ranged',
    range: 24,
    attacks: 1,
    skill: 4,
    strength: 3,
    ap: 0,
    damage: 1,
    abilities: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AttackContext> = {}): AttackContext {
  return {
    weapon: makeWeapon(),
    abilities: [],
    distanceToTarget: 12,
    targetUnitSize: 5,
    targetKeywords: ['INFANTRY'],
    attackerStationary: false,
    attackerCharged: false,
    attackerModelCount: 10,
    ...overrides,
  };
}

function setupGameWithFaction(factionKeyword: string, detachmentId?: string): {
  state: GameState;
  playerId: string;
  unit: Unit;
} {
  let state = createInitialGameState();
  const playerId = 'p1';

  state = gameReducer(state, {
    type: 'ADD_PLAYER',
    payload: { player: { id: playerId, name: 'Test Player', color: '#ff0000', commandPoints: 0 } },
  });

  const unit: Unit = {
    id: 'u1',
    name: 'Infantry Squad',
    playerId,
    modelIds: ['m1', 'm2', 'm3'],
    keywords: ['INFANTRY', factionKeyword],
    abilities: [],
    weapons: [makeWeapon()],
  };

  state = gameReducer(state, {
    type: 'SET_FACTION_KEYWORD',
    payload: { playerId, keyword: factionKeyword },
  });

  if (detachmentId) {
    // Find the detachment across all registered factions
    const allFactions = getAllFactions();
    for (const faction of allFactions) {
      const detachment = faction.detachments.find((d: Detachment) => d.id === detachmentId);
      if (detachment) {
        state = gameReducer(state, {
          type: 'SELECT_DETACHMENT',
          payload: { playerId, detachment },
        });
        break;
      }
    }
  }

  return { state, playerId, unit };
}

// ===============================================
// Born Soldiers (Faction Rule)
// ===============================================

describe('Born Soldiers -- Astra Militarum Faction Rule', () => {
  it('critical hit threshold is lowered to 5 for stationary ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({ attackerStationary: true, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBe(5);
    expect(triggeredRules).toContain('Born Soldiers (crit on 5+)');
  });

  it('does not apply when unit moved (not stationary)', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({ attackerStationary: false, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
    expect(triggeredRules).not.toContain('Born Soldiers (crit on 5+)');
  });

  it('does not apply to melee attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({
      attackerStationary: true,
      weapon: makeWeapon({ type: 'melee', name: 'Bayonet', range: undefined }),
    });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
  });

  it('does not apply to non-AM factions', () => {
    const { state, unit } = setupGameWithFaction('ADEPTUS ASTARTES');
    const ctx = makeCtx({ attackerStationary: true, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
  });

  it('resolveAttackSequence respects criticalHitThreshold (5+ crits)', () => {
    // Run many attacks to statistically verify that 5s count as crits
    // With criticalHitThreshold=5, a roll of 5 should be a crit
    const ctx = makeCtx({
      attackerStationary: true,
      weapon: makeWeapon({ type: 'ranged', abilities: ['SUSTAINED HITS 1'] }),
      abilities: [{ name: 'SUSTAINED HITS', value: 1 }],
      criticalHitThreshold: 5,
    });

    // Run 1000 attacks to check that crits happen more often with threshold 5
    let critsAt5 = 0;
    let critsAt6 = 0;
    const trials = 500;

    for (let i = 0; i < trials; i++) {
      const result5 = resolveAttackSequence(1, 4, 3, 3, { ...ctx, criticalHitThreshold: 5 });
      if (result5.triggeredAbilities.some(t => t.startsWith('Sustained Hits'))) critsAt5++;

      const result6 = resolveAttackSequence(1, 4, 3, 3, { ...ctx, criticalHitThreshold: 6 });
      if (result6.triggeredAbilities.some(t => t.startsWith('Sustained Hits'))) critsAt6++;
    }

    // With threshold 5, crits should happen ~2/6 = 33% of the time (5 or 6)
    // With threshold 6, crits should happen ~1/6 = 17% of the time (6 only)
    // So critsAt5 should be roughly double critsAt6
    expect(critsAt5).toBeGreaterThan(critsAt6);
  });
});

// ===============================================
// Detachment Rule Tests
// ===============================================

describe('Mechanised Assault -- Armoured Spearhead', () => {
  it('improves AP by 1 for TRANSPORT units', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'mechanised-assault');
    const transportUnit: Unit = {
      id: 'u2',
      name: 'Chimera',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'TRANSPORT', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [makeWeapon({ ap: 0 })],
    };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, transportUnit);

    expect(modified.weapon.ap).toBe(-1); // AP improved by 1
    expect(triggeredRules).toContain('Armoured Spearhead (AP +1)');
  });

  it('does not apply to non-TRANSPORT/MOUNTED units', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'mechanised-assault');

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.weapon.ap).toBe(0); // Unchanged
    expect(triggeredRules).not.toContain('Armoured Spearhead (AP +1)');
  });
});

describe('Armoured Company -- Rolling Fortress (defensive)', () => {
  it('applies -1 to Wound for attacks targeting VEHICLE from >12"', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');
    const vehicleUnit: Unit = {
      id: 'u2',
      name: 'Leman Russ',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [],
    };

    const { woundRollModifier, triggeredRules } = applyDefensiveDetachmentRules(state, vehicleUnit, 18);

    expect(woundRollModifier).toBe(-1);
    expect(triggeredRules).toContain('Rolling Fortress (-1 to Wound)');
  });

  it('does not apply within 12"', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');
    const vehicleUnit: Unit = {
      id: 'u2',
      name: 'Leman Russ',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [],
    };

    const { woundRollModifier } = applyDefensiveDetachmentRules(state, vehicleUnit, 10);

    expect(woundRollModifier).toBe(0);
  });

  it('does not apply to non-VEHICLE units', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');

    const { woundRollModifier } = applyDefensiveDetachmentRules(state, unit, 18);

    expect(woundRollModifier).toBe(0);
  });
});

describe('Fortification Network -- Siege Warfare', () => {
  /** Adds an enemy target unit and an objective marker at the given positions. */
  function setupWithTarget(targetPos: { x: number; y: number }, objectivePos: { x: number; y: number }) {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'fortification-network');
    const targetModel = makeModel({ id: 'tm1', unitId: 'target-u1', position: targetPos });
    const targetUnit = makeUnit({ id: 'target-u1', playerId: 'p2', modelIds: ['tm1'] });
    let s = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: targetUnit, models: [targetModel] } });
    s = gameReducer(s, {
      type: 'PLACE_OBJECTIVE',
      payload: { objective: { id: 'o1', position: objectivePos, number: 1 } },
    });
    return { state: s, unit };
  }

  it('applies re-roll wound 1s when target is within 3" of an objective', () => {
    const { state, unit } = setupWithTarget({ x: 20, y: 20 }, { x: 21, y: 20 });
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollWoundRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Siege Warfare (re-roll wound 1s)');
  });

  it('does not apply when target is far from all objectives', () => {
    const { state, unit } = setupWithTarget({ x: 20, y: 20 }, { x: 40, y: 40 });
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollWoundRollsOf1).toBeUndefined();
  });
});

// ===============================================
// Combined Regiment Orders -- Combat Modifiers
// ===============================================

describe('Combined Regiment Orders -- Combat Modifiers', () => {
  it('Take Aim applies skillImprovement +1 for ranged attacks (BS +1)', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.skillImprovement).toBe(1);
    expect(triggeredRules).toContain('Take Aim! (BS +1)');
  });

  it('FRFSRF applies bonusAttacks +1 for Rapid Fire weapons only', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'frfsrf' }, officersUsedThisPhase: [] } } };

    // Rapid Fire weapon — should apply
    const rfCtx = makeCtx({ weapon: makeWeapon({ type: 'ranged', abilities: ['RAPID FIRE 1'] }) });
    const { ctx: rfModified, triggeredRules } = applyFactionAndDetachmentRules(rfCtx, stateWithOrder, unit);
    expect(rfModified.bonusAttacks).toBe(1);
    expect(triggeredRules).toContain('FRFSRF (A +1)');

    // Non-Rapid Fire weapon — should NOT apply
    const normalCtx = makeCtx({ weapon: makeWeapon({ type: 'ranged', abilities: [] }) });
    const { ctx: normalModified } = applyFactionAndDetachmentRules(normalCtx, stateWithOrder, unit);
    expect(normalModified.bonusAttacks).toBeUndefined();
  });

  it('Fix Bayonets applies skillImprovement +1 for melee attacks only (WS +1)', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'fix-bayonets' }, officersUsedThisPhase: [] } } };

    // Melee — should apply
    const meleeCtx = makeCtx({ weapon: makeWeapon({ type: 'melee', name: 'Bayonet' }) });
    const { ctx: meleeModified } = applyFactionAndDetachmentRules(meleeCtx, stateWithOrder, unit);
    expect(meleeModified.skillImprovement).toBe(1);

    // Ranged — should NOT apply
    const rangedCtx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });
    const { ctx: rangedModified } = applyFactionAndDetachmentRules(rangedCtx, stateWithOrder, unit);
    expect(rangedModified.skillImprovement).toBeUndefined();
  });

  it('Take Aim does not apply to melee attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.skillImprovement).toBeUndefined();
  });

  it('orders do not apply to Battle-shocked units', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = {
      ...state,
      factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } },
      battleShocked: [unit.id],
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.skillImprovement).toBeUndefined();
  });
});

// ===============================================
// T'au Empire Detachment Rules
// ===============================================

describe("Kauyon -- Patient Hunter", () => {
  it('applies re-roll hit 1s from Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules.some(r => r.includes('Patient Hunter'))).toBe(true);
  });

  it('does not apply before Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR2 = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR2, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to melee', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });
});

describe("Mont'ka -- Killing Blow", () => {
  it('applies AP+1 within 18" in Round 1', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR1 = { ...state, turnState: { ...state.turnState, roundNumber: 1 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 15 });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateR1, unit);

    expect(modified.bonusAP).toBe(-1);
    expect(triggeredRules.some(r => r.includes('Killing Blow'))).toBe(true);
  });

  it('does not apply outside threshold range', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR2 = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };
    // Round 2 threshold is 12", target at 15"
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 15 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR2, unit);

    expect(modified.bonusAP).toBeUndefined();
  });

  it('applies AP+1 within 9" in Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 8 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.bonusAP).toBe(-1);
  });

  it('does not apply after Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR4 = { ...state, turnState: { ...state.turnState, roundNumber: 4 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 5 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR4, unit);

    expect(modified.bonusAP).toBeUndefined();
  });
});

describe("Kroot Hunting Pack -- Guerrilla Tactics", () => {
  const krootUnit: Unit = {
    id: 'kroot-u1',
    name: 'Kroot Carnivores',
    playerId: 'p1',
    modelIds: ['km1'],
    keywords: ['INFANTRY', 'KROOT', "T'AU EMPIRE"],
    abilities: [],
    weapons: [makeWeapon({ type: 'melee', name: 'Kroot Rifle (melee)' })],
  };

  /** Adds an enemy target unit that started with 2 models; optionally destroy one. */
  function setupWithTarget(targetBelowStrength: boolean) {
    const { state } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const m1 = makeModel({ id: 'tm1', unitId: 'target-u1', position: { x: 20, y: 20 } });
    const m2 = makeModel({
      id: 'tm2',
      unitId: 'target-u1',
      position: { x: 21, y: 20 },
      status: targetBelowStrength ? 'destroyed' : 'active',
      wounds: targetBelowStrength ? 0 : 2,
    });
    const targetUnit = makeUnit({
      id: 'target-u1',
      playerId: 'p2',
      modelIds: ['tm1', 'tm2'],
      startingStrength: 2,
    });
    return gameReducer(state, { type: 'ADD_UNIT', payload: { unit: targetUnit, models: [m1, m2] } });
  }

  it('applies re-roll hit 1s for KROOT melee attacks vs a unit below Starting Strength', () => {
    const state = setupWithTarget(true);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }), targetUnitId: 'target-u1' });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Guerrilla Tactics (re-roll hit 1s)');
  });

  it('does not apply when target is at full Starting Strength', () => {
    const state = setupWithTarget(false);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to non-KROOT units', () => {
    const state = setupWithTarget(true);
    const { unit } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    // unit has keywords ['INFANTRY', "T'AU EMPIRE"] -- no KROOT
    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to ranged attacks', () => {
    const state = setupWithTarget(true);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, {
      ...krootUnit,
      weapons: [makeWeapon({ type: 'ranged' })],
    });

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });
});

// ===============================================
// Retaliation Cadre -- Bonded by Honour
// ===============================================

describe('Retaliation Cadre -- Bonded by Honour', () => {
  /** Sets up a Tau attacker, an enemy target unit, and (optionally) a friendly unit
   *  destroyed this turn near or far from the target. */
  function setup(destroyedDistance?: number) {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'retaliation-cadre');
    const targetModel = makeModel({ id: 'tm1', unitId: 'target-u1', position: { x: 20, y: 20 } });
    const targetUnit = makeUnit({ id: 'target-u1', playerId: 'p2', modelIds: ['tm1'] });
    let s = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: targetUnit, models: [targetModel] } });

    if (destroyedDistance !== undefined) {
      s = {
        ...s,
        turnTracking: {
          ...s.turnTracking,
          unitsDestroyedThisTurn: [
            { unitId: 'dead-u1', playerId: 'p1', position: { x: 20 + destroyedDistance, y: 20 } },
          ],
        },
      };
    }
    return { state: s, unit };
  }

  it('re-rolls hits and wounds when target is within 6" of a destroyed friendly unit', () => {
    const { state, unit } = setup(4);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollAllFailedHits).toBe(true);
    expect(modified.rerollAllFailedWounds).toBe(true);
    expect(triggeredRules).toContain('Bonded by Honour (re-roll hits & wounds)');
  });

  it('does not apply when the destroyed friendly unit is more than 6" away', () => {
    const { state, unit } = setup(10);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollAllFailedHits).toBeUndefined();
    expect(modified.rerollAllFailedWounds).toBeUndefined();
  });

  it('does not apply when no friendly units were destroyed this turn', () => {
    const { state, unit } = setup(undefined);
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollAllFailedHits).toBeUndefined();
  });

  it('does not trigger from destroyed ENEMY units', () => {
    const { state, unit } = setup(4);
    // Re-tag the destroyed unit as belonging to the enemy
    const s = {
      ...state,
      turnTracking: {
        ...state.turnTracking,
        unitsDestroyedThisTurn: state.turnTracking.unitsDestroyedThisTurn.map(r => ({ ...r, playerId: 'p2' })),
      },
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'target-u1' });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, s, unit);

    expect(modified.rerollAllFailedHits).toBeUndefined();
  });
});

// ===============================================
// Kauyon Round 4 -- full hit re-rolls
// ===============================================

describe('Kauyon -- Patient Hunter Round 4+', () => {
  it('re-rolls ALL failed hits from Round 4', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR4 = { ...state, turnState: { ...state.turnState, roundNumber: 4 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateR4, unit);

    expect(modified.rerollAllFailedHits).toBe(true);
    expect(triggeredRules).toContain('Patient Hunter (re-roll failed hits, R4+)');
  });
});

// ===============================================
// For the Greater Good -- Guided Targets (combat modifiers only)
// ===============================================

describe("For the Greater Good -- Guided Targets (combat modifiers)", () => {
  it('applies +1 BS modifier when shooting a guided target', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'enemy-u1' });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBe(1);
    expect(triggeredRules).toContain('For the Greater Good (+1 BS)');
  });

  it('does not apply +1 BS to non-guided targets', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'different-enemy' });
    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBeUndefined();
  });

  it('does not apply to melee attacks against guided target', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }), targetUnitId: 'enemy-u1' });
    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBeUndefined();
  });
});
