import { roll2D6 } from '../dice/index.js';
import type { GameState, QueuedWindow, UnitId } from '../types/state.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { isBelowHalfStrength } from '../effects/conditions.js';
import { aliveModels, unitIsOnBattlefield } from './validation.js';

/**
 * Battle-shock step automation. On entering the step, every active-player
 * unit Below Half-strength tests 2D6 vs its best Leadership. Failures open
 * an Insane Bravery window before the shock is applied.
 */

/** Units the active player must test this step. */
export function unitsToTest(state: GameState, env: ReducerEnv): UnitId[] {
  const ctxBase = {
    state,
    content: env.content,
    activePlayer: state.activePlayer,
    phase: state.phase,
  };
  return Object.values(state.units)
    .filter(
      (u) =>
        u.owner === state.activePlayer &&
        unitIsOnBattlefield(u) &&
        aliveModels(u).length > 0 &&
        isBelowHalfStrength({ ...ctxBase, bearerUnitId: u.id }, u.id),
    )
    .map((u) => u.id);
}

/** Best (lowest-threshold) leadership among a unit's alive models. */
function bestLeadership(state: GameState, env: ReducerEnv, unitId: UnitId): number {
  const unit = state.units[unitId]!;
  const ds = env.content.getDatasheet(unit.datasheetId);
  const values = aliveModels(unit).map((m) => {
    const profile = ds?.models.find((p) => p.id === m.profileId) ?? ds?.models[0];
    return profile?.leadership ?? 7;
  });
  return values.length > 0 ? Math.min(...values) : 7;
}

/**
 * Run one unit's test: on failure, returns a window (Insane Bravery) whose
 * follow-up applies the shock if the player passes.
 */
export function runOneBattleShockTest(
  state: GameState,
  env: ReducerEnv,
  unitId: UnitId,
): { state: GameState; failedWindow: QueuedWindow | null } {
  const unit = state.units[unitId];
  if (!unit) return { state, failedWindow: null };
  const { total, rolls, rng } = roll2D6(state.rng);
  const ld = bestLeadership(state, env, unitId);
  const passed = total >= ld;
  let next: GameState = { ...state, rng };
  next = appendLog(next, {
    kind: 'battleShock',
    player: unit.owner,
    message: `${unit.name} Battle-shock test: ${rolls[0]}+${rolls[1]}=${total} vs Ld ${ld}+ — ${passed ? 'passed' : 'FAILED'}.`,
    data: { unitId, rolls, total, ld, passed },
  });
  if (passed) return { state: next, failedWindow: null };
  return {
    state: next,
    failedWindow: {
      hook: 'command.battleShockFailed',
      player: unit.owner,
      followUp: { type: 'battleShockFailed', unitId, roll: total },
      context: { unitId, candidateUnitIds: [unitId] },
    },
  };
}

/** The follow-up when no Insane Bravery is played: the unit is shocked. */
export function applyBattleShock(
  state: GameState,
  _env: ReducerEnv,
  unitId: UnitId,
  _roll: number,
): GameState {
  const unit = state.units[unitId];
  if (!unit) return state;
  let next: GameState = {
    ...state,
    units: { ...state.units, [unitId]: { ...unit, battleShocked: true } },
  };
  next = appendLog(next, {
    kind: 'battleShock',
    player: unit.owner,
    message: `${unit.name} is Battle-shocked (OC 0, no stratagems) until the start of their next Command phase.`,
  });
  return next;
}

/** Clear the active player's shocks at the start of their command phase. */
export function clearOwnBattleShock(state: GameState): GameState {
  const units = { ...state.units };
  let changed = false;
  for (const [id, unit] of Object.entries(units)) {
    if (unit.owner === state.activePlayer && unit.battleShocked) {
      units[id] = { ...unit, battleShocked: false };
      changed = true;
    }
  }
  return changed ? { ...state, units } : state;
}
