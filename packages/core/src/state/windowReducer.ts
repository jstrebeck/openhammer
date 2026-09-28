import type { ActiveEffect, GameState, WindowFollowUp } from '../types/state.js';
import type { ActionResult, GameAction } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { canUse, recordUse } from '../effects/engine.js';
import {
  applyFollowUp,
  processWindowQueue,
  type FollowUpResolvers,
  type StratagemOption,
} from './windows.js';
import { applyBattleShock, runOneBattleShockTest } from './battleShock.js';
import { continueShooting } from './shootingReducer.js';
import { rollChargeNow } from './chargeReducer.js';

/**
 * Resolution of open stratagem windows: use a stratagem or pass. Pass can
 * carry a standing preference ("don't ask again this phase").
 */

export function getResolvers(): FollowUpResolvers {
  return {
    resolveShooting: (state, env) => continueShooting(state, env),
    applyBattleShock: (state, env, unitId, roll) => applyBattleShock(state, env, unitId, roll),
    rollCharge: (state, env) => rollChargeNow(state, env),
  };
}

export function reduceWindow(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  if (action.type !== 'useStratagem' && action.type !== 'passWindow') return null;

  const decision = state.pendingDecision;
  if (!decision || decision.kind !== 'stratagemWindow') {
    // No window open: own-turn "proactive" stratagems can still be used
    // directly (e.g. "Your Shooting phase" buffs).
    if (action.type === 'useStratagem') {
      return useProactiveStratagem(state, action, env);
    }
    return reject('There is no stratagem window open.');
  }
  if (action.player !== decision.player) {
    return reject('This window belongs to your opponent.', 'OUT_OF_TURN');
  }
  const followUp = (decision.context.followUp ?? { type: 'none' }) as WindowFollowUp;
  const resolvers = getResolvers();

  if (action.type === 'passWindow') {
    let next: GameState = { ...state, pendingDecision: null };
    if (action.dontAskAgainThisPhase) {
      const player = next.players[action.player];
      const key = `hook:${String(decision.context.hook ?? decision.window ?? '')}`;
      next = {
        ...next,
        players: withPlayer(next, action.player, {
          autoPassThisPhase: [...(player.autoPassThisPhase ?? []), key],
        }),
      };
    }
    next = applyFollowUp(next, env, followUp, resolvers);
    next = processWindowQueue(next, env, resolvers);
    return { ok: true, state: next };
  }

  // --- useStratagem ---
  const option = (decision.options as StratagemOption[]).find(
    (o) => o.stratagemId === action.stratagemId,
  );
  if (!option) {
    return reject(`${action.stratagemId} is not available in this window.`);
  }
  if (option.requiresTarget) {
    if (!action.targetUnitId || !option.targets.includes(action.targetUnitId)) {
      return reject('Choose a legal target for the stratagem.');
    }
  }
  const available =
    env.content.getStratagemsFor?.(state, action.player) ??
    env.content.getStratagems?.() ??
    [];
  const def = available.find((s) => s.id === action.stratagemId);
  if (!def) return reject(`Unknown stratagem: ${action.stratagemId}`);
  const player = state.players[action.player];
  if (player.cp < def.cost) return reject('Not enough CP.');

  let next: GameState = {
    ...state,
    pendingDecision: null,
    players: withPlayer(state, action.player, {
      cp: player.cp - def.cost,
      stratagemsUsedThisPhase: [...player.stratagemsUsedThisPhase, def.id],
    }),
  };
  next = appendLog(next, {
    kind: 'stratagem',
    player: action.player,
    message: `${player.name} uses ${def.name} (${def.cost} CP)${
      action.targetUnitId ? ` on ${state.units[action.targetUnitId]?.name ?? action.targetUnitId}` : ''
    }.`,
    data: { stratagemId: def.id, targetUnitId: action.targetUnitId ?? null },
  });

  let treatShockAsPassed = false;
  for (const effect of def.effects) {
    if (effect.limit) {
      next = recordUse(next, effect.id, effect.limit);
    }
    const scriptPrims = effect.effects.filter((p) => p.type === 'script');
    const hasAutoPass = effect.effects.some((p) => p.type === 'autoPassBattleShock');
    if (hasAutoPass) treatShockAsPassed = true;

    if (effect.effects.some((p) => p.type === 'forceBattleShockTest')) {
      // The test hits the acting enemy unit from the window context
      // (Photon Grenades shocks the charger, not the stratagem's target).
      const subject = (decision.context.chargingUnitId ??
        decision.context.movedUnitId ??
        action.targetUnitId) as string | undefined;
      if (subject) {
        const r = runOneBattleShockTest(next, env, subject);
        next = r.state;
        if (r.failedWindow) next = applyBattleShock(next, env, subject, 0);
      }
    }
    if (scriptPrims.length > 0) {
      for (const prim of scriptPrims) {
        const script = env.content.getScript?.((prim as { scriptId: string }).scriptId);
        if (!script) continue; // excluded at eligibility; belt and braces
        next = script(next, env, {
          player: action.player,
          targetUnitId: action.targetUnitId,
          context: decision.context,
        });
      }
    } else if (effect.duration && effect.duration !== 'instant') {
      const active: ActiveEffect = {
        instanceId: `${def.id}:${effect.id}:${next.actionSeq}`,
        def: effect,
        source: { kind: 'stratagem', id: def.id, player: action.player },
        boundUnits: action.targetUnitId ? [action.targetUnitId] : [],
        duration: effect.duration,
        activatedAt: { round: next.round, turn: next.activePlayer, phase: next.phase },
      };
      next = { ...next, activeEffects: [...next.activeEffects, active] };
    }
    // Instant non-script primitives beyond autoPassBattleShock (CP mods
    // etc.) are not needed by the core-stratagem set yet.
  }

  if (followUp.type === 'battleShockFailed' && treatShockAsPassed) {
    next = appendLog(next, {
      kind: 'battleShock',
      player: action.player,
      message: `${state.units[followUp.unitId]?.name ?? 'The unit'} holds firm — the test counts as passed.`,
    });
  } else {
    next = applyFollowUp(next, env, followUp, resolvers);
  }
  next = processWindowQueue(next, env, resolvers);
  return { ok: true, state: next };
}

