import type { GameState } from '../../types/index';
import { CORE_STRATAGEMS } from '../../types/index';
import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { getEdition } from '../../rules/registry';
import { isUnitInEngagementRange } from '../../combat/shooting';

export const stratagemReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 16: Stratagems =====

    case 'USE_STRATAGEM': {
      const { stratagemId, playerId, targetUnitId } = action.payload;
      const player = state.players[playerId];
      if (!player) return state;

      const detachmentStratagems = state.playerDetachments[playerId]?.stratagems ?? [];
      const stratagem = CORE_STRATAGEMS.find(s => s.id === stratagemId)
        ?? detachmentStratagems.find(s => s.id === stratagemId);
      if (!stratagem) return state;

      // Check: already used this phase?
      if (state.stratagemsUsedThisPhase.includes(stratagemId)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] ${stratagem.name} already used this phase`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: enough CP?
      if (player.commandPoints < stratagem.cpCost) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Not enough CP for ${stratagem.name} (need ${stratagem.cpCost}, have ${player.commandPoints})`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: cannot target Battle-shocked units (except Insane Bravery)
      if (targetUnitId && stratagemId !== 'insane-bravery' && state.battleShocked.includes(targetUnitId)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot use ${stratagem.name} on a Battle-shocked unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Check: Battle-shocked units cannot use stratagems (except Insane Bravery)
      if (targetUnitId && stratagemId !== 'insane-bravery') {
        const targetUnit = state.units[targetUnitId];
        if (targetUnit && targetUnit.playerId === playerId && state.battleShocked.includes(targetUnitId)) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] Battle-shocked units cannot use Stratagems`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Check: valid phase
      const edition = getEdition(state.editionId);
      if (edition) {
        const currentPhase = edition.phases[state.turnState.currentPhaseIndex];
        if (currentPhase && !stratagem.phases.includes(currentPhase.id)) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${stratagem.name} cannot be used during ${currentPhase.name}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Deduct CP and record usage
      let newState: GameState = {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...player, commandPoints: player.commandPoints - stratagem.cpCost },
        },
        stratagemsUsedThisPhase: [...state.stratagemsUsedThisPhase, stratagemId],
        log: appendLog(state.log, {
          type: 'message',
          text: `${player.name} uses ${stratagem.name} (${stratagem.cpCost} CP)${targetUnitId ? ` on ${state.units[targetUnitId]?.name ?? targetUnitId}` : ''}`,
          timestamp: Date.now(),
        }),
      };

      // Apply immediate stratagem effects
      switch (stratagemId) {
        case 'insane-bravery': {
          // Auto-pass Battle-shock — remove from battleShocked
          if (targetUnitId && newState.battleShocked.includes(targetUnitId)) {
            newState = {
              ...newState,
              battleShocked: newState.battleShocked.filter(id => id !== targetUnitId),
              log: appendLog(newState.log, {
                type: 'message',
                text: `${newState.units[targetUnitId]?.name ?? targetUnitId} auto-passes Battle-shock test (Insane Bravery)`,
                timestamp: Date.now(),
              }),
            };
          }
          break;
        }

        case 'counter-offensive': {
          // Insert target unit at front of fight eligible list
          if (targetUnitId && newState.fightState.eligibleUnits.length >= 0) {
            const eligEdition = getEdition(newState.editionId);
            if (eligEdition) {
              const engagementRange = eligEdition.getEngagementRange();
              const targetUnit = newState.units[targetUnitId];
              if (targetUnit && isUnitInEngagementRange(targetUnit, newState, engagementRange)) {
                // Remove from eligible list if already there, then add to front
                const filtered = newState.fightState.eligibleUnits.filter(id => id !== targetUnitId);
                newState = {
                  ...newState,
                  fightState: {
                    ...newState.fightState,
                    eligibleUnits: [targetUnitId, ...filtered],
                    nextToSelect: playerId,
                  },
                };
              }
            }
          }
          break;
        }

        case 'epic-challenge': {
          // Mark unit for Precision on CHARACTER melee attacks until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              stratagemEffects: {
                ...newState.stratagemEffects,
                epicChallengeUnits: [...newState.stratagemEffects.epicChallengeUnits, targetUnitId],
              },
            };
          }
          break;
        }

        case 'smokescreen': {
          // Grant Benefit of Cover and Stealth until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              stratagemEffects: {
                ...newState.stratagemEffects,
                smokescreenUnits: [...newState.stratagemEffects.smokescreenUnits, targetUnitId],
              },
            };
          }
          break;
        }

        case 'go-to-ground': {
          // Grant 6+ invulnerable save and Benefit of Cover until end of phase
          if (targetUnitId) {
            newState = {
              ...newState,
              stratagemEffects: {
                ...newState.stratagemEffects,
                goToGroundUnits: [...newState.stratagemEffects.goToGroundUnits, targetUnitId],
              },
            };
          }
          break;
        }

        case 'rapid-ingress': {
          // Set out-of-phase flag to allow ARRIVE_FROM_RESERVES during opponent's Movement
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'rapid-ingress', playerId },
          };
          break;
        }

        case 'fire-overwatch': {
          // Set out-of-phase flag to allow shooting actions during Movement/Charge
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'fire-overwatch', playerId },
          };
          break;
        }

        case 'heroic-intervention': {
          // Set out-of-phase flag to allow charge move during opponent's Charge
          newState = {
            ...newState,
            outOfPhaseAction: { stratagemId: 'heroic-intervention', playerId },
          };
          break;
        }

        // command-reroll, tank-shock, grenade: resolved via separate actions
        default:
          break;
      }

      return newState;
    }

    // ===== Phase 24: Stratagem Effects =====

    case 'APPLY_COMMAND_REROLL': {
      const { originalRollId, newRoll } = action.payload;

      // Validate the original roll can be re-rolled
      const originalEntry = state.log.entries.find(
        (e) => e.type === 'dice_roll' && e.roll.id === originalRollId,
      );
      if (!originalEntry || originalEntry.type !== 'dice_roll') {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Original roll not found for Command Re-roll`,
            timestamp: Date.now(),
          }),
        };
      }

      if (originalEntry.roll.reRolled) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Cannot re-roll an already re-rolled die (Command Re-roll)`,
            timestamp: Date.now(),
          }),
        };
      }

      // Mark the new roll as a re-roll
      const reRolledDice: import('../../types/index').DiceRoll = { ...newRoll, reRolled: true };

      return {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll',
          roll: reRolledDice,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_TANK_SHOCK': {
      const { unitId, targetUnitId, roll } = action.payload;
      const tsUnit = state.units[unitId];
      const tsTarget = state.units[targetUnitId];
      if (!tsUnit || !tsTarget) return state;

      // Validate VEHICLE keyword
      if (!tsUnit.keywords.includes('VEHICLE')) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Tank Shock requires a VEHICLE unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Count mortal wounds (5+ on each die)
      const mortalWounds = roll.dice.filter(d => d >= 5).length;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds inline (reusing APPLY_MORTAL_WOUNDS logic)
        let newModels = { ...newState.models };
        let remaining = mortalWounds;
        let casualties = 0;

        const activeModelIds = tsTarget.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        const sortedModels = activeModelIds
          .map(id => newModels[id]!)
          .sort((a, b) => a.wounds - b.wounds);

        for (const model of sortedModels) {
          if (remaining <= 0) break;
          const damageToApply = Math.min(remaining, model.wounds);
          const newWounds = model.wounds - damageToApply;
          remaining -= damageToApply;
          if (newWounds === 0) casualties++;

          newModels = {
            ...newModels,
            [model.id]: {
              ...model,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' : 'active',
            },
          };
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Tank Shock: ${tsTarget.name} suffers ${mortalWounds} mortal wound(s)${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Tank Shock: no mortal wounds inflicted on ${tsTarget.name}`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    case 'RESOLVE_GRENADE': {
      const { unitId, targetUnitId, roll } = action.payload;
      const grenadeUnit = state.units[unitId];
      const grenadeTarget = state.units[targetUnitId];
      if (!grenadeUnit || !grenadeTarget) return state;

      // Validate GRENADES keyword
      if (!grenadeUnit.keywords.includes('GRENADES')) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Grenade requires a GRENADES unit`,
            timestamp: Date.now(),
          }),
        };
      }

      // Count mortal wounds (4+ on each die)
      const mortalWounds = roll.dice.filter(d => d >= 4).length;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds inline
        let newModels = { ...newState.models };
        let remaining = mortalWounds;
        let casualties = 0;

        const activeModelIds = grenadeTarget.modelIds.filter(id => {
          const m = newModels[id];
          return m && m.status === 'active';
        });

        const sortedModels = activeModelIds
          .map(id => newModels[id]!)
          .sort((a, b) => a.wounds - b.wounds);

        for (const model of sortedModels) {
          if (remaining <= 0) break;
          const damageToApply = Math.min(remaining, model.wounds);
          const newWounds = model.wounds - damageToApply;
          remaining -= damageToApply;
          if (newWounds === 0) casualties++;

          newModels = {
            ...newModels,
            [model.id]: {
              ...model,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' : 'active',
            },
          };
        }

        newState = {
          ...newState,
          models: newModels,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Grenade: ${grenadeTarget.name} suffers ${mortalWounds} mortal wound(s)${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
            timestamp: Date.now(),
          }),
        };
      } else {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `Grenade: no mortal wounds inflicted on ${grenadeTarget.name}`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    case 'RESOLVE_OVERWATCH': {
      const { attackingUnitId, targetUnitId, hitRoll, hits, woundRoll, wounds } = action.payload;
      const owUnit = state.units[attackingUnitId];
      const owTarget = state.units[targetUnitId];
      if (!owUnit || !owTarget) return state;

      // Validate: only unmodified 6s count as hits
      const validHits = hitRoll.dice.filter(d => d === 6).length;
      const effectiveHits = Math.min(hits, validHits);

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll: hitRoll, timestamp: Date.now() }),
      };

      newState = {
        ...newState,
        log: appendLog(newState.log, {
          type: 'message',
          text: `Fire Overwatch: ${owUnit.name} fires at ${owTarget.name} — ${effectiveHits} hit(s) (only 6s count), ${wounds} wound(s)`,
          timestamp: Date.now(),
        }),
      };

      if (woundRoll.dice.length > 0) {
        newState = {
          ...newState,
          log: appendLog(newState.log, { type: 'dice_roll', roll: woundRoll, timestamp: Date.now() }),
        };
      }

      // Clear out-of-phase action after overwatch resolves
      newState = { ...newState, outOfPhaseAction: undefined };

      return newState;
    }

    case 'RESOLVE_HEROIC_INTERVENTION': {
      const { unitId, targetUnitId, positions } = action.payload;
      const hiUnit = state.units[unitId];
      const hiTarget = state.units[targetUnitId];
      if (!hiUnit || !hiTarget) return state;

      // Apply positions (charge move)
      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      // Track as a charge
      const newState: GameState = {
        ...state,
        models: newModels,
        turnTracking: {
          ...state.turnTracking,
          chargedUnits: [...state.turnTracking.chargedUnits, unitId],
        },
        // Clear out-of-phase action
        outOfPhaseAction: undefined,
        log: appendLog(state.log, {
          type: 'message',
          text: `Heroic Intervention: ${hiUnit.name} charges ${hiTarget.name}`,
          timestamp: Date.now(),
        }),
      };

      return newState;
    }

    // ===== Phase 26: Persisting Effects =====

    case 'ADD_PERSISTING_EFFECT': {
      const { effect } = action.payload;
      return {
        ...state,
        persistingEffects: [...state.persistingEffects, effect],
        log: appendLog(state.log, {
          type: 'message',
          text: `Effect added: ${effect.type} on ${state.units[effect.targetUnitId]?.name ?? effect.targetUnitId}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'REMOVE_PERSISTING_EFFECT': {
      const { effectId } = action.payload;
      const removed = state.persistingEffects.find(e => e.id === effectId);
      return {
        ...state,
        persistingEffects: state.persistingEffects.filter(e => e.id !== effectId),
        log: appendLog(state.log, {
          type: 'message',
          text: `Effect removed: ${removed?.type ?? effectId}`,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
