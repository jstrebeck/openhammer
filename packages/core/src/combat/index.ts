import type { DiceRoll, Weapon, Model, Unit, GameState, MoveType } from '../types/index';
import { rollDice, countSuccesses } from '../dice/index';
import { getEdition } from '../rules/registry';
import { distanceBetweenModels } from '../measurement/index';
import { pointInPolygon } from '../los/index';

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
    hitRoll = { id: crypto.randomUUID(), dice: [], sides: 6, purpose: 'To Hit (Torrent - auto)', timestamp: Date.now() };
    hits = numAttacks;
    triggered.push('Torrent (auto-hit)');
  } else {
    hitRoll = rollDice(numAttacks, 6, 'To Hit', skill);
    const effectiveSkill = Math.max(2, skill - hitModifier); // Can't go below 2+

    hits = 0;
    for (const d of hitRoll.dice) {
      if (d === 1) continue; // Unmodified 1 always fails
      const isCrit = d === 6; // Unmodified 6 is always a critical hit

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
  }

  // --- Wound Modifier ---
  let woundModifier = 0;
  if (ctx) {
    // Lance: +1 to Wound if unit charged
    if (hasAbility(ctx, 'LANCE') && ctx.attackerCharged) {
      woundModifier += 1;
      triggered.push('Lance (+1 to Wound)');
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
  } else {
    woundRoll = { id: crypto.randomUUID(), dice: [], sides: 6, threshold: effectiveWoundThreshold, purpose: 'To Wound', timestamp: Date.now() };
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

// ===== Save Resolution =====

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

// ===== Wound Allocation =====

/**
 * Get the model that should receive wound allocation next.
 * Rules: allocate to already-wounded models first.
 */
export function getWoundAllocationTarget(unit: Unit, models: Record<string, Model>): Model | null {
  const activeModels = unit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (activeModels.length === 0) return null;

  // Already-wounded models first (wounds < maxWounds)
  const wounded = activeModels.filter(m => m.wounds < m.maxWounds);
  if (wounded.length > 0) {
    // Pick the one with fewest wounds remaining
    return wounded.sort((a, b) => a.wounds - b.wounds)[0];
  }

  // Otherwise, any active model
  return activeModels[0];
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

// ===== Phase 23: Unit Ability Validation =====

/**
 * Validate Deep Strike arrival: must be >9" from all enemy models, and round 2+.
 */
export function validateDeepStrikeArrival(
  state: GameState,
  unitId: string,
  positions: Record<string, import('../types/geometry').Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  if (state.turnState.roundNumber < 2) {
    errors.push('Deep Strike units cannot arrive before Round 2');
  }

  const DEEP_STRIKE_MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      // Use a virtual model at the position for distance checking
      const model = state.models[modelId];
      if (!model) continue;
      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= DEEP_STRIKE_MIN_DISTANCE) {
        errors.push(`${model.name} must be placed more than 9" from enemy models (${dist.toFixed(1)}" from ${otherModel.name})`);
      }
    }
  }

  return errors;
}

/**
 * Validate Infiltrators deployment: must be >9" from enemy deployment zone and enemy models.
 */
export function validateInfiltratorsDeployment(
  state: GameState,
  unitId: string,
  positions: Record<string, import('../types/geometry').Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    const model = state.models[modelId];
    if (!model) continue;

    // Check distance from enemy models
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= MIN_DISTANCE) {
        errors.push(`${model.name} must deploy more than 9" from enemy models`);
      }
    }

    // Check distance from enemy deployment zones
    for (const zone of Object.values(state.deploymentZones)) {
      if (zone.playerId === unit.playerId) continue;
      if (pointInPolygon(pos, zone.polygon)) {
        errors.push(`${model.name} cannot deploy within enemy deployment zone`);
      }
    }
  }

  return errors;
}

/**
 * Validate Scout move: max X" from starting position.
 */
export function validateScoutMove(
  unit: Unit,
  models: Record<string, Model>,
  positions: Record<string, import('../types/geometry').Point>,
  maxDistance: number,
): string[] {
  const errors: string[] = [];

  for (const modelId of unit.modelIds) {
    const model = models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = positions[modelId];
    if (!newPos) continue;

    const dist = Math.sqrt(
      (newPos.x - model.position.x) ** 2 + (newPos.y - model.position.y) ** 2,
    );
    if (dist > maxDistance + 0.01) {
      errors.push(`${model.name} Scout moved ${dist.toFixed(1)}" but max is ${maxDistance}"`);
    }
  }

  return errors;
}

