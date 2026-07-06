import { roll2D6 } from '../dice/index.js';
import { distance } from '../measurement/index.js';
import type { GameState, QueuedWindow, UnitId, UnitState } from '../types/state.js';
import type { ActionResult, GameAction } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { phaseStepKind } from './kinds.js';
import { enqueueWindows, processWindowQueue } from './windows.js';
import { getResolvers } from './windowReducer.js';
import {
  aliveModels,
  checkCoherency,
  enemyOf,
  positionsOnBoard,
  positionsOverlap,
  unitDistance,
  unitIsOnBattlefield,
} from './validation.js';

/**
 * Charge phase: declare targets within 12", roll 2D6, then either commit
 * a legal charge move (ER with every target, no ER with non-targets) or
 * concede the failure. A successful charge grants Fights First (the
 * charge bonus) until end of turn.
 */
export function reduceCharge(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'declareCharge': {
      const gate = chargeGate(state, env, action.player);
      if (gate) return gate;
      if (state.charge) {
        return reject(`Resolve ${state.units[state.charge.unitId]?.name}'s charge first.`);
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (!unitIsOnBattlefield(unit)) return reject('That unit is not on the battlefield.');
      if (unit.turnFlags.chargeDeclared) {
        return reject(`${unit.name} has already attempted a charge this turn.`);
      }
      if (unit.turnFlags.moveKind === 'advance') {
        return reject('A unit that Advanced cannot charge.');
      }
      if (unit.turnFlags.moveKind === 'fallBack') {
        return reject('A unit that Fell Back cannot charge.');
      }
      if (isEngaged(state, env, unit.id)) {
        return reject('Units already in Engagement Range cannot declare a charge.');
      }
      if (action.targetIds.length === 0) return reject('Declare at least one charge target.');
      for (const targetId of action.targetIds) {
        const target = state.units[targetId];
        if (!target || target.owner === unit.owner || aliveModels(target).length === 0) {
          return reject('Invalid charge target.');
        }
        const d = unitDistance(env.content, unit, target);
        if (d === null || d > env.content.edition.parameters.chargeRange) {
          return reject(`${target.name} is more than 12" away.`);
        }
      }

      const { total, rolls, rng } = roll2D6(state.rng);
      let next: GameState = {
        ...state,
        rng,
        charge: {
          unitId: unit.id,
          targetIds: action.targetIds,
          roll: total,
          rolls: [rolls[0] ?? 1, rolls[1] ?? 1],
        },
        units: {
          ...state.units,
          [unit.id]: {
            ...unit,
            turnFlags: { ...unit.turnFlags, chargeDeclared: true },
          },
        },
      };
      next = appendLog(next, {
        kind: 'charge',
        player: action.player,
        message: `${unit.name} declares a charge (${action.targetIds
          .map((t) => state.units[t]?.name)
          .join(', ')}) — rolled ${rolls[0]}+${rolls[1]} = ${total}".`,
        data: { unitId: unit.id, targetIds: action.targetIds, roll: total },
      });
      // Command Re-roll window on the charge roll (the roller's own call).
      next = enqueueWindows(next, [
        {
          hook: 'move.chargeRoll',
          player: action.player,
          followUp: { type: 'none' },
          context: { kind: 'charge', unitId: unit.id },
        },
      ]);
      next = processWindowQueue(next, env, getResolvers());
      return { ok: true, state: next };
    }

    case 'commitCharge': {
      const gate = chargeGate(state, env, action.player);
      if (gate) return gate;
      const seq = state.charge;
      if (!seq || seq.unitId !== action.unitId) return reject('No charge to resolve for that unit.');
      const unit = state.units[action.unitId]!;
      if (unit.owner !== action.player) return reject('Not your unit.');

      const alive = aliveModels(unit);
      const byId = new Map(action.positions.map((p) => [p.modelId, p]));
      if (alive.some((m) => !byId.has(m.id))) {
        return reject('Provide a destination for every model.');
      }
      for (const model of alive) {
        const dest = byId.get(model.id)!;
        if (!model.position) return reject('Model has no current position.');
        const moved = distance(model.position, { x: dest.x, y: dest.y });
        if (moved > seq.roll + 1e-6) {
          return reject(`A model moved ${moved.toFixed(1)}" but the charge roll was ${seq.roll}".`);
        }
      }
      if (!positionsOnBoard(state, action.positions)) {
        return reject('Models cannot leave the battlefield.');
      }
      if (positionsOverlap(state, env.content, unit, action.positions)) {
        return reject('Models cannot end on top of other models.');
      }
      const coherent = checkCoherency(env.content, unit, action.positions);
      if (!coherent && state.enforcement.coherency === 'enforce') {
        return reject('The unit must end its charge in unit coherency.');
      }
      // Simulate the final positions for ER checks.
      const moved: UnitState = {
        ...unit,
        models: unit.models.map((m) => {
          const p = byId.get(m.id);
          return p && !m.destroyed ? { ...m, position: { x: p.x, y: p.y } } : m;
        }),
      };
      const er = env.content.edition.parameters.engagementRangeHorizontal;
      for (const targetId of seq.targetIds) {
        const target = state.units[targetId];
        if (!target || aliveModels(target).length === 0) continue; // died to overwatch etc.
        const d = unitDistance(env.content, moved, target);
        if (d === null || d > er) {
          return reject(
            `The charge must end within Engagement Range of every declared target (${target.name} is out).`,
          );
        }
      }
      for (const other of Object.values(state.units)) {
        if (other.owner === unit.owner || seq.targetIds.includes(other.id)) continue;
        if (!unitIsOnBattlefield(other)) continue;
        const d = unitDistance(env.content, moved, other);
        if (d !== null && d <= er) {
          return reject(
            `Charging models cannot move within Engagement Range of ${other.name} — it was not a charge target.`,
          );
        }
      }

      let next: GameState = {
        ...state,
        charge: null,
        units: {
          ...state.units,
          [unit.id]: {
            ...moved,
            turnFlags: {
              ...unit.turnFlags,
              moveKind: 'charge',
              chargeRoll: seq.roll,
              chargeTargets: seq.targetIds,
              fightsFirst: true, // the charge bonus, expires at end of turn
            },
          },
        },
      };
      if (!coherent && state.enforcement.coherency === 'warn') {
        next = appendLog(next, {
          kind: 'warning',
          player: action.player,
          message: `${unit.name} ended its charge out of coherency.`,
        });
      }
      next = appendLog(next, {
        kind: 'charge',
        player: action.player,
        message: `${unit.name} charges into combat!`,
      });
      next = enqueueWindows(next, chargeCompletedWindows(next, env, unit.id));
      next = processWindowQueue(next, env, getResolvers());
      return { ok: true, state: next };
    }

    case 'failCharge': {
      const seq = state.charge;
      if (!seq || seq.unitId !== action.unitId) return reject('No charge to fail for that unit.');
      const unit = state.units[action.unitId]!;
      if (unit.owner !== action.player) return reject('Not your unit.');
      let next: GameState = { ...state, charge: null };
      next = appendLog(next, {
        kind: 'charge',
        player: action.player,
        message: `${unit.name}'s charge fails (${seq.roll}" was not enough). No models move.`,
      });
      return { ok: true, state: next };
    }

    default:
      return null;
  }
}

