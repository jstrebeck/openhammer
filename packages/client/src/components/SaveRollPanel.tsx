import { useGameStore } from '../store/gameStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { parseDiceExpression, resolveSave, resolveFeelNoPain, getWoundAllocationTarget, getAttachedUnitWoundTarget } from '@openhammer/core';
import type { PendingSave, PendingSaveResult, DiceRoll, Model } from '@openhammer/core';

interface SaveRollPanelProps {
  pendingSave: PendingSave;
}

export function SaveRollPanel({ pendingSave }: SaveRollPanelProps) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const playerId = useMultiplayerStore((s) => s.playerId);
  const roomId = useMultiplayerStore((s) => s.roomId);

  const isMultiplayer = !!roomId;
  const isDefender = !isMultiplayer || playerId === pendingSave.defendingPlayerId;

  const targetUnit = gameState.units[pendingSave.targetUnitId];
  const defendingPlayer = Object.values(gameState.players).find(p => p.id === pendingSave.defendingPlayerId);

  const handleRollSaves = () => {
    if (!targetUnit) return;

    const results: PendingSaveResult[] = [];
    let tempModels = { ...gameState.models };

    // Check for attached unit relationships
    // attachedUnits maps leader unit ID → bodyguard unit ID
    const attachedLeaderId = Object.entries(gameState.attachedUnits).find(
      ([, bodyguardId]) => bodyguardId === pendingSave.targetUnitId,
    )?.[0];
    const isBodyguard = !!attachedLeaderId;
    const leaderUnit = attachedLeaderId ? gameState.units[attachedLeaderId] : undefined;

    const bodyguardUnitId = gameState.attachedUnits[pendingSave.targetUnitId];
    const bodyguardUnit = bodyguardUnitId ? gameState.units[bodyguardUnitId] : undefined;

    for (let i = 0; i < pendingSave.wounds; i++) {
      // Find wound allocation target, accounting for attached units
      let target: Model | null = null;

      if (leaderUnit && isBodyguard) {
        // Target unit is the bodyguard — leader absorbs after bodyguard
        target = getAttachedUnitWoundTarget(leaderUnit, targetUnit, tempModels, false);
      } else if (bodyguardUnit) {
        // Target unit is the leader — bodyguard absorbs first
        target = getAttachedUnitWoundTarget(targetUnit, bodyguardUnit, tempModels, false);
      } else {
        const activeUnit = {
          ...targetUnit,
          modelIds: targetUnit.modelIds.filter(id => tempModels[id]?.status === 'active'),
        };
        target = getWoundAllocationTarget(activeUnit, tempModels);
      }
      if (!target) break;

      // Roll save using this model's stats
      const { saveRoll, saved } = resolveSave(
        target.stats.save,
        pendingSave.ap,
        target.stats.invulnSave,
        pendingSave.coverSaveModifier ? { coverSaveModifier: pendingSave.coverSaveModifier } : undefined,
      );

      let damageApplied = 0;
      let fnpRolls: DiceRoll[] | undefined;

      if (!saved) {
        let damage = parseDiceExpression(pendingSave.damage);

        if (pendingSave.fnpThreshold) {
          const fnp = resolveFeelNoPain(damage, pendingSave.fnpThreshold);
          fnpRolls = [fnp.rolls];
          damage = fnp.woundsSuffered;
        }

        damageApplied = damage;

        if (damageApplied > 0) {
          const newWounds = Math.max(0, target.wounds - damageApplied);
          tempModels = {
            ...tempModels,
            [target.id]: {
              ...target,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' as const : 'active' as const,
            },
          };
        }
      }

      results.push({
        targetModelId: target.id,
        saveRoll,
        saved,
        fnpRolls,
        damageApplied,
      });
    }

    dispatch({
      type: 'RESOLVE_PENDING_SAVES',
      payload: { pendingSaveId: pendingSave.id, results },
    });
  };

  // Resolved — show results
  if (pendingSave.resolved && pendingSave.results) {
    const totalDamage = pendingSave.results.reduce((sum, r) => sum + r.damageApplied, 0);
    const savesMade = pendingSave.results.filter(r => r.saved).length;

    return (
      <div className="border border-gray-600 rounded p-3 bg-gray-800/50 space-y-2 mb-2">
        <div className="text-xs font-bold text-gray-200">
          {pendingSave.weaponName} — Saves Resolved
        </div>
        <div className="text-xs text-gray-300">
          {savesMade}/{pendingSave.wounds} saves made, {totalDamage} damage dealt
        </div>
        <div className="space-y-0.5">
          {pendingSave.results.map((r, idx) => {
            const model = gameState.models[r.targetModelId];
            return (
              <div key={idx} className={`text-[11px] ${r.saved ? 'text-green-400' : 'text-red-400'}`}>
                {model?.name ?? 'Model'}: rolled {r.saveRoll.dice[0]} — {r.saved ? 'SAVED' : `${r.damageApplied} damage`}
                {!r.saved && model?.status === 'destroyed' ? ' (DESTROYED)' : ''}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Waiting state for attacker in multiplayer
  if (!isDefender) {
    return (
      <div className="border border-gray-600 rounded p-3 bg-gray-800/50 space-y-2 mb-2">
        <div className="text-xs font-bold text-gray-300">
          Waiting for {defendingPlayer?.name ?? 'opponent'} to roll saves...
        </div>
        <div className="text-xs text-gray-500">
          {pendingSave.weaponName}: {pendingSave.wounds} wound(s), AP{pendingSave.ap}, D{pendingSave.damage}
        </div>
      </div>
    );
  }

  // Defender prompt — roll saves
  const firstActiveModel = targetUnit?.modelIds
    .map(id => gameState.models[id])
    .find(m => m?.status === 'active');

  return (
    <div className="border-2 border-yellow-500 rounded p-3 bg-yellow-900/20 space-y-2 mb-2">
      <div className="text-[10px] text-yellow-400 uppercase tracking-wider font-bold">
        {!isMultiplayer && `${defendingPlayer?.name ?? 'Defender'}: `}Roll saves against {pendingSave.weaponName}
      </div>
      <div className="text-xs text-gray-300">
        {pendingSave.wounds} wound(s) — AP{pendingSave.ap}, D{pendingSave.damage}
        {firstActiveModel && ` — ${targetUnit?.name} (Sv ${firstActiveModel.stats.save}+${firstActiveModel.stats.invulnSave ? `/${firstActiveModel.stats.invulnSave}++` : ''})`}
      </div>
      <button
        onClick={handleRollSaves}
        className="w-full px-3 py-1.5 rounded text-xs font-medium bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
      >
        Roll Saves
      </button>
    </div>
  );
}
