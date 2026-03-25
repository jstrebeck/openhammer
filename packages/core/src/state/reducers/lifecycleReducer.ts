import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { generateUUID } from '../../utils/uuid';
import {
  createEmptyTurnTracking,
  createEmptyShootingState,
  createEmptyChargeState,
  createEmptyFightState,
  createEmptyStratagemEffects,
} from '../../types/index';
import type { GameState, TurnTracking, DeploymentZone, ObjectiveMarker, FactionStateSlice, TurnChangeContext } from '../../types/index';
import { getEdition } from '../../rules/registry';
import { getRegisteredFactionHandlers } from '../../detachments/registry';
import { evaluateScoring } from '../../missions/index';
import { checkCoherency, isWithinRange, distanceToPoint } from '../../measurement/index';
import { getOrderOCBonus } from '../../combat/factionModifiers';

function resetFactionStateForPhase(state: GameState, newPhaseId: string): Record<string, FactionStateSlice> {
  const newFactionState = { ...state.factionState };
  for (const [factionId, handlers] of getRegisteredFactionHandlers()) {
    const current = state.factionState[factionId] ?? handlers.createInitial();
    newFactionState[factionId] = handlers.onPhaseChange(current as any, {
      newPhaseId,
      activePlayerId: state.turnState.activePlayerId,
      roundNumber: state.turnState.roundNumber,
    });
  }
  return newFactionState;
}

function resetFactionStateForTurn(state: GameState, context: TurnChangeContext): Record<string, FactionStateSlice> {
  const newFactionState = { ...state.factionState };
  for (const [factionId, handlers] of getRegisteredFactionHandlers()) {
    const current = state.factionState[factionId] ?? handlers.createInitial();
    newFactionState[factionId] = handlers.onTurnChange(current as any, context);
  }
  return newFactionState;
}

