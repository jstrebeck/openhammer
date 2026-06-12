import type { DiceRoll, GameState, Weapon } from '../types/index';
import { rollDice } from '../dice/index';
import { determineCover } from '../terrain/cover';
import { getStratagemSaveModifiers } from './stratagems';
import { getOrderSaveModifier } from './factionModifiers';
import { weaponHasAbility } from './abilities';

// ===== Save Resolution =====

/**
 * Compute the defensive save modifiers for an incoming attack, combining every
 * Benefit of Cover source (terrain, Smokescreen, Go to Ground, Take Cover! order,
 * Indirect Fire) and Go to Ground's 6+ invulnerable save.
 *
 * Benefit of Cover is not cumulative — the result is capped at +1. Weapons with
 * [IGNORES COVER] negate the cover bonus but not Go to Ground's invulnerable save.
 * Melee attacks never benefit from cover.
 */
export function computeDefensiveSaveModifiers(
  state: GameState,
  attackingUnitId: string,
  targetUnitId: string,
  weapon?: Weapon,
): { coverSaveModifier: number; bonusInvulnSave?: number } {
  const targetUnit = state.units[targetUnitId];
  if (!targetUnit) return { coverSaveModifier: 0 };
  if (weapon?.type === 'melee') return { coverSaveModifier: 0 };

  const strat = getStratagemSaveModifiers(state, targetUnitId);
  // Go to Ground's invuln is not a cover benefit — Ignores Cover does not negate it
  const bonusInvulnSave = strat.bonusInvulnSave;

  const ignoresCover = weapon ? weaponHasAbility(weapon, 'IGNORES COVER') : false;
  let hasCover = false;
  if (!ignoresCover) {
    hasCover = strat.coverSaveModifier > 0;
    if (!hasCover && getOrderSaveModifier(state, targetUnit) > 0) hasCover = true;
    if (!hasCover && weapon && weaponHasAbility(weapon, 'INDIRECT FIRE')) hasCover = true;
    if (!hasCover) {
      const attackingUnit = state.units[attackingUnitId];
      if (attackingUnit) {
        hasCover = determineCover(attackingUnit, targetUnit, state).hasCover;
      }
    }
  }

  return { coverSaveModifier: hasCover ? 1 : 0, bonusInvulnSave };
}

export function resolveSave(
  saveCharacteristic: number,
  ap: number,
  invulnSave?: number,
  options?: {
    /** Bonus to save from cover/stratagems (e.g., +1 from Smokescreen/Go to Ground) */
    coverSaveModifier?: number;
    /** Bonus invulnerable save from stratagems (e.g., 6+ from Go to Ground) */
    bonusInvulnSave?: number;
  },
): {
  saveRoll: DiceRoll;
  saved: boolean;
} {
  // Apply cover save modifier (e.g., Benefit of Cover = +1, which means -1 to the characteristic number)
  let effectiveSaveChar = saveCharacteristic;
  if (options?.coverSaveModifier) {
    // +1 save means the number goes down (better): 4+ becomes 3+
    // But cover doesn't help models with 3+ or better save vs AP 0
    if (!(saveCharacteristic <= 3 && ap === 0)) {
      effectiveSaveChar = saveCharacteristic - options.coverSaveModifier;
    }
  }

  const modifiedSave = effectiveSaveChar - ap;

  // Consider bonus invuln save (e.g., 6+ from Go to Ground)
  let bestInvuln = invulnSave;
  if (options?.bonusInvulnSave) {
    bestInvuln = bestInvuln
      ? Math.min(bestInvuln, options.bonusInvulnSave)
      : options.bonusInvulnSave;
  }

  const effectiveSave = bestInvuln
    ? Math.min(modifiedSave, bestInvuln)
    : modifiedSave;

  const saveRoll = rollDice(1, 6, 'Save', effectiveSave);
  const dieResult = saveRoll.dice[0];
  const saved = dieResult !== 1 && dieResult >= effectiveSave;

  return { saveRoll, saved };
}

// ===== Feel No Pain =====

/**
 * Resolve Feel No Pain rolls after damage. Returns the number of wounds actually suffered.
 */
export function resolveFeelNoPain(
  damage: number,
  fnpThreshold: number,
): { woundsSuffered: number; woundsBlocked: number; rolls: DiceRoll } {
  const rolls = rollDice(damage, 6, `Feel No Pain (${fnpThreshold}+)`, fnpThreshold);
  let blocked = 0;
  for (const d of rolls.dice) {
    if (d >= fnpThreshold) blocked++;
  }
  return { woundsSuffered: damage - blocked, woundsBlocked: blocked, rolls };
}
