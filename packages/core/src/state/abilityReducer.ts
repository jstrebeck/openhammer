import type { MechanicDef } from '../types/content.js';
import type { ActiveEffect, GameState, UnitId } from '../types/state.js';
import type { ActionResult, GameAction } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { canUse, recordUse } from '../effects/engine.js';
import { evalCondition } from '../effects/conditions.js';
import type { HookContext } from '../effects/context.js';
import { aliveModels, unitDistance, unitIsOnBattlefield } from './validation.js';

/**
 * Activated faction mechanics — anything a content pack declares as a
 * MechanicDef (order-style buffs, spotter pairings...). The engine
 * validates timing, the user unit, targets, ranges and shared usage
 * limits, then plants tokens and duration effects. No faction is named
 * anywhere here.
 */
export function reduceAbility(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  if (action.type !== 'useAbility') return null;

  const player = state.players[action.player];
  const mechanics = env.content.getFactionMechanics?.(player.factionId) ?? [];
  const mechanic = mechanics.find((m) => m.id === action.abilityId);
  if (!mechanic) return reject(`Unknown ability: ${action.abilityId}`);

  // Timing.
  if (mechanic.timing.player === 'active' && action.player !== state.activePlayer) {
    return reject(`${mechanic.name} can only be used on your own turn.`, 'OUT_OF_TURN');
  }
  if (mechanic.timing.phase.length > 0 && !mechanic.timing.phase.includes(state.phase)) {
    return reject(`${mechanic.name} cannot be used in this phase.`);
  }

  // The user unit.
  const user = state.units[action.unitId];
  if (!user || user.owner !== action.player) return reject('Not your unit.');
  if (!unitIsOnBattlefield(user) || aliveModels(user).length === 0) {
    return reject(`${user.name} is not on the battlefield.`);
  }
  if (user.battleShocked) {
    return reject(`${user.name} is Battle-shocked and cannot use abilities.`);
  }
  if (mechanic.user.keyword && !hasKeyword(state, env, user.id, mechanic.user.keyword)) {
    return reject(`${user.name} cannot use ${mechanic.name} (needs ${mechanic.user.keyword}).`);
  }
  if (mechanic.user.condition && !condition(state, env, user.id, mechanic.user.condition)) {
    return reject(`${user.name} does not meet the conditions for ${mechanic.name}.`);
  }

  // Usage limits, shared across the mechanic's group, scoped per user unit.
  const limiterId = mechanic.groupId ?? mechanic.id;
  const scopeKey = mechanic.limit?.scope === 'unit' ? `unit:${user.id}` : 'army';
  if (mechanic.limit && !canUse(state, limiterId, mechanic.limit, scopeKey)) {
    return reject(`${user.name} has already used ${mechanic.groupId ?? mechanic.name} this ${mechanic.limit.per}.`);
  }

  // Targets.
  const target = action.targetUnitId ? state.units[action.targetUnitId] : undefined;
  if (mechanic.target) {
    const err = validateTarget(state, env, mechanic, 'target', user.id, target?.id, action.player);
    if (err) return reject(err);
  } else if (action.targetUnitId) {
    return reject(`${mechanic.name} does not take a target.`);
  }
  const second = action.secondTargetUnitId ? state.units[action.secondTargetUnitId] : undefined;
  if (mechanic.secondTarget) {
    const err = validateTarget(
      state,
      env,
      mechanic,
      'secondTarget',
      user.id,
      second?.id,
      action.player,
    );
    if (err) return reject(err);
  }

  // Apply: tokens + duration effects, all riding one ActiveEffect per def
  // (plus a carrier when only tokens are planted) so expiry is unified.
  let next: GameState = state;
  if (mechanic.limit) next = recordUse(next, limiterId, mechanic.limit, scopeKey);

  // Exclusive groups: a new Order replaces any existing one on the target.
  if (mechanic.exclusiveGroup && target) {
    const group = mechanic.exclusiveGroup;
    const sameGroupIds = new Set(
      mechanics.filter((m) => m.exclusiveGroup === group).map((m) => m.id),
    );
    const stale = next.activeEffects.filter(
      (e) =>
        e.source.kind === 'mechanic' &&
        sameGroupIds.has(e.source.id) &&
        e.boundUnits.includes(target.id),
    );
    if (stale.length > 0) {
      const staleIds = new Set(stale.map((e) => e.instanceId));
      const units2 = { ...next.units };
      for (const e of stale) {
        for (const t of e.tokens ?? []) {
          const u = units2[t.unitId];
          if (u) units2[t.unitId] = { ...u, tokens: u.tokens.filter((x) => x !== t.token) };
        }
      }
      next = {
        ...next,
        units: units2,
        activeEffects: next.activeEffects.filter((e) => !staleIds.has(e.instanceId)),
      };
    }
  }

  const tokenTargets: { unitId: UnitId; token: string }[] = [];
  for (const t of mechanic.applyTokens ?? []) {
    const unitId =
      t.to === 'user' ? user.id : t.to === 'target' ? target?.id : second?.id;
    if (unitId) tokenTargets.push({ unitId, token: t.token });
  }
  const units = { ...next.units };
  for (const t of tokenTargets) {
    const u = units[t.unitId]!;
    if (!u.tokens.includes(t.token)) units[t.unitId] = { ...u, tokens: [...u.tokens, t.token] };
  }
  next = { ...next, units };

  const boundUnits = [target?.id ?? user.id];
  const activeEffects: ActiveEffect[] = mechanic.effects.map((def, i) => ({
    instanceId: `${mechanic.id}:${def.id}:${next.actionSeq}:${i}`,
    def,
    source: { kind: 'mechanic', id: mechanic.id, player: action.player },
    boundUnits,
    duration: def.duration ?? mechanic.duration,
    activatedAt: { round: next.round, turn: next.activePlayer, phase: next.phase },
    ...(i === 0 && tokenTargets.length > 0 ? { tokens: tokenTargets } : {}),
  }));
  if (activeEffects.length === 0 && tokenTargets.length > 0) {
    // Token-only mechanic: a carrier effect owns the tokens' lifetime.
    activeEffects.push({
      instanceId: `${mechanic.id}:tokens:${next.actionSeq}`,
      def: { id: `${mechanic.id}.tokens`, trigger: 'lifecycle.phaseEnd', effects: [] },
      source: { kind: 'mechanic', id: mechanic.id, player: action.player },
      boundUnits,
      duration: mechanic.duration,
      activatedAt: { round: next.round, turn: next.activePlayer, phase: next.phase },
      tokens: tokenTargets,
    });
  }
  next = { ...next, activeEffects: [...next.activeEffects, ...activeEffects] };

  next = appendLog(next, {
    kind: 'ability',
    player: action.player,
    message:
      `${user.name} uses ${mechanic.name}` +
      (target ? ` on ${target.name}` : '') +
      (second ? ` (spotting ${second.name})` : '') +
      '.',
    data: {
      abilityId: mechanic.id,
      unitId: user.id,
      targetUnitId: target?.id ?? null,
      secondTargetUnitId: second?.id ?? null,
    },
  });
  return { ok: true, state: next };
}

