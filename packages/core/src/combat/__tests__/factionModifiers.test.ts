import { describe, it, expect } from 'vitest';
import { applyFactionAndDetachmentRules, applyDefensiveDetachmentRules } from '../factionModifiers';
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
  it('applies re-roll wound 1s', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'fortification-network');
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollWoundRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Siege Warfare (re-roll wound 1s)');
  });
});

// ===============================================
// Combined Regiment Orders -- Combat Modifiers
// ===============================================

describe('Combined Regiment Orders -- Combat Modifiers', () => {
  it('Take Aim applies rerollHitRollsOf1 for ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Take Aim! (re-roll hit 1s)');
  });

  it('FRFSRF applies bonusAP for ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'frfsrf' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.bonusAP).toBe(-1);
    expect(triggeredRules).toContain('FRFSRF (AP +1)');
  });

  it('Fix Bayonets applies rerollHitRollsOf1 for melee attacks only', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'fix-bayonets' }, officersUsedThisPhase: [] } } };

    // Melee — should apply
    const meleeCtx = makeCtx({ weapon: makeWeapon({ type: 'melee', name: 'Bayonet' }) });
    const { ctx: meleeModified } = applyFactionAndDetachmentRules(meleeCtx, stateWithOrder, unit);
    expect(meleeModified.rerollHitRollsOf1).toBe(true);

    // Ranged — should NOT apply
    const rangedCtx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });
    const { ctx: rangedModified } = applyFactionAndDetachmentRules(rangedCtx, stateWithOrder, unit);
    expect(rangedModified.rerollHitRollsOf1).toBeUndefined();
  });

  it('Take Aim does not apply to melee attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
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
  it('applies re-roll hit 1s for KROOT melee attacks', () => {
    const { state } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const krootUnit: Unit = {
      id: 'kroot-u1',
      name: 'Kroot Carnivores',
      playerId: 'p1',
      modelIds: ['km1'],
      keywords: ['INFANTRY', 'KROOT', "T'AU EMPIRE"],
      abilities: [],
      weapons: [makeWeapon({ type: 'melee', name: 'Kroot Rifle (melee)' })],
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Guerrilla Tactics (re-roll hit 1s)');
  });

  it('does not apply to non-KROOT units', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    // unit has keywords ['INFANTRY', "T'AU EMPIRE"] -- no KROOT
    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to ranged attacks', () => {
    const { state } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const krootUnit: Unit = {
      id: 'kroot-u1',
      name: 'Kroot Carnivores',
      playerId: 'p1',
      modelIds: ['km1'],
      keywords: ['INFANTRY', 'KROOT', "T'AU EMPIRE"],
      abilities: [],
      weapons: [makeWeapon({ type: 'ranged' })],
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
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
