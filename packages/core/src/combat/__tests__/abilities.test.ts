import { describe, it, expect } from 'vitest';
import { parseWeaponAbility, parseWeaponAbilities, weaponHasAbility, parseUnitAbility, unitHasAbility, getUnitAbilityValue } from '../abilities';
import type { Weapon, Unit } from '../../types/index';

// ===============================================
// Weapon Ability Parser
// ===============================================

describe('Weapon Ability Parser', () => {
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
// Unit Ability Parser
// ===============================================

describe('Unit Ability Parser', () => {
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
