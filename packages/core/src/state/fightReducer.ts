import { distance } from '../measurement/index.js';
import type { Circle } from '../types/geometry.js';
import type { GameState, PlayerIndex, UnitId, UnitState } from '../types/state.js';
import type { ActionResult, GameAction } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import { appendLog } from './reducer.js';
import { phaseStepKind } from './kinds.js';
import { enqueueWindows, processWindowQueue } from './windows.js';
import { getResolvers } from './windowReducer.js';
import { beginMeleeSequence } from './shootingReducer.js';
import {
  aliveModels,
  checkCoherency,
  enemyOf,
  modelBase,
  positionsOnBoard,
  positionsOverlap,
  unitBases,
  unitDistance,
  unitIsOnBattlefield,
} from './validation.js';
import { edgeToEdgeDistance } from '../measurement/index.js';

/**
 * Fight phase alternation: the REACTIVE player selects first in each step;
 * a player with eligible units must select one. Each activation runs
 * Pile In (3") → melee attacks (shared attack sequence) → Consolidate (3").
 */

export function reduceFight(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'selectFighter': {
      const gate = fightGate(state, env);
      if (gate) return gate;
      const fight = state.fight!;
      if (fight.stage !== 'select') {
        return reject('A unit is already fighting — finish its activation.');
      }
      if (fight.selector === null) return reject('No units are waiting to fight.');
      if (action.player !== fight.selector) {
        return reject(
          `It is ${state.players[fight.selector].name}'s turn to select a unit to fight.`,
          'OUT_OF_TURN',
        );
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (!eligibleThisStep(state, env, unit)) {
        return reject(`${unit.name} is not eligible to fight in this step.`);
      }
      let next: GameState = {
        ...state,
        fight: { ...fight, activeUnitId: unit.id, stage: 'pileIn' },
      };
      next = appendLog(next, {
        kind: 'fight',
        player: action.player,
        message: `${unit.name} is selected to fight.`,
      });
      // Epic Challenge window for the selecting player's Characters.
      next = enqueueWindows(next, [
        {
          hook: 'fight.unitSelected',
          player: action.player,
          followUp: { type: 'none' },
          context: { unitId: unit.id, candidateUnitIds: [unit.id] },
        },
      ]);
      next = processWindowQueue(next, env, getResolvers());
      return { ok: true, state: next };
    }

    case 'pileIn':
    case 'consolidate': {
      const gate = fightGate(state, env);
      if (gate) return gate;
      const fight = state.fight!;
      const expectedStage = action.type === 'pileIn' ? 'pileIn' : 'consolidate';
      if (fight.activeUnitId !== action.unitId || fight.stage !== expectedStage) {
        return reject(`It is not time for that unit to ${action.type}.`);
      }
      const unit = state.units[action.unitId]!;
      if (unit.owner !== action.player) return reject('Not your unit.');

      const err = validateEngagementMove(state, env, unit, action.positions);
      if (err) return reject(err);

      const byId = new Map(action.positions.map((p) => [p.modelId, p]));
      let next: GameState = {
        ...state,
        units: {
          ...state.units,
          [unit.id]: {
            ...unit,
            models: unit.models.map((m) => {
              const p = byId.get(m.id);
              return p && !m.destroyed ? { ...m, position: { x: p.x, y: p.y } } : m;
            }),
          },
        },
      };

      if (action.type === 'pileIn') {
        next = { ...next, fight: { ...fight, stage: 'attacks' } };
        next = appendLog(next, {
          kind: 'fight',
          player: action.player,
          message: `${unit.name} piles in.`,
        });
        return { ok: true, state: next };
      }

      // Consolidate: the activation ends.
      next = appendLog(next, {
        kind: 'fight',
        player: action.player,
        message: `${unit.name} consolidates.`,
      });
      return { ok: true, state: finishActivation(next, env, unit.id) };
    }

    case 'declareMelee': {
      const gate = fightGate(state, env);
      if (gate) return gate;
      const fight = state.fight!;
      if (fight.activeUnitId !== action.unitId || fight.stage !== 'attacks') {
        return reject('It is not time for that unit to make melee attacks.');
      }
      const unit = state.units[action.unitId]!;
      if (unit.owner !== action.player) return reject('Not your unit.');

      if (action.assignments.length === 0) {
        // Charged but cannot reach anything: skip to consolidate.
        let next: GameState = { ...state, fight: { ...fight, stage: 'consolidate' } };
        next = appendLog(next, {
          kind: 'fight',
          player: action.player,
          message: `${unit.name} has no melee attacks to make.`,
        });
        return { ok: true, state: next };
      }

      const er = env.content.edition.parameters.engagementRangeHorizontal;
      for (const a of action.assignments) {
        const weapon = unit.weapons[a.weaponId];
        if (!weapon) return reject(`Unknown weapon: ${a.weaponId}`);
        if (weapon.kind !== 'melee') return reject(`${weapon.name} is not a melee weapon.`);
        const target = state.units[a.targetUnitId];
        if (!target || target.owner === unit.owner || aliveModels(target).length === 0) {
          return reject('Invalid melee target.');
        }
        const d = unitDistance(env.content, unit, target);
        if (d === null || d > er) {
          return reject(`${target.name} is not within Engagement Range.`);
        }
      }
      return beginMeleeSequence(state, env, unit.id, action.assignments);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sequencing helpers (used by the main reducer at phase/step boundaries and
// by the attack sequence when a melee activation finishes its attacks)
// ---------------------------------------------------------------------------

function fightGate(state: GameState, env: ReducerEnv): ActionResult | null {
  if (phaseStepKind(env, state).phase !== 'fight') {
    return reject('Fight actions are only legal in the Fight phase.');
  }
  if (!state.fight) return reject('The fight sequence has not started.');
  return null;
}

function isInER(state: GameState, env: ReducerEnv, unit: UnitState): boolean {
  const er = env.content.edition.parameters.engagementRangeHorizontal;
  for (const other of Object.values(state.units)) {
    if (other.owner === unit.owner || !unitIsOnBattlefield(other)) continue;
    const d = unitDistance(env.content, unit, other);
    if (d !== null && d <= er) return true;
  }
  return false;
}

function hasFightsFirst(state: GameState, env: ReducerEnv, unit: UnitState): boolean {
  if (unit.turnFlags.fightsFirst) return true;
  const ds = env.content.getDatasheet(unit.datasheetId);
  return (ds?.coreAbilities ?? []).some(
    (ref) => env.content.getCoreAbility(ref).structural === 'fightsFirst',
  );
}

function eligibleThisStep(state: GameState, env: ReducerEnv, unit: UnitState): boolean {
  if (aliveModels(unit).length === 0 || !unitIsOnBattlefield(unit)) return false;
  if ((state.fight?.fought ?? []).includes(unit.id)) return false;
  if (unit.turnFlags.hasFought) return false;
  const engagedOrCharged = isInER(state, env, unit) || unit.turnFlags.moveKind === 'charge';
  if (!engagedOrCharged) return false;
  const { step } = phaseStepKind(env, state);
  if (step === 'fightsFirst') return hasFightsFirst(state, env, unit);
  return true;
}

function eligibleFighters(
  state: GameState,
  env: ReducerEnv,
  player: PlayerIndex,
): UnitId[] {
  return Object.values(state.units)
    .filter((u) => u.owner === player && eligibleThisStep(state, env, u))
    .map((u) => u.id);
}

/**
 * Who selects next: reactive player first, then whoever still has units.
 * `lastFighterOwner` is null at step start (reactive priority applies).
 */
export function computeSelector(
  state: GameState,
  env: ReducerEnv,
  lastFighterOwner: PlayerIndex | null,
): PlayerIndex | null {
  const reactive = enemyOf(state.activePlayer);
  const reactiveHas = eligibleFighters(state, env, reactive).length > 0;
  const activeHas = eligibleFighters(state, env, state.activePlayer).length > 0;
  if (lastFighterOwner === null) {
    if (reactiveHas) return reactive;
    if (activeHas) return state.activePlayer;
    return null;
  }
  const other = enemyOf(lastFighterOwner);
  const otherHas = other === reactive ? reactiveHas : activeHas;
  const sameHas = lastFighterOwner === reactive ? reactiveHas : activeHas;
  if (otherHas) return other;
  if (sameHas) return lastFighterOwner;
  return null;
}

/** Close out an activation after Consolidate (or after skipped attacks). */
function finishActivation(state: GameState, env: ReducerEnv, unitId: UnitId): GameState {
  const unit = state.units[unitId]!;
  let next: GameState = {
    ...state,
    units: {
      ...state.units,
      [unitId]: { ...unit, turnFlags: { ...unit.turnFlags, hasFought: true } },
    },
  };
  const fight = next.fight!;
  const fought = [...fight.fought, unitId];
  next = { ...next, fight: { ...fight, fought, activeUnitId: null, stage: 'select' } };
  const selector = computeSelector(next, env, unit.owner);
  next = { ...next, fight: { ...next.fight!, selector } };
  // Counter-Offensive window for the opponent of the unit that just fought.
  next = enqueueWindows(next, [
    {
      hook: 'fight.unitFought',
      player: enemyOf(unit.owner),
      followUp: { type: 'none' },
      context: {
        foughtUnitId: unitId,
        candidateUnitIds: eligibleFighters(next, env, enemyOf(unit.owner)),
      },
    },
  ]);
  next = processWindowQueue(next, env, getResolvers());
  return next;
}

/**
 * Pile In / Consolidate validation: ≤3", every moved model ends closer to
 * the nearest enemy model, coherency, no overlaps, on the board.
 */
function validateEngagementMove(
  state: GameState,
  env: ReducerEnv,
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): string | null {
  const limit = env.content.edition.parameters.pileInDistance;
  const alive = aliveModels(unit);
  const byId = new Map(positions.map((p) => [p.modelId, p]));
  if (alive.some((m) => !byId.has(m.id))) {
    return 'Provide a destination for every model (unmoved models keep their spot).';
  }
  const enemyBases: Circle[] = [];
  for (const other of Object.values(state.units)) {
    if (other.owner === unit.owner) continue;
    for (const { base } of unitBases(env.content, other)) enemyBases.push(base);
  }
  for (const model of alive) {
    const dest = byId.get(model.id)!;
    if (!model.position) return 'Model has no current position.';
    const movedBy = distance(model.position, { x: dest.x, y: dest.y });
    if (movedBy > limit + 1e-6) {
      return `Pile In and Consolidate moves are at most ${limit}".`;
    }
    if (movedBy > 1e-6 && enemyBases.length > 0) {
      const oldBase = modelBase(env.content, unit, model)!;
      const newBase = modelBase(env.content, unit, model, { x: dest.x, y: dest.y })!;
      const oldNearest = Math.min(...enemyBases.map((b) => edgeToEdgeDistance(oldBase, b)));
      const newNearest = Math.min(...enemyBases.map((b) => edgeToEdgeDistance(newBase, b)));
      if (newNearest > oldNearest + 1e-6) {
        return 'Every model that moves must end closer to the closest enemy model.';
      }
    }
  }
  if (!positionsOnBoard(state, positions)) return 'Models cannot leave the battlefield.';
  if (positionsOverlap(state, env.content, unit, positions)) {
    return 'Models cannot end on top of other models.';
  }
  const coherent = checkCoherency(env.content, unit, positions);
  if (!coherent && state.enforcement.coherency === 'enforce') {
    return 'The unit must end the move in unit coherency.';
  }
  return null;
}
