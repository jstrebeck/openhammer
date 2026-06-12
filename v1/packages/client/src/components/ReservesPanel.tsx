import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { DeepStrikeArrival } from './DeepStrikeArrival';
import type { ReserveEntry } from '@openhammer/core';

const reserveTypeLabels: Record<string, string> = {
  strategic: 'Strategic Reserves',
  deep_strike: 'Deep Strike',
  aircraft: 'Aircraft',
};

const reserveTypeColors: Record<string, string> = {
  strategic: 'bg-blue-900/40 border-blue-700/50',
  deep_strike: 'bg-purple-900/40 border-purple-700/50',
  aircraft: 'bg-cyan-900/40 border-cyan-700/50',
};

export function ReservesPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const [expanded, setExpanded] = useState(false);
  const [arrivingUnitId, setArrivingUnitId] = useState<string | null>(null);

  const reserveEntries = Object.values(gameState.reserves);
  if (reserveEntries.length === 0) return null;

  const roundNumber = gameState.turnState.roundNumber;

  // If a unit is arriving, show the placement UI
  const arrivingEntry = arrivingUnitId ? gameState.reserves[arrivingUnitId] : null;

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
        <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto">
          {/* Active arrival placement */}
          {arrivingUnitId && arrivingEntry && (
            <DeepStrikeArrival
              unitId={arrivingUnitId}
              reserveEntry={arrivingEntry}
              onClose={() => setArrivingUnitId(null)}
            />
          )}

          {/* Reserve entries list */}
          {reserveEntries.map((entry) => {
            const unit = gameState.units[entry.unitId];
            if (!unit) return null;

            const canArrive = roundNumber >= entry.availableFromRound;
            const player = gameState.players[unit.playerId];
            const isArriving = arrivingUnitId === entry.unitId;
            const modelCount = unit.modelIds.filter(id =>
              gameState.models[id]?.status === 'active',
            ).length;
            const colorClass = reserveTypeColors[entry.type] ?? 'bg-gray-700/40';

            return (
              <div
                key={entry.unitId}
                className={`rounded px-2 py-1.5 text-xs border ${
                  isArriving ? 'border-yellow-500/50 bg-yellow-900/20' : colorClass
                }`}
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
                    <span className="text-[10px] text-gray-500">({modelCount})</span>
                  </div>
                  {canArrive && !isArriving && (
                    <button
                      onClick={() => setArrivingUnitId(entry.unitId)}
                      className="ml-2 px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white text-[10px] font-medium flex-shrink-0 transition-colors"
                    >
                      Arrive
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] ${
                    entry.type === 'deep_strike' ? 'text-purple-400' :
                    entry.type === 'aircraft' ? 'text-cyan-400' :
                    'text-blue-400'
                  }`}>
                    {reserveTypeLabels[entry.type] ?? entry.type}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {canArrive
                      ? '● Available now'
                      : `Round ${entry.availableFromRound}+`}
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
