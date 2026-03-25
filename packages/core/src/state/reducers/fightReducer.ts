import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import { generateUUID } from '../../utils/uuid';
import { getEdition } from '../../rules/registry';
import { distance, distanceBetweenModels, checkCoherency, closestEnemyModel } from '../../measurement/index';
import type { GameState } from '../../types/index';
import type { Point } from '../../types/geometry';
import type { RulesEdition } from '../../rules/RulesEdition';
import { getUnitAbilityValue } from '../../combat/abilities';

/** Validate a Pile In move: each model must end closer to closest enemy, max 3", coherency */
function validatePileIn(
  state: GameState,
  unitId: string,
  newPositions: Record<string, Point>,
  edition: RulesEdition,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const coherencyRange = edition.getCoherencyRange();
  const PILE_IN_DISTANCE = 3;

  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    // Max 3" move
    const distMoved = distance(model.position, newPos);
    if (distMoved > PILE_IN_DISTANCE + 0.01) {
      errors.push(`${model.name} pile-in moved ${distMoved.toFixed(1)}" but max is ${PILE_IN_DISTANCE}"`);
    }

    // Must end closer to the closest enemy model
    const closestBefore = closestEnemyModel(model.position, unit.playerId, state.models, state.units);
    const closestAfter = closestEnemyModel(newPos, unit.playerId, state.models, state.units);
    if (closestBefore && closestAfter && distMoved > 0.01) {
      if (closestAfter.distance >= closestBefore.distance - 0.01) {
        errors.push(`${model.name} must end closer to the closest enemy model after pile-in`);
      }
    }
  }

  // Coherency after pile-in
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    const tempModels: Record<string, import('../../types/index').Model> = {};
    for (const mid of activeModelIds) {
      const m = state.models[mid];
      if (m) {
        tempModels[mid] = newPositions[mid] ? { ...m, position: newPositions[mid] } : m;
      }
    }
    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, tempModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency after pile-in`);
    }
  }

  return errors;
}

/** Validate a Consolidate move: same as pile-in but with objective marker fallback */
function validateConsolidate(
  state: GameState,
  unitId: string,
  newPositions: Record<string, Point>,
  edition: RulesEdition,
): string[] {
  const errors: string[] = [];
  const unit = state.units[unitId];
  if (!unit) return ['Unit not found'];

  const coherencyRange = edition.getCoherencyRange();
  const CONSOLIDATE_DISTANCE = 3;

  for (const modelId of unit.modelIds) {
    const model = state.models[modelId];
    if (!model || model.status === 'destroyed') continue;
    const newPos = newPositions[modelId];
    if (!newPos) continue;

    // Max 3" move
    const distMoved = distance(model.position, newPos);
    if (distMoved > CONSOLIDATE_DISTANCE + 0.01) {
      errors.push(`${model.name} consolidate moved ${distMoved.toFixed(1)}" but max is ${CONSOLIDATE_DISTANCE}"`);
    }

    if (distMoved < 0.01) continue; // No movement, skip direction check

    // Must end closer to closest enemy OR nearest objective
    const closestBefore = closestEnemyModel(model.position, unit.playerId, state.models, state.units);
    const closestAfter = closestEnemyModel(newPos, unit.playerId, state.models, state.units);
    const hasObjectives = Object.keys(state.objectives).length > 0;

    // If no enemies and no objectives, only enforce distance (no direction constraint)
    if (!closestBefore && !hasObjectives) continue;

    let movedCloserToEnemy = false;
    if (closestBefore && closestAfter) {
      movedCloserToEnemy = closestAfter.distance < closestBefore.distance - 0.01;
    }

    let movedCloserToObjective = false;
    if (!movedCloserToEnemy) {
      for (const obj of Object.values(state.objectives)) {
        const distBefore = distance(model.position, obj.position);
        const distAfter = distance(newPos, obj.position);
        if (distAfter < distBefore - 0.01) {
          movedCloserToObjective = true;
          break;
        }
      }
    }

    if (!movedCloserToEnemy && !movedCloserToObjective) {
      errors.push(`${model.name} must consolidate closer to an enemy model or objective marker`);
    }
  }

  // Coherency after consolidate
  const activeModelIds = unit.modelIds.filter(id => {
    const m = state.models[id];
    return m && m.status === 'active';
  });

  if (activeModelIds.length > 1) {
    const tempModels: Record<string, import('../../types/index').Model> = {};
    for (const mid of activeModelIds) {
      const m = state.models[mid];
      if (m) {
        tempModels[mid] = newPositions[mid] ? { ...m, position: newPositions[mid] } : m;
      }
    }
    const minNeighbors = edition.getCoherencyMinModels(activeModelIds.length);
    const coherency = checkCoherency(activeModelIds, tempModels, coherencyRange, minNeighbors);
    if (!coherency.inCoherency) {
      errors.push(`Unit would lose coherency after consolidate`);
    }
  }

  return errors;
}

/** Check if a melee target is valid: within Engagement Range or reachable via friendly base-to-base chain */
function isValidMeleeTarget(
  state: GameState,
  attackingUnitId: string,
  targetUnitId: string,
  edition: RulesEdition,
): { valid: boolean; reason?: string } {
  const attackingUnit = state.units[attackingUnitId];
  const targetUnit = state.units[targetUnitId];
  if (!attackingUnit || !targetUnit) return { valid: false, reason: 'Unit not found' };
  if (attackingUnit.playerId === targetUnit.playerId) return { valid: false, reason: 'Cannot attack friendly units' };

  const engagementRange = edition.getEngagementRange();
  const attackerModels = attackingUnit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');
  const targetModels = targetUnit.modelIds
    .map(id => state.models[id])
    .filter(m => m && m.status === 'active');

  if (attackerModels.length === 0 || targetModels.length === 0) {
    return { valid: false, reason: 'No active models' };
  }

  // Direct check: any attacker model within Engagement Range of any target model
  const directContact = attackerModels.some(am =>
    targetModels.some(tm => distanceBetweenModels(am, tm) <= engagementRange)
  );
  if (directContact) return { valid: true };

  // Base-to-base chain: can we reach the target through a chain of friendly models
  // in base-to-base contact?
  const BASE_CONTACT_THRESHOLD = 0.5; // within 0.5" counts as base-to-base

  // BFS from attacker models through friendly models in base-to-base contact
  const visited = new Set<string>();
  const queue: string[] = attackerModels.map(m => m.id);
  for (const id of queue) visited.add(id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = state.models[currentId];
    if (!current) continue;

    // Check if this model is in base-to-base with any target model
    if (targetModels.some(tm => distanceBetweenModels(current, tm) <= BASE_CONTACT_THRESHOLD)) {
      return { valid: true };
    }

    // Find friendly models in base-to-base contact
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      if (visited.has(otherModel.id)) continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit || otherUnit.playerId !== attackingUnit.playerId) continue;

      if (distanceBetweenModels(current, otherModel) <= BASE_CONTACT_THRESHOLD) {
        visited.add(otherModel.id);
        queue.push(otherModel.id);
      }
    }
  }

  return { valid: false, reason: `Target ${targetUnit.name} not in Engagement Range or reachable via base-to-base chain` };
}

export const fightReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 11: Fight =====

    case 'INITIALIZE_FIGHT_PHASE': {
      // Determine eligible units and fight order
      const edition = getEdition(state.editionId);
      if (!edition) return state;
      const engagementRange = edition.getEngagementRange();

      // Find all units within engagement range of enemies
      const eligibleUnits: string[] = [];
      const allModels = Object.values(state.models).filter(m => m.status === 'active');

      for (const unit of Object.values(state.units)) {
        const unitModels = unit.modelIds
          .map(id => state.models[id])
          .filter(m => m && m.status === 'active');
        if (unitModels.length === 0) continue;

        // Check if any model in this unit is within engagement range of an enemy model
        const isInEngagement = unitModels.some(um =>
          allModels.some(em => {
            if (!em) return false;
            const enemyUnit = state.units[em.unitId];
            if (!enemyUnit || enemyUnit.playerId === unit.playerId) return false;
            return distanceBetweenModels(um, em) <= engagementRange;
          })
        );

        if (isInEngagement) {
          eligibleUnits.push(unit.id);
        }
      }

      // Separate Fights First (charged this turn) from remaining
      const fightsFirstUnits = eligibleUnits.filter(id => state.turnTracking.chargedUnits.includes(id));
      const remainingUnits = eligibleUnits.filter(id => !state.turnTracking.chargedUnits.includes(id));

      // Non-active player selects first
      const playerIds = Object.keys(state.players);
      const activePlayerId = state.turnState.activePlayerId;
      const nonActivePlayerId = playerIds.find(id => id !== activePlayerId) ?? activePlayerId;

      return {
        ...state,
        fightState: {
          fightStep: fightsFirstUnits.length > 0 ? 'fights_first' : 'remaining',
          eligibleUnits: fightsFirstUnits.length > 0 ? fightsFirstUnits : remainingUnits,
          currentFighter: null,
          unitsFought: [],
          nextToSelect: nonActivePlayerId,
          activeAttacks: [],
          pendingSaves: [],
        },
      };
    }

    case 'SELECT_UNIT_TO_FIGHT': {
      const { unitId } = action.payload;
      if (!state.units[unitId]) return state;
      if (!state.fightState.eligibleUnits.includes(unitId)) return state;

      // Alternate who selects next
      const playerIds = Object.keys(state.players);
      const currentSelector = state.fightState.nextToSelect;
      const nextSelector = playerIds.find(id => id !== currentSelector) ?? currentSelector;

      return {
        ...state,
        fightState: {
          ...state.fightState,
          currentFighter: unitId,
          eligibleUnits: state.fightState.eligibleUnits.filter(id => id !== unitId),
          nextToSelect: nextSelector,
          activeAttacks: [],
        },
      };
    }

    case 'PILE_IN': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Validate pile-in if enforcement is on
      const pileInEdition = getEdition(state.editionId);
      if (pileInEdition && state.rulesConfig.movementRange !== 'off') {
        const errors = validatePileIn(state, unitId, positions, pileInEdition);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Pile-in invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Pile-in: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      return {
        ...state,
        models: newModels,
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} piles in`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'RESOLVE_MELEE_ATTACK': {
      const { attackingUnitId, attackingModelId, weaponId, weaponName, targetUnitId, numAttacks, hitRoll, hits, woundRoll, wounds } = action.payload;

      // Validate melee target eligibility
      const meleeEdition = getEdition(state.editionId);
      if (meleeEdition && state.rulesConfig.phaseRestrictions !== 'off') {
        const meleeCheck = isValidMeleeTarget(state, attackingUnitId, targetUnitId, meleeEdition);
        if (!meleeCheck.valid) {
          if (state.rulesConfig.phaseRestrictions === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Melee target invalid: ${meleeCheck.reason}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Melee target: ${meleeCheck.reason}`,
              timestamp: Date.now(),
            }),
          };
        }
      }
      const attack: import('../../types/index').AttackSequence = {
        id: generateUUID(),
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

      // Create PendingSave if there are wounds to save against
      const meleeUnit = state.units[attackingUnitId];
      let newPendingSaves = state.fightState.pendingSaves;
      if (wounds > 0) {
        const weapon = meleeUnit?.weapons.find(w => w.id === weaponId);
        const targetUnit = state.units[targetUnitId];

        let fnpThreshold: number | undefined;
        if (targetUnit) {
          const fnpValue = getUnitAbilityValue(targetUnit, 'FEEL NO PAIN');
          if (fnpValue !== undefined) fnpThreshold = fnpValue;
        }

        newPendingSaves = [...state.fightState.pendingSaves, {
          id: generateUUID(),
          attackSequenceId: attack.id,
          attackingPlayerId: meleeUnit?.playerId ?? '',
          defendingPlayerId: targetUnit?.playerId ?? '',
          targetUnitId,
          weaponName,
          wounds,
          ap: weapon?.ap ?? 0,
          damage: weapon?.damage ?? '1',
          fnpThreshold,
          mortalWounds: 0,
          resolved: false,
        }];
      }

      return {
        ...state,
        fightState: {
          ...state.fightState,
          activeAttacks: [...state.fightState.activeAttacks, attack],
          pendingSaves: newPendingSaves,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName} (melee): ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'CONSOLIDATE': {
      const { unitId, positions } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      // Validate consolidate if enforcement is on
      const consolEdition = getEdition(state.editionId);
      if (consolEdition && state.rulesConfig.movementRange !== 'off') {
        const errors = validateConsolidate(state, unitId, positions, consolEdition);
        if (errors.length > 0) {
          if (state.rulesConfig.movementRange === 'enforce') {
            return {
              ...state,
              log: appendLog(state.log, {
                type: 'message',
                text: `[BLOCKED] Consolidate invalid: ${errors.join('; ')}`,
                timestamp: Date.now(),
              }),
            };
          }
          state = {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[WARNING] Consolidate: ${errors.join('; ')}`,
              timestamp: Date.now(),
            }),
          };
        }
      }

      const newModels = { ...state.models };
      for (const [modelId, pos] of Object.entries(positions)) {
        const model = newModels[modelId];
        if (model) {
          newModels[modelId] = { ...model, position: pos };
        }
      }

      return {
        ...state,
        models: newModels,
        log: appendLog(state.log, {
          type: 'message',
          text: `${unit.name} consolidates`,
          timestamp: Date.now(),
        }),
      };
    }

    case 'COMPLETE_FIGHT': {
      const { unitId } = action.payload;

      // Block if there are unresolved pending saves
      const hasUnresolvedSaves = state.fightState.pendingSaves.some(ps => !ps.resolved);
      if (hasUnresolvedSaves) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: '[BLOCKED] Cannot complete fight — pending saves must be resolved first',
            timestamp: Date.now(),
          }),
        };
      }

      const newUnitsFought = [...state.fightState.unitsFought, unitId];

      // Check if we need to transition from fights_first to remaining
      let newFightState = {
        ...state.fightState,
        currentFighter: null,
        unitsFought: newUnitsFought,
        activeAttacks: [],
        pendingSaves: [] as import('../../types/index').PendingSave[],
      };

      if (newFightState.eligibleUnits.length === 0 && newFightState.fightStep === 'fights_first') {
        // Transition to remaining combats
        const edition = getEdition(state.editionId);
        if (edition) {
          const engagementRange = edition.getEngagementRange();
          const allModels = Object.values(state.models).filter(m => m.status === 'active');

          // Find units in engagement range that haven't fought
          const remainingEligible: string[] = [];
          for (const unit of Object.values(state.units)) {
            if (newUnitsFought.includes(unit.id)) continue;
            const unitModels = unit.modelIds
              .map(id => state.models[id])
              .filter(m => m && m.status === 'active');
            if (unitModels.length === 0) continue;

            const isInEngagement = unitModels.some(um =>
              allModels.some(em => {
                if (!em) return false;
                const enemyUnit = state.units[em.unitId];
                if (!enemyUnit || enemyUnit.playerId === unit.playerId) return false;
                return distanceBetweenModels(um, em) <= engagementRange;
              })
            );

            if (isInEngagement) {
              remainingEligible.push(unit.id);
            }
          }

          newFightState = {
            ...newFightState,
            fightStep: 'remaining',
            eligibleUnits: remainingEligible,
          };
        }
      }

      return {
        ...state,
        fightState: newFightState,
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
