import { useGameStore } from '../store/gameStore';
import { validateArmy } from '@openhammer/core';

/**
 * Sprint H: Army validation panel.
 * Shows faction conflicts, points overages, reserves cap issues.
 */
export function ArmyValidationPanel({ playerId }: { playerId: string }) {
  const gameState = useGameStore((s) => s.gameState);

  const errors = validateArmy(gameState, playerId);
  const player = gameState.players[playerId];
  const playerUnits = Object.values(gameState.units).filter(u => u.playerId === playerId);
  const totalPoints = playerUnits.reduce((sum, u) => sum + (u.points ?? 0), 0);

  if (playerUnits.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Army Validation</div>
        <div className="text-xs text-gray-400">
          {totalPoints} pts
          {gameState.pointsLimit ? ` / ${gameState.pointsLimit} pts` : ''}
        </div>
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-300">
        <span className="font-medium text-white">{player?.name ?? 'Player'}</span>
        {' — '}
        {playerUnits.length} unit{playerUnits.length !== 1 ? 's' : ''}
        {gameState.factionKeyword && (
          <span className="text-gray-500 ml-1">({gameState.factionKeyword})</span>
        )}
      </div>

      {/* Warlord status */}
      {gameState.warlordModelId ? (
        <div className="text-xs text-green-400 flex items-center gap-1">
          <span className="text-yellow-400">★</span>
          Warlord: {gameState.models[gameState.warlordModelId]?.name ?? 'Unknown'}
        </div>
      ) : (
        <div className="text-xs text-yellow-400">No Warlord designated</div>
      )}

      {/* Points bar */}
      {gameState.pointsLimit != null && gameState.pointsLimit > 0 && (
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${
              totalPoints > gameState.pointsLimit ? 'bg-red-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(100, (totalPoints / gameState.pointsLimit) * 100)}%` }}
          />
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700/50 rounded p-2 space-y-0.5">
          {errors.map((err, i) => (
            <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
              <span className="text-red-500 mt-0.5 shrink-0">✕</span>
              {err}
            </div>
          ))}
        </div>
      )}

      {errors.length === 0 && playerUnits.length > 0 && (
        <div className="text-[10px] text-green-400 flex items-center gap-1">
          <span>✓</span> Army valid
        </div>
      )}
    </div>
  );
}