function chargeGate(state: GameState, env: ReducerEnv, player: number): ActionResult | null {
  if (phaseStepKind(env, state).phase !== 'charge') {
    return reject('Charge actions are only legal in the Charge phase.');
  }
  if (player !== state.activePlayer) {
    return reject('You can only charge on your own turn.', 'OUT_OF_TURN');
  }
  return null;
}

function isEngaged(state: GameState, env: ReducerEnv, unitId: UnitId): boolean {
  const unit = state.units[unitId]!;
  const er = env.content.edition.parameters.engagementRangeHorizontal;
  for (const other of Object.values(state.units)) {
    if (other.owner === unit.owner || !unitIsOnBattlefield(other)) continue;
    const d = unitDistance(env.content, unit, other);
    if (d !== null && d <= er) return true;
  }
  return false;
}

/**
 * Windows after a completed charge: the reactive player first (Fire
 * Overwatch / Heroic Intervention), then the active player (Tank Shock).
 */
export function chargeCompletedWindows(
  state: GameState,
  env: ReducerEnv,
  chargedUnitId: UnitId,
): QueuedWindow[] {
  const charged = state.units[chargedUnitId]!;
  const reactive = enemyOf(charged.owner as 0 | 1);
  // Reactive candidates: their units within 24" of the charging unit.
  const reactiveCandidates = Object.values(state.units)
    .filter(
      (u) =>
        u.owner === reactive &&
        unitIsOnBattlefield(u) &&
        aliveModels(u).length > 0 &&
        (unitDistance(env.content, u, charged) ?? Infinity) <= 24,
    )
    .map((u) => u.id);
  // Active candidates for Tank Shock: enemies in ER of the charged vehicle.
  const er = env.content.edition.parameters.engagementRangeHorizontal;
  const shockTargets = Object.values(state.units)
    .filter(
      (u) =>
        u.owner === reactive &&
        unitIsOnBattlefield(u) &&
        (unitDistance(env.content, u, charged) ?? Infinity) <= er,
    )
    .map((u) => u.id);
  return [
    {
      hook: 'charge.completed',
      player: reactive,
      followUp: { type: 'none' },
      context: { movedUnitId: chargedUnitId, candidateUnitIds: reactiveCandidates },
    },
    {
      hook: 'charge.completed',
      player: charged.owner,
      followUp: { type: 'none' },
      context: { chargedUnitId, candidateUnitIds: shockTargets },
    },
  ];
}
