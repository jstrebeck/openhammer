import type { ActiveEffect, GameState, WindowFollowUp } from '../types/state.js';
import type { ActionResult, GameAction } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { recordUse } from '../effects/engine.js';
import {
  applyFollowUp,
  processWindowQueue,
  type FollowUpResolvers,
  type StratagemOption,
} from './windows.js';
import { applyBattleShock } from './battleShock.js';
import { continueShooting } from './shootingReducer.js';

/**
 * Resolution of open stratagem windows: use a stratagem or pass. Pass can
 * carry a standing preference ("don't ask again this phase").
 */

export function getResolvers(): FollowUpResolvers {
  return {
    resolveShooting: (state, env) => continueShooting(state, env),
    applyBattleShock: (state, env, unitId, roll) => applyBattleShock(state, env, unitId, roll),
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
  const def = (env.content.getStratagems?.() ?? []).find((s) => s.id === action.stratagemId);
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
