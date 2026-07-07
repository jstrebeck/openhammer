import { rollD6 } from '../dice/index.js';
import { distance, edgeToEdgeDistance } from '../measurement/index.js';
import type { GameAction, ActionResult } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import type { GameState, PlayerIndex, UnitState } from '../types/state.js';
import { appendLog, SETUP_PHASE } from './reducer.js';
import {
  aliveModels,
  checkCoherency,
  modelBase,
  positionsInZone,
  positionsOnBoard,
  positionsOverlap,
  unitBases,
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
      action.type === 'deployUnit' ||
      action.type === 'setReserves' ||
      action.type === 'attachLeader' ||
      action.type === 'scoutMove' ||
      action.type === 'chooseDetachment' ||
      action.type === 'assignEnhancement'
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
      // Infer the player's faction from the first matched datasheet.
      let factionId = state.players[action.player].factionId;
      for (const unit of action.units) {
        const ds = _env.content.getDatasheet(unit.datasheetId);
        if (ds?.factionId) {
          factionId = ds.factionId;
          break;
        }
      }
      const players: GameState['players'] = [state.players[0], state.players[1]];
      players[action.player] = { ...players[action.player], factionId };
      let next: GameState = {
        ...state,
        units,
        players,
        setup: { ...setup, rostersLoaded },
      };
      next = appendLog(next, {
        kind: 'roster',
        player: action.player,
        message: `${state.players[action.player].name} loaded a roster of ${action.units.length} unit(s).`,
      });
      return { ok: true, state: next };
    }

    case 'chooseDetachment': {
      if (setup.attacker !== null) {
        return reject('Detachments are locked once the roll-off is resolved.');
      }
      const player = state.players[action.player];
      const options = _env.content.getDetachmentsFor?.(player.factionId) ?? [];
      const detachment = options.find((d) => d.id === action.detachmentId);
      if (!detachment) {
        return reject(`${action.detachmentId} is not a detachment of your faction.`);
      }
      const players: GameState['players'] = [state.players[0], state.players[1]];
      players[action.player] = { ...player, detachmentId: detachment.id };
      let next: GameState = { ...state, players };
      next = appendLog(next, {
        kind: 'detachment',
        player: action.player,
        message: `${player.name} fields the ${detachment.name} detachment.`,
      });
      return { ok: true, state: next };
    }

    case 'assignEnhancement': {
      if (setup.attacker !== null) {
        return reject('Enhancements are locked once the roll-off is resolved.');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      // Clearing an assignment is always fine.
      if (action.enhancementId === null) {
        return {
          ok: true,
          state: {
            ...state,
            units: { ...state.units, [unit.id]: { ...unit, enhancementId: null } },
          },
        };
      }
      const player = state.players[action.player];
      const detachment = _env.content.getDetachment?.(player.detachmentId);
      const enhancement = detachment?.enhancements.find((e) => e.id === action.enhancementId);
      if (!enhancement) {
        return reject(`${action.enhancementId} is not an enhancement of your detachment.`);
      }
      const keywords = _env.content
        .getUnitKeywords(state, unit.id)
        .map((k) => k.toLowerCase());
      if (!keywords.includes('character')) {
        return reject('Enhancements can only be assigned to Character units.');
      }
      const ds = _env.content.getDatasheet(unit.datasheetId);
      if (ds?.isEpicHero) return reject('Epic Heroes cannot take enhancements.');
      if (
        enhancement.eligibleKeywords.length > 0 &&
        !enhancement.eligibleKeywords.some((k) => keywords.includes(k.toLowerCase()))
      ) {
        return reject(`${unit.name} is not eligible for ${enhancement.name}.`);
      }
      if (enhancement.excludeKeywords?.some((k) => keywords.includes(k.toLowerCase()))) {
        return reject(`${unit.name} cannot take ${enhancement.name}.`);
      }
      const alreadyOn = Object.values(state.units).find(
        (u) => u.owner === action.player && u.enhancementId === enhancement.id && u.id !== unit.id,
      );
      if (alreadyOn) {
        return reject(`${enhancement.name} is already assigned to ${alreadyOn.name}.`);
      }
      if (unit.enhancementId && unit.enhancementId !== enhancement.id) {
        return reject(`${unit.name} already has an enhancement (clear it first).`);
      }
      let next: GameState = {
        ...state,
        units: { ...state.units, [unit.id]: { ...unit, enhancementId: enhancement.id } },
      };
      next = appendLog(next, {
        kind: 'enhancement',
        player: action.player,
        message: `${unit.name} takes ${enhancement.name} (+${enhancement.points} pts).`,
      });
      return { ok: true, state: next };
    }

    case 'setReserves': {
      if (setup.attacker !== null) {
        return reject('Reserves are declared before the roll-off.');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (action.kind === 'deepStrike') {
        const ds = _env.content.getDatasheet(unit.datasheetId);
        const canDeepStrike = (ds?.coreAbilities ?? []).some(
          (ref) => _env.content.getCoreAbility(ref).structural === 'deepStrike',
        );
        if (!canDeepStrike) return reject(`${unit.name} does not have Deep Strike.`);
      }
      if (action.kind === 'strategic') {
        const myUnits = Object.values(state.units).filter((u) => u.owner === action.player);
        const totalPoints = myUnits.reduce((a, u) => a + (u.points ?? 0), 0);
        const reservedPoints = myUnits
          .filter((u) => u.reserves === 'strategic' && u.id !== unit.id)
          .reduce((a, u) => a + (u.points ?? 0), 0);
        const cap = totalPoints * _env.content.edition.parameters.reservesMaxPointsFraction;
        if (totalPoints > 0 && reservedPoints + (unit.points ?? 0) > cap) {
          return reject(
            `Strategic Reserves cannot exceed ${Math.round(cap)} pts (25% of your army).`,
          );
        }
      }
      let next: GameState = {
        ...state,
        units: { ...state.units, [unit.id]: { ...unit, reserves: action.kind } },
      };
      next = appendLog(next, {
        kind: 'reserves',
        player: action.player,
        message:
          action.kind === 'none'
            ? `${unit.name} will deploy normally.`
            : `${unit.name} is placed in ${action.kind === 'deepStrike' ? 'Deep Strike' : 'Strategic Reserves'}.`,
      });
      return { ok: true, state: next };
    }

    case 'attachLeader': {
      if (setup.attacker !== null) {
        return reject('Leaders attach before the roll-off.');
      }
      const leader = state.units[action.leaderUnitId];
      if (!leader || leader.owner !== action.player) return reject('Not your unit.');
      const ds = _env.content.getDatasheet(leader.datasheetId);
      const isLeader = (ds?.coreAbilities ?? []).some(
        (ref) => _env.content.getCoreAbility(ref).structural === 'leader',
      );
      if (!isLeader) return reject(`${leader.name} does not have the Leader ability.`);

      // Detach.
      if (action.bodyguardUnitId === null) {
        const old = leader.attachedTo;
        if (!old) return reject(`${leader.name} is not attached.`);
        const bodyguard = state.units[old];
        let next: GameState = {
          ...state,
          units: {
            ...state.units,
            [leader.id]: { ...leader, attachedTo: null },
            ...(bodyguard ? { [old]: { ...bodyguard, leaderOf: null } } : {}),
          },
        };
        next = appendLog(next, {
          kind: 'leader',
          player: action.player,
          message: `${leader.name} detaches.`,
        });
        return { ok: true, state: next };
      }

      const bodyguard = state.units[action.bodyguardUnitId];
      if (!bodyguard || bodyguard.owner !== action.player) return reject('Not your unit.');
      if (bodyguard.leaderOf !== null) {
        return reject(`${bodyguard.name} already has a Leader attached.`);
      }
      if (bodyguard.attachedTo !== null || leader.leaderOf !== null) {
        return reject('Leaders cannot attach to other Leaders.');
      }
      // canLead lists are empty in the sample-derived packs (milestone 4
      // fills them from BSData); until then any non-Character unit is legal
      // and we log the assumption.
      const bodyguardKeywords = _env.content.getUnitKeywords(state, bodyguard.id);
      if (bodyguardKeywords.some((k) => k.toLowerCase() === 'character')) {
        return reject('A Leader must attach to a Bodyguard unit, not another Character.');
      }
      const canLead = ds?.leader?.canLead ?? [];
      if (canLead.length > 0 && !canLead.includes(bodyguard.datasheetId) && !canLead.includes(bodyguard.name)) {
        return reject(`${leader.name} cannot lead ${bodyguard.name}.`);
      }
      let next: GameState = {
        ...state,
        units: {
          ...state.units,
          [leader.id]: { ...leader, attachedTo: bodyguard.id },
          [bodyguard.id]: { ...bodyguard, leaderOf: leader.id },
        },
      };
      next = appendLog(next, {
        kind: 'leader',
        player: action.player,
        message: `${leader.name} attaches to ${bodyguard.name}.`,
      });
      return { ok: true, state: next };
    }

    case 'scoutMove': {
      if (!setup.readyToStart) {
        return reject('Scout moves happen after the first turn is decided.');
      }
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      const ds = _env.content.getDatasheet(unit.datasheetId);
      const scoutRef = (ds?.coreAbilities ?? []).find(
        (ref) => _env.content.getCoreAbility(ref).structural === 'scout',
      );
      if (!scoutRef) return reject(`${unit.name} does not have Scout.`);
      const scoutDistance = scoutRef.value ?? 6;
      const alive = aliveModels(unit);
      const byId = new Map(action.positions.map((p) => [p.modelId, p]));
      if (alive.some((m) => !byId.has(m.id))) {
        return reject('Provide a destination for every model.');
      }
      for (const model of alive) {
        const dest = byId.get(model.id)!;
        if (!model.position) return reject(`${unit.name} must be deployed before it Scouts.`);
        const moved = distance(model.position, { x: dest.x, y: dest.y });
        if (moved > scoutDistance + 1e-6) {
          return reject(`Scout ${scoutDistance}": a model moved ${moved.toFixed(1)}".`);
        }
        // End more than 9" from all enemy models.
        const base = modelBase(_env.content, unit, model, { x: dest.x, y: dest.y })!;
        for (const other of Object.values(state.units)) {
          if (other.owner === unit.owner) continue;
          for (const { base: enemy } of unitBases(_env.content, other)) {
            if (edgeToEdgeDistance(base, enemy) <= 9) {
              return reject('Scout moves must end more than 9" from all enemy models.');
            }
          }
        }
      }
      if (!positionsOnBoard(state, action.positions)) {
        return reject('Models cannot leave the battlefield.');
      }
      if (positionsOverlap(state, _env.content, unit, action.positions)) {
        return reject('Models cannot end on top of other models.');
      }
      const coherent = checkCoherency(_env.content, unit, action.positions);
      if (!coherent && state.enforcement.coherency === 'enforce') {
        return reject('The unit must end its Scout move in coherency.');
      }
      let next = applyPositions(state, unit.id, action.positions);
      next = appendLog(next, {
        kind: 'scout',
        player: action.player,
        message: `${unit.name} makes a Scout move (up to ${scoutDistance}").`,
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
