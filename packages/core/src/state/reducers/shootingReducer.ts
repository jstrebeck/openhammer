import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { getEdition } from '../../rules/registry';
import { distanceBetweenModels } from '../../measurement/index';
import {
  isUnitInEngagementRange,
  getEngagementShootingMode,
  weaponHasAbility,
} from '../../combat/index';

export const shootingReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'DECLARE_SHOOTING': {
      const { unitId } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Check shooting eligibility based on movement
      const edition = getEdition(state.editionId);
      if (edition) {
        const moveType = state.turnTracking.unitMovement[unitId];
        const eligibility = edition.canUnitShoot(moveType);
        if (!eligibility.allowed) {
          if (state.rulesConfig.phaseRestrictions === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] ${eligibility.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
          if (state.rulesConfig.phaseRestrictions === 'warn') {
            state = {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[WARNING] ${eligibility.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
        }

        // Check engagement range shooting (Big Guns Never Tire / Pistols)
        const engagementRange = edition.getEngagementRange();
        if (isUnitInEngagementRange(unit, state, engagementRange)) {
          const shootingMode = getEngagementShootingMode(unit);
          if (shootingMode === 'none') {
            if (state.rulesConfig.phaseRestrictions === 'enforce') {
              return {
                ...state,
                log: appendLog(state.log, {
                  type: 'message',
                  text: `[BLOCKED] ${unit.name} is in Engagement Range and has no Pistol weapons or MONSTER/VEHICLE keyword`,
                  timestamp: Date.now(),
                }),
              };
            }
          }
        }
      }

      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          activeShootingUnit: unitId,
          weaponAssignments: [],
          activeAttacks: [],
        },
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { ...state.turnTracking.unitsActivated, [unitId]: true },
        },
      };
    }

    case 'ASSIGN_WEAPON_TARGETS': {
      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          weaponAssignments: action.payload.assignments,
        },
      };
    }

    case 'RESOLVE_SHOOTING_ATTACK': {
      const { attackingUnitId, attackingModelId, weaponId, weaponName, targetUnitId, numAttacks, hitRoll, hits, woundRoll, wounds } = action.payload;

      // One Shot validation: check if this weapon was already fired this battle
      const oneShotKey = `${attackingUnitId}:${weaponId}`;
      const attackingUnit = state.units[attackingUnitId];
      if (attackingUnit) {
        const weapon = attackingUnit.weapons.find(w => w.id === weaponId);
        if (weapon && weaponHasAbility(weapon, 'ONE SHOT') && state.weaponsFired[oneShotKey]) {
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${weaponName} has ONE SHOT and has already been fired this battle`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      const attack: import('../../types/index').AttackSequence = {
        id: crypto.randomUUID(),
        attackingUnitId,
        attackingModelId,
        weaponId,
        weaponName,
        targetUnitId,
        numAttacks,
        hitRoll,
        hits,
        woundRoll,
        wounds,
        woundAllocations: [],
        resolved: false,
      };

      // Track One Shot weapons
      let newWeaponsFired = state.weaponsFired;
      if (attackingUnit) {
        const weapon = attackingUnit.weapons.find(w => w.id === weaponId);
        if (weapon && weaponHasAbility(weapon, 'ONE SHOT')) {
          newWeaponsFired = { ...state.weaponsFired, [oneShotKey]: true };
        }
      }

      return {
        ...state,
        weaponsFired: newWeaponsFired,
        shootingState: {
          ...state.shootingState,
          activeAttacks: [...state.shootingState.activeAttacks, attack],
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName}: ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_SAVE_ROLL': {
      const { targetModelId, saveRoll, saved, damageToApply } = action.payload;
      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll: saveRoll, timestamp: Date.now() }),
      };

      if (!saved && damageToApply > 0) {
        // Apply damage to the target model
        newState = shootingReducer(newState, {
          type: 'APPLY_DAMAGE',
          payload: { modelId: targetModelId, damage: damageToApply, source: 'shooting' },
        }) ?? newState;
      }

      return newState;
    }

    case 'APPLY_DAMAGE': {
      const { modelId, damage, source } = action.payload;
      const model = state.models[modelId];
      if (!model || model.status === 'destroyed') return state;

      const newWounds = Math.max(0, model.wounds - damage);
      return {
        ...state,
        models: {
          ...state.models,
          [modelId]: {
            ...model,
            wounds: newWounds,
            status: newWounds === 0 ? 'destroyed' : 'active',
          },
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${model.name} takes ${damage} damage from ${source}${newWounds === 0 ? ' — DESTROYED' : ` (${newWounds}W remaining)`}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'COMPLETE_SHOOTING': {
      const { unitId } = action.payload;
      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          activeShootingUnit: null,
          weaponAssignments: [],
          activeAttacks: [],
          unitsShot: [...state.shootingState.unitsShot, unitId],
        },
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }

    case 'RESOLVE_HAZARDOUS': {
      const { unitId, weaponId, rolls, destroyedModelIds } = action.payload;
      const hazUnit = state.units[unitId];
      if (!hazUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll' as const,
          roll: rolls,
          timestamp: Date.now(),
        }),
      };

      // Destroy models that rolled 1
      for (const modelId of destroyedModelIds) {
        newState = shootingReducer(newState, {
          type: 'APPLY_DAMAGE',
          payload: { modelId, damage: 9999, source: `Hazardous (${hazUnit.weapons.find(w => w.id === weaponId)?.name ?? 'weapon'})` },
        }) ?? newState;
      }

      return newState;
    }

    case 'APPLY_MORTAL_WOUNDS': {
      const { targetUnitId, mortalWounds, source } = action.payload;
      const unit = state.units[targetUnitId];
      if (!unit) return state;

      let newState = { ...state };
      let newModels = { ...newState.models };
      let remaining = mortalWounds;
      let casualties = 0;

      // Get active models sorted by wounds remaining (lowest first = allocate to most damaged)
      const activeModelIds = unit.modelIds.filter(id => {
        const m = newModels[id];
        return m && m.status === 'active';
      });

      // Sort by wounds remaining (ascending) so damage spills efficiently
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

      return {
        ...newState,
        models: newModels,
        log: appendLog(newState.log, {
          type: 'message',
          text: `${unit.name} suffers ${mortalWounds} mortal wound(s) from ${source}${casualties > 0 ? ` — ${casualties} model(s) destroyed` : ''}`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_DEADLY_DEMISE': {
      const { unitId, roll, mortalWounds } = action.payload;
      const ddUnit = state.units[unitId];
      if (!ddUnit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, {
          type: 'dice_roll' as const,
          roll,
          timestamp: Date.now(),
        }),
      };

      if (mortalWounds > 0) {
        // Apply mortal wounds to all enemy units within 6" of the destroyed unit's models
        const ddModels = ddUnit.modelIds
          .map(id => state.models[id])
          .filter(m => m != null);

        for (const otherUnit of Object.values(state.units)) {
          if (otherUnit.playerId === ddUnit.playerId) continue;
          const otherModels = otherUnit.modelIds
            .map(id => state.models[id])
            .filter(m => m && m.status === 'active');
          if (otherModels.length === 0) continue;

          // Check if any model of this unit is within 6" of any model of the destroyed unit
          const within6 = otherModels.some(om =>
            ddModels.some(dm => distanceBetweenModels(dm, om) <= 6)
          );

          if (within6) {
            newState = shootingReducer(newState, {
              type: 'APPLY_MORTAL_WOUNDS',
              payload: { targetUnitId: otherUnit.id, mortalWounds, source: `Deadly Demise (${ddUnit.name})` },
            }) ?? newState;
          }
        }
      }

      return newState;
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