/**
 * Check if all models in a unit have the Stealth ability.
 * Stealth only applies if ALL models have it.
 */
export function unitHasStealth(unit: Unit): boolean {
  return unitHasAbility(unit, 'STEALTH');
}

/**
 * Get wound allocation target in an Attached unit (Leader + Bodyguard).
 * Bodyguard models absorb wounds first; CHARACTER protected unless Precision.
 */
export function getAttachedUnitWoundTarget(
  leaderUnit: Unit,
  bodyguardUnit: Unit,
  models: Record<string, Model>,
  precision: boolean,
): Model | null {
  if (precision) {
    // Precision: target CHARACTER (leader) models
    const leaderModels = leaderUnit.modelIds
      .map(id => models[id])
      .filter((m): m is Model => m != null && m.status === 'active');
    if (leaderModels.length > 0) {
      const wounded = leaderModels.filter(m => m.wounds < m.maxWounds);
      return wounded.length > 0
        ? wounded.sort((a, b) => a.wounds - b.wounds)[0]
        : leaderModels[0];
    }
  }

  // Normal: bodyguard models absorb first
  const bodyguardModels = bodyguardUnit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (bodyguardModels.length > 0) {
    const wounded = bodyguardModels.filter(m => m.wounds < m.maxWounds);
    return wounded.length > 0
      ? wounded.sort((a, b) => a.wounds - b.wounds)[0]
      : bodyguardModels[0];
  }

  // No bodyguard left — fall through to leader
  const leaderModels = leaderUnit.modelIds
    .map(id => models[id])
    .filter((m): m is Model => m != null && m.status === 'active');
  return leaderModels.length > 0 ? leaderModels[0] : null;
}

/**
 * Validate Strategic Reserves: ≤25% army points, Round 2+ arrival, within 6" of board edge, >9" from enemies.
 */
export function validateStrategicReservesArrival(
  state: GameState,
  unitId: string,
  positions: Record<string, import('../types/geometry').Point>,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  if (state.turnState.roundNumber < 2) {
    errors.push('Strategic Reserves cannot arrive before Round 2');
  }

  const BOARD_EDGE_DISTANCE = 6;
  const ENEMY_MIN_DISTANCE = 9;

  for (const [modelId, pos] of Object.entries(positions)) {
    const model = state.models[modelId];
    if (!model) continue;

    // Must be within 6" of a board edge
    const distToEdge = Math.min(pos.x, pos.y, state.board.width - pos.x, state.board.height - pos.y);
    if (distToEdge > BOARD_EDGE_DISTANCE) {
      errors.push(`${model.name} must arrive within ${BOARD_EDGE_DISTANCE}" of a board edge`);
    }

    // Must be >9" from enemies
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId === unit.playerId) continue;

      const virtualModel = { ...model, position: pos };
      const dist = distanceBetweenModels(virtualModel, otherModel);
      if (dist <= ENEMY_MIN_DISTANCE) {
        errors.push(`${model.name} must arrive more than 9" from enemy models`);
        break;
      }
    }
  }

  return errors;
}

// ===== Stratagem Combat Integration =====

/**
 * Get hit and save modifiers for a target unit affected by Smokescreen.
 * Smokescreen grants Stealth (-1 to Hit) and Benefit of Cover (+1 save).
 */
export function getSmokescreenModifiers(state: GameState, targetUnitId: string): {
  hitModifier: number;
  coverSaveModifier: number;
} {
  if (state.smokescreenUnits.includes(targetUnitId)) {
    return { hitModifier: -1, coverSaveModifier: 1 };
  }
  return { hitModifier: 0, coverSaveModifier: 0 };
}

/**
 * Get save modifiers for a target unit affected by Go to Ground.
 * Go to Ground grants 6+ invulnerable save and Benefit of Cover (+1 save).
 */