function useProactiveStratagem(
  state: GameState,
  action: Extract<GameAction, { type: 'useStratagem' }>,
  env: ReducerEnv,
): ActionResult {
  const available =
    env.content.getStratagemsFor?.(state, action.player) ??
    env.content.getStratagems?.() ??
    [];
  const def = available.find((s) => s.id === action.stratagemId);
  if (!def) return reject(`Unknown stratagem: ${action.stratagemId}`);
  if (def.activation !== 'proactive') {
    return reject(`${def.name} is used in its reactive window, not directly.`);
  }
  if (def.player === 'active' && action.player !== state.activePlayer) {
    return reject(`${def.name} is used on your own turn.`, 'OUT_OF_TURN');
  }
  if (def.player === 'reactive' && action.player === state.activePlayer) {
    return reject(`${def.name} is used on your opponent's turn.`, 'OUT_OF_TURN');
  }
  if (def.phase.length > 0 && !def.phase.includes(state.phase)) {
    return reject(`${def.name} cannot be used in this phase.`);
  }
  const player = state.players[action.player];
  if (player.cp < def.cost) return reject('Not enough CP.');
  if (player.stratagemsUsedThisPhase.includes(def.id)) {
    return reject(`${def.name} was already used this phase.`);
  }
  if (def.effects.some((e) => e.limit && !canUse(state, e.id, e.limit))) {
    return reject(`${def.name} has hit its usage limit.`);
  }
  // Target validation against the full board (no window context).
  if (def.target) {
    if (!action.targetUnitId) return reject('Choose a target for the stratagem.');
    const unit = state.units[action.targetUnitId];
    if (!unit || unit.models.every((m) => m.destroyed)) return reject('Invalid target.');
    if (def.target.who === 'friendly' && unit.owner !== action.player) {
      return reject('The target must be friendly.');
    }
    if (def.target.who === 'enemy' && unit.owner === action.player) {
      return reject('The target must be an enemy unit.');
    }
    if (unit.battleShocked && !def.target.allowBattleShocked) {
      return reject(`${unit.name} is Battle-shocked and cannot be targeted by stratagems.`);
    }
    if (def.target.keyword) {
      const keywords = env.content.getUnitKeywords(state, unit.id);
      if (!keywords.some((k) => k.toLowerCase() === def.target!.keyword!.toLowerCase())) {
        return reject(`The target must be ${def.target.keyword}.`);
      }
    }
  }
  // Scripts must be available.
  const scriptIds = def.effects.flatMap((e) =>
    e.effects.filter((p) => p.type === 'script').map((p) => (p as { scriptId: string }).scriptId),
  );
  if (scriptIds.some((id) => !env.content.getScript?.(id))) {
    return reject(`${def.name} is not implemented yet.`);
  }

  let next: GameState = {
    ...state,
    players: withPlayer(state, action.player, {
      cp: player.cp - def.cost,
      stratagemsUsedThisPhase: [...player.stratagemsUsedThisPhase, def.id],
    }),
  };
  next = appendLog(next, {
    kind: 'stratagem',
    player: action.player,
    message: `${player.name} uses ${def.name} (${def.cost} CP)${
      action.targetUnitId ? ` on ${state.units[action.targetUnitId]?.name}` : ''
    }.`,
    data: { stratagemId: def.id, targetUnitId: action.targetUnitId ?? null },
  });
  for (const effect of def.effects) {
    if (effect.limit) next = recordUse(next, effect.id, effect.limit);
    const scriptPrims = effect.effects.filter((p) => p.type === 'script');
    if (scriptPrims.length > 0) {
      for (const prim of scriptPrims) {
        const script = env.content.getScript?.((prim as { scriptId: string }).scriptId);
        if (script) {
          next = script(next, env, {
            player: action.player,
            targetUnitId: action.targetUnitId,
            context: {},
          });
        }
      }
    } else if (effect.duration && effect.duration !== 'instant') {
      next = {
        ...next,
        activeEffects: [
          ...next.activeEffects,
          {
            instanceId: `${def.id}:${effect.id}:${next.actionSeq}`,
            def: effect,
            source: { kind: 'stratagem', id: def.id, player: action.player },
            boundUnits: action.targetUnitId ? [action.targetUnitId] : [],
            duration: effect.duration,
            activatedAt: { round: next.round, turn: next.activePlayer, phase: next.phase },
          },
        ],
      };
    }
  }
  return { ok: true, state: next };
}

function withPlayer(
  state: GameState,
  index: 0 | 1,
  patch: Partial<GameState['players'][0]>,
): [GameState['players'][0], GameState['players'][1]] {
  const players: [GameState['players'][0], GameState['players'][1]] = [
    state.players[0],
    state.players[1],
  ];
  players[index] = { ...players[index], ...patch };
  return players;
}
