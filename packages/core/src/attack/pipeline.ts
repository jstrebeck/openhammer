import { evalDiceExpression } from '../dice/index.js';
import type { RngState } from '../types/state.js';
import type { CoreParameters } from '../types/content.js';
import {
  type AttackComputation,
  type RerollMode,
  cappedModifier,
  woundThreshold,
} from '../effects/engine.js';

/**
 * Pure attack resolution. The reducer builds an AttackComputation (firing
 * effect hooks along the way), then calls these stage functions. Each stage
 * returns a full breakdown for the game log; nothing is hidden.
 */

export interface DieResult {
  initial: number;
  rerolled: boolean;
  final: number; // unmodified face after any reroll
  modified: number;
  success: boolean;
  critical: boolean;
}

function resolveRollBatch(
  count: number,
  threshold: number, // needed on the modified die, e.g. 3 means 3+
  netModifier: number,
  critOn: number,
  reroll: RerollMode,
  rng: RngState,
  draw: (rng: RngState, n: number) => { rolls: number[]; rng: RngState },
): { dice: DieResult[]; rng: RngState } {
  let cur = rng;
  const first = draw(cur, count);
  cur = first.rng;
  const dice: DieResult[] = [];
  const judge = (face: number) => {
    const critical = face >= critOn;
    // Unmodified 1 always fails; criticals always succeed.
    const success = face !== 1 && (critical || face + netModifier >= threshold);
    return { success, critical };
  };
  const needsReroll = (face: number): boolean => {
    if (reroll === 'none') return false;
    if (reroll === 'ones') return face === 1;
    // 'failed' and 'any': reroll anything that is not a success.
    // ('any' also allows fishing for crits; auto-resolution only rerolls
    // failures — a player-facing choice can refine this later.)
    return !judge(face).success;
  };
  const toReroll: number[] = [];
  for (const face of first.rolls) {
    if (needsReroll(face)) toReroll.push(dice.length);
    dice.push({ initial: face, rerolled: false, final: face, modified: face + netModifier, ...judge(face) });
  }
  if (toReroll.length > 0) {
    const second = draw(cur, toReroll.length);
    cur = second.rng;
    toReroll.forEach((dieIndex, i) => {
      const face = second.rolls[i] ?? 1;
      const j = judge(face);
      dice[dieIndex] = {
        initial: dice[dieIndex]!.initial,
        rerolled: true,
        final: face,
        modified: face + netModifier,
        success: j.success,
        critical: j.critical,
      };
    });
  }
  return { dice, rng: cur };
}

import { rollD6 } from '../dice/index.js';

// ---------------------------------------------------------------------------
// Stage 0: number of attacks
// ---------------------------------------------------------------------------

export interface AttacksResult {
  perModelRolls: { total: number; rolls: number[] }[];
  blastBonus: number;
  total: number;
  rng: RngState;
}

export function computeAttacks(
  comp: AttackComputation,
  modelsFiring: number,
  targetModelCount: number,
  rng: RngState,
): AttacksResult {
  let cur = rng;
  const perModelRolls: { total: number; rolls: number[] }[] = [];
  let total = 0;
  for (let i = 0; i < modelsFiring; i++) {
    const r = evalDiceExpression(comp.attacksExpr, cur);
    cur = r.rng;
    const perModel = r.total + comp.attacksFlatBonus;
    perModelRolls.push({ total: perModel, rolls: r.rolls });
    total += perModel;
  }
  let blastBonus = 0;
  for (const scale of comp.attacksPerTargetModels) {
    blastBonus += Math.floor(targetModelCount / scale.per) * scale.value * modelsFiring;
  }
  total += blastBonus;
  return { perModelRolls, blastBonus, total, rng: cur };
}

// ---------------------------------------------------------------------------
// Stage 1: hit rolls
// ---------------------------------------------------------------------------

export interface HitResult {
  dice: DieResult[];
  netModifier: number;
  autoHit: boolean;
  /** Ordinary hits that proceed to the wound roll. */
  hits: number;
  /** Critical hits that auto-wound (Lethal Hits) — skip the wound roll. */
  autoWounds: number;
  /** Extra hits from Sustained Hits. */
  sustainedExtra: number;
  rng: RngState;
}

export function rollHits(
  comp: AttackComputation,
  attacks: number,
  params: CoreParameters,
  rng: RngState,
): HitResult {
  if (comp.autoHit || comp.hitSkill === null) {
    return {
      dice: [],
      netModifier: 0,
      autoHit: true,
      hits: attacks,
      autoWounds: 0,
      sustainedExtra: 0,
      rng,
    };
  }
  const netModifier = comp.ignoreModifiers.has('hit')
    ? 0
    : cappedModifier(comp.hitModifiers, params.modifierCaps.hit);
  const { dice, rng: next } = resolveRollBatch(
    attacks,
    comp.hitSkill,
    netModifier,
    comp.critHitOn,
    comp.rerollHit,
    rng,
    rollD6,
  );
  let hits = 0;
  let autoWounds = 0;
  let sustainedExtra = 0;
  for (const die of dice) {
    if (!die.success) continue;
    if (die.critical) {
      sustainedExtra += comp.sustainedHits;
      if (comp.lethalHits) {
        autoWounds += 1;
        continue;
      }
    }
    hits += 1;
  }
  hits += sustainedExtra; // sustained extra hits are ordinary hits
  return { dice, netModifier, autoHit: false, hits, autoWounds, sustainedExtra, rng: next };
}