export const lifecycleReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'ADVANCE_PHASE': {
      const edition = getEdition(state.editionId);
      if (!edition) return state;
      const nextIndex = edition.getNextPhase(state.turnState.currentPhaseIndex);
      if (nextIndex === null) return state;
      const newPhase = edition.phases[nextIndex];
      return {
        ...state,
        turnState: { ...state.turnState, currentPhaseIndex: nextIndex },
        // Reset per-phase activation tracking but keep per-turn data (unitMovement, chargedUnits)
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: {},
          unitsCompleted: {},
          embarkedThisPhase: [],
          disembarkedThisPhase: [],
          surgeMoveUsedThisPhase: {},
        },
        // Reset phase-specific state
        shootingState: createEmptyShootingState(),
        chargeState: nextIndex === edition.phases.findIndex(p => p.id === 'charge')
          ? createEmptyChargeState()
          : state.chargeState,
        fightState: createEmptyFightState(),
        stratagemsUsedThisPhase: [],
        // Clear phase-duration stratagem effects
        stratagemEffects: createEmptyStratagemEffects(),
        outOfPhaseAction: undefined,
        // Reset faction state for phase change (orders, guided targets, etc.)
        factionState: resetFactionStateForPhase(state, newPhase?.id ?? ''),
        // Auto-expire persisting effects at phase end
        persistingEffects: state.persistingEffects.filter(e => e.expiresAt.type !== 'phase_end'),
        log: appendLog(state.log, {
          type: 'phase_change',
          phase: newPhase?.name ?? `Phase ${nextIndex}`,
          roundNumber: state.turnState.roundNumber,
          playerId: state.turnState.activePlayerId,
          timestamp: Date.now(),
        }),
      };
    }

    case 'NEXT_TURN': {
      const playerIds = Object.keys(state.players);
      const currentIdx = playerIds.indexOf(state.turnState.activePlayerId);
      const isLastPlayer = currentIdx >= playerIds.length - 1;
      const newRound = isLastPlayer ? state.turnState.roundNumber + 1 : state.turnState.roundNumber;
      const newPlayerId = playerIds[(currentIdx + 1) % playerIds.length] ?? '';
      const edition = getEdition(state.editionId);
      const firstPhase = edition?.phases[0];
      return {
        ...state,
        turnState: {
          roundNumber: newRound,
          activePlayerId: newPlayerId,
          currentPhaseIndex: 0,
        },
        // Reset all per-turn tracking
        turnTracking: createEmptyTurnTracking(),
        shootingState: createEmptyShootingState(),
        chargeState: createEmptyChargeState(),
        fightState: createEmptyFightState(),
        stratagemsUsedThisPhase: [],
        stratagemEffects: createEmptyStratagemEffects(),
        outOfPhaseAction: undefined,
        factionState: resetFactionStateForTurn(state, { newActivePlayerId: newPlayerId, roundNumber: newRound }),
        cpGainedThisRound: isLastPlayer ? {} : state.cpGainedThisRound,
        // Auto-expire persisting effects at turn/round end
        persistingEffects: state.persistingEffects.filter(e => {
          if (e.expiresAt.type === 'phase_end' || e.expiresAt.type === 'turn_end') return false;
          if (e.expiresAt.type === 'round_end' && isLastPlayer && e.expiresAt.round != null && newRound > e.expiresAt.round) return false;
          return true;
        }),
        log: appendLog(state.log, {
          type: 'phase_change',
          phase: firstPhase?.name ?? 'Phase 0',
          roundNumber: newRound,
          playerId: newPlayerId,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SET_MISSION': {
      const { mission } = action.payload;

      // Create deployment zones from mission definition, mapping roles to player IDs
      const newZones: Record<string, DeploymentZone> = {};
      for (const zone of mission.deploymentMap) {
        const playerId = zone.role === 'attacker' ? state.attackerId : state.defenderId;
        const player = playerId ? state.players[playerId] : undefined;
        const zoneId = generateUUID();
        newZones[zoneId] = {
          id: zoneId,
          playerId: playerId ?? '',
          polygon: zone.polygon,
          label: zone.label,
          color: player?.color ?? (zone.role === 'attacker' ? '#3b82f6' : '#ef4444'),
        };
      }

      // Create objectives from mission definition
      const newObjectives: Record<string, ObjectiveMarker> = {};
      for (const obj of mission.objectivePlacements) {
        const objId = generateUUID();
        newObjectives[objId] = {
          id: objId,
          position: obj.position,
          number: obj.number,
          label: obj.label,
        };
      }

      return {
        ...state,
        mission,
        board: { width: mission.battlefieldSize.width, height: mission.battlefieldSize.height },
        deploymentZones: newZones,
        objectives: newObjectives,
        maxBattleRounds: mission.maxBattleRounds,
        log: appendLog(state.log, {
          type: 'message',
          text: `Mission set: ${mission.name}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'SELECT_SECONDARY': {
      const { playerId, conditionIds } = action.payload;
      return {
        ...state,
        secondaryObjectives: {
          ...state.secondaryObjectives,
          [playerId]: conditionIds,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `Player ${state.players[playerId]?.name ?? playerId} selected ${conditionIds.length} secondary objectives`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'END_TURN': {
      // End-of-turn sequence:
      // 1. Clear turn-scoped effects (charge bonus, movement flags)
      // 2. Calculate objective control (inline)
      // 3. Evaluate end-of-turn scoring

      // Step 1: Clear turn-scoped effects on turnTracking
      const clearedTracking: TurnTracking = {
        ...state.turnTracking,
        unitsActivated: {},
        unitsCompleted: {},
        embarkedThisPhase: [],
        disembarkedThisPhase: [],
        surgeMoveUsedThisPhase: {},
      };

      // Step 2: Calculate objective control (same logic as CALCULATE_OBJECTIVE_CONTROL)
      const updatedObjectives = { ...state.objectives };
      const editionForOC = getEdition(state.editionId);
      if (editionForOC) {
        for (const obj of Object.values(updatedObjectives)) {
          const ocByPlayer: Record<string, number> = {};
          for (const model of Object.values(state.models)) {
            if (model.status === 'destroyed') continue;
            const unit = state.units[model.unitId];
            if (!unit) continue;
            const dist = distanceToPoint(model, obj.position);
            if (dist <= 3) {
              const isBattleShocked = state.battleShocked.includes(unit.id);
              const baseOC = model.stats.objectiveControl + getOrderOCBonus(state, unit.id);
              const oc = isBattleShocked ? 0 : baseOC;
              ocByPlayer[unit.playerId] = (ocByPlayer[unit.playerId] ?? 0) + oc;
            }
          }
          const playerEntries = Object.entries(ocByPlayer).filter(([, oc]) => oc > 0);
          if (playerEntries.length === 0) {
            updatedObjectives[obj.id] = { ...obj, controllingPlayerId: undefined };
          } else if (playerEntries.length === 1) {
            updatedObjectives[obj.id] = { ...obj, controllingPlayerId: playerEntries[0][0] };
          } else {
            const maxOC = Math.max(...playerEntries.map(([, oc]) => oc));
            const winners = playerEntries.filter(([, oc]) => oc === maxOC);
            updatedObjectives[obj.id] = {
              ...obj,
              controllingPlayerId: winners.length === 1 ? winners[0][0] : undefined,
            };
          }
        }
      }

      // Step 3: Evaluate end-of-turn scoring
      const stateForScoring: GameState = { ...state, objectives: updatedObjectives, turnTracking: clearedTracking };
      const turnScoring = evaluateScoring(stateForScoring, 'end_of_turn');
      const newScore = { ...state.score };
      for (const [pid, delta] of Object.entries(turnScoring.scoreDeltas)) {
        newScore[pid] = (newScore[pid] ?? 0) + delta;
      }

      return {
        ...state,
        turnTracking: clearedTracking,
        objectives: updatedObjectives,
        score: newScore,
        scoringLog: [...state.scoringLog, ...turnScoring.entries],
        // Clear phase-duration effects
        stratagemEffects: createEmptyStratagemEffects(),
        outOfPhaseAction: undefined,
        persistingEffects: state.persistingEffects.filter(e => e.expiresAt.type !== 'phase_end' && e.expiresAt.type !== 'turn_end'),
        log: appendLog(state.log, {
          type: 'message',
          text: `End of turn for ${state.players[state.turnState.activePlayerId]?.name ?? 'Unknown'}` +
            (turnScoring.entries.length > 0
              ? `. VP scored: ${turnScoring.entries.map(e => `${state.players[e.playerId]?.name ?? e.playerId} +${e.vpScored} (${e.conditionName})`).join(', ')}`
              : ''),
          timestamp: Date.now(),
        }),
      };
    }

    case 'END_BATTLE_ROUND': {
      // End-of-battle-round sequence:
      // 1. Score VP per mission (end_of_round conditions)
      // 2. Clear round-scoped effects
      // 3. Increment round counter
      // 4. Check final round

      // Step 1: Evaluate end-of-round scoring
      const roundScoring = evaluateScoring(state, 'end_of_round');
      const roundScore = { ...state.score };
      for (const [pid, delta] of Object.entries(roundScoring.scoreDeltas)) {
        roundScore[pid] = (roundScore[pid] ?? 0) + delta;
      }

      // Step 2: Check if this is the final round
      const isLastRound = state.turnState.roundNumber >= state.maxBattleRounds;

      // Step 3: Clear round-scoped effects and advance
      const playerIds = Object.keys(state.players);
      const newActivePlayer = state.firstTurnPlayerId ?? playerIds[0] ?? '';

      let newState: GameState = {
        ...state,
        score: roundScore,
        scoringLog: [...state.scoringLog, ...roundScoring.entries],
        // Increment round if not last
        turnState: isLastRound ? state.turnState : {
          roundNumber: state.turnState.roundNumber + 1,
          activePlayerId: newActivePlayer,
          currentPhaseIndex: 0,
        },
        // Reset all per-turn tracking for new round
        turnTracking: isLastRound ? state.turnTracking : createEmptyTurnTracking(),
        shootingState: isLastRound ? state.shootingState : createEmptyShootingState(),
        chargeState: isLastRound ? state.chargeState : createEmptyChargeState(),
        fightState: isLastRound ? state.fightState : createEmptyFightState(),
        stratagemsUsedThisPhase: isLastRound ? state.stratagemsUsedThisPhase : [],
        stratagemEffects: createEmptyStratagemEffects(),
        outOfPhaseAction: undefined,
        cpGainedThisRound: isLastRound ? state.cpGainedThisRound : {},
        // Clear round-end persisting effects
        persistingEffects: state.persistingEffects.filter(e => {
          if (e.expiresAt.type === 'phase_end' || e.expiresAt.type === 'turn_end') return false;
          if (e.expiresAt.type === 'round_end') return false;
          return true;
        }),
        log: appendLog(state.log, {
          type: 'message',
          text: `End of Battle Round ${state.turnState.roundNumber}` +
            (roundScoring.entries.length > 0
              ? `. VP scored: ${roundScoring.entries.map(e => `${state.players[e.playerId]?.name ?? e.playerId} +${e.vpScored} (${e.conditionName})`).join(', ')}`
              : '') +
            (isLastRound ? '. Final round complete!' : ''),
          timestamp: Date.now(),
        }),
      };

      // If final round, auto-trigger end of battle
      if (isLastRound) {
        newState = lifecycleReducer(newState, { type: 'END_BATTLE', payload: { reason: 'max_rounds' } }) ?? newState;
      }

      return newState;
    }

    case 'END_BATTLE': {
      const { reason } = action.payload;

      // 1. Undeployed Reserves count as destroyed
      const updatedModels = { ...state.models };
      const destroyedReserveUnits: string[] = [];
      for (const [unitId, reserve] of Object.entries(state.reserves)) {
        const unit = state.units[unitId];
        if (!unit) continue;
        destroyedReserveUnits.push(unit.name);
        for (const modelId of unit.modelIds) {
          const model = updatedModels[modelId];
          if (model && model.status !== 'destroyed') {
            updatedModels[modelId] = { ...model, status: 'destroyed', wounds: 0 };
          }
        }
      }

      // 2. Evaluate end-of-battle scoring
      const battleScoring = evaluateScoring({ ...state, models: updatedModels }, 'end_of_battle');
      const finalScores: Record<string, number> = { ...state.score };
      for (const [pid, delta] of Object.entries(battleScoring.scoreDeltas)) {
        finalScores[pid] = (finalScores[pid] ?? 0) + delta;
      }

      // 3. Determine winner
      const playerIds = Object.keys(state.players);
      let winnerId: string | null = null;
      if (playerIds.length >= 2) {
        const scores = playerIds.map(pid => ({ pid, vp: finalScores[pid] ?? 0 }));
        scores.sort((a, b) => b.vp - a.vp);
        if (scores[0].vp > scores[1].vp) {
          winnerId = scores[0].pid;
        }
        // else tie = draw (winnerId stays null)
      }

      return {
        ...state,
        models: updatedModels,
        score: finalScores,
        scoringLog: [...state.scoringLog, ...battleScoring.entries],
        gameResult: {
          winnerId,
          finalScores,
          reason,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `Battle ended (${reason})!` +
            (destroyedReserveUnits.length > 0 ? ` Reserves destroyed: ${destroyedReserveUnits.join(', ')}.` : '') +
            (winnerId
              ? ` Winner: ${state.players[winnerId]?.name ?? winnerId} (${finalScores[winnerId] ?? 0} VP)`
              : ` Result: Draw (${playerIds.map(p => `${state.players[p]?.name ?? p}: ${finalScores[p] ?? 0}`).join(', ')})`),
          timestamp: Date.now(),
        }),
      };
    }

    case 'CALCULATE_OBJECTIVE_CONTROL': {
      const edition = getEdition(state.editionId);
      if (!edition) return state;

      const newObjectives = { ...state.objectives };

      for (const [objId, objective] of Object.entries(state.objectives)) {
        // Find models within 3" of the objective
        const controlByPlayer: Record<string, number> = {};

        for (const model of Object.values(state.models)) {
          if (model.status === 'destroyed') continue;
          const unit = state.units[model.unitId];
          if (!unit) continue;

          // Check distance: within 3" of objective (edge-to-point)
          if (!isWithinRange(model, objective.position, 3)) continue;

          // OC is 0 if battle-shocked; Duty and Honour! adds +1 OC
          const baseOC = model.stats.objectiveControl + getOrderOCBonus(state, unit.id);
          const oc = state.battleShocked.includes(unit.id) ? 0 : baseOC;
          controlByPlayer[unit.playerId] = (controlByPlayer[unit.playerId] ?? 0) + oc;
        }

        // Determine controller
        const entries = Object.entries(controlByPlayer);
        if (entries.length === 0) {
          newObjectives[objId] = { ...objective, controllingPlayerId: undefined };
        } else {
          entries.sort((a, b) => b[1] - a[1]);
          const highest = entries[0][1];
          const tied = entries.filter(([, v]) => v === highest);
          if (tied.length > 1 || highest === 0) {
            // Contested or no OC
            newObjectives[objId] = { ...objective, controllingPlayerId: undefined };
          } else {
            newObjectives[objId] = { ...objective, controllingPlayerId: tied[0][0] };
          }
        }
      }

      return { ...state, objectives: newObjectives };
    }

    case 'UPDATE_SCORE': {
      const { playerId, delta, reason } = action.payload;
      const oldScore = state.score[playerId] ?? 0;
      const newScore = Math.max(0, oldScore + delta);
      return {
        ...state,
        score: { ...state.score, [playerId]: newScore },
        log: appendLog(state.log, {
          type: 'message',
          text: `${state.players[playerId]?.name ?? playerId} scores ${delta} VP (${reason}) — total: ${newScore}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ACTIVATE_UNIT': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
      };
    }

    case 'COMPLETE_UNIT_ACTIVATION': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      return {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    case 'LOG_MESSAGE': {
      return {
        ...state,
        log: appendLog(state.log, {
          type: 'message',
          text: action.payload.text,
          timestamp: Date.now(),
        }),
      };
    }

    case 'ROLL_DICE': {
      const { roll } = action.payload;
      return {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };
    }

    case 'ROLL_OFF': {
      const { player1Id, player2Id, player1Roll, player2Roll, winnerId } = action.payload;
      const p1Name = state.players[player1Id]?.name ?? player1Id;
      const p2Name = state.players[player2Id]?.name ?? player2Id;
      const p1Val = player1Roll.dice[0] ?? 0;
      const p2Val = player2Roll.dice[0] ?? 0;

      let resultText: string;
      if (winnerId) {
        const winnerName = state.players[winnerId]?.name ?? winnerId;
        resultText = `Roll-off: ${p1Name} rolls ${p1Val}, ${p2Name} rolls ${p2Val} — ${winnerName} wins`;
      } else {
        resultText = `Roll-off: ${p1Name} rolls ${p1Val}, ${p2Name} rolls ${p2Val} — Tie! Re-roll required`;
      }

      let newLog = appendLog(state.log, { type: 'dice_roll', roll: player1Roll, timestamp: Date.now() });
      newLog = appendLog(newLog, { type: 'dice_roll', roll: player2Roll, timestamp: Date.now() });
      newLog = appendLog(newLog, { type: 'message', text: resultText, timestamp: Date.now() });

      return { ...state, log: newLog };
    }

    case 'CHECK_END_OF_TURN_COHERENCY': {
      const coherencyEdition = getEdition(state.editionId);
      if (!coherencyEdition) return state;

      const coherencyRange = coherencyEdition.getCoherencyRange();
      let newState = { ...state };
      let newModels = { ...newState.models };

      for (const unit of Object.values(newState.units)) {
        const activeModelIds = unit.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        if (activeModelIds.length <= 1) continue;

        // Determine min neighbors: 1 for ≤5 models, 2 for >5
        const minNeighbors = activeModelIds.length > 5 ? 2 : 1;

        let check = checkCoherency(activeModelIds, newModels, coherencyRange, minNeighbors);

        // Iteratively remove failing models until coherent
        const removedModelIds: string[] = [];
        let remainingIds = [...activeModelIds];

        while (!check.inCoherency && check.failingModelIds.length > 0 && remainingIds.length > 1) {
          // Remove the first failing model (farthest from coherent group)
          const toRemove = check.failingModelIds[0];
          const model = newModels[toRemove];
          if (model) {
            newModels = {
              ...newModels,
              [toRemove]: { ...model, status: 'destroyed', wounds: 0 },
            };
            removedModelIds.push(toRemove);
          }

          remainingIds = remainingIds.filter(id => id !== toRemove);
          if (remainingIds.length <= 1) break;

          const newMinNeighbors = remainingIds.length > 5 ? 2 : 1;
          check = checkCoherency(remainingIds, newModels, coherencyRange, newMinNeighbors);
        }

        if (removedModelIds.length > 0) {
          const removedNames = removedModelIds.map(id => newModels[id]?.name ?? id).join(', ');
          newState = {
            ...newState,
            log: appendLog(newState.log, {
              type: 'message',
              text: `End-of-turn coherency: ${unit.name} loses ${removedModelIds.length} model(s) (${removedNames})`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      return { ...newState, models: newModels };
    }

    case 'RESOLVE_DESPERATE_ESCAPE': {
      const { unitId, roll, destroyedModelIds } = action.payload;
      const deUnit = state.units[unitId];
      if (!deUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      // Destroy the specified models (1-2 on D6 per model)
      if (destroyedModelIds.length > 0) {
        const newModels = { ...newState.models };
        for (const modelId of destroyedModelIds) {
          const model = newModels[modelId];
          if (model) {
            newModels[modelId] = { ...model, status: 'destroyed', wounds: 0 };
          }
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Desperate Escape: ${deUnit.name} loses ${destroyedModelIds.length} model(s) while Falling Back`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Desperate Escape: ${deUnit.name} successfully Falls Back with no casualties`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    default:
      return null;
  }
};
