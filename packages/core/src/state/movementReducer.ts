import { rollD6 } from '../dice/index.js';
import { distance, edgeToEdgeDistance, pointToSegmentDistance } from '../measurement/index.js';
import { pointInPolygon } from '../los/index.js';
import type { GameAction, ActionResult } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import type { GameState, UnitState } from '../types/state.js';
import { appendLog } from './reducer.js';
import { phaseStepKind } from './kinds.js';
import { enqueueWindows, processWindowQueue } from './windows.js';
import { getResolvers } from './windowReducer.js';
import {
  aliveModels,
  checkCoherency,
  enemyOf,
  isInEngagementRange,
  modelBase,
  positionsInEngagementRange,
  positionsOnBoard,
  positionsOverlap,
  unitBases,
  unitDistance,
  unitIsOnBattlefield,
} from './validation.js';

/**
 * Movement phase: Remain Stationary / Normal / Advance / Fall Back with
 * straight-line distance validation, Desperate Escape tests, and
 * Reinforcements (Deep Strike / Strategic Reserves). Terrain climbing,
 * transports and FLY come later.
 */
export function reduceMovement(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'startMove': {
      const gate = movementGate(state, env, action.player);
      if (gate) return gate;
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (aliveModels(unit).length === 0 || unit.models.every((m) => m.position === null)) {
        return reject('That unit is not on the battlefield.');
      }
      if (unit.turnFlags.moveKind !== null) {
        return reject(`${unit.name} has already moved this turn.`);
      }
      if (state.pendingMove) {
        return reject(`Finish moving ${state.units[state.pendingMove.unitId]?.name} first.`);
      }
      const inER = isInEngagementRange(state, env.content, unit.id);
      if (action.kind === 'stationary') {
        let next: GameState = {
          ...state,
          units: {
            ...state.units,
            [unit.id]: { ...unit, turnFlags: { ...unit.turnFlags, moveKind: 'stationary' } },
          },
        };
        next = appendLog(next, {
          kind: 'move',
          player: action.player,
          message: `${unit.name} remains stationary.`,
        });
        return { ok: true, state: next };
      }
      if (action.kind === 'fallBack') {
        if (!inER) return reject('Only units in Engagement Range can Fall Back.');
      } else if (inER) {
        return reject('Units in Engagement Range can only Remain Stationary or Fall Back.');
      }
      const maxMove = unitMaxMove(env, unit.datasheetId);
      if (action.kind === 'advance') {
        const draw = rollD6(state.rng, 1);
        const roll = draw.rolls[0] ?? 1;
        let next: GameState = {
          ...state,
          rng: draw.rng,
          pendingMove: {
            unitId: unit.id,
            kind: 'advance',
            budget: maxMove + roll,
            advanceRoll: roll,
          },
        };
        next = appendLog(next, {
          kind: 'move',
          player: action.player,
          message: `${unit.name} advances — rolled ${roll}" (move up to M+${roll}").`,
          data: { advanceRoll: roll },
        });
        // Command Re-roll window on the advance roll.
        next = enqueueWindows(next, [
          {
            hook: 'move.advanceRoll',
            player: action.player,
            followUp: { type: 'none' },
            context: { kind: 'advance', unitId: unit.id },
          },
        ]);
        next = processWindowQueue(next, env, getResolvers());
        return { ok: true, state: next };
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingMove: { unitId: unit.id, kind: action.kind, budget: maxMove, advanceRoll: null },
        },
      };
    }

    case 'commitMove': {
      const gate = movementGate(state, env, action.player);
      if (gate) return gate;
      const pending = state.pendingMove;
      if (!pending || pending.unitId !== action.unitId) {
        return reject('No move in progress for that unit.');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      const alive = aliveModels(unit);
      const byId = new Map(action.positions.map((p) => [p.modelId, p]));
      if (alive.some((m) => !byId.has(m.id))) {
        return reject('Provide a destination for every model (unmoved models keep their spot).');
      }
      // Per-model distance budget: that model's M (+ the unit's advance roll).
      for (const model of alive) {
        const dest = byId.get(model.id)!;
        const from = model.position;
        if (!from) return reject('Model has no current position.');
        const budget = modelMove(env, unit.datasheetId, model.profileId) + (pending.advanceRoll ?? 0);
        const moved = distance(from, { x: dest.x, y: dest.y });
        if (moved > budget + 1e-6) {
          return reject(
            `${unit.name}: a model moved ${moved.toFixed(1)}" but its maximum is ${budget}".`,
          );
        }
      }
      if (!positionsOnBoard(state, action.positions)) {
        return reject('Models cannot leave the battlefield.');
      }
      if (positionsOverlap(state, env.content, unit, action.positions)) {
        return reject('Models cannot end on top of other models.');
      }
      const endsInER = positionsInEngagementRange(state, env.content, unit, action.positions);
      if (endsInER) {
        return reject(
          pending.kind === 'fallBack'
            ? 'A Fall Back move must end outside Engagement Range.'
            : 'A Normal or Advance move cannot end within Engagement Range.',
        );
      }
      const coherent = checkCoherency(env.content, unit, action.positions);
      if (!coherent && state.enforcement.coherency === 'enforce') {
        return reject('The unit must end its move in unit coherency.');
      }
      let next: GameState = {
        ...state,
        pendingMove: null,
        units: {
          ...state.units,
          [unit.id]: {
            ...unit,
            models: unit.models.map((m) => {
              const p = byId.get(m.id);
              return p && !m.destroyed ? { ...m, position: { x: p.x, y: p.y } } : m;
            }),
            turnFlags: {
              ...unit.turnFlags,
              moveKind: pending.kind,
              advanceRoll: pending.advanceRoll,
            },
          },
        },
      };
      if (!coherent && state.enforcement.coherency === 'warn') {
        next = appendLog(next, {
          kind: 'warning',
          player: action.player,
          message: `${unit.name} ended its move out of coherency.`,
        });
      }
      const verb =
        pending.kind === 'advance'
          ? `advances (D6: ${pending.advanceRoll})`
          : pending.kind === 'fallBack'
            ? 'falls back'
            : 'makes a normal move';
      next = appendLog(next, {
        kind: 'move',
        player: action.player,
        message: `${unit.name} ${verb}.`,
      });

      // Desperate Escape: battle-shocked units test EVERY model; otherwise
      // only models whose path crossed an enemy base.
      if (pending.kind === 'fallBack') {
        const origins = new Map(
          alive.filter((m) => m.position).map((m) => [m.id, m.position!] as const),
        );
        next = desperateEscape(next, env, unit.id, byId, origins);
      }

      // Fire Overwatch window for the reactive player.
      next = enqueueWindows(next, [
        {
          hook: 'move.completed',
          player: enemyOf(action.player),
          followUp: { type: 'none' },
          context: {
            movedUnitId: unit.id,
            candidateUnitIds: overwatchCandidates(next, env, unit.id),
          },
        },
      ]);
      next = processWindowQueue(next, env, getResolvers());
      return { ok: true, state: next };
    }

    case 'deployReserves': {
      const { step } = phaseStepKind(env, state);
      if (step !== 'reinforcements') {
        return reject('Reserves arrive in the Reinforcements step of the Movement phase.');
      }
      if (action.player !== state.activePlayer) {
        return reject('You can only bring on reserves on your own turn.', 'OUT_OF_TURN');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (unit.reserves === 'none' || unitIsOnBattlefield(unit)) {
        return reject(`${unit.name} is not in Reserves.`);
      }
      if (state.round < 2) {
        return reject('Reserves cannot arrive before battle round 2.');
      }
      const alive = aliveModels(unit);
      const placed = new Set(action.positions.map((p) => p.modelId));
      if (alive.length !== action.positions.length || !alive.every((m) => placed.has(m.id))) {
        return reject('Every model in the unit must be placed exactly once.');
      }
      if (!positionsOnBoard(state, action.positions)) {
        return reject('Models must arrive on the battlefield.');
      }
      // Always more than 9" from all enemy models.
      const minDist = env.content.edition.parameters.deepStrikeDistance;
      for (const p of action.positions) {
        const model = unit.models.find((m) => m.id === p.modelId)!;
        const base = modelBase(env.content, unit, model, { x: p.x, y: p.y })!;
        for (const other of Object.values(state.units)) {
          if (other.owner === unit.owner) continue;
          for (const { base: enemy } of unitBases(env.content, other)) {
            if (edgeToEdgeDistance(base, enemy) <= minDist) {
              return reject(`Reserves must arrive more than ${minDist}" from all enemy models.`);
            }
          }
        }
      }
      if (unit.reserves === 'strategic') {
        const err = validateStrategicReserves(state, env, unit, action.positions);
        if (err) return reject(err);
      }
      if (positionsOverlap(state, env.content, unit, action.positions)) {
        return reject('Models cannot overlap other models.');
      }
      const coherent = checkCoherency(env.content, unit, action.positions);
      if (!coherent && state.enforcement.coherency === 'enforce') {
        return reject('The unit must arrive in unit coherency.');
      }
      const byId = new Map(action.positions.map((p) => [p.modelId, p]));
      let next: GameState = {
        ...state,
        units: {
          ...state.units,
          [unit.id]: {
            ...unit,
            reserves: 'none',
            models: unit.models.map((m) => {
              const p = byId.get(m.id);
              return p && !m.destroyed ? { ...m, position: { x: p.x, y: p.y } } : m;
            }),
            turnFlags: {
              ...unit.turnFlags,
              moveKind: 'normal', // reserves count as having made a Normal Move
              arrivedFromReserves: true,
            },
          },
        },
      };
      next = appendLog(next, {
        kind: 'reserves',
        player: action.player,
        message: `${unit.name} arrives from ${unit.reserves === 'deepStrike' ? 'Deep Strike' : 'Strategic Reserves'}.`,
      });
      next = enqueueWindows(next, [
        {
          hook: 'reserves.arrived',
          player: enemyOf(action.player),
          followUp: { type: 'none' },
          context: {
            movedUnitId: unit.id,
            candidateUnitIds: overwatchCandidates(next, env, unit.id),
          },
        },
      ]);
      next = processWindowQueue(next, env, getResolvers());
      return { ok: true, state: next };
    }

    case 'cancelMove': {
      const pending = state.pendingMove;
      if (!pending || pending.unitId !== action.unitId) {
        return reject('No move in progress for that unit.');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (pending.kind === 'advance') {
        return reject('An Advance cannot be cancelled once the dice is rolled.');
      }
      return { ok: true, state: { ...state, pendingMove: null } };
    }

    default:
      return null;
  }
}

function movementGate(state: GameState, env: ReducerEnv, player: number): ActionResult | null {
  if (phaseStepKind(env, state).phase !== 'movement') {
    return reject('Movement actions are only legal in the Movement phase.');
  }
  if (player !== state.activePlayer) {
    return reject('You can only move units on your own turn.', 'OUT_OF_TURN');
  }
  return null;
}

/**
 * Desperate Escape: battle-shocked fall-backs test every model; otherwise
 * each model whose straight-line path crossed an enemy base tests once.
 * On a 1-2 a model is destroyed (auto-picked: first non-leader casualty).
 */
function desperateEscape(
  state: GameState,
  env: ReducerEnv,
  unitId: string,
  destinations: Map<string, { modelId: string; x: number; y: number }>,
  origins?: Map<string, { x: number; y: number }>,
): GameState {
  const unit = state.units[unitId]!;
  const testsFor: string[] = [];
  if (unit.battleShocked) {
    for (const m of aliveModels(unit)) testsFor.push(m.id);
  } else {
    for (const m of aliveModels(unit)) {
      const from = origins?.get(m.id) ?? null;
      const to = destinations.get(m.id);
      if (!from || !to) continue;
      // Path segment vs enemy bases (crossed over an enemy model).
      for (const other of Object.values(state.units)) {
        if (other.owner === unit.owner) continue;
        const crossed = unitBases(env.content, other).some(({ base }) => {
          const d = pointToSegmentDistance(base.center, from, { x: to.x, y: to.y });
          return d <= base.radius;
        });
        if (crossed) {
          testsFor.push(m.id);
          break;
        }
      }
    }
  }
  if (testsFor.length === 0) return state;
  const { rolls, rng } = rollD6(state.rng, testsFor.length);
  const failures = rolls.filter((r) => r <= env.content.edition.parameters.desperateEscapeFailOn).length;
  let next: GameState = { ...state, rng };
  if (failures > 0) {
    const models = next.units[unitId]!.models.map((m) => ({ ...m }));
    let toRemove = failures;
    for (const m of models) {
      if (toRemove === 0) break;
      if (!m.destroyed) {
        m.destroyed = true;
        m.woundsRemaining = 0;
        m.position = null;
        toRemove--;
      }
    }
    next = {
      ...next,
      units: { ...next.units, [unitId]: { ...next.units[unitId]!, models } },
    };
  }
  next = appendLog(next, {
    kind: 'desperateEscape',
    player: unit.owner,
    message: `${unit.name} Desperate Escape (${testsFor.length} test(s)): [${rolls.join(' ')}] — ${failures} model(s) lost.`,
    data: { unitId, rolls, failures },
  });
  return next;
}

/** Reactive units able to Fire Overwatch at the moved unit (within 24"). */
function overwatchCandidates(state: GameState, env: ReducerEnv, movedUnitId: string): string[] {
  const moved = state.units[movedUnitId]!;
  const reactive = enemyOf(moved.owner);
  return Object.values(state.units)
    .filter((u) => {
      if (u.owner !== reactive || !unitIsOnBattlefield(u) || aliveModels(u).length === 0) {
        return false;
      }
      if (u.battleShocked) return false;
      if (isInEngagementRange(state, env.content, u.id)) return false;
      const hasRanged = Object.values(u.weapons).some((w) => w.kind === 'ranged');
      if (!hasRanged) return false;
      const d = unitDistance(env.content, u, moved);
      return d !== null && d <= 24;
    })
    .map((u) => u.id);
}

function validateStrategicReserves(
  state: GameState,
  env: ReducerEnv,
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): string | null {
  const edgeMax = 6;
  for (const p of positions) {
    const model = unit.models.find((m) => m.id === p.modelId)!;
    const base = modelBase(env.content, unit, model, { x: p.x, y: p.y })!;
    const distToEdge = Math.min(
      p.x - base.radius,
      p.y - base.radius,
      state.board.width - p.x - base.radius,
      state.board.height - p.y - base.radius,
    );
    if (distToEdge > edgeMax) {
      return `Strategic Reserves must arrive wholly within ${edgeMax}" of a battlefield edge.`;
    }
    if (state.round === 2) {
      const enemyZone = state.board.deploymentZones.find(
        (z) => z.player !== unit.owner,
      );
      if (enemyZone) {
        const inEnemyZone = positions.some((pp) =>
          pointInEnemyZone(pp, enemyZone.polygon),
        );
        if (inEnemyZone) {
          return 'In battle round 2, Strategic Reserves cannot arrive in the enemy deployment zone.';
        }
      }
    }
  }
  return null;
}

function pointInEnemyZone(p: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  return pointInPolygon({ x: p.x, y: p.y }, polygon);
}

function unitMaxMove(env: ReducerEnv, datasheetId: string): number {
  const ds = env.content.getDatasheet(datasheetId);
  return Math.max(...(ds?.models.map((m) => m.move) ?? [6]));
}

function modelMove(env: ReducerEnv, datasheetId: string, profileId: string): number {
  const ds = env.content.getDatasheet(datasheetId);
  const profile = ds?.models.find((p) => p.id === profileId) ?? ds?.models[0];
  return profile?.move ?? 6;
}