// ---------------------------------------------------------------------------
// Stage 2: wound rolls
// ---------------------------------------------------------------------------

export interface WoundResult {
  dice: DieResult[];
  threshold: number;
  netModifier: number;
  /** Normal wounds proceeding to allocation/saves. */
  wounds: number;
  /** Critical wounds converted to mortal wounds (Devastating Wounds). */
  devastatingWounds: number;
  rng: RngState;
}

export function rollWounds(
  comp: AttackComputation,
  hits: number,
  autoWounds: number,
  params: CoreParameters,
  rng: RngState,
): WoundResult {
  const threshold = woundThreshold(comp.strength, comp.toughness);
  const netModifier = comp.ignoreModifiers.has('wound')
    ? 0
    : cappedModifier(comp.woundModifiers, params.modifierCaps.wound);
  const { dice, rng: next } = resolveRollBatch(
    hits,
    threshold,
    netModifier,
    comp.critWoundOn,
    comp.rerollWound,
    rng,
    rollD6,
  );
  let wounds = autoWounds;
  let devastatingWounds = 0;
  for (const die of dice) {
    if (!die.success) continue;
    if (die.critical && comp.devastatingWounds) {
      devastatingWounds += 1;
      continue;
    }
    wounds += 1;
  }
  return { dice, threshold, netModifier, wounds, devastatingWounds, rng: next };
}

// ---------------------------------------------------------------------------
// Stage 3: a single saving throw (per allocated attack)
// ---------------------------------------------------------------------------

export interface SaveResult {
  die: number;
  rerolled: boolean;
  usedInvulnerable: boolean;
  needed: number;
  saved: boolean;
  coverApplied: boolean;
  rng: RngState;
}

export function rollSave(
  comp: AttackComputation,
  modelSave: number,
  modelInvuln: number | null,
  params: CoreParameters,
  rng: RngState,
): SaveResult {
  // Cover: +1 to armour save vs ranged, but not for Sv3+ (or better) vs AP0.
  const coverApplied =
    comp.cover &&
    !comp.ignoresCover &&
    !(modelSave <= params.coverIneligibleSaveAtOrBelow && comp.ap === 0);
  const improvement = Math.min(
    params.modifierCaps.saveImprovement,
    comp.saveModifiers.filter((m) => m > 0).reduce((a, b) => a + b, 0) + (coverApplied ? 1 : 0),
  );
  const penalties = comp.saveModifiers.filter((m) => m < 0).reduce((a, b) => a + b, 0);
  // ap is stored non-positive; subtracting it worsens the needed roll.
  const armourNeeded = modelSave - comp.ap - improvement - penalties;
  const invuln = comp.invulnerableSave !== null
    ? modelInvuln !== null
      ? Math.min(comp.invulnerableSave, modelInvuln)
      : comp.invulnerableSave
    : modelInvuln;
  // Auto-pick the better save; the defender UI can override before rolling.
  const useInvuln = invuln !== null && invuln < armourNeeded;
  const needed = useInvuln ? invuln : armourNeeded;
  const { rolls, rng: next } = rollD6(rng, 1);
  const die = rolls[0] ?? 1;
  const saved = die !== 1 && die >= needed;
  return { die, rerolled: false, usedInvulnerable: useInvuln, needed, saved, coverApplied, rng: next };
}

// ---------------------------------------------------------------------------
// Stage 4: damage for one failed save
// ---------------------------------------------------------------------------

export interface DamageResult {
  rolls: number[];
  amount: number;
  rng: RngState;
}

export function rollDamage(comp: AttackComputation, rng: RngState): DamageResult {
  const r = evalDiceExpression(comp.damageExpr, rng);
  const amount = Math.max(comp.minimumDamage, r.total + comp.damageBonus);
  return { rolls: r.rolls, amount, rng: r.rng };
}

/** Feel No Pain: roll per point of damage; each success discards one point. */
export function rollFeelNoPain(
  fnp: number,
  damage: number,
  rng: RngState,
): { rolls: number[]; prevented: number; taken: number; rng: RngState } {
  const { rolls, rng: next } = rollD6(rng, damage);
  const prevented = rolls.filter((r) => r >= fnp).length;
  return { rolls, prevented, taken: damage - prevented, rng: next };
}
