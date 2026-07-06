import type { EditionDef } from '../types/content.js';
import type { GameState, LogEntry, PlayerIndex, UnitState } from '../types/state.js';
import { sweepExpiredEffects, sweepUsageCounters } from '../effects/engine.js';
import type { ActionResult, GameAction } from './actions.js';
import type { ReducerEnv } from './env.js';
import { reduceSetup } from './setupReducer.js';
import { reduceMovement } from './movementReducer.js';
import { reduceShooting } from './shootingReducer.js';
import { reduceCharge } from './chargeReducer.js';
import { reduceFight, computeSelector } from './fightReducer.js';
import { reduceWindow, getResolvers } from './windowReducer.js';
import { clearOwnBattleShock, runOneBattleShockTest, unitsToTest } from './battleShock.js';
import { enqueueWindows, processWindowQueue } from './windows.js';
import { phaseStepKind } from './kinds.js';

/**
 * The pure, server-authoritative reducer. Phase order comes from the
 * edition pack — the reducer never names a phase beyond the generic
 * 'setup' / 'ended' sentinels.
 */

export const SETUP_PHASE = 'setup';
export const ENDED_PHASE = 'ended';

export function reduce(state: GameState, action: GameAction, env: ReducerEnv): ActionResult {
  if (state.result !== null && action.type !== 'concede') {
    return { ok: false, error: 'The battle has ended.', code: 'GAME_ENDED' };
  }

  if (action.type === 'concede') {
    const winner: PlayerIndex = action.player === 0 ? 1 : 0;
    return {
      ok: true,
      state: appendLog(
        { ...state, result: { winner, concededBy: action.player }, phase: ENDED_PHASE },
        { kind: 'concede', player: action.player, message: `Player ${action.player + 1} concedes.` },
      ),
    };
  }

  // While a reactive decision is open, only the actions resolving it pass.
  const decisionResolvers: GameAction['type'][] = ['resolveSaves', 'useStratagem', 'passWindow'];
  if (state.pendingDecision !== null && !decisionResolvers.includes(action.type)) {
    return {
      ok: false,
      error: `Waiting on ${state.players[state.pendingDecision.player].name} (${state.pendingDecision.kind}).`,
      code: 'PENDING_DECISION',
    };
  }

  // Any accepted action may leave queued windows behind (e.g. saves
  // resolved mid-overwatch with a Tank Shock window still queued) — drain
  // them before handing the state back.
  const drain = (result: ActionResult): ActionResult => {
    if (!result.ok) return result;
    let s = result.state;
    if (s.pendingDecision === null && (s.windowQueue ?? []).length > 0) {
      s = processWindowQueue(s, env, getResolvers());
    }
    return { ok: true, state: s };
  };

  const subReducers = [
    reduceWindow,
    reduceSetup,
    reduceMovement,
    reduceShooting,
    reduceCharge,
    reduceFight,
  ] as const;
  for (const sub of subReducers) {
    const result = sub(state, action, env);
    if (result) return drain(result);
  }

  switch (action.type) {
    case 'advanceStep':
      if (action.player !== state.activePlayer) {
        return {
          ok: false,
          error: `Player ${action.player + 1} cannot advance the phase on Player ${state.activePlayer + 1}'s turn.`,
          code: 'OUT_OF_TURN',
        };
      }
      if (state.phase === SETUP_PHASE && !state.setup?.readyToStart) {
        return {
          ok: false,
          error: 'Setup is not complete (rosters, roll-off, deployment, first-turn roll).',
          code: 'ILLEGAL',
        };
      }
      if (state.pendingMove !== null) {
        return { ok: false, error: 'Finish or cancel the move in progress first.', code: 'ILLEGAL' };
      }
      if (state.shooting !== null) {
        return { ok: false, error: 'Finish resolving the current shooting first.', code: 'ILLEGAL' };
      }
      if (state.charge !== null) {
        return { ok: false, error: 'Finish resolving the charge in progress first.', code: 'ILLEGAL' };
      }
      if ((state.windowQueue ?? []).length > 0) {
        return { ok: false, error: 'Reactive windows are still resolving.', code: 'ILLEGAL' };
      }
      if (state.fight && state.fight.stage !== 'select') {
        return { ok: false, error: 'Finish the current fight activation first.', code: 'ILLEGAL' };
      }
      if (state.fight && state.fight.selector !== null) {
        return {
          ok: false,
          error: `${state.players[state.fight.selector].name} must select a unit to fight.`,
          code: 'ILLEGAL',
        };
      }
      return { ok: true, state: advanceStep(state, env) };

    default:
      return { ok: false, error: 'Unknown action.', code: 'UNKNOWN_ACTION' };
  }
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

interface Position {
  phaseIndex: number;
  stepIndex: number;
}

function findPosition(state: GameState, edition: EditionDef): Position | null {
  const phaseIndex = edition.phases.findIndex((p) => p.id === state.phase);
  if (phaseIndex < 0) return null;
  const phase = edition.phases[phaseIndex]!;
  const stepIndex = state.step === null ? 0 : phase.steps.findIndex((s) => s.id === state.step);
  return { phaseIndex, stepIndex: Math.max(0, stepIndex) };
}

/**
 * Advance one step; rolling over steps -> next phase -> next turn ->
 * next round -> end of battle, firing expiry sweeps at each boundary,
 * then running the entered step's protocol (battle-shock tests, fight
 * sequencing) per the edition-declared step kind.
 */
export function advanceStep(state: GameState, env: ReducerEnv): GameState {
  return onEnterStep(advanceStepCore(state, env), env);
}

function onEnterStep(state: GameState, env: ReducerEnv): GameState {
  if (state.phase === ENDED_PHASE || state.phase === SETUP_PHASE) return state;
  const { phase, step } = phaseStepKind(env, state);
  let next = state;

  // Leaving the fight phase clears its sequence.
  if (phase !== 'fight' && next.fight !== null) {
    next = { ...next, fight: null };
  }

  if (phase === 'command' && step === 'command') {
    // "Until the start of your next Command phase" — shocks clear now.
    next = clearOwnBattleShock(next);
  }

  if (step === 'battleShock') {
    const toTest = unitsToTest(next, env);
    const failureWindows = [];
    for (const unitId of toTest) {
      const result = runOneBattleShockTest(next, env, unitId);
      next = result.state;
      if (result.failedWindow) failureWindows.push(result.failedWindow);
    }
    if (toTest.length === 0) {
      next = appendLog(next, {
        kind: 'battleShock',
        player: next.activePlayer,
        message: 'No units are Below Half-strength — no Battle-shock tests needed.',
      });
    }
    next = enqueueWindows(next, failureWindows);
    next = processWindowQueue(next, env, getResolvers());
  }

  if (phase === 'fight' && (step === 'fightsFirst' || step === 'remainingCombats')) {
    const fought = step === 'fightsFirst' ? [] : (next.fight?.fought ?? []);
    next = {
      ...next,
      fight: { selector: null, activeUnitId: null, stage: 'select', fought },
    };
    const selector = computeSelector(next, env, null);
    next = { ...next, fight: { ...next.fight!, selector } };
    if (selector !== null) {
      next = appendLog(next, {
        kind: 'fight',
        player: selector,
        message: `${next.players[selector].name} selects the first unit to fight this step.`,
      });
    }
  }

  return next;
}

function advanceStepCore(state: GameState, env: ReducerEnv): GameState {
  const edition = env.content.edition;

  // Leaving setup: enter the first phase of round 1 for the first player.
  if (state.phase === SETUP_PHASE) {
    const next = { ...state, round: 1, activePlayer: state.firstPlayer };
    return enterPhase(next, edition, 0);
  }

  const pos = findPosition(state, edition);
  if (!pos) return state;
  const phase = edition.phases[pos.phaseIndex]!;

  // Next step within the same phase?
  if (pos.stepIndex + 1 < phase.steps.length) {
    const step = phase.steps[pos.stepIndex + 1]!;
    return appendLog({ ...state, step: step.id }, {
      kind: 'step',
      player: state.activePlayer,
      message: `${phase.name} — ${step.name}.`,
    });
  }

  // Phase boundary.
  let next = endPhase(state);
  if (pos.phaseIndex + 1 < edition.phases.length) {
    return enterPhase(next, edition, pos.phaseIndex + 1);
  }

  // Turn boundary.
  next = endTurn(next);
  const otherPlayer: PlayerIndex = state.activePlayer === 0 ? 1 : 0;
  const bothPlayersDone = otherPlayer === state.firstPlayer;
  if (!bothPlayersDone) {
    return enterPhase({ ...next, activePlayer: otherPlayer }, edition, 0);
  }

  // Round boundary.
  next = endRound(next);
  if (state.round >= edition.battleRounds) {
    return endBattle(next);
  }
  return enterPhase(
    { ...next, round: state.round + 1, activePlayer: state.firstPlayer },
    edition,
    0,
  );
}

function enterPhase(state: GameState, edition: EditionDef, phaseIndex: number): GameState {
  const phase = edition.phases[phaseIndex]!;
  const step = phase.steps[0] ?? null;
  let next: GameState = {
    ...state,
    phase: phase.id,
    step: step ? step.id : null,
    players: [
      { ...state.players[0], stratagemsUsedThisPhase: [] },
      { ...state.players[1], stratagemsUsedThisPhase: [] },
    ],
  };

  // Core CP accrual: entering the first phase of a turn grants both
  // players CP per the edition parameters.
  if (phaseIndex === 0) {
    const cp = edition.parameters.cpPerCommandPhase;
    next = {
      ...next,
      players: [
        { ...next.players[0], cp: next.players[0].cp + cp },
        { ...next.players[1], cp: next.players[1].cp + cp },
      ],
    };
    next = appendLog(next, {
      kind: 'cp',
      player: null,
      message: `Both players gain ${cp} CP.`,
    });
  }

  return appendLog(next, {
    kind: 'phase',
    player: next.activePlayer,
    message: `Round ${next.round} — Player ${next.activePlayer + 1} ${phase.name}${step ? ` (${step.name})` : ''}.`,
  });
}

function endPhase(state: GameState): GameState {
  let next = sweepUsageCounters(state, 'phase');
  next = {
    ...next,
    activeEffects: sweepExpiredEffects(next.activeEffects, 'phase'),
    players: [
      { ...next.players[0], autoPassThisPhase: [] },
      { ...next.players[1], autoPassThisPhase: [] },
    ],
    units: mapUnits(next.units, (u) => ({
      ...u,
      models: u.models.map((m) =>
        m.hasTakenWoundsThisPhase ? { ...m, hasTakenWoundsThisPhase: false } : m,
      ),
    })),
  };
  return next;
}

function endTurn(state: GameState): GameState {
  let next = sweepUsageCounters(state, 'turn');
  next = {
    ...next,
    activeEffects: sweepExpiredEffects(next.activeEffects, 'turn'),
    units: mapUnits(next.units, (u) => ({
      ...u,
      turnFlags: {
        moveKind: null,
        advanceRoll: null,
        chargeRoll: null,
        chargeTargets: [],
        chargeDeclared: false,
        hasShot: false,
        hasFought: false,
        fightsFirst: false,
        arrivedFromReserves: false,
      },
    })),
  };
  return appendLog(next, {
    kind: 'turnEnd',
    player: state.activePlayer,
    message: `Player ${state.activePlayer + 1}'s turn ends.`,
  });
}

function endRound(state: GameState): GameState {
  let next = sweepUsageCounters(state, 'round');
  next = {
    ...next,
    activeEffects: sweepExpiredEffects(next.activeEffects, 'round'),
    players: [
      { ...next.players[0], extraCpThisRound: 0 },
      { ...next.players[1], extraCpThisRound: 0 },
    ],
  };
  return appendLog(next, {
    kind: 'roundEnd',
    player: null,
    message: `Battle round ${state.round} ends.`,
  });
}

function endBattle(state: GameState): GameState {
  // Reserves that never arrived count as destroyed.
  let swept = state;
  for (const unit of Object.values(state.units)) {
    if (unit.reserves !== 'none' && unit.models.every((m) => m.position === null)) {
      swept = {
        ...swept,
        units: {
          ...swept.units,
          [unit.id]: {
            ...unit,
            models: unit.models.map((m) => ({ ...m, destroyed: true, woundsRemaining: 0 })),
          },
        },
      };
      swept = appendLog(swept, {
        kind: 'destroyed',
        player: unit.owner,
        message: `${unit.name} never arrived from Reserves and counts as destroyed.`,
      });
    }
  }
  state = swept;
  const [p0, p1] = state.players;
  const winner: PlayerIndex | 'draw' = p0.vp > p1.vp ? 0 : p1.vp > p0.vp ? 1 : 'draw';
  const next: GameState = {
    ...state,
    phase: ENDED_PHASE,
    step: null,
    activeEffects: [],
    result: { winner },
  };
  return appendLog(next, {
    kind: 'battleEnd',
    player: null,
    message:
      winner === 'draw'
        ? `The battle ends in a draw, ${p0.vp} VP each.`
        : `Player ${winner + 1} wins ${[p0.vp, p1.vp][winner]} VP to ${[p0.vp, p1.vp][winner === 0 ? 1 : 0]}.`,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapUnits(
  units: Record<string, UnitState>,
  fn: (u: UnitState) => UnitState,
): Record<string, UnitState> {
  const out: Record<string, UnitState> = {};
  for (const [id, unit] of Object.entries(units)) out[id] = fn(unit);
  return out;
}

export function appendLog(
  state: GameState,
  entry: Omit<LogEntry, 'seq' | 'round' | 'phase'> & Partial<Pick<LogEntry, 'round' | 'phase'>>,
): GameState {
  const log: LogEntry = {
    seq: state.log.length,
    round: entry.round ?? state.round,
    phase: entry.phase ?? state.phase,
    player: entry.player,
    kind: entry.kind,
    message: entry.message,
    ...(entry.data ? { data: entry.data } : {}),
  };
  return { ...state, log: [...state.log, log] };
}
