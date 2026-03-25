import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import type { PendingSave, AttackSequence } from '../../types/index';

export const pendingSavesReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'RESOLVE_PENDING_SAVES': {
      const { pendingSaveId, results } = action.payload;

      // Search both shooting and fight states for the pending save
      let phase: 'shooting' | 'fight' | null = null;
      let pendingSave: PendingSave | undefined;

      pendingSave = state.shootingState.pendingSaves.find(ps => ps.id === pendingSaveId);
      if (pendingSave) {
        phase = 'shooting';
      } else {
        pendingSave = state.fightState.pendingSaves.find(ps => ps.id === pendingSaveId);
        if (pendingSave) phase = 'fight';
      }

      if (!pendingSave || !phase) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Pending save ${pendingSaveId} not found`,
            timestamp: Date.now(),
          }),
        };
      }

      if (pendingSave.resolved) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: '[BLOCKED] Pending save already resolved',
            timestamp: Date.now(),
          }),
        };
      }

      // Apply damage for each failed save
      let newModels = { ...state.models };
      const logEntries: string[] = [];

      for (const result of results) {
        if (!result.saved && result.damageApplied > 0) {
          const model = newModels[result.targetModelId];
          if (model && model.status === 'active') {
            const newWounds = Math.max(0, model.wounds - result.damageApplied);
            newModels = {
              ...newModels,
              [result.targetModelId]: {
                ...model,
                wounds: newWounds,
                status: newWounds === 0 ? 'destroyed' : 'active',
              },
            };
            const destroyed = newWounds === 0 ? ' — DESTROYED' : ` (${newWounds}W remaining)`;
            logEntries.push(`${model.name} takes ${result.damageApplied} damage${destroyed}`);
          }
        }
      }

      // Apply mortal wounds (subject to FNP)
      if (pendingSave.mortalWounds > 0) {
        const targetUnit = state.units[pendingSave.targetUnitId];
        if (targetUnit) {
          let remainingMortals = pendingSave.mortalWounds;

          if (pendingSave.fnpThreshold) {
            let blocked = 0;
            for (let i = 0; i < pendingSave.mortalWounds; i++) {
              const roll = Math.ceil(Math.random() * 6);
              if (roll >= pendingSave.fnpThreshold) blocked++;
            }
            remainingMortals -= blocked;
            if (blocked > 0) {
              logEntries.push(`Feel No Pain blocked ${blocked} of ${pendingSave.mortalWounds} mortal wound(s)`);
            }
          }

          // Get active models sorted by wounds remaining (lowest first for spill)
          const activeModelIds = targetUnit.modelIds.filter(id => {
            const m = newModels[id];
            return m && m.status === 'active';
          });

          const sortedModels = activeModelIds
            .map(id => newModels[id]!)
            .sort((a, b) => a.wounds - b.wounds);

          for (const model of sortedModels) {
            if (remainingMortals <= 0) break;
            const dmg = Math.min(remainingMortals, model.wounds);
            const newWounds = model.wounds - dmg;
            remainingMortals -= dmg;
            newModels = {
              ...newModels,
              [model.id]: {
                ...model,
                wounds: Math.max(0, newWounds),
                status: newWounds <= 0 ? 'destroyed' : 'active',
              },
            };
          }
          logEntries.push(`${pendingSave.mortalWounds} mortal wound(s) applied to ${targetUnit.name}`);
        }
      }

      // Mark the PendingSave as resolved with results
      const updatedPendingSave: PendingSave = { ...pendingSave, resolved: true, results };

      // Update linked AttackSequence: mark resolved and populate woundAllocations
      const updateAttacks = (attacks: AttackSequence[]) =>
        attacks.map(a =>
          a.id === pendingSave!.attackSequenceId
            ? {
                ...a,
                resolved: true,
                woundAllocations: results.map(r => ({
                  modelId: r.targetModelId,
                  saveRoll: r.saveRoll,
                  saved: r.saved,
                  damageApplied: r.damageApplied,
                })),
              }
            : a,
        );

      // Build log with dice rolls and damage messages
      let newLog = state.log;
      for (const result of results) {
        newLog = appendLog(newLog, { type: 'dice_roll', roll: result.saveRoll, timestamp: Date.now() });
      }
      for (const msg of logEntries) {
        newLog = appendLog(newLog, { type: 'message', text: msg, timestamp: Date.now() });
      }

      if (phase === 'shooting') {
        return {
          ...state,
          models: newModels,
          shootingState: {
            ...state.shootingState,
            pendingSaves: state.shootingState.pendingSaves.map(ps =>
              ps.id === pendingSaveId ? updatedPendingSave : ps,
            ),
            activeAttacks: updateAttacks(state.shootingState.activeAttacks),
          },
          log: newLog,
        };
      } else {
        return {
          ...state,
          models: newModels,
          fightState: {
            ...state.fightState,
            pendingSaves: state.fightState.pendingSaves.map(ps =>
              ps.id === pendingSaveId ? updatedPendingSave : ps,
            ),
            activeAttacks: updateAttacks(state.fightState.activeAttacks),
          },
          log: newLog,
        };
      }
    }

    default:
      return null;
  }
};
