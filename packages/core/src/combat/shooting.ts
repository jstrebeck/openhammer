import type { Weapon, Model, Unit, GameState, MoveType } from '../types/index';
import { weaponHasAbility } from './abilities';
import { distanceBetweenModels } from '../measurement/index';

// ===== Shooting Eligibility with Abilities =====

/**
 * Check if a unit can shoot considering weapon abilities like Assault.
 */
export function canUnitShootWithAbilities(
  moveType: MoveType | undefined,
  weapons: Weapon[],
): { allowed: boolean; reason?: string; assaultOnly?: boolean } {
  if (moveType === 'advance') {
    // Check if any weapon has Assault
    const hasAssault = weapons.some(w => weaponHasAbility(w, 'ASSAULT'));
    if (hasAssault) {
      return { allowed: true, assaultOnly: true };
    }
    return { allowed: false, reason: 'Unit Advanced — only Assault weapons can fire' };
  }
  if (moveType === 'fall_back') {
    return { allowed: false, reason: 'Unit Fell Back and cannot shoot' };
  }
  return { allowed: true };
}

// ===== Engagement Range Shooting =====

/**
 * Check if a unit is in engagement range of any enemy.
 */
export function isUnitInEngagementRange(unit: Unit, state: GameState, engagementRange: number): boolean {
  const unitModels = unit.modelIds
    .map(id => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  for (const um of unitModels) {
    for (const other of Object.values(state.models)) {
      if (other.status !== 'active') continue;
      const otherUnit = state.units[other.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;
      if (distanceBetweenModels(um, other) <= engagementRange) return true;
    }
  }
  return false;
}

/**
 * Get enemy unit IDs that are in engagement range of the given unit.
 */
export function getEngagedEnemyUnits(unit: Unit, state: GameState, engagementRange: number): string[] {
  const engaged = new Set<string>();
  const unitModels = unit.modelIds
    .map(id => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  for (const um of unitModels) {
    for (const other of Object.values(state.models)) {
      if (other.status !== 'active') continue;
      const otherUnit = state.units[other.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;
      if (distanceBetweenModels(um, other) <= engagementRange) {
        engaged.add(otherUnit.id);
      }
    }
  }
  return Array.from(engaged);
}

/**
 * Check what a unit can shoot while in engagement range.
 * Big Guns Never Tire: MONSTER/VEHICLE can shoot ranged (non-Pistol) weapons, targeting only engaged units.
 * Pistols: Any unit can fire Pistol weapons at engaged units.
 */
export function getEngagementShootingMode(unit: Unit): 'none' | 'big_guns' | 'pistols' | 'both' {
  const isMonsterOrVehicle = unit.keywords.some(k => k === 'MONSTER' || k === 'VEHICLE');
  const hasPistols = unit.weapons.some(w => w.type === 'ranged' && weaponHasAbility(w, 'PISTOL'));

  if (isMonsterOrVehicle && hasPistols) return 'both';
  if (isMonsterOrVehicle) return 'big_guns';
  if (hasPistols) return 'pistols';
  return 'none';
}

/**
 * Filter weapons a unit can fire while in engagement range.
 * Big Guns: ranged weapons except Pistols.
 * Pistols: only Pistol weapons.
 */
export function getWeaponsForEngagementShooting(unit: Unit, mode: 'big_guns' | 'pistols' | 'both'): Weapon[] {
  return unit.weapons.filter(w => {
    if (w.type !== 'ranged') return false;
    const isPistol = weaponHasAbility(w, 'PISTOL');
    if (mode === 'big_guns') return !isPistol;
    if (mode === 'pistols') return isPistol;
    // 'both': all ranged weapons
    return true;
  });
}

// ===== Target Validation =====

export function isTargetInRange(attacker: Model, target: Model, weapon: Weapon): boolean {
  if (weapon.type === 'melee') return true;
  if (!weapon.range) return false;
  return distanceBetweenModels(attacker, target) <= weapon.range;
}

export function getValidShootingTargets(attackingUnit: Unit, state: GameState): string[] {
  const targetUnitIds: Set<string> = new Set();

  for (const targetUnit of Object.values(state.units)) {
    if (targetUnit.playerId === attackingUnit.playerId) continue;
    const hasActiveModels = targetUnit.modelIds.some(id => {
      const m = state.models[id];
      return m && m.status === 'active';
    });
    if (!hasActiveModels) continue;

    for (const attackerModelId of attackingUnit.modelIds) {
      const attackerModel = state.models[attackerModelId];
      if (!attackerModel || attackerModel.status !== 'active') continue;

      for (const weapon of attackingUnit.weapons) {
        if (weapon.type !== 'ranged') continue;
        for (const targetModelId of targetUnit.modelIds) {
          const targetModel = state.models[targetModelId];
          if (!targetModel || targetModel.status !== 'active') continue;
          if (isTargetInRange(attackerModel, targetModel, weapon)) {
            targetUnitIds.add(targetUnit.id);
          }
        }
      }
    }
  }

  return Array.from(targetUnitIds);
}
