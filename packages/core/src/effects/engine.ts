import type {
  CoreParameters,
  EffectDuration,
  EffectPrimitive,
  HookName,
  UsageLimit,
} from '../types/content.js';
import type { GameState, ActiveEffect, PlayerIndex } from '../types/state.js';
import { evalCondition } from './conditions.js';
import type { EffectCandidate, HookContext } from './context.js';

// ---------------------------------------------------------------------------
// Reroll precedence
// ---------------------------------------------------------------------------

export type RerollMode = 'none' | 'ones' | 'failed' | 'any';
const REROLL_RANK: Record<RerollMode, number> = { none: 0, ones: 1, failed: 2, any: 3 };

export function mergeReroll(a: RerollMode, b: RerollMode): RerollMode {
  return REROLL_RANK[a] >= REROLL_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// The attack computation — the mutable payload attack.* hooks operate on.
// The pipeline builds one per (weapon, target) batch, fires hooks, then
// resolves dice against the final values.
// ---------------------------------------------------------------------------

export interface AttackComputation {
  attacksExpr: string;
  attacksFlatBonus: number;
  /** Blast-style scaling: +value per `per` models in the target unit. */
  attacksPerTargetModels: { per: number; value: number }[];

  hitSkill: number | null; // null => no hit roll possible
  autoHit: boolean;
  hitModifiers: number[];
  critHitOn: number;
  rerollHit: RerollMode;
  lethalHits: boolean;
  sustainedHits: number;

  strength: number;
  toughness: number;
  woundModifiers: number[];
  critWoundOn: number;
  rerollWound: RerollMode;
  devastatingWounds: boolean;

  ap: number;
  saveModifiers: number[];
  invulnerableSave: number | null;
  cover: boolean;
  ignoresCover: boolean;

  damageExpr: string;
  damageBonus: number;
  minimumDamage: number;
  rerollDamage: RerollMode;

  feelNoPain: number | null;
  precision: boolean;
  ignoreModifiers: Set<string>;

  /** Script ids that fired and need bespoke handling by the pipeline. */
  scripts: string[];
}

export function newAttackComputation(init: {
  attacksExpr: string;
  hitSkill: number | null;
  strength: number;
  toughness: number;
  ap: number;
  damageExpr: string;
  params: CoreParameters;
}): AttackComputation {
  return {
    attacksExpr: init.attacksExpr,
    attacksFlatBonus: 0,
    attacksPerTargetModels: [],
    hitSkill: init.hitSkill,
    autoHit: init.hitSkill === null,
    hitModifiers: [],
    critHitOn: init.params.defaultCriticalHitOn,
    rerollHit: 'none',
    lethalHits: false,
    sustainedHits: 0,
    strength: init.strength,
    toughness: init.toughness,
    woundModifiers: [],
    critWoundOn: init.params.defaultCriticalWoundOn,
    rerollWound: 'none',
    devastatingWounds: false,
    ap: init.ap,
    saveModifiers: [],
    invulnerableSave: null,
    cover: false,
    ignoresCover: false,
    damageExpr: init.damageExpr,
    damageBonus: 0,
    minimumDamage: 0,
    rerollDamage: 'none',
    feelNoPain: null,
    precision: false,
    ignoreModifiers: new Set(),
    scripts: [],
  };
}

/** Net modifier after the edition's ±cap, e.g. hit/wound caps of 1. */
export function cappedModifier(modifiers: number[], cap: number): number {
  const sum = modifiers.reduce((a, b) => a + b, 0);
  return Math.max(-cap, Math.min(cap, sum));
}

// ---------------------------------------------------------------------------
// Deterministic candidate ordering
// ---------------------------------------------------------------------------

const SET_VALUE_TYPES = new Set<EffectPrimitive['type']>([
  'setCriticalHitOn',
  'setCriticalWoundOn',
  'setInvulnerableSave',
  'setCharacteristic',
  'autoHit',
]);

function effectClass(c: EffectCandidate): 0 | 1 {
  return c.def.effects.every((e) => SET_VALUE_TYPES.has(e.type)) ? 0 : 1;
}

/**
 * Resolution order: set-value effects first, then everything else;
 * ties broken by active player first, then loader declaration order.
 * Same state in => same order out, always.
 */
export function orderCandidates(
  candidates: EffectCandidate[],
  activePlayer: PlayerIndex,
): EffectCandidate[] {
  return [...candidates].sort((a, b) => {
    const cls = effectClass(a) - effectClass(b);
    if (cls !== 0) return cls;
    const ap = (a.player === activePlayer ? 0 : 1) - (b.player === activePlayer ? 0 : 1);
    if (ap !== 0) return ap;
    return a.declOrder - b.declOrder;
  });
}

// ---------------------------------------------------------------------------
// Firing a hook against an AttackComputation
// ---------------------------------------------------------------------------

export interface FiredEffect {
  sourceId: string;
  effectId: string;
  name?: string;
}

/**
 * Evaluate candidates for `hook` and apply their primitives to the attack
 * computation. Returns which effects fired (for the game log/UI).
 */
export function fireAttackHook(
  hook: HookName,
  candidates: EffectCandidate[],
  ctx: HookContext,
  comp: AttackComputation,
): FiredEffect[] {
  const fired: FiredEffect[] = [];
  const relevant = candidates.filter((c) => c.def.trigger === hook);
  for (const cand of orderCandidates(relevant, ctx.activePlayer)) {
    const candCtx: HookContext = { ...ctx, bearerUnitId: cand.bearerUnitId };
    if (!evalCondition(cand.def.condition, candCtx)) continue;
    for (const prim of cand.def.effects) {
      applyAttackPrimitive(prim, comp);
    }
    fired.push({ sourceId: cand.sourceId, effectId: cand.def.id, name: cand.def.name });
  }
  return fired;
}

function applyAttackPrimitive(prim: EffectPrimitive, comp: AttackComputation): void {
  switch (prim.type) {
    case 'modifyRoll':
      switch (prim.roll) {
        case 'hit':
          comp.hitModifiers.push(prim.value);
          break;
        case 'wound':
          comp.woundModifiers.push(prim.value);
          break;
        case 'save':
          comp.saveModifiers.push(prim.value);
          break;
        case 'damage':
          comp.damageBonus += prim.value;
          break;
        default:
          break; // non-attack rolls handled by their own pipelines
      }
      break;
    case 'setCriticalHitOn':
      comp.critHitOn = prim.value;
      break;
    case 'setCriticalWoundOn':
      comp.critWoundOn = prim.value;
      break;
    case 'setInvulnerableSave':
      comp.invulnerableSave =
        comp.invulnerableSave === null ? prim.value : Math.min(comp.invulnerableSave, prim.value);
      break;
    case 'reroll':
      if (prim.roll === 'hit') comp.rerollHit = mergeReroll(comp.rerollHit, prim.dice as RerollMode);
      if (prim.roll === 'wound') comp.rerollWound = mergeReroll(comp.rerollWound, prim.dice as RerollMode);
      if (prim.roll === 'damage') comp.rerollDamage = mergeReroll(comp.rerollDamage, prim.dice as RerollMode);
      break;
    case 'addAttacks':
      comp.attacksFlatBonus += prim.value;
      break;
    case 'addAttacksPerTargetModels':
      comp.attacksPerTargetModels.push({ per: prim.per, value: prim.value });
      break;
    case 'autoHit':
      comp.autoHit = true;
      break;
    case 'criticalHitsAutoWound':
      comp.lethalHits = true;
      break;
    case 'extraHitsOnCritical':
      comp.sustainedHits += prim.value;
      break;
    case 'criticalWoundsBecomeMortal':
      comp.devastatingWounds = true;
      break;
    case 'addDamage':
      comp.damageBonus += prim.value;
      break;
    case 'minimumDamage':
      comp.minimumDamage = Math.max(comp.minimumDamage, prim.value);
      break;
    case 'ignoreCover':
      comp.ignoresCover = true;
      break;
    case 'grantCover':
      comp.cover = true;
      break;
    case 'allocatePrecision':
      comp.precision = true;
      break;
    case 'ignoreModifiers':
      for (const r of prim.rolls) comp.ignoreModifiers.add(r);
      break;
    case 'feelNoPain':
      comp.feelNoPain =
        comp.feelNoPain === null ? prim.value : Math.min(comp.feelNoPain, prim.value);
      break;
    case 'script':
      comp.scripts.push(prim.scriptId);
      break;
    case 'modifyCharacteristic':
      if (prim.stat === 'S') comp.strength += prim.value;
      if (prim.stat === 'T') comp.toughness += prim.value;
      if (prim.stat === 'AP') comp.ap += prim.value;
      break;
    case 'setCharacteristic':
      if (prim.stat === 'S') comp.strength = prim.value;
      if (prim.stat === 'T') comp.toughness = prim.value;
      if (prim.stat === 'AP') comp.ap = prim.value;
      break;
    default:
      // Non-attack primitives (CP, tokens, mortal wounds, permissions...)
      // are applied by the reducer, not the per-attack computation.
      break;
  }
}

// ---------------------------------------------------------------------------
// Wound threshold (core math, parameter-free in 10e)
// ---------------------------------------------------------------------------

export function woundThreshold(strength: number, toughness: number): number {
  if (strength >= 2 * toughness) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

// ---------------------------------------------------------------------------
// Active effect lifecycle — durations & sweeps
// ---------------------------------------------------------------------------

const DURATION_RANK: Record<EffectDuration, number> = {
  instant: 0,
  phase: 1,
  turn: 2,
  round: 3,
  battle: 4,
};

export type ExpiryBoundary = 'phase' | 'turn' | 'round' | 'battle';

/**
 * Remove effects whose duration expires at this boundary (and anything
 * shorter — nothing may linger because nothing swept it).
 */
export function sweepExpiredEffects(effects: ActiveEffect[], boundary: ExpiryBoundary): ActiveEffect[] {
  const rank = DURATION_RANK[boundary];
  return effects.filter((e) => DURATION_RANK[e.duration] > rank);
}

// ---------------------------------------------------------------------------
// Usage limits — tracked centrally, never by each effect privately
// ---------------------------------------------------------------------------

function usageKey(limiterId: string, scopeKey: string, per: UsageLimit['per']): string {
  return `${limiterId}|${scopeKey}|${per}`;
}

export function canUse(
  state: GameState,
  limiterId: string,
  limit: UsageLimit | undefined,
  scopeKey = 'army',
): boolean {
  if (!limit) return true;
  const used = state.usage.counts[usageKey(limiterId, scopeKey, limit.per)] ?? 0;
  return used < limit.count;
}

export function recordUse(
  state: GameState,
  limiterId: string,
  limit: UsageLimit | undefined,
  scopeKey = 'army',
): GameState {
  if (!limit) return state;
  const key = usageKey(limiterId, scopeKey, limit.per);
  return {
    ...state,
    usage: { counts: { ...state.usage.counts, [key]: (state.usage.counts[key] ?? 0) + 1 } },
  };
}

/** Reset counters whose window closed (called from lifecycle sweeps). */
export function sweepUsageCounters(state: GameState, boundary: ExpiryBoundary): GameState {
  const windows: UsageLimit['per'][] =
    boundary === 'phase'
      ? ['phase']
      : boundary === 'turn'
        ? ['phase', 'turn']
        : boundary === 'round'
          ? ['phase', 'turn', 'round']
          : ['phase', 'turn', 'round', 'battle'];
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.usage.counts)) {
    const per = key.split('|')[2] as UsageLimit['per'];
    if (!windows.includes(per)) counts[key] = value;
  }
  return { ...state, usage: { counts } };
}
