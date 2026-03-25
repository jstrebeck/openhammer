import type { DiceRoll, Weapon } from '../types/index';
import { rollDice } from '../dice/index';
import type { ParsedAbility } from './abilities';
import { generateUUID } from '../utils/uuid';

// ===== Dice Expression Parser =====

/**
 * Parse a dice expression like "D6", "D3", "2D6", "D3+1", "D6+3", "3" into a rolled value.
 */
export function parseDiceExpression(expr: number | string): number {
  if (typeof expr === 'number') return expr;

  const trimmed = expr.trim().toUpperCase();
  const plainNum = Number(trimmed);
  if (!isNaN(plainNum)) return plainNum;

  const match = trimmed.match(/^(\d*)D(\d+)(?:\+(\d+))?$/);
  if (!match) return 1;

  const count = match[1] ? parseInt(match[1]) : 1;
  const sides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total + bonus;
}

// ===== Wound Threshold =====

export function getWoundThreshold(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

// ===== Attack Context (for ability-aware resolution) =====

export interface AttackContext {
  /** The weapon being used */
  weapon: Weapon;
  /** Parsed abilities */
  abilities: ParsedAbility[];
  /** Distance between attacker and closest target model (edge-to-edge) */
  distanceToTarget: number;
  /** Number of active models in the target unit */
  targetUnitSize: number;
  /** Keywords on the target unit */
  targetKeywords: string[];
  /** Whether the attacking unit remained stationary this turn */
  attackerStationary: boolean;
  /** Whether the attacking unit charged this turn */
  attackerCharged: boolean;
  /** Number of active models in the attacking unit */
  attackerModelCount: number;
  /** External hit modifier applied to attacker (e.g., Stealth/Smokescreen = -1) */
  targetHitModifier?: number;
  /** Critical hit threshold — unmodified roll >= this is a crit (default 6). E.g. Born Soldiers sets to 5 for ranged. */
  criticalHitThreshold?: number;
  /** External wound roll modifier (e.g., detachment rules like -1 to wound) */
  woundRollModifier?: number;
  /** If true, re-roll wound rolls of 1 */
  rerollWoundRollsOf1?: boolean;
  /** If true, re-roll hit rolls of 1 (e.g., Take Aim / Fix Bayonets orders) */
  rerollHitRollsOf1?: boolean;
  /** Additional AP modifier applied to the weapon (e.g., FRFSRF order: -1) */
  bonusAP?: number;
  /** Characteristic improvement to BS/WS (e.g., Take Aim! = 1, Fix Bayonets! = 1). Applied to base skill, separate from hit roll modifiers. */
  skillImprovement?: number;
  /** Bonus attacks to add (e.g., FRFSRF = 1 for Rapid Fire weapons) */
  bonusAttacks?: number;
  /** Target unit ID (for guided target / For the Greater Good checks) */
  targetUnitId?: string;
}

function hasAbility(ctx: AttackContext, name: string): boolean {
  return ctx.abilities.some(a => a.name === name);
}

function getAbilityValue(ctx: AttackContext, name: string): number | undefined {
  return ctx.abilities.find(a => a.name === name)?.value;
}

// ===== Ability-Aware Attack Resolution =====

export interface AttackResult {
  numAttacks: number;
  hitRoll: DiceRoll;
  hits: number;
  criticalHits: number;
  autoWounds: number;       // From Lethal Hits
  extraHits: number;        // From Sustained Hits
  woundRoll: DiceRoll;
  wounds: number;
  mortalWounds: number;     // From Devastating Wounds
  effectiveDamage: number;  // Per unsaved wound (after Melta etc.)
  /** Abilities that triggered during this attack */
  triggeredAbilities: string[];
}

/**
 * Calculate the number of attacks after abilities are applied.
 */
export function calculateAttacks(ctx: AttackContext): number {
  let attacks = parseDiceExpression(ctx.weapon.attacks) * ctx.attackerModelCount;

  // Blast: +1 attack per 5 models in target unit
  if (hasAbility(ctx, 'BLAST') && ctx.targetUnitSize >= 5) {
    attacks += Math.floor(ctx.targetUnitSize / 5) * ctx.attackerModelCount;
  }

  // Rapid Fire X: +X attacks within half range
  const rapidFireVal = getAbilityValue(ctx, 'RAPID FIRE');
  if (rapidFireVal !== undefined && ctx.weapon.range) {
    if (ctx.distanceToTarget <= ctx.weapon.range / 2) {
      attacks += rapidFireVal * ctx.attackerModelCount;
    }
  }

  return Math.max(1, attacks);
}

/**
 * Resolve a full ability-aware attack sequence: hit roll → wound roll.
 */
export function resolveAttackSequence(
  numAttacks: number,
  skill: number,
  strength: number,
  toughness: number,
  ctx?: AttackContext,
): AttackResult {
  const triggered: string[] = [];

  // --- Characteristic Improvements (applied before modifiers) ---
  // Skill improvement (e.g., Take Aim! BS+1, Fix Bayonets! WS+1) modifies the base characteristic
  const effectiveBaseSkill = Math.max(2, skill - (ctx?.skillImprovement ?? 0));
  // Bonus attacks (e.g., FRFSRF +1 Attacks for Rapid Fire)
  const totalAttacks = numAttacks + (ctx?.bonusAttacks ?? 0);

  // --- Hit Modifier ---
  let hitModifier = 0;
  if (ctx) {
    // Heavy: +1 to Hit if stationary
    if (hasAbility(ctx, 'HEAVY') && ctx.attackerStationary) {
      hitModifier += 1;
      triggered.push('Heavy (+1 to Hit)');
    }
    // Indirect Fire: -1 to Hit
    if (hasAbility(ctx, 'INDIRECT FIRE')) {
      hitModifier -= 1;
      triggered.push('Indirect Fire (-1 to Hit)');
    }
    // External hit modifier (e.g., Stealth/Smokescreen = -1)
    if (ctx.targetHitModifier) {
      hitModifier += ctx.targetHitModifier;
      if (ctx.targetHitModifier < 0) {
        triggered.push(`Stealth (-1 to Hit)`);
      }
    }
  }
  // Clamp modifier to ±1
  hitModifier = Math.max(-1, Math.min(1, hitModifier));

  // --- Hit Roll ---
  let hitRoll: DiceRoll;
  let hits: number;
  let criticalHits = 0;
  let autoWounds = 0;
  let extraHits = 0;

  const isTorrent = ctx && hasAbility(ctx, 'TORRENT');

  if (isTorrent) {
    // Torrent: auto-hit, no roll needed
    hitRoll = { id: generateUUID(), dice: [], sides: 6, purpose: 'To Hit (Torrent - auto)', timestamp: Date.now() };
    hits = totalAttacks;
    triggered.push('Torrent (auto-hit)');
  } else {
    hitRoll = rollDice(totalAttacks, 6, 'To Hit', effectiveBaseSkill);
    const effectiveSkill = Math.max(2, effectiveBaseSkill - hitModifier); // Can't go below 2+

    hits = 0;
    for (const d of hitRoll.dice) {
      if (d === 1) continue; // Unmodified 1 always fails
      const critThreshold = ctx?.criticalHitThreshold ?? 6;
      const isCrit = d >= critThreshold; // Unmodified roll >= threshold is a critical hit

      // Conversion X: crits on 4+ if target > X" away
      let conversionCrit = false;
      if (ctx) {
        const convVal = getAbilityValue(ctx, 'CONVERSION');
        if (convVal !== undefined && ctx.distanceToTarget > convVal && d >= 4) {
          conversionCrit = true;
        }
      }

      if (isCrit || conversionCrit || d + hitModifier >= effectiveSkill) {
        hits++;
        if (isCrit || conversionCrit) {
          criticalHits++;

          // Lethal Hits: critical hit auto-wounds
          if (ctx && hasAbility(ctx, 'LETHAL HITS')) {
            autoWounds++;
            hits--; // Remove from normal hits — goes straight to wounds
            if (triggered.indexOf('Lethal Hits') === -1) triggered.push('Lethal Hits');
          }

          // Sustained Hits X: critical hit scores X extra hits
          if (ctx) {
            const sustainedVal = getAbilityValue(ctx, 'SUSTAINED HITS');
            if (sustainedVal !== undefined) {
              extraHits += sustainedVal;
              hits += sustainedVal;
              if (triggered.indexOf(`Sustained Hits ${sustainedVal}`) === -1) triggered.push(`Sustained Hits ${sustainedVal}`);
            }
          }
        }
      }
    }

    // Re-roll hit rolls of 1 (e.g., faction/detachment rules)
    if (ctx?.rerollHitRollsOf1) {
      const effectiveSkill = Math.max(2, effectiveBaseSkill - hitModifier);
      const ones = hitRoll.dice.filter(d => d === 1);
      if (ones.length > 0) {
        const reRoll = rollDice(ones.length, 6, 'To Hit (re-roll 1s)', effectiveSkill);
        for (const d of reRoll.dice) {
          if (d === 1) continue;
          const critThreshold = ctx.criticalHitThreshold ?? 6;
          const isCrit = d >= critThreshold;
          if (isCrit || d + hitModifier >= effectiveSkill) {
            hits++;
            if (isCrit) {
              criticalHits++;
              if (hasAbility(ctx, 'LETHAL HITS')) {
                autoWounds++;
                hits--;
              }
              const sustainedVal = getAbilityValue(ctx, 'SUSTAINED HITS');
              if (sustainedVal !== undefined) {
                extraHits += sustainedVal;
                hits += sustainedVal;
              }
            }
          }
        }
        hitRoll = { ...hitRoll, dice: [...hitRoll.dice, ...reRoll.dice] };
        if (triggered.indexOf('Re-roll hit 1s') === -1) triggered.push('Re-roll hit 1s');
      }
    }
  }

  // --- Bonus AP (e.g., FRFSRF order) ---
  if (ctx?.bonusAP) {
    // bonusAP is negative (e.g., -1 means improve AP by 1)
    // We modify the weapon AP for wound/save calculations later
    ctx = { ...ctx, weapon: { ...ctx.weapon, ap: ctx.weapon.ap + ctx.bonusAP } };
    if (triggered.indexOf('AP improved') === -1) triggered.push('AP improved');
  }

  // --- Wound Modifier ---
  let woundModifier = 0;
  if (ctx) {
    // Lance: +1 to Wound if unit charged
    if (hasAbility(ctx, 'LANCE') && ctx.attackerCharged) {
      woundModifier += 1;
      triggered.push('Lance (+1 to Wound)');
    }
    // External wound roll modifier (e.g., detachment rules)
    if (ctx.woundRollModifier) {
      woundModifier += ctx.woundRollModifier;
    }
  }
  woundModifier = Math.max(-1, Math.min(1, woundModifier));

  // --- Wound Roll ---
  const woundThreshold = getWoundThreshold(strength, toughness);
  const effectiveWoundThreshold = Math.max(2, woundThreshold - woundModifier);
  const woundsToRoll = hits; // Lethal Hits already removed from this count

  let woundRoll: DiceRoll;
  let wounds = autoWounds; // Start with auto-wounds from Lethal Hits
  let mortalWounds = 0;

  if (woundsToRoll > 0) {
    woundRoll = rollDice(woundsToRoll, 6, 'To Wound', effectiveWoundThreshold);

    for (const d of woundRoll.dice) {
      if (d === 1) continue; // Unmodified 1 always fails
      const isCritWound = d === 6;

      // Anti-KEYWORD X+: critical wound on X+ vs matching keyword
      let antiCrit = false;
      if (ctx) {
        const antiAbility = ctx.abilities.find(a => a.name === 'ANTI');
        if (antiAbility && antiAbility.keyword && antiAbility.value !== undefined) {
          if (ctx.targetKeywords.some(k => k.toUpperCase() === antiAbility.keyword)) {
            if (d >= antiAbility.value) {
              antiCrit = true;
              if (triggered.indexOf(`Anti-${antiAbility.keyword}`) === -1) triggered.push(`Anti-${antiAbility.keyword}`);
            }
          }
        }
      }

      if (isCritWound || antiCrit || d + woundModifier >= effectiveWoundThreshold) {
        // Devastating Wounds: critical wound → mortal wounds
        if ((isCritWound || antiCrit) && ctx && hasAbility(ctx, 'DEVASTATING WOUNDS')) {
          const dmg = parseDiceExpression(ctx.weapon.damage);
          mortalWounds += dmg;
          if (triggered.indexOf('Devastating Wounds') === -1) triggered.push('Devastating Wounds');
        } else {
          wounds++;
        }
      }
    }

    // Twin-linked: re-roll failed wound rolls
    if (ctx && hasAbility(ctx, 'TWIN-LINKED')) {
      const failed = woundRoll.dice.filter(d => {
        if (d === 1) return true;
        return d + woundModifier < effectiveWoundThreshold && d !== 6;
      });
      if (failed.length > 0) {
        const reRoll = rollDice(failed.length, 6, 'To Wound (re-roll)', effectiveWoundThreshold);
        for (const d of reRoll.dice) {
          if (d === 1) continue;
          if (d === 6 || d + woundModifier >= effectiveWoundThreshold) {
            wounds++;
          }
        }
        // Merge re-roll dice into wound roll for display
        woundRoll = { ...woundRoll, dice: [...woundRoll.dice, ...reRoll.dice] };
        if (triggered.indexOf('Twin-linked (re-roll)') === -1) triggered.push('Twin-linked (re-roll)');
      }
    }

    // Re-roll wound rolls of 1 (e.g., Fortification Network detachment rule)
    if (ctx?.rerollWoundRollsOf1 && !hasAbility(ctx, 'TWIN-LINKED')) {
      const ones = woundRoll.dice.filter(d => d === 1);
      if (ones.length > 0) {
        const reRoll = rollDice(ones.length, 6, 'To Wound (re-roll 1s)', effectiveWoundThreshold);
        for (const d of reRoll.dice) {
          if (d === 1) continue;
          if (d === 6 || d + woundModifier >= effectiveWoundThreshold) {
            wounds++;
          }
        }
        woundRoll = { ...woundRoll, dice: [...woundRoll.dice, ...reRoll.dice] };
        if (triggered.indexOf('Re-roll wound 1s') === -1) triggered.push('Re-roll wound 1s');
      }
    }
  } else {
    woundRoll = { id: generateUUID(), dice: [], sides: 6, threshold: effectiveWoundThreshold, purpose: 'To Wound', timestamp: Date.now() };
  }

  // --- Damage calculation ---
  let effectiveDamage = parseDiceExpression(ctx?.weapon.damage ?? 1);

  // Melta X: +X damage within half range
  if (ctx) {
    const meltaVal = getAbilityValue(ctx, 'MELTA');
    if (meltaVal !== undefined && ctx.weapon.range) {
      if (ctx.distanceToTarget <= ctx.weapon.range / 2) {
        effectiveDamage += meltaVal;
        triggered.push(`Melta ${meltaVal} (+${meltaVal} damage)`);
      }
    }
  }

  return {
    numAttacks,
    hitRoll,
    hits: hits + autoWounds,
    criticalHits,
    autoWounds,
    extraHits,
    woundRoll,
    wounds: wounds + mortalWounds,
    mortalWounds,
    effectiveDamage,
    triggeredAbilities: triggered,
  };
}
