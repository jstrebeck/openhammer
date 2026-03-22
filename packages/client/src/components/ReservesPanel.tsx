import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

const reserveTypeLabels: Record<string, string> = {
  strategic: 'Strategic Reserves',
  deep_strike: 'Deep Strike',
  aircraft: 'Aircraft',
};

export function ReservesPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const [expanded, setExpanded] = useState(false);

  const reserveEntries = Object.values(gameState.reserves);
  if (reserveEntries.length === 0) return null;

  const roundNumber = gameState.turnState.roundNumber;

  const handleArrive = (unitId: string) => {
    // Dispatch with empty positions — the reducer or a follow-up action handles placement
    dispatch({
      type: 'ARRIVE_FROM_RESERVES',
      payload: { unitId, positions: {} },
    });
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left flex items-center justify-between"
      >
        <span>Reserves ({reserveEntries.length})</span>
        <span className="text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="p-2 space-y-1.5 max-h-48 overflow-y-auto">
          {reserveEntries.map((entry) => {
            const unit = gameState.units[entry.unitId];
            if (!unit) return null;

            const canArrive = roundNumber >= entry.availableFromRound;
            const player = gameState.players[unit.playerId];

            return (
              <div
                key={entry.unitId}
                className="bg-gray-700/40 rounded px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {player && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: player.color }}
                      />
                    )}
                    <span className="text-gray-300 truncate">{unit.name}</span>
                  </div>
                  {canArrive && (
                    <button
                      onClick={() => handleArrive(entry.unitId)}
                      className="ml-2 px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white text-[10px] font-medium flex-shrink-0 transition-colors"
                    >
                      Arrive
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-500">
                    {reserveTypeLabels[entry.type] ?? entry.type}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {canArrive
                      ? 'Available now'
                      : `Available Round ${entry.availableFromRound}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
