import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * Sprint I: Scoring conditions display.
 * Persistent panel showing active conditions and what's been scored.
 */
export function ScoringConditionsPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const [expanded, setExpanded] = useState(false);

  const mission = gameState.mission;
  if (!mission) return null;

  const playerIds = Object.keys(gameState.players);

  // Calculate scored VP per condition per player
  const getVpScored = (conditionId: string, playerId: string): number => {
    return gameState.scoringLog
      .filter(e => e.conditionId === conditionId && e.playerId === playerId)
      .reduce((sum, e) => sum + e.vpScored, 0);
  };

  return (
    <div className="border border-gray-700/50 rounded bg-gray-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs"
      >
        <span className="text-gray-400 font-medium">
          Scoring — {mission.name}
        </span>
        <span className="text-gray-500">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Conditions */}
          {mission.scoringConditions.map((sc) => (
            <div key={sc.id} className="bg-gray-700/30 rounded p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-[9px] px-1 rounded ${
                  sc.type === 'primary' ? 'bg-blue-700/50 text-blue-300' : 'bg-purple-700/50 text-purple-300'
                }`}>
                  {sc.type}
                </span>
                <span className="text-xs text-white font-medium">{sc.name}</span>
                <span className="text-[10px] text-yellow-400 ml-auto">
                  {sc.vpAwarded} VP | {sc.timing.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-[10px] text-gray-400 mb-1.5">{sc.description}</div>

              {/* Per-player scoring */}
              <div className="space-y-0.5">
                {playerIds.map((pid) => {
                  const scored = getVpScored(sc.id, pid);
                  const player = gameState.players[pid];
                  return (
                    <div key={pid} className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                      <span className="text-gray-300">{player?.name}</span>
                      <span className="ml-auto font-medium text-white">
                        {scored} VP
                        {sc.maxVp ? <span className="text-gray-500"> / {sc.maxVp}</span> : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Total scores */}
          <div className="border-t border-gray-600 pt-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total VP</div>
            {playerIds.map((pid) => {
              const player = gameState.players[pid];
              const total = gameState.score[pid] ?? 0;
              return (
                <div key={pid} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                  <span className="text-gray-300">{player?.name}</span>
                  <span className="ml-auto font-bold text-white">{total} VP</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
