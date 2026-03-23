import { useGameStore } from '../store/gameStore';

/**
 * Sprint I: End-of-turn summary popup.
 * Shows coherency removals, OC changes, VP scored.
 */
export function EndOfTurnSummary({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const playerIds = Object.keys(gameState.players);

  // Collect recent scoring from this turn
  const currentRound = gameState.turnState.roundNumber;
  const recentScoring = gameState.scoringLog.filter(
    e => e.roundNumber === currentRound,
  );

  // Objective control summary
  const objectives = Object.values(gameState.objectives);
  const controlledByPlayer: Record<string, number> = {};
  for (const obj of objectives) {
    if (obj.controllingPlayerId) {
      controlledByPlayer[obj.controllingPlayerId] = (controlledByPlayer[obj.controllingPlayerId] ?? 0) + 1;
    }
  }

  const handleEndTurn = () => {
    dispatch({ type: 'END_TURN' });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[440px]">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">End of Turn</h2>
          <div className="text-xs text-gray-400 mt-1">
            Round {currentRound} — {gameState.players[gameState.turnState.activePlayerId]?.name}'s turn
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Objective Control */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Objective Control</div>
            {playerIds.map(pid => {
              const player = gameState.players[pid];
              const count = controlledByPlayer[pid] ?? 0;
              return (
                <div key={pid} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                  <span className="text-gray-300">{player?.name}</span>
                  <span className="ml-auto font-medium text-white">{count} obj</span>
                </div>
              );
            })}
          </div>

          {/* VP Scored */}
          {recentScoring.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">VP Scored This Round</div>
              {recentScoring.map((entry, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: gameState.players[entry.playerId]?.color ?? '#888' }} />
                  <span className="text-gray-300">{gameState.players[entry.playerId]?.name}</span>
                  <span className="text-gray-500">— {entry.conditionName}</span>
                  <span className="ml-auto text-yellow-400 font-medium">+{entry.vpScored} VP</span>
                </div>
              ))}
            </div>
          )}

          {/* Running Totals */}
          <div className="border-t border-gray-600 pt-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Running Total</div>
            {playerIds.map(pid => {
              const player = gameState.players[pid];
              return (
                <div key={pid} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                  <span className="text-gray-300">{player?.name}</span>
                  <span className="ml-auto font-bold text-white">{gameState.score[pid] ?? 0} VP</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end p-4 border-t border-gray-700">
          <button
            onClick={handleEndTurn}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
