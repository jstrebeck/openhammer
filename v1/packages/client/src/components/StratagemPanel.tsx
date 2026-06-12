import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getEdition, CORE_STRATAGEMS } from '@openhammer/core';
import type { Stratagem } from '@openhammer/core';

export function StratagemPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const [expanded, setExpanded] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const edition = getEdition(gameState.editionId);
  const currentPhase = edition?.phases[gameState.turnState.currentPhaseIndex];
  const activePlayerId = gameState.turnState.activePlayerId;
  const activePlayer = gameState.players[activePlayerId];

  if (!activePlayer || !currentPhase) return null;

  // Filter stratagems available in this phase (core + detachment)
  const detachmentStratagems = gameState.playerDetachments[activePlayerId]?.stratagems ?? [];
  const allStratagems = [...CORE_STRATAGEMS, ...detachmentStratagems];
  const available = allStratagems.filter((s) => s.phases.includes(currentPhase.id));
  const alreadyUsed = new Set(gameState.stratagemsUsedThisPhase);

  const handleUse = (stratagem: Stratagem) => {
    dispatch({
      type: 'USE_STRATAGEM',
      payload: {
        stratagemId: stratagem.id,
        playerId: activePlayerId,
        targetUnitId: selectedTarget ?? undefined,
      },
    });
    setSelectedTarget(null);
  };

  const friendlyUnits = Object.values(gameState.units).filter(
    (u) => u.playerId === activePlayerId && u.modelIds.some((id) => gameState.models[id]?.status === 'active'),
  );

  if (available.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left flex items-center justify-between"
      >
        <span>Stratagems ({activePlayer.commandPoints} CP)</span>
        <span className="text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="p-2 space-y-1.5 max-h-60 overflow-y-auto">
          {/* Target selector */}
          <div>
            <select
              value={selectedTarget ?? ''}
              onChange={(e) => setSelectedTarget(e.target.value || null)}
              className="w-full bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none"
            >
              <option value="">No target unit</option>
              {friendlyUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {available.map((strat) => {
            const used = alreadyUsed.has(strat.id);
            const canAfford = activePlayer.commandPoints >= strat.cpCost;
            const disabled = used || !canAfford;

            return (
              <button
                key={strat.id}
                onClick={() => !disabled && handleUse(strat)}
                disabled={disabled}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  disabled
                    ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-700/60 text-gray-300 hover:bg-indigo-600 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{strat.name}</span>
                  <span className={`text-[10px] px-1 rounded ${canAfford ? 'bg-yellow-600 text-white' : 'bg-gray-600 text-gray-400'}`}>
                    {strat.cpCost} CP
                  </span>
                </div>
                <div className="text-[10px] opacity-60 mt-0.5">{strat.description}</div>
                {used && <div className="text-[10px] text-red-400 mt-0.5">Already used this phase</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
