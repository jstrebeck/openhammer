import type { BattlescribeRoster, ArmyListValidationError } from './schema';

/**
 * Validate a Battlescribe JSON export.
 * Checks the top-level structure is present and has at least one force with selections.
 */
export function validateArmyList(data: unknown): { valid: boolean; errors: ArmyListValidationError[]; roster: BattlescribeRoster | null } {
  const errors: ArmyListValidationError[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: [{ path: '', message: 'Input must be a JSON object' }], roster: null };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.roster !== 'object' || obj.roster === null) {
    return { valid: false, errors: [{ path: 'roster', message: '"roster" field is required and must be an object' }], roster: null };
  }

  const roster = obj.roster as Record<string, unknown>;

  if (!Array.isArray(roster.forces) || roster.forces.length === 0) {
    errors.push({ path: 'roster.forces', message: '"roster.forces" must be a non-empty array' });
  } else {
    for (let i = 0; i < roster.forces.length; i++) {
      const force = roster.forces[i] as Record<string, unknown>;
      if (typeof force !== 'object' || force === null) {
        errors.push({ path: `roster.forces[${i}]`, message: 'Force must be an object' });
        continue;
      }

      if (!Array.isArray(force.selections)) {
        errors.push({ path: `roster.forces[${i}].selections`, message: 'Force must have a "selections" array' });
      } else {
        // Check that there's at least one model or unit selection
        const unitOrModelSelections = (force.selections as Record<string, unknown>[]).filter(
          (s) => s.type === 'model' || s.type === 'unit',
        );
        if (unitOrModelSelections.length === 0) {
          errors.push({
            path: `roster.forces[${i}].selections`,
            message: 'Force has no unit or model selections — only configuration/upgrades found',
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, roster: null };
  }

  return { valid: true, errors: [], roster: obj as unknown as BattlescribeRoster };
}
