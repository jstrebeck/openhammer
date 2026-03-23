import { useGameStore } from '../store/gameStore';

/**
 * Sprint I: End-of-round summary.
 * VP scored this round, running totals.
 */
export function EndOfRoundSummary({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const playerIds = Object.keys(gameState.players);
  const currentRound = gameState.turnState.roundNumber;

  // Scoring this round
  const roundScoring = gameState.scoringLog.filter(e => e.roundNumber === currentRound);
  const roundTotals: Record<string, number> = {};
  for (const entry of roundScoring) {
    roundTotals[entry.playerId] = (roundTotals[entry.playerId] ?? 0) + entry.vpScored;
  }

  const handleEndRound = () => {
    dispatch({ type: 'END_BATTLE_ROUND' });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[440px]">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">End of Round {currentRound}</h2>
        </div>

        <div className="p-4 space-y-3">
          {/* Round VP */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">VP Scored This Round</div>
            {playerIds.map(pid => {
              const player = gameState.players[pid];
              const vp = roundTotals[pid] ?? 0;
              return (
                <div key={pid} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                  <span className="text-gray-300">{player?.name}</span>
                  <span className="ml-auto text-yellow-400 font-medium">+{vp} VP</span>
                </div>
              );
            })}
          </div>

          {/* Detailed scoring */}
          {roundScoring.length > 0 && (
            <div className="bg-gray-700/30 rounded p-2 space-y-0.5">
              {roundScoring.map((entry, i) => (
                <div key={i} className="text-[10px] text-gray-400">
                  {gameState.players[entry.playerId]?.name}: {entry.conditionName} (+{entry.vpScored})
                </div>
              ))}
            </div>
          )}

          {/* Running Totals */}
          <div className="border-t border-gray-600 pt-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Running Total</div>
            {playerIds.map(pid => {
              const player = gameState.players[pid];
              const total = gameState.score[pid] ?? 0;
              const maxTotal = Math.max(...playerIds.map(p => gameState.score[p] ?? 0), 1);
              return (
                <div key={pid} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                    <span className="text-gray-300">{player?.name}</span>
                    <span className="ml-auto font-bold text-white">{total} VP</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1">
                    <div
                      className="h-1 rounded-full"
                      style={{
                        backgroundColor: player?.color ?? '#888',
                        width: `${(total / maxTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Round counter */}
          <div className="text-center text-xs text-gray-500">
            Round {currentRound} of {gameState.maxBattleRounds}
            {currentRound >= gameState.maxBattleRounds && (
              <span className="text-yellow-400 ml-1">— Final Round!</span>
            )}
          </div>
        </div>

        <div className="flex justify-end p-4 border-t border-gray-700">
          <button
            onClick={handleEndRound}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
          >
            {currentRound >= gameState.maxBattleRounds ? 'End Game' : 'Next Round'}
          </button>
        </div>
      </div>
    </div>
  );
}
