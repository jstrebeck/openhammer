import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getUnitAbilityValue } from '@openhammer/core';

/**
 * Sprint O: Scout move pre-game movement dialog.
 * Lists Scout units and allows executing pre-game moves.
 */
export function ScoutMoveDialog({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const [movedUnits, setMovedUnits] = useState<Set<string>>(new Set());

  // Find all units with Scout ability
  const scoutUnits = Object.values(gameState.units).filter((u) => {
    return u.abilities.some((a) => a.toUpperCase().startsWith('SCOUT'));
  });

  const handleCommitScout = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;

    // Get current positions of all active models
    const positions: Record<string, { x: number; y: number }> = {};
    for (const modelId of unit.modelIds) {
      const model = gameState.models[modelId];
      if (model && model.status === 'active') {
        positions[modelId] = model.position;
      }
    }

    dispatch({ type: 'SCOUT_MOVE', payload: { unitId, positions } });
    setMovedUnits((prev) => new Set([...prev, unitId]));
  };

  if (scoutUnits.length === 0) {
    return (
      <div className="border border-gray-700 rounded p-3 bg-gray-800/90 space-y-2">
        <div className="text-xs text-gray-500">No units with Scout ability</div>
        <button onClick={onClose} className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="border border-gray-700 rounded p-3 bg-gray-800/90 space-y-2">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Scout Moves</div>
      <div className="text-xs text-gray-400">
        Drag Scout units on the board, then commit each move.
      </div>

      <div className="space-y-1.5">
        {scoutUnits.map((u) => {
          const scoutDist = getUnitAbilityValue(u, 'SCOUT') ?? 0;
          const done = movedUnits.has(u.id);
          return (
            <div key={u.id} className="flex items-center gap-2 text-xs">
              <span className={`flex-1 ${done ? 'text-gray-500 line-through' : 'text-white'}`}>
                {u.name}
                <span className="text-gray-500 ml-1">({scoutDist}")</span>
              </span>
              <button
                onClick={() => handleCommitScout(u.id)}
                disabled={done}
                className="px-2 py-1 rounded text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {done ? 'Done' : 'Commit'}
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={onClose}
        className="w-full px-3 py-1.5 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
      >
        {movedUnits.size === scoutUnits.length ? 'Done' : 'Skip Remaining'}
      </button>
    </div>
  );
}
