import type { Condition } from '../types/content.js';
import type { HookContext } from './context.js';

/**
 * Declarative condition evaluator. Unknown conditions evaluate to false —
 * a malformed pack must never silently grant an effect.
 */
export function evalCondition(cond: Condition | undefined, ctx: HookContext): boolean {
  if (!cond) return true;

  if ('all' in cond) return cond.all.every((c) => evalCondition(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, ctx));
  if ('not' in cond) return !evalCondition(cond.not, ctx);

  if ('bearerIs' in cond) {
    if (ctx.bearerUnitId === undefined) return false;
    switch (cond.bearerIs) {
      case 'attacker':
        return ctx.bearerUnitId === ctx.attackerUnitId;
      case 'defender':
        return ctx.bearerUnitId === ctx.targetUnitId;
      case 'activeUnit':
        return ctx.bearerUnitId === (ctx.attackerUnitId ?? ctx.moveUnitId);
    }
  }

  if ('attackerHasKeyword' in cond) {
    return hasKeyword(ctx, ctx.attackerUnitId, cond.attackerHasKeyword);
  }
  if ('targetHasKeyword' in cond) {
    return hasKeyword(ctx, ctx.targetUnitId, cond.targetHasKeyword);
  }
  if ('bearerHasKeyword' in cond) {
    return hasKeyword(ctx, ctx.bearerUnitId, cond.bearerHasKeyword);
  }

  if ('weaponType' in cond) return ctx.weapon?.kind === cond.weaponType;
  if ('weaponHasAbility' in cond) {
    return ctx.weapon?.abilities.some((a) => a.id === cond.weaponHasAbility) ?? false;
  }

  if ('targetWithinHalfRange' in cond) {
    if (ctx.distance === undefined || !ctx.weapon?.range) return false;
    return ctx.distance <= ctx.weapon.range / 2;
  }
  if ('targetFurtherThan' in cond) {
    return ctx.distance !== undefined && ctx.distance > cond.targetFurtherThan;
  }
  if ('targetWithin' in cond) {
    return ctx.distance !== undefined && ctx.distance <= cond.targetWithin;
  }

  if ('phaseIs' in cond) return ctx.phase === cond.phaseIs;
  if ('turnIs' in cond) {
    const bearerOwner = unitOwner(ctx, ctx.bearerUnitId);
    if (bearerOwner === undefined) return false;
    const isOwn = bearerOwner === ctx.activePlayer;
    return cond.turnIs === 'own' ? isOwn : !isOwn;
  }
  if ('battleRoundAtLeast' in cond) return ctx.state.round >= cond.battleRoundAtLeast;

  if ('bearerRemainedStationary' in cond) return flag(ctx, 'stationary');
  if ('bearerAdvanced' in cond) return flag(ctx, 'advance');
  if ('bearerFellBack' in cond) return flag(ctx, 'fallBack');
  if ('bearerCharged' in cond) return flag(ctx, 'charge');

  if ('bearerBelowHalfStrength' in cond) {
    const unit = ctx.bearerUnitId ? ctx.state.units[ctx.bearerUnitId] : undefined;
    if (!unit) return false;
    return isBelowHalfStrength(ctx, unit.id);
  }
  if ('bearerIsBattleShocked' in cond) {
    const unit = ctx.bearerUnitId ? ctx.state.units[ctx.bearerUnitId] : undefined;
    return unit?.battleShocked ?? false;
  }

  if ('bearerHasToken' in cond) return hasToken(ctx, ctx.bearerUnitId, cond.bearerHasToken);
  if ('attackerHasToken' in cond) return hasToken(ctx, ctx.attackerUnitId, cond.attackerHasToken);
  if ('targetHasToken' in cond) return hasToken(ctx, ctx.targetUnitId, cond.targetHasToken);

  if ('targetIsAttachedUnit' in cond) {
    const unit = ctx.targetUnitId ? ctx.state.units[ctx.targetUnitId] : undefined;
    if (!unit) return false;
    return unit.leaderOf !== null || Object.values(ctx.state.units).some(
      (u) => u.attachedTo === unit.id && !u.models.every((m) => m.destroyed),
    );
  }

  if ('targetNotVisible' in cond) return ctx.targetVisible === false;

  if ('script' in cond) return false; // resolved by the script registry layer

  return false;
}

function hasKeyword(ctx: HookContext, unitId: string | undefined, keyword: string): boolean {
  if (!unitId) return false;
  const keywords = ctx.content.getUnitKeywords(ctx.state, unitId);
  return keywords.some((k) => k.toLowerCase() === keyword.toLowerCase());
}

function hasToken(ctx: HookContext, unitId: string | undefined, token: string): boolean {
  if (!unitId) return false;
  return ctx.state.units[unitId]?.tokens.includes(token) ?? false;
}

function unitOwner(ctx: HookContext, unitId: string | undefined) {
  return unitId ? ctx.state.units[unitId]?.owner : undefined;
}

function flag(
  ctx: HookContext,
  kind: 'stationary' | 'advance' | 'fallBack' | 'charge',
): boolean {
  const unit = ctx.bearerUnitId ? ctx.state.units[ctx.bearerUnitId] : undefined;
  if (!unit) return false;
  if (kind === 'charge') return unit.turnFlags.moveKind === 'charge' || unit.turnFlags.chargeRoll !== null;
  return unit.turnFlags.moveKind === kind;
}

export function isBelowHalfStrength(ctx: HookContext, unitId: string): boolean {
  const unit = ctx.state.units[unitId];
  if (!unit) return false;
  const alive = unit.models.filter((m) => !m.destroyed);
  if (unit.startingStrength > 1) {
    return alive.length < unit.startingStrength / 2;
  }
  const model = alive[0];
  if (!model) return true;
  const ds = ctx.content.getDatasheet(unit.datasheetId);
  const profile = ds?.models.find((p) => p.id === model.profileId) ?? ds?.models[0];
  if (!profile) return false;
  return model.woundsRemaining < profile.wounds / 2;
}
