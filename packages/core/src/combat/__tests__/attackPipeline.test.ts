import { describe, it, expect } from 'vitest';
import { parseDiceExpression, getWoundThreshold, calculateAttacks, resolveAttackSequence } from '../attackPipeline';
import type { AttackContext } from '../attackPipeline';
import { parseWeaponAbility } from '../abilities';
import type { Weapon } from '../../types/index';

// ===============================================
// Combat Utilities (from sprintA)
// ===============================================

describe('Combat Utilities', () => {
  it('getWoundThreshold: S >= 2T -> 2+', () => {
    expect(getWoundThreshold(8, 4)).toBe(2);
    expect(getWoundThreshold(10, 4)).toBe(2);
  });

  it('getWoundThreshold: S > T -> 3+', () => {
    expect(getWoundThreshold(5, 4)).toBe(3);
    expect(getWoundThreshold(6, 4)).toBe(3);
    expect(getWoundThreshold(7, 4)).toBe(3);
  });

  it('getWoundThreshold: S == T -> 4+', () => {
    expect(getWoundThreshold(4, 4)).toBe(4);
  });

  it('getWoundThreshold: S < T -> 5+', () => {
    expect(getWoundThreshold(3, 4)).toBe(5);
  });

  it('getWoundThreshold: S <= T/2 -> 6+', () => {
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
});

// ===============================================
// Wound Threshold (from sprintC)
// ===============================================

describe('Wound Threshold', () => {
  it('S >= 2T -> 2+', () => expect(getWoundThreshold(8, 4)).toBe(2));
  it('S > T -> 3+', () => expect(getWoundThreshold(5, 4)).toBe(3));
  it('S == T -> 4+', () => expect(getWoundThreshold(4, 4)).toBe(4));
  it('S < T -> 5+', () => expect(getWoundThreshold(3, 4)).toBe(5));
  it('S <= T/2 -> 6+', () => expect(getWoundThreshold(2, 4)).toBe(6));
});

// ===============================================
// calculateAttacks with Abilities (from sprintC)
// ===============================================

describe('calculateAttacks', () => {
  function makeCtx(overrides: Partial<AttackContext>): AttackContext {
    return {
      weapon: { id: 'w', name: 'Gun', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1, abilities: [] },
      abilities: [],
      distanceToTarget: 12,
      targetUnitSize: 5,
      targetKeywords: ['INFANTRY'],
      attackerStationary: false,
      attackerCharged: false,
      attackerModelCount: 1,
      ...overrides,
    };
  }

  it('Blast: +1 attack per 5 models in target unit', () => {
    const ctx = makeCtx({
      abilities: [{ name: 'BLAST' }],
      targetUnitSize: 10,
      attackerModelCount: 1,
    });
    // 2 base + 2 from blast (10/5=2) = 4
    const attacks = calculateAttacks(ctx);
    expect(attacks).toBe(4);
  });

  it('Blast: no bonus for target < 5 models', () => {
    const ctx = makeCtx({
      abilities: [{ name: 'BLAST' }],
      targetUnitSize: 4,
      attackerModelCount: 1,
    });
    expect(calculateAttacks(ctx)).toBe(2);
  });

  it('Rapid Fire X: +X attacks within half range', () => {
    const ctx = makeCtx({
      weapon: { id: 'w', name: 'Bolter', type: 'ranged', range: 24, attacks: 1, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['RAPID FIRE 1'] },
      abilities: [{ name: 'RAPID FIRE', value: 1 }],
      distanceToTarget: 10, // within 12" (half of 24")
      attackerModelCount: 1,
    });
    expect(calculateAttacks(ctx)).toBe(2); // 1 base + 1 rapid fire
  });

  it('Rapid Fire X: no bonus outside half range', () => {
    const ctx = makeCtx({
      weapon: { id: 'w', name: 'Bolter', type: 'ranged', range: 24, attacks: 1, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['RAPID FIRE 1'] },
      abilities: [{ name: 'RAPID FIRE', value: 1 }],
      distanceToTarget: 15, // outside 12"
      attackerModelCount: 1,
    });
    expect(calculateAttacks(ctx)).toBe(1);
  });
});

// ===============================================
// resolveAttackSequence with Abilities (from sprintC)
// ===============================================

describe('resolveAttackSequence with abilities', () => {
  function makeCtx(overrides: Partial<AttackContext>): AttackContext {
    return {
      weapon: { id: 'w', name: 'Gun', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1, abilities: [] },
      abilities: [],
      distanceToTarget: 12,
      targetUnitSize: 5,
      targetKeywords: ['INFANTRY'],
      attackerStationary: false,
      attackerCharged: false,
      attackerModelCount: 1,
      ...overrides,
    };
  }

  it('Torrent: auto-hits (no hit roll)', () => {
    const ctx = makeCtx({ abilities: [{ name: 'TORRENT' }] });
    const result = resolveAttackSequence(5, 6, 4, 4, ctx);
    // All 5 attacks should hit (torrent auto-hits)
    expect(result.hits).toBe(5);
    expect(result.hitRoll.dice).toHaveLength(0); // No dice rolled
    expect(result.triggeredAbilities).toContain('Torrent (auto-hit)');
  });

  it('Heavy: +1 to Hit when stationary', () => {
    const ctx = makeCtx({
      abilities: [{ name: 'HEAVY' }],
      attackerStationary: true,
    });
    const result = resolveAttackSequence(20, 4, 4, 4, ctx); // BS4+ with +1 = effectively 3+
    expect(result.triggeredAbilities).toContain('Heavy (+1 to Hit)');
    // Statistically should hit more often (3+ vs 4+), but we can't test exact numbers
  });

  it('Lance: +1 to Wound when charged', () => {
    const ctx = makeCtx({
      abilities: [{ name: 'LANCE' }],
      attackerCharged: true,
    });
    const result = resolveAttackSequence(20, 3, 4, 4, ctx); // S4 vs T4 normally 4+, with lance 3+
    expect(result.triggeredAbilities).toContain('Lance (+1 to Wound)');
  });

  it('Melta X: +X damage within half range', () => {
    const ctx = makeCtx({
      weapon: { id: 'w', name: 'Melta', type: 'ranged', range: 12, attacks: 1, skill: 3, strength: 9, ap: -4, damage: 'D6', abilities: ['MELTA 2'] },
      abilities: [{ name: 'MELTA', value: 2 }],
      distanceToTarget: 5, // within 6" (half of 12")
    });
    const result = resolveAttackSequence(1, 3, 9, 4, ctx);
    expect(result.effectiveDamage).toBeGreaterThanOrEqual(3); // D6 min 1 + 2 = 3
    expect(result.triggeredAbilities).toContain('Melta 2 (+2 damage)');
  });

  it('Melta X: no bonus outside half range', () => {
    const ctx = makeCtx({
      weapon: { id: 'w', name: 'Melta', type: 'ranged', range: 12, attacks: 1, skill: 3, strength: 9, ap: -4, damage: 2, abilities: ['MELTA 2'] },
      abilities: [{ name: 'MELTA', value: 2 }],
      distanceToTarget: 8, // outside 6"
    });
    const result = resolveAttackSequence(1, 3, 9, 4, ctx);
    expect(result.effectiveDamage).toBe(2);
    expect(result.triggeredAbilities).not.toContain('Melta 2 (+2 damage)');
  });

  it('without context, behaves like the simple version', () => {
    const result = resolveAttackSequence(10, 3, 4, 4);
    expect(result.hitRoll.dice).toHaveLength(10);
    expect(result.hits).toBeGreaterThanOrEqual(0);
    expect(result.hits).toBeLessThanOrEqual(10);
    expect(result.triggeredAbilities).toHaveLength(0);
  });
});

// ===============================================
// Indirect Fire (from sprintF_p22)
// ===============================================

describe('Indirect Fire', () => {
  it('-1 to Hit when using Indirect Fire', () => {
    const indirectWeapon: Weapon = {
      id: 'w-mortar', name: 'Mortar', type: 'ranged', range: 48,
      attacks: 2, skill: 4, strength: 5, ap: 0, damage: 1, abilities: ['INDIRECT FIRE'],
    };

    const ctx = {
      weapon: indirectWeapon,
      abilities: indirectWeapon.abilities.map(parseWeaponAbility),
      distanceToTarget: 30,
      targetUnitSize: 5,
      targetKeywords: ['INFANTRY'],
      attackerStationary: true,
      attackerCharged: false,
      attackerModelCount: 1,
    };

    // Run the attack many times and check that Indirect Fire is triggered
    const result = resolveAttackSequence(10, 4, 5, 4, ctx);
    expect(result.triggeredAbilities).toContain('Indirect Fire (-1 to Hit)');
  });
});

// ===============================================
// Extra Attacks (from sprintF_p22)
// ===============================================

describe('Extra Attacks', () => {
  it('parseWeaponAbility parses EXTRA ATTACKS', () => {
    const parsed = parseWeaponAbility('EXTRA ATTACKS 2');
    expect(parsed.name).toBe('EXTRA ATTACKS');
    expect(parsed.value).toBe(2);
  });
});