export function getGoToGroundModifiers(state: GameState, targetUnitId: string): {
  coverSaveModifier: number;
  bonusInvulnSave: number | undefined;
} {
  if (state.goToGroundUnits.includes(targetUnitId)) {
    return { coverSaveModifier: 1, bonusInvulnSave: 6 };
  }
  return { coverSaveModifier: 0, bonusInvulnSave: undefined };
}

/**
 * Check if an attacking unit's CHARACTER model gains Precision from Epic Challenge.
 * Epic Challenge grants Precision to CHARACTER melee attacks — bypasses Bodyguard allocation.
 */
export function isEpicChallengePrecision(state: GameState, attackingUnitId: string): boolean {
  return state.epicChallengeUnits.includes(attackingUnitId);
}

/**
 * Combine all stratagem-based save modifiers for a target unit.
 * Returns the combined coverSaveModifier and best bonusInvulnSave.
 */
export function getStratagemSaveModifiers(state: GameState, targetUnitId: string): {
  coverSaveModifier: number;
  bonusInvulnSave: number | undefined;
} {
  const smoke = getSmokescreenModifiers(state, targetUnitId);
  const ground = getGoToGroundModifiers(state, targetUnitId);

  // Cover bonuses are not cumulative — take the best one (max +1 from any source)
  const coverSaveModifier = Math.max(smoke.coverSaveModifier, ground.coverSaveModifier);
  const bonusInvulnSave = ground.bonusInvulnSave;

  return { coverSaveModifier, bonusInvulnSave };
}

/**
 * Get the combined hit modifier from stratagems for a target unit.
 * Currently only Smokescreen grants Stealth (-1 to Hit).
 */
export function getStratagemHitModifier(state: GameState, targetUnitId: string): number {
  const smoke = getSmokescreenModifiers(state, targetUnitId);
  return smoke.hitModifier;
}

// ===== Sprint K: Attached Unit Rules =====

/**
 * Check if a bodyguard unit already has a leader attached.
 * Enforces max one Leader CHARACTER per Attached unit.
 */
export function canAttachLeader(
  state: GameState,
  leaderUnitId: string,
  bodyguardUnitId: string,
): { allowed: boolean; reason?: string } {
  const leaderUnit = state.units[leaderUnitId];
  if (!leaderUnit) return { allowed: false, reason: 'Leader unit not found' };

  if (!leaderUnit.keywords.includes('CHARACTER')) {
    return { allowed: false, reason: 'Only CHARACTER units can be attached as Leader' };
  }

  const bodyguardUnit = state.units[bodyguardUnitId];
  if (!bodyguardUnit) return { allowed: false, reason: 'Bodyguard unit not found' };

  if (leaderUnit.playerId !== bodyguardUnit.playerId) {
    return { allowed: false, reason: 'Leader and Bodyguard must belong to the same player' };
  }

  // Check if bodyguard already has a leader
  for (const [existingLeaderId, existingBodyguardId] of Object.entries(state.attachedUnits)) {
    if (existingBodyguardId === bodyguardUnitId) {
      return { allowed: false, reason: `${bodyguardUnit.name} already has a Leader attached (${state.units[existingLeaderId]?.name})` };
    }
  }

  // Check if this leader is already attached somewhere
  if (state.attachedUnits[leaderUnitId]) {
    return { allowed: false, reason: `${leaderUnit.name} is already attached to another unit` };
  }

  return { allowed: true };
}

/**
 * Check if destroying a unit in an attached pair (Leader or Bodyguard)
 * counts as destroying a unit for VP purposes.
 */
export function doesAttachedUnitDestructionCountAsDestroyed(
  state: GameState,
  destroyedUnitId: string,
): boolean {
  // If this unit is a leader or bodyguard in an attached pair, destruction counts
  if (state.attachedUnits[destroyedUnitId]) return true; // Was a leader
  for (const bodyguardId of Object.values(state.attachedUnits)) {
    if (bodyguardId === destroyedUnitId) return true; // Was a bodyguard
  }
  return false;
}

/**
 * When one unit in an attached pair is destroyed, the surviving unit
 * reverts to its original Starting Strength.
 */
export function getRevertedStartingStrength(unit: Unit): number {
  return unit.modelIds.length; // Original model count from the unit definition
}
