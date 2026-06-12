import { useGameStore } from '../store/gameStore';

/**
 * Sprint I: End-of-battle screen.
 * Final VP, winner announcement, game statistics.
 */
export function EndOfBattleScreen({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);

  const result = gameState.gameResult;
  const playerIds = Object.keys(gameState.players);

  // Compute statistics
  const stats: Record<string, {
    unitsDestroyed: number;
    modelsDestroyed: number;
    totalUnits: number;
    totalModels: number;
    objectivesControlled: number;
  }> = {};

  for (const pid of playerIds) {
    const playerUnits = Object.values(gameState.units).filter(u => u.playerId === pid);
    const playerModels = playerUnits.flatMap(u => u.modelIds.map(id => gameState.models[id]));
    const destroyed = playerModels.filter(m => m?.status === 'destroyed').length;
    const total = playerModels.length;
    const objControlled = Object.values(gameState.objectives).filter(o => o.controllingPlayerId === pid).length;

    // Count enemy units fully destroyed
    const enemyPid = playerIds.find(p => p !== pid);
    const enemyUnits = enemyPid ? Object.values(gameState.units).filter(u => u.playerId === enemyPid) : [];
    const enemyUnitsDestroyed = enemyUnits.filter(u => {
      return u.modelIds.every(id => gameState.models[id]?.status === 'destroyed');
    }).length;

    stats[pid] = {
      unitsDestroyed: enemyUnitsDestroyed,
      modelsDestroyed: destroyed,
      totalUnits: playerUnits.length,
      totalModels: total,
      objectivesControlled: objControlled,
    };
  }

  const winner = result?.winnerId ? gameState.players[result.winnerId] : null;
  const isDraw = result && !result.winnerId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-gray-800 rounded-lg shadow-2xl border border-gray-600 w-[520px]">
        {/* Winner banner */}
        <div className={`p-6 text-center rounded-t-lg ${
          isDraw ? 'bg-yellow-900/30' : 'bg-gradient-to-b from-gray-700/50 to-transparent'
        }`}>
          {isDraw ? (
            <>
              <div className="text-2xl font-bold text-yellow-400">DRAW</div>
              <div className="text-sm text-gray-400 mt-1">Both players tied on Victory Points</div>
            </>
          ) : winner ? (
            <>
              <div className="text-sm text-gray-400 uppercase tracking-wider">Victory</div>
              <div className="text-2xl font-bold mt-1" style={{ color: winner.color }}>
                {winner.name} Wins!
              </div>
              <div className="text-sm text-gray-400 mt-1">
                {result?.reason === 'max_rounds' && 'Game ended after maximum rounds'}
                {result?.reason === 'concede' && 'Opponent conceded'}
                {result?.reason === 'tabled' && 'All enemy units destroyed'}
              </div>
            </>
          ) : null}
        </div>

        {/* Final scores */}
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Final Score</div>
            <div className="space-y-2">
              {playerIds.map(pid => {
                const player = gameState.players[pid];
                const vp = gameState.score[pid] ?? 0;
                const maxVp = Math.max(...playerIds.map(p => gameState.score[p] ?? 0), 1);
                const isWinner = result?.winnerId === pid;
                return (
                  <div key={pid} className={`rounded p-3 ${isWinner ? 'bg-green-900/20 border border-green-700/50' : 'bg-gray-700/30'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                      <span className="text-sm font-medium text-white">{player?.name}</span>
                      {isWinner && <span className="text-yellow-400 text-sm">★</span>}
                      <span className="ml-auto text-xl font-bold text-white">{vp} VP</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          backgroundColor: player?.color ?? '#888',
                          width: `${(vp / maxVp) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Game Statistics */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Statistics</div>
            <div className="grid grid-cols-2 gap-3">
              {playerIds.map(pid => {
                const player = gameState.players[pid];
                const s = stats[pid];
                return (
                  <div key={pid} className="bg-gray-700/30 rounded p-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-white mb-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: player?.color ?? '#888' }} />
                      {player?.name}
                    </div>
                    <div className="text-[10px] text-gray-400 flex justify-between">
                      <span>Units</span>
                      <span className="text-white">{s.totalUnits}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 flex justify-between">
                      <span>Enemy units killed</span>
                      <span className="text-red-400">{s.unitsDestroyed}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 flex justify-between">
                      <span>Models lost</span>
                      <span className="text-red-400">{s.modelsDestroyed}/{s.totalModels}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 flex justify-between">
                      <span>Objectives held</span>
                      <span className="text-yellow-400">{s.objectivesControlled}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Game info */}
          <div className="text-center text-[10px] text-gray-500">
            {gameState.turnState.roundNumber} rounds played
            {gameState.mission && ` — ${gameState.mission.name}`}
          </div>
        </div>

        <div className="flex justify-center p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
