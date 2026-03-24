import type { Weapon, Unit } from '../types/index';

// ===== Weapon Ability Parser =====

export interface ParsedAbility {
  name: string;
  value?: number;
  keyword?: string;
}

/**
 * Parse a weapon ability string into a structured object.
 * Examples: "LETHAL HITS" → { name: "LETHAL HITS" }
 *           "SUSTAINED HITS 1" → { name: "SUSTAINED HITS", value: 1 }
 *           "MELTA 2" → { name: "MELTA", value: 2 }
 *           "ANTI-INFANTRY 4+" → { name: "ANTI", value: 4, keyword: "INFANTRY" }
 *           "RAPID FIRE 2" → { name: "RAPID FIRE", value: 2 }
 */
export function parseWeaponAbility(raw: string): ParsedAbility {
  const s = raw.trim().toUpperCase();

  // ANTI-KEYWORD X+
  const antiMatch = s.match(/^ANTI-(\S+)\s+(\d+)\+?$/);
  if (antiMatch) {
    return { name: 'ANTI', value: parseInt(antiMatch[2]), keyword: antiMatch[1] };
  }

  // CONVERSION X
  const convMatch = s.match(/^CONVERSION\s+(\d+)$/);
  if (convMatch) {
    return { name: 'CONVERSION', value: parseInt(convMatch[1]) };
  }

  // Abilities with a numeric value: SUSTAINED HITS X, RAPID FIRE X, MELTA X, FEEL NO PAIN X+
  const valueMatch = s.match(/^(.+?)\s+(\d+)\+?$/);
  if (valueMatch) {
    return { name: valueMatch[1].trim(), value: parseInt(valueMatch[2]) };
  }

  // Simple keyword abilities
  return { name: s };
}

/**
 * Parse all abilities on a weapon into structured objects.
 */
export function parseWeaponAbilities(weapon: Weapon): ParsedAbility[] {
  return weapon.abilities.map(parseWeaponAbility);
}

/**
 * Check if a weapon has a specific ability (case-insensitive).
 */
export function weaponHasAbility(weapon: Weapon, abilityName: string): boolean {
  return weapon.abilities.some(a => a.toUpperCase().startsWith(abilityName.toUpperCase()));
}

// ===== Unit Ability Helpers =====

/**
 * Parse a unit ability string to extract name and value.
 * E.g., "FEEL NO PAIN 5+" → { name: "FEEL NO PAIN", value: 5 }
 *        "DEADLY DEMISE D3" → { name: "DEADLY DEMISE", value: undefined, expr: "D3" }
 *        "SCOUT 6\"" → { name: "SCOUT", value: 6 }
 *        "DEEP STRIKE" → { name: "DEEP STRIKE" }
 */
export function parseUnitAbility(raw: string): { name: string; value?: number; expr?: string } {
  const s = raw.trim().toUpperCase().replace(/"/g, '');

  // Match "NAME X+" or "NAME X"
  const valMatch = s.match(/^(.+?)\s+(\d+)\+?$/);
  if (valMatch) {
    return { name: valMatch[1].trim(), value: parseInt(valMatch[2]) };
  }

  // Match "NAME DX" or "NAME DX+Y"
  const diceMatch = s.match(/^(.+?)\s+(D\d+(?:\+\d+)?)$/);
  if (diceMatch) {
    return { name: diceMatch[1].trim(), expr: diceMatch[2] };
  }

  return { name: s };
}

/**
 * Check if a unit has a specific ability.
 */
export function unitHasAbility(unit: Unit, abilityName: string): boolean {
  return unit.abilities.some(a => a.toUpperCase().startsWith(abilityName.toUpperCase()));
}

/**
 * Get the value of a unit ability (e.g., Feel No Pain 5+ → 5, Scout 6" → 6).
 */
export function getUnitAbilityValue(unit: Unit, abilityName: string): number | undefined {
  const ability = unit.abilities.find(a => a.toUpperCase().startsWith(abilityName.toUpperCase()));
  if (!ability) return undefined;
  const parsed = parseUnitAbility(ability);
  return parsed.value;
}

/**
 * Check if all models in a unit have the Stealth ability.
 * Stealth only applies if ALL models have it.
 */
export function unitHasStealth(unit: Unit): boolean {
  return unitHasAbility(unit, 'STEALTH');
}
