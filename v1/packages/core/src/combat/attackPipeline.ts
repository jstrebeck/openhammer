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
  /** If true, re-roll ALL failed hit rolls (e.g., Kauyon Round 4+, Retaliation Cadre). Supersedes rerollHitRollsOf1. */
  rerollAllFailedHits?: boolean;
  /** If true, re-roll ALL failed wound rolls (e.g., Retaliation Cadre). Supersedes rerollWoundRollsOf1. */
  rerollAllFailedWounds?: boolean;
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

  // Bonus attacks per model (e.g., FRFSRF order: +1 Attacks for Rapid Fire weapons)
  attacks += (ctx.bonusAttacks ?? 0) * ctx.attackerModelCount;

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
  // Bonus attacks (e.g., FRFSRF) are folded into the attack count by calculateAttacks()
  const totalAttacks = numAttacks;

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
    const critThreshold = ctx?.criticalHitThreshold ?? 6;
    const conversionVal = ctx ? getAbilityValue(ctx, 'CONVERSION') : undefined;

    // Scores a single hit die: unmodified 1 always fails, unmodified >= critThreshold is a crit,
    // Conversion X crits on 4+ when the target is more than X" away.
    const scoreHitDie = (d: number): { hit: boolean; crit: boolean } => {
      if (d === 1) return { hit: false, crit: false };
      const isCrit =
        d >= critThreshold ||
        (conversionVal !== undefined && ctx!.distanceToTarget > conversionVal && d >= 4);
      return { hit: isCrit || d + hitModifier >= effectiveSkill, crit: isCrit };
    };

    const applyHitDie = (d: number): boolean => {
      const { hit, crit } = scoreHitDie(d);
      if (!hit) return false;
      hits++;
      if (crit) {
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
      return true;
    };

    hits = 0;
    const failedHitDice: number[] = [];
    for (const d of hitRoll.dice) {
      if (!applyHitDie(d)) failedHitDice.push(d);
    }

    // Re-roll failed hit rolls: either all of them (Kauyon R4+, Retaliation Cadre)
    // or only unmodified 1s (Take Aim, Kauyon R3, etc.)
    const hitDiceToReroll = ctx?.rerollAllFailedHits
      ? failedHitDice
      : ctx?.rerollHitRollsOf1
        ? failedHitDice.filter(d => d === 1)
        : [];
    if (hitDiceToReroll.length > 0) {
      const label = ctx?.rerollAllFailedHits ? 'To Hit (re-roll failed)' : 'To Hit (re-roll 1s)';
      const reRoll = rollDice(hitDiceToReroll.length, 6, label, effectiveSkill);
      for (const d of reRoll.dice) {
        applyHitDie(d);
      }
      hitRoll = { ...hitRoll, dice: [...hitRoll.dice, ...reRoll.dice] };
      const trigLabel = ctx?.rerollAllFailedHits ? 'Re-roll failed hits' : 'Re-roll hit 1s';
      if (triggered.indexOf(trigLabel) === -1) triggered.push(trigLabel);
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

    // Scores a single wound die: unmodified 1 always fails, unmodified 6 is a crit,
    // Anti-KEYWORD X+ crits on X+ against matching targets.
    const scoreWoundDie = (d: number): { wound: boolean; crit: boolean } => {
      if (d === 1) return { wound: false, crit: false };
      let crit = d === 6;
      if (!crit && ctx) {
        const antiAbility = ctx.abilities.find(a => a.name === 'ANTI');
        if (
          antiAbility?.keyword &&
          antiAbility.value !== undefined &&
          ctx.targetKeywords.some(k => k.toUpperCase() === antiAbility.keyword) &&
          d >= antiAbility.value
        ) {
          crit = true;
          if (triggered.indexOf(`Anti-${antiAbility.keyword}`) === -1) triggered.push(`Anti-${antiAbility.keyword}`);
        }
      }
      return { wound: crit || d + woundModifier >= effectiveWoundThreshold, crit };
    };

    const applyWoundDie = (d: number): boolean => {
      const { wound, crit } = scoreWoundDie(d);
      if (!wound) return false;
      // Devastating Wounds: critical wound → mortal wounds
      if (crit && ctx && hasAbility(ctx, 'DEVASTATING WOUNDS')) {
        const dmg = parseDiceExpression(ctx.weapon.damage);
        mortalWounds += dmg;
        if (triggered.indexOf('Devastating Wounds') === -1) triggered.push('Devastating Wounds');
      } else {
        wounds++;
      }
      return true;
    };

    const failedWoundDice: number[] = [];
    for (const d of woundRoll.dice) {
      if (!applyWoundDie(d)) failedWoundDice.push(d);
    }

    // Re-roll failed wound rolls: all of them (Twin-linked, Retaliation Cadre)
    // or only unmodified 1s (Fortification Network, Patient Ambush, etc.)
    const rerollAllWounds = (ctx && hasAbility(ctx, 'TWIN-LINKED')) || ctx?.rerollAllFailedWounds;
    const woundDiceToReroll = rerollAllWounds
      ? failedWoundDice
      : ctx?.rerollWoundRollsOf1
        ? failedWoundDice.filter(d => d === 1)
        : [];
    if (woundDiceToReroll.length > 0) {
      const label = rerollAllWounds ? 'To Wound (re-roll failed)' : 'To Wound (re-roll 1s)';
      const reRoll = rollDice(woundDiceToReroll.length, 6, label, effectiveWoundThreshold);
      for (const d of reRoll.dice) {
        applyWoundDie(d);
      }
      // Merge re-roll dice into wound roll for display
      woundRoll = { ...woundRoll, dice: [...woundRoll.dice, ...reRoll.dice] };
      const trigLabel =
        ctx && hasAbility(ctx, 'TWIN-LINKED')
          ? 'Twin-linked (re-roll)'
          : rerollAllWounds
            ? 'Re-roll failed wounds'
            : 'Re-roll wound 1s';
      if (triggered.indexOf(trigLabel) === -1) triggered.push(trigLabel);
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
