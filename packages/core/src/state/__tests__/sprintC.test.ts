import { describe, it, expect } from 'vitest';
import { parseWeaponAbility, parseWeaponAbilities, weaponHasAbility, parseUnitAbility, unitHasAbility, getUnitAbilityValue } from '../../combat/abilities';
import { calculateAttacks, resolveAttackSequence, getWoundThreshold } from '../../combat/attackPipeline';
import type { AttackContext } from '../../combat/attackPipeline';
import { resolveFeelNoPain } from '../../combat/saves';
import { canUnitShootWithAbilities } from '../../combat/shooting';
import type { Weapon, Unit } from '../../types/index';
import '../../editions/index';

// ===============================================
// Phase 13: Weapon Ability Parser
// ===============================================

describe('Phase 13: Weapon Ability Parser', () => {
  it('parses simple abilities: LETHAL HITS', () => {
    const parsed = parseWeaponAbility('LETHAL HITS');
    expect(parsed.name).toBe('LETHAL HITS');
    expect(parsed.value).toBeUndefined();
  });

  it('parses abilities with values: SUSTAINED HITS 1', () => {
    const parsed = parseWeaponAbility('SUSTAINED HITS 1');
    expect(parsed.name).toBe('SUSTAINED HITS');
    expect(parsed.value).toBe(1);
  });

  it('parses MELTA 2', () => {
    const parsed = parseWeaponAbility('MELTA 2');
    expect(parsed.name).toBe('MELTA');
    expect(parsed.value).toBe(2);
  });

  it('parses RAPID FIRE 2', () => {
    const parsed = parseWeaponAbility('RAPID FIRE 2');
    expect(parsed.name).toBe('RAPID FIRE');
    expect(parsed.value).toBe(2);
  });

  it('parses ANTI-INFANTRY 4+', () => {
    const parsed = parseWeaponAbility('ANTI-INFANTRY 4+');
    expect(parsed.name).toBe('ANTI');
    expect(parsed.value).toBe(4);
    expect(parsed.keyword).toBe('INFANTRY');
  });

  it('parses CONVERSION 12', () => {
    const parsed = parseWeaponAbility('CONVERSION 12');
    expect(parsed.name).toBe('CONVERSION');
    expect(parsed.value).toBe(12);
  });

  it('parses case-insensitively', () => {
    const parsed = parseWeaponAbility('lethal hits');
    expect(parsed.name).toBe('LETHAL HITS');
  });

  it('weaponHasAbility checks correctly', () => {
    const weapon: Weapon = {
      id: 'w1', name: 'Test', type: 'ranged', range: 24,
      attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1,
      abilities: ['LETHAL HITS', 'SUSTAINED HITS 1'],
    };
    expect(weaponHasAbility(weapon, 'LETHAL HITS')).toBe(true);
    expect(weaponHasAbility(weapon, 'SUSTAINED')).toBe(true);
    expect(weaponHasAbility(weapon, 'MELTA')).toBe(false);
  });

  it('parseWeaponAbilities parses all abilities on a weapon', () => {
    const weapon: Weapon = {
      id: 'w1', name: 'Test', type: 'ranged', range: 24,
      attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1,
      abilities: ['LETHAL HITS', 'RAPID FIRE 1', 'ANTI-INFANTRY 4+'],
    };
    const parsed = parseWeaponAbilities(weapon);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe('LETHAL HITS');
    expect(parsed[1].name).toBe('RAPID FIRE');
    expect(parsed[1].value).toBe(1);
    expect(parsed[2].name).toBe('ANTI');
    expect(parsed[2].keyword).toBe('INFANTRY');
  });
});

// ===============================================
// Phase 13: Attack Calculation with Abilities
// ===============================================

describe('Phase 13: calculateAttacks', () => {
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
// Phase 13: resolveAttackSequence with Abilities
// ===============================================

describe('Phase 13: resolveAttackSequence with abilities', () => {
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
// Phase 13: Assault (shoot after advancing)
// ===============================================

describe('Phase 13: Assault weapon ability', () => {
  it('canUnitShootWithAbilities: allows Assault weapons after Advance', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Assault Bolter', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['ASSAULT'] },
    ];
    const result = canUnitShootWithAbilities('advance', weapons);
    expect(result.allowed).toBe(true);
    expect(result.assaultOnly).toBe(true);
  });

  it('canUnitShootWithAbilities: blocks non-Assault weapons after Advance', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Heavy Bolter', type: 'ranged', range: 36, attacks: 3, skill: 4, strength: 5, ap: -1, damage: 2, abilities: ['HEAVY'] },
    ];
    const result = canUnitShootWithAbilities('advance', weapons);
    expect(result.allowed).toBe(false);
  });

  it('canUnitShootWithAbilities: always blocks after Fall Back', () => {
    const weapons: Weapon[] = [
      { id: 'w1', name: 'Assault Bolter', type: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['ASSAULT'] },
    ];
    const result = canUnitShootWithAbilities('fall_back', weapons);
    expect(result.allowed).toBe(false);
  });

  it('canUnitShootWithAbilities: allows normal move', () => {
    const result = canUnitShootWithAbilities('normal', []);
    expect(result.allowed).toBe(true);
  });
});

