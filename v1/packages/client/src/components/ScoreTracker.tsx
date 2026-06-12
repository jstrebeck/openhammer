import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

export function ScoreTracker() {
  const gameState = useGameStore((s) => s.gameState);
  const [expanded, setExpanded] = useState(false);

  const players = Object.values(gameState.players);
  if (players.length === 0) return null;

  // Find the max score for bar scaling (minimum 1 to avoid division by zero)
  const maxScore = Math.max(1, ...players.map((p) => gameState.score[p.id] ?? 0));

  // Filter log entries that mention VP
  const vpEntries = gameState.log.entries.filter(
    (entry) => entry.type === 'message' && entry.text.includes('VP'),
  );

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left flex items-center justify-between"
      >
        <span>Score</span>
        <span className="text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="p-2 space-y-2">
          {/* Per-player score bars */}
          {players.map((player) => {
            const score = gameState.score[player.id] ?? 0;
            const widthPercent = (score / maxScore) * 100;
            return (
              <div key={player.id} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className="text-gray-300 truncate">{player.name}</span>
                  </div>
                  <span className="text-white font-bold">{score} VP</span>
                </div>
                <div className="w-full h-2 bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-300"
                    style={{
                      width: `${widthPercent}%`,
                      backgroundColor: player.color,
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* VP history */}
          {vpEntries.length > 0 && (
            <div className="mt-2 border-t border-gray-700 pt-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">VP History</div>
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {vpEntries.map((entry, i) => (
                  <div key={i} className="text-xs text-gray-400 leading-relaxed">
                    {entry.type === 'message' ? entry.text : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {vpEntries.length === 0 && (
            <div className="text-xs text-gray-500">No VP scored yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
