import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { rollDice } from '@openhammer/core';

/**
 * Sprint O: Desperate Escape resolution UI.
 * Roll D6 per model — show casualties.
 */
export function DesperateEscapePrompt({
  unitId,
  modelIds,
  onClose,
}: {
  unitId: string;
  modelIds: string[];
  onClose: () => void;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const gameState = useGameStore((s) => s.gameState);
  const [resolved, setResolved] = useState(false);
  const [results, setResults] = useState<Array<{ modelId: string; roll: number; destroyed: boolean }>>([]);

  const handleResolve = () => {
    const rolls = rollDice(modelIds.length, 6, 'Desperate Escape');
    const destroyedIds: string[] = [];
    const rollResults = modelIds.map((modelId, i) => {
      const die = rolls.dice[i];
      // 1-2 = destroyed in Desperate Escape
      const destroyed = die <= 2;
      if (destroyed) destroyedIds.push(modelId);
      return { modelId, roll: die, destroyed };
    });

    setResults(rollResults);
    setResolved(true);

    dispatch({
      type: 'RESOLVE_DESPERATE_ESCAPE',
      payload: {
        unitId,
        roll: rolls,
        destroyedModelIds: destroyedIds,
      },
    });
  };

  return (
    <div className="border border-red-600/50 rounded p-2 bg-red-900/20 space-y-2">
      <div className="text-[10px] text-red-400 uppercase tracking-wider font-bold">
        Desperate Escape
      </div>

      {!resolved ? (
        <>
          <div className="text-xs text-gray-300">
            Roll D6 per model falling back through Engagement Range. On 1-2, model is destroyed.
          </div>
          <div className="text-xs text-gray-400">
            {modelIds.length} model{modelIds.length !== 1 ? 's' : ''} to test
          </div>
          <button
            onClick={handleResolve}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Roll Desperate Escape
          </button>
        </>
      ) : (
        <>
          <div className="space-y-1">
            {results.map((r) => {
              const model = gameState.models[r.modelId];
              return (
                <div key={r.modelId} className="flex items-center gap-2 text-xs">
                  <span className={`w-5 h-5 rounded flex items-center justify-center font-bold ${
                    r.destroyed ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
                  }`}>
                    {r.roll}
                  </span>
                  <span className={r.destroyed ? 'text-red-400 line-through' : 'text-green-400'}>
                    {model?.name ?? r.modelId}
                  </span>
                  {r.destroyed && <span className="text-red-400 text-[10px]">DESTROYED</span>}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-400">
            {results.filter(r => r.destroyed).length} destroyed, {results.filter(r => !r.destroyed).length} survived
          </div>
          <button
            onClick={onClose}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
          >
            Done
          </button>
        </>
      )}
    </div>
  );
}
