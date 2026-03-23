import React from 'react';
import { useGameStore } from '../store/gameStore';
import { getEdition } from '@openhammer/core';

export function TurnTracker() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const edition = getEdition(gameState.editionId);
  const phases = edition?.phases ?? [];
  const currentPhaseIndex = gameState.turnState.currentPhaseIndex;
  const currentPhase = phases[currentPhaseIndex];
  const isLastPhase = currentPhaseIndex >= phases.length - 1;
  const activePlayer = gameState.players[gameState.turnState.activePlayerId];
  const playerIds = Object.keys(gameState.players);

  const handleAdvancePhase = () => {
    if (isLastPhase) {
      dispatch({ type: 'NEXT_TURN' });
    } else {
      dispatch({ type: 'ADVANCE_PHASE' });
    }
  };

  // Auto-set active player if not set yet
  React.useEffect(() => {
    if (!gameState.turnState.activePlayerId && playerIds.length > 0) {
      dispatch({ type: 'NEXT_TURN' });
    }
  }, [gameState.turnState.activePlayerId, playerIds.length, dispatch]);

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-gray-800/90 backdrop-blur rounded-lg shadow-lg border border-gray-700 flex items-center gap-3 px-4 py-2">
      {/* Round */}
      <div className="text-center">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Round</div>
        <div className="text-lg font-bold text-white leading-tight">
          {gameState.turnState.roundNumber}
          <span className="text-sm text-gray-400 font-normal">/{gameState.maxBattleRounds}</span>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-600" />

      {/* Active Player */}
      <div className="text-center min-w-[80px]">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Player</div>
        <div className="text-sm font-medium text-white leading-tight flex items-center justify-center gap-1.5">
          {activePlayer && (
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activePlayer.color }} />
          )}
          {activePlayer?.name ?? 'None'}
        </div>
      </div>

      <div className="w-px h-8 bg-gray-600" />

      {/* Phase Indicators */}
      <div className="flex items-center gap-1">
        {phases.map((phase, i) => (
          <div
            key={phase.id}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              i === currentPhaseIndex
                ? 'bg-blue-600 text-white font-medium'
                : i < currentPhaseIndex
                  ? 'bg-gray-600/50 text-gray-400'
                  : 'bg-gray-700/50 text-gray-500'
            }`}
            title={phase.name}
          >
            {phase.name.replace(' Phase', '')}
          </div>
        ))}
      </div>

      <div className="w-px h-8 bg-gray-600" />

      {/* Advance Button */}
      <button
        onClick={handleAdvancePhase}
        disabled={!gameState.gameStarted}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          gameState.gameStarted
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-gray-600 text-gray-400 cursor-not-allowed'
        }`}
      >
        {isLastPhase ? 'Next Turn' : 'Next Phase'}
      </button>
    </div>
  );
}
