import type { GameState, PlayerIndex, UnitId } from '../types/state.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { baseToPointDistance } from '../measurement/index.js';
import { aliveModels, boundCharacteristicBonus, modelBase } from './validation.js';

/**
 * Automatic mission scoring — the game knows who is winning without any
 * bookkeeping. Control math and VP cadence all come from mission data.
 */

export interface ObjectiveControlEntry {
  controller: PlayerIndex | null;
  oc: [number, number];
}

/**
 * Level of Control per objective: sum the OC of each player's models
 * within control range. Battle-shocked models count 0. OC bonuses from
 * effects (Duty and Honour!, banners) ride the scoring hook.
 */
export function computeObjectiveControl(
  state: GameState,
  env: ReducerEnv,
): Record<string, ObjectiveControlEntry> {
  const range = env.content.edition.parameters.objectiveControlRangeHorizontal;
  const out: Record<string, ObjectiveControlEntry> = {};
  for (const objective of state.board.objectives) {
    const oc: [number, number] = [0, 0];
    for (const unit of Object.values(state.units)) {
      if (unit.battleShocked) continue;
      const alive = aliveModels(unit).filter((m) => m.position !== null);
      if (alive.length === 0) continue;
      const ds = env.content.getDatasheet(unit.datasheetId);
      const bonus = boundCharacteristicBonus(state, unit.id, 'OC', 'scoring.objectiveControl');
      for (const model of alive) {
        const base = modelBase(env.content, unit, model);
        if (!base) continue;
        if (baseToPointDistance(base, objective.position) > range) continue;
        const profile = ds?.models.find((p) => p.id === model.profileId) ?? ds?.models[0];
        oc[unit.owner] += Math.max(0, (profile?.objectiveControl ?? 0) + bonus);
      }
    }
    out[objective.id] = {
      controller: oc[0] > oc[1] ? 0 : oc[1] > oc[0] ? 1 : null,
      oc,
    };
  }
  return out;
}

/** Refresh the live control map on the state (board markers, scoreboard). */
export function refreshObjectiveControl(state: GameState, env: ReducerEnv): GameState {
  return { ...state, objectiveControl: computeObjectiveControl(state, env) };
}

function primaryScoredSoFar(state: GameState, player: PlayerIndex): number {
  return state.players[player].vpLog
    .filter((e) => e.source === 'primary')
    .reduce((a, e) => a + e.amount, 0);
}

/**
 * Score the mission's primary for `player` per one scoring rule: called
 * from the cadence points (command-phase start, battle end).
 */
export function scorePrimary(
  state: GameState,
  env: ReducerEnv,
  player: PlayerIndex,
  cadenceHook: string,
): GameState {
  const mission = env.content.getMission?.(state.missionId);
  if (!mission) return state;
  let next = refreshObjectiveControl(state, env);
  for (const rule of mission.primaryScoring) {
    if (rule.cadence.hook !== cadenceHook) continue;
    if (rule.cadence.fromRound !== undefined && next.round < rule.cadence.fromRound) continue;
    if (rule.cadence.untilRound !== undefined && next.round > rule.cadence.untilRound) continue;

    const held = Object.entries(next.objectiveControl ?? {})
      .filter(([, entry]) => entry.controller === player)
      .map(([id]) => id);
    const raw = held.length * rule.scoring.perObjectiveHeld;
    const capped = Math.min(rule.scoring.maxPerScore, raw);
    const totalCap = rule.maxTotal ?? Infinity;
    const already = primaryScoredSoFar(next, player);
    const awarded = Math.max(0, Math.min(capped, totalCap - already));
    if (awarded === 0 && held.length === 0) {
      next = appendLog(next, {
        kind: 'scoring',
        player,
        message: `${next.players[player].name} holds no objectives — no primary VP.`,
      });
      continue;
    }
    const players: GameState['players'] = [next.players[0], next.players[1]];
    players[player] = {
      ...players[player],
      vp: players[player].vp + awarded,
      vpLog: [
        ...players[player].vpLog,
        {
          round: next.round,
          source: 'primary',
          amount: awarded,
          detail: `${rule.name}: holds ${held.length} objective(s) [${held.join(', ')}]`,
        },
      ],
    };
    next = { ...next, players };
    next = appendLog(next, {
      kind: 'scoring',
      player,
      message: `${next.players[player].name} holds ${held.length} objective(s) [${held.join(', ')}] → ${awarded} VP (${rule.name}).`,
      data: { held, awarded, rule: rule.id },
    });
  }
  return next;
}

/** Battle-end bonuses declared by mission data (e.g. painted army). */
export function scoreEndOfBattle(state: GameState, env: ReducerEnv): GameState {
  const mission = env.content.getMission?.(state.missionId);
  if (!mission) return state;
  // The player who took the second turn scores the final hold.
  const second: PlayerIndex = state.firstPlayer === 0 ? 1 : 0;
  let next = scorePrimary(state, env, second, 'lifecycle.battleEnd');

  for (const bonus of mission.bonusVP ?? []) {
    for (const player of [0, 1] as const) {
      const eligible = bonus.auto || next.players[player].paintedArmy;
      if (!eligible) continue;
      const players: GameState['players'] = [next.players[0], next.players[1]];
      players[player] = {
        ...players[player],
        vp: players[player].vp + bonus.value,
        vpLog: [
          ...players[player].vpLog,
          { round: next.round, source: bonus.id, amount: bonus.value, detail: bonus.name },
        ],
      };
      next = { ...next, players };
      next = appendLog(next, {
        kind: 'scoring',
        player,
        message: `${next.players[player].name} gains ${bonus.value} VP (${bonus.name}).`,
      });
    }
  }
  return next;
}