function validateTarget(
  state: GameState,
  env: ReducerEnv,
  mechanic: MechanicDef,
  which: 'target' | 'secondTarget',
  userUnitId: UnitId,
  targetUnitId: UnitId | undefined,
  player: number,
): string | null {
  const spec = which === 'target' ? mechanic.target! : mechanic.secondTarget!;
  if (!targetUnitId) return `${mechanic.name} needs a ${which === 'target' ? 'target' : 'second target'}.`;
  const unit = state.units[targetUnitId];
  if (!unit || aliveModels(unit).length === 0 || !unitIsOnBattlefield(unit)) {
    return 'Invalid target.';
  }
  if (spec.who === 'friendly' && unit.owner !== player) return 'The target must be friendly.';
  if (spec.who === 'enemy' && unit.owner === player) return 'The target must be an enemy unit.';
  if (spec.who === 'friendly' && unit.battleShocked) {
    return `${unit.name} is Battle-shocked and cannot receive abilities.`;
  }
  if (spec.keyword && !hasKeyword(state, env, unit.id, spec.keyword)) {
    return `The target must be ${spec.keyword}.`;
  }
  if (spec.within !== undefined) {
    const d = unitDistance(env.content, state.units[userUnitId]!, unit);
    if (d === null || d > spec.within) {
      return `${unit.name} is more than ${spec.within}" away.`;
    }
  }
  if (which === 'target' && mechanic.target?.condition) {
    if (!condition(state, env, unit.id, mechanic.target.condition)) {
      return `${unit.name} does not meet the conditions.`;
    }
  }
  return null;
}

function hasKeyword(state: GameState, env: ReducerEnv, unitId: UnitId, keyword: string): boolean {
  return env.content
    .getUnitKeywords(state, unitId)
    .some((k) => k.toLowerCase() === keyword.toLowerCase());
}

function condition(
  state: GameState,
  env: ReducerEnv,
  bearerUnitId: UnitId,
  cond: NonNullable<MechanicDef['user']['condition']>,
): boolean {
  const ctx: HookContext = {
    state,
    content: env.content,
    activePlayer: state.activePlayer,
    phase: state.phase,
    bearerUnitId,
  };
  return evalCondition(cond, ctx);
}