// ===============================================
// Phase 17: Unit Ability Parser
// ===============================================

describe('Phase 17: Unit Ability Parser', () => {
  it('parses DEEP STRIKE', () => {
    const parsed = parseUnitAbility('DEEP STRIKE');
    expect(parsed.name).toBe('DEEP STRIKE');
    expect(parsed.value).toBeUndefined();
  });

  it('parses FEEL NO PAIN 5+', () => {
    const parsed = parseUnitAbility('FEEL NO PAIN 5+');
    expect(parsed.name).toBe('FEEL NO PAIN');
    expect(parsed.value).toBe(5);
  });

  it('parses SCOUT 6"', () => {
    const parsed = parseUnitAbility('SCOUT 6"');
    expect(parsed.name).toBe('SCOUT');
    expect(parsed.value).toBe(6);
  });

  it('parses DEADLY DEMISE D3', () => {
    const parsed = parseUnitAbility('DEADLY DEMISE D3');
    expect(parsed.name).toBe('DEADLY DEMISE');
    expect(parsed.expr).toBe('D3');
  });

  it('unitHasAbility checks correctly', () => {
    const unit: Unit = {
      id: 'u1', name: 'Test', playerId: 'p1', modelIds: [], keywords: [],
      abilities: ['DEEP STRIKE', 'FEEL NO PAIN 5+', 'STEALTH'], weapons: [],
    };
    expect(unitHasAbility(unit, 'DEEP STRIKE')).toBe(true);
    expect(unitHasAbility(unit, 'FEEL NO PAIN')).toBe(true);
    expect(unitHasAbility(unit, 'STEALTH')).toBe(true);
    expect(unitHasAbility(unit, 'SCOUT')).toBe(false);
  });

  it('getUnitAbilityValue extracts value', () => {
    const unit: Unit = {
      id: 'u1', name: 'Test', playerId: 'p1', modelIds: [], keywords: [],
      abilities: ['FEEL NO PAIN 5+', 'SCOUT 6"'], weapons: [],
    };
    expect(getUnitAbilityValue(unit, 'FEEL NO PAIN')).toBe(5);
    expect(getUnitAbilityValue(unit, 'SCOUT')).toBe(6);
    expect(getUnitAbilityValue(unit, 'DEEP STRIKE')).toBeUndefined();
  });
});

// ===============================================
// Phase 17: Feel No Pain
// ===============================================

describe('Phase 17: Feel No Pain', () => {
  it('rolls D6 per wound and blocks on threshold+', () => {
    // Run many times to verify probabilistic behavior
    let totalBlocked = 0;
    let totalRolls = 0;
    for (let i = 0; i < 100; i++) {
      const result = resolveFeelNoPain(3, 5); // 3 wounds, FNP 5+
      totalRolls += 3;
      totalBlocked += result.woundsBlocked;
      expect(result.woundsSuffered + result.woundsBlocked).toBe(3);
      expect(result.rolls.dice).toHaveLength(3);
    }
    // With FNP 5+, expect roughly 33% blocked
    const blockRate = totalBlocked / totalRolls;
    expect(blockRate).toBeGreaterThan(0.1);
    expect(blockRate).toBeLessThan(0.6);
  });

  it('returns correct dice roll object', () => {
    const result = resolveFeelNoPain(2, 6); // FNP 6+
    expect(result.rolls.purpose).toContain('Feel No Pain');
    expect(result.rolls.dice).toHaveLength(2);
    expect(result.woundsSuffered + result.woundsBlocked).toBe(2);
  });
});

// ===============================================
// Phase 13: Wound Threshold (verify still works)
// ===============================================

describe('Phase 13: Wound Threshold', () => {
  it('S >= 2T → 2+', () => expect(getWoundThreshold(8, 4)).toBe(2));
  it('S > T → 3+', () => expect(getWoundThreshold(5, 4)).toBe(3));
  it('S == T → 4+', () => expect(getWoundThreshold(4, 4)).toBe(4));
  it('S < T → 5+', () => expect(getWoundThreshold(3, 4)).toBe(5));
  it('S <= T/2 → 6+', () => expect(getWoundThreshold(2, 4)).toBe(6));
});
