import { rollD6 } from '../dice/index.js';
import type { GameAction, ActionResult } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import type { GameState, PlayerIndex, UnitState } from '../types/state.js';
import { appendLog, SETUP_PHASE } from './reducer.js';
import {
  aliveModels,
  checkCoherency,
  positionsInZone,
  positionsOnBoard,
  positionsOverlap,
} from './validation.js';

/**
 * Minimal milestone-2 pre-game: load rosters → roll off → winner picks
 * attacker/defender → alternating deployment (attacker first) → roll off
 * for first turn → ready. Scout moves, redeploys, reserves: milestone 3.
 */
export function reduceSetup(
  state: GameState,
  action: GameAction,
  _env: ReducerEnv,
): ActionResult | null {
  if (state.phase !== SETUP_PHASE) {
    if (
      action.type === 'loadRoster' ||
      action.type === 'performRollOff' ||
      action.type === 'chooseRole' ||
      action.type === 'deployUnit'
    ) {
      return reject('Setup actions are only legal before the battle begins.');
    }
    return null;
  }
  const setup = state.setup;
  if (!setup) return null;

  switch (action.type) {
    case 'loadRoster': {
      if (setup.attacker !== null) {
        return reject('Rosters are locked once the roll-off is resolved.');
      }
      // Replace any previously loaded units for this player.
      const units: Record<string, UnitState> = {};
      for (const [id, unit] of Object.entries(state.units)) {
        if (unit.owner !== action.player) units[id] = unit;
      }
      for (const unit of action.units) {
        const id = unit.id.startsWith(`p${action.player}-`)
          ? unit.id
          : `p${action.player}-${unit.id}`;
        units[id] = {
          ...unit,
          id,
          owner: action.player,
          models: unit.models.map((m) => ({ ...m, position: null })),
        };
      }
      const rostersLoaded: [boolean, boolean] = [...setup.rostersLoaded];
      rostersLoaded[action.player] = true;
      let next: GameState = {
        ...state,
        units,
        setup: { ...setup, rostersLoaded },
      };
      next = appendLog(next, {
        kind: 'roster',
        player: action.player,
        message: `${state.players[action.player].name} loaded a roster of ${action.units.length} unit(s).`,
      });
      return { ok: true, state: next };
    }

    case 'performRollOff': {
      if (!setup.rostersLoaded[0] || !setup.rostersLoaded[1]) {
        return reject('Both players must load rosters before rolling off.');
      }
      const purpose: 'attackerChoice' | 'firstTurn' =
        setup.attacker === null ? 'attackerChoice' : 'firstTurn';
      if (purpose === 'attackerChoice' && setup.rollOff?.purpose === 'attackerChoice') {
        return reject('The attacker/defender roll-off is already resolved.');
      }
      if (purpose === 'firstTurn') {
        if (setup.deployNext !== null || !deploymentComplete(state)) {
          return reject('The first-turn roll-off happens after deployment completes.');
        }
        if (setup.readyToStart) return reject('First turn is already decided.');
      }
      // Roll off: highest wins, ties re-roll (no modifiers, ever).
      let rng = state.rng;
      let a = 0;
      let b = 0;
      do {
        const draw = rollD6(rng, 2);
        rng = draw.rng;
        a = draw.rolls[0] ?? 1;
        b = draw.rolls[1] ?? 1;
      } while (a === b);
      const winner: PlayerIndex = a > b ? 0 : 1;
      let next: GameState = {
        ...state,
        rng,
        setup: { ...setup, rollOff: { purpose, rolls: [a, b], winner } },
      };
      if (purpose === 'firstTurn') {
        next = {
          ...next,
          firstPlayer: winner,
          activePlayer: winner,
          setup: { ...next.setup!, readyToStart: true },
        };
      }
      next = appendLog(next, {
        kind: 'rollOff',
        player: null,
        message:
          purpose === 'attackerChoice'
            ? `Roll-off ${a} vs ${b} — ${state.players[winner].name} wins and chooses Attacker or Defender.`
            : `First-turn roll-off ${a} vs ${b} — ${state.players[winner].name} takes the first turn.`,
        data: { rolls: [a, b], winner, purpose },
      });
      return { ok: true, state: next };
    }

    case 'chooseRole': {
      const rollOff = setup.rollOff;
      if (!rollOff || rollOff.purpose !== 'attackerChoice' || setup.attacker !== null) {
        return reject('There is no attacker/defender choice to make.');
      }
      if (action.player !== rollOff.winner) {
        return reject('Only the roll-off winner chooses.', 'OUT_OF_TURN');
      }
      const attacker: PlayerIndex =
        action.role === 'attacker' ? action.player : action.player === 0 ? 1 : 0;
      const defender: PlayerIndex = attacker === 0 ? 1 : 0;
      // Attacker deploys first — skip players with nothing to deploy.
      const deployNext = hasUndeployedUnits(state, attacker)
        ? attacker
        : hasUndeployedUnits(state, defender)
          ? defender
          : null;
      let next: GameState = {
        ...state,
        setup: { ...setup, attacker, deployNext, rollOff: null },
      };
      next = appendLog(next, {
        kind: 'roles',
        player: action.player,
        message: `${state.players[attacker].name} is the Attacker and deploys first.`,
      });
      return { ok: true, state: next };
    }

    case 'deployUnit': {
      if (setup.attacker === null || setup.deployNext === null) {
        return reject('Deployment has not started.');
      }
      if (action.player !== setup.deployNext) {
        return reject(
          `It is ${state.players[setup.deployNext].name}'s turn to deploy.`,
          'OUT_OF_TURN',
        );
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (unit.models.some((m) => m.position !== null)) {
        return reject(`${unit.name} is already deployed.`);
      }
      const alive = aliveModels(unit);
      const placed = new Set(action.positions.map((p) => p.modelId));
      if (alive.length !== action.positions.length || !alive.every((m) => placed.has(m.id))) {
        return reject('Every model in the unit must be placed exactly once.');
      }
      const zone = state.board.deploymentZones.find((z) => z.player === action.player);
      if (!zone) return reject('No deployment zone defined for this player.');
      if (!positionsOnBoard(state, action.positions)) {
        return reject('Models must be placed on the battlefield.');
      }
      if (!positionsInZone(action.positions, zone.polygon)) {
        return reject('All models must be set up wholly within your deployment zone.');
      }
      if (positionsOverlap(state, _env.content, unit, action.positions)) {
        return reject('Models cannot overlap other models.');
      }
      const coherent = checkCoherency(_env.content, unit, action.positions);
      if (!coherent && state.enforcement.coherency === 'enforce') {
        return reject('The unit must be set up in unit coherency (2" between models).');
      }
      let next = applyPositions(state, unit.id, action.positions);
      if (!coherent && state.enforcement.coherency === 'warn') {
        next = appendLog(next, {
          kind: 'warning',
          player: action.player,
          message: `${unit.name} was set up out of coherency.`,
        });
      }
      const opponent: PlayerIndex = action.player === 0 ? 1 : 0;
      const opponentHas = hasUndeployedUnits(next, opponent);
      const selfHas = hasUndeployedUnits(next, action.player);
      const deployNext = opponentHas ? opponent : selfHas ? action.player : null;
      next = {
        ...next,
        setup: { ...next.setup!, deployNext },
      };
      next = appendLog(next, {
        kind: 'deploy',
        player: action.player,
        message: `${state.players[action.player].name} deploys ${unit.name}.`,
      });
      if (deployNext === null) {
        next = appendLog(next, {
          kind: 'deploy',
          player: null,
          message: 'Deployment complete — roll off for the first turn.',
        });
      }
      return { ok: true, state: next };
    }

    default:
      return null;
  }
}

function applyPositions(
  state: GameState,
  unitId: string,
  positions: { modelId: string; x: number; y: number }[],
): GameState {
  const unit = state.units[unitId]!;
  const byId = new Map(positions.map((p) => [p.modelId, p]));
  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: {
        ...unit,
        models: unit.models.map((m) => {
          const p = byId.get(m.id);
          return p ? { ...m, position: { x: p.x, y: p.y } } : m;
        }),
      },
    },
  };
}

function hasUndeployedUnits(state: GameState, player: PlayerIndex): boolean {
  return Object.values(state.units).some(
    (u) =>
      u.owner === player &&
      u.reserves === 'none' &&
      aliveModels(u).length > 0 &&
      u.models.every((m) => m.position === null),
  );
}

export function deploymentComplete(state: GameState): boolean {
  return !hasUndeployedUnits(state, 0) && !hasUndeployedUnits(state, 1);
}
