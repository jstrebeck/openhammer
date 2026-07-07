import type { StratagemDef } from '../types/content.js';
import type {
  GameState,
  PlayerIndex,
  QueuedWindow,
  UnitId,
  WindowFollowUp,
} from '../types/state.js';
import type { HookContext } from '../effects/context.js';
import { evalCondition } from '../effects/conditions.js';
import { canUse } from '../effects/engine.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';

/**
 * Reactive decision windows — a defined protocol, not an afterthought.
 * Hooks enqueue windows; the queue is processed one window at a time.
 * A window where the prompted player has zero eligible options is skipped
 * silently (never shown). Each prompt offers the eligible stratagems plus
 * "pass"; standing preferences auto-pass matching windows.
 */

export interface StratagemOption {
  stratagemId: string;
  name: string;
  cost: number;
  /** Unit choices for the stratagem's target, when it takes one. */
  targets: UnitId[];
  requiresTarget: boolean;
}

/** Injected continuations so this module stays cycle-free. */
export interface FollowUpResolvers {
  resolveShooting(state: GameState, env: ReducerEnv): GameState;
  applyBattleShock(state: GameState, env: ReducerEnv, unitId: UnitId, roll: number): GameState;
  rollCharge(state: GameState, env: ReducerEnv): GameState;
}

export function enqueueWindows(state: GameState, windows: QueuedWindow[]): GameState {
  if (windows.length === 0) return state;
  return { ...state, windowQueue: [...(state.windowQueue ?? []), ...windows] };
}

/**
 * Advance the queue: apply follow-ups for empty windows, stop at the first
 * window with at least one eligible option and open its pendingDecision.
 */
export function processWindowQueue(
  state: GameState,
  env: ReducerEnv,
  resolvers: FollowUpResolvers,
): GameState {
  let cur = state;
  while ((cur.windowQueue ?? []).length > 0 && cur.pendingDecision === null) {
    const [window, ...rest] = cur.windowQueue!;
    cur = { ...cur, windowQueue: rest };
    const options = eligibleStratagems(cur, env, window!);
    if (options.length === 0) {
      cur = applyFollowUp(cur, env, window!.followUp, resolvers);
      continue;
    }
    cur = {
      ...cur,
      pendingDecision: {
        id: `window-${cur.actionSeq}-${window!.hook}`,
        player: window!.player,
        kind: 'stratagemWindow',
        window: window!.hook as never,
        options,
        context: { ...window!.context, hook: window!.hook, followUp: window!.followUp },
        canPass: true,
      },
    };
  }
  return cur;
}

export function applyFollowUp(
  state: GameState,
  env: ReducerEnv,
  followUp: WindowFollowUp,
  resolvers: FollowUpResolvers,
): GameState {
  switch (followUp.type) {
    case 'none':
      return state;
    case 'battleShockFailed':
      return resolvers.applyBattleShock(state, env, followUp.unitId, followUp.roll);
    case 'resolveShooting':
      return resolvers.resolveShooting(state, env);
    case 'rollCharge':
      return resolvers.rollCharge(state, env);
  }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function windowsOf(def: StratagemDef): string[] {
  return Array.isArray(def.window) ? def.window : [def.window];
}

export function eligibleStratagems(
  state: GameState,
  env: ReducerEnv,
  window: QueuedWindow,
): StratagemOption[] {
  const player = state.players[window.player];
  const out: StratagemOption[] = [];
  const stratagems =
    env.content.getStratagemsFor?.(state, window.player) ??
    env.content.getStratagems?.() ??
    [];

  for (const def of stratagems) {
    if (!windowsOf(def).includes(window.hook)) continue;
    // Player side relative to whose turn it is.
    const isActive = window.player === state.activePlayer;
    if (def.player === 'active' && !isActive) continue;
    if (def.player === 'reactive' && isActive) continue;
    // Phase gate (ids from the edition pack; empty = any phase).
    if (def.phase.length > 0 && !def.phase.includes(state.phase)) continue;
    if (player.cp < def.cost) continue;
    if (player.stratagemsUsedThisPhase.includes(def.id)) continue;
    const prefs = player.autoPassThisPhase ?? [];
    if (prefs.includes(def.id) || prefs.includes(`hook:${window.hook}`)) continue;
    // Once-per-X limits declared on the stratagem's effects.
    if (def.effects.some((e) => e.limit && !canUse(state, e.id, e.limit))) continue;
    // Stratagem-level condition.
    const ctx: HookContext = {
      state,
      content: env.content,
      activePlayer: state.activePlayer,
      phase: state.phase,
    };
    if (def.condition && !evalCondition(def.condition, ctx)) continue;
    // Scripts must exist to be offered.
    const scriptIds = def.effects.flatMap((e) =>
      e.effects.filter((p) => p.type === 'script').map((p) => (p as { scriptId: string }).scriptId),
    );
    if (scriptIds.some((id) => !env.content.getScript?.(id))) continue;

    // Target candidates. Only stratagems that opt in draw from the
    // window's contextual list; the rest consider the whole board.
    let targets: UnitId[] = [];
    const requiresTarget = def.target !== undefined;
    if (def.target) {
      const preset = def.target.fromWindowContext
        ? (window.context.candidateUnitIds as UnitId[] | undefined)
        : undefined;
      if (def.target.fromWindowContext && (preset?.length ?? 0) === 0) continue;
      targets = candidateTargets(state, env, window.player, def, preset);
      if (targets.length === 0) continue;
    }
    out.push({
      stratagemId: def.id,
      name: def.name,
      cost: def.cost,
      targets,
      requiresTarget,
    });
  }
  return out;
}

function candidateTargets(
  state: GameState,
  env: ReducerEnv,
  player: PlayerIndex,
  def: StratagemDef,
  preset: UnitId[] | undefined,
): UnitId[] {
  const target = def.target!;
  const pool = preset ?? Object.keys(state.units);
  return pool.filter((unitId) => {
    const unit = state.units[unitId];
    if (!unit) return false;
    if (unit.models.every((m) => m.destroyed)) return false;
    if (target.who === 'friendly' && unit.owner !== player) return false;
    if (target.who === 'enemy' && unit.owner === player) return false;
    // Battle-shocked units cannot be affected by stratagems (data opts out
    // for Insane Bravery via allowBattleShocked).
    if (unit.battleShocked && !target.allowBattleShocked) return false;
    if (target.keyword) {
      const keywords = env.content.getUnitKeywords(state, unitId);
      if (!keywords.some((k) => k.toLowerCase() === target.keyword!.toLowerCase())) return false;
    }
    if (target.condition) {
      const ctx: HookContext = {
        state,
        content: env.content,
        activePlayer: state.activePlayer,
        phase: state.phase,
        bearerUnitId: unitId,
      };
      if (!evalCondition(target.condition, ctx)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Small logging helper shared by window resolution
// ---------------------------------------------------------------------------

export function logWindow(state: GameState, player: PlayerIndex, message: string): GameState {
  return appendLog(state, { kind: 'stratagem', player, message });
}
