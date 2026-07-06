import { rollD6 } from '../dice/index.js';
import { distance } from '../measurement/index.js';
import type { GameAction, ActionResult } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import type { GameState } from '../types/state.js';
import { appendLog } from './reducer.js';
import {
  aliveModels,
  checkCoherency,
  isInEngagementRange,
  positionsInEngagementRange,
  positionsOnBoard,
  positionsOverlap,
} from './validation.js';

/**
 * Movement phase, milestone-2 scope: Remain Stationary / Normal / Advance /
 * Fall Back with straight-line distance validation. Desperate Escape,
 * terrain climbing, transports and FLY come in milestone 3.
 */
export function reduceMovement(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'startMove': {
      const gate = movementGate(state, action.player);
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
      const gate = movementGate(state, action.player);
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

function movementGate(state: GameState, player: number): ActionResult | null {
  if (state.phase !== 'movement') {
    return reject('Movement actions are only legal in the Movement phase.');
  }
  if (player !== state.activePlayer) {
    return reject('You can only move units on your own turn.', 'OUT_OF_TURN');
  }
  return null;
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
