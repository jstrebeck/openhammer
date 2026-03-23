import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { rollDice, resolveFeelNoPain } from '@openhammer/core';

/**
 * Sprint O: Feel No Pain rolls after damage.
 * Prompt with dice results for each wound.
 */
export function FeelNoPainPrompt({
  unitId,
  damage,
  threshold,
  modelId,
  source,
  onClose,
}: {
  unitId: string;
  damage: number;
  threshold: number;
  modelId: string;
  source: string;
  onClose: () => void;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const gameState = useGameStore((s) => s.gameState);
  const [resolved, setResolved] = useState(false);
  const [result, setResult] = useState<{ woundsSuffered: number; woundsBlocked: number; rolls: number[] } | null>(null);

  const handleResolve = () => {
    const fnpResult = resolveFeelNoPain(damage, threshold);
    setResult({
      woundsSuffered: fnpResult.woundsSuffered,
      woundsBlocked: fnpResult.woundsBlocked,
      rolls: fnpResult.rolls.dice,
    });
    setResolved(true);

    // Apply actual damage after FNP
    if (fnpResult.woundsSuffered > 0) {
      dispatch({
        type: 'APPLY_DAMAGE',
        payload: { modelId, damage: fnpResult.woundsSuffered, source: `${source} (after FNP)` },
      });
    }
  };

  const model = gameState.models[modelId];

  return (
    <div className="border border-green-600/50 rounded p-2 bg-green-900/20 space-y-2">
      <div className="text-[10px] text-green-400 uppercase tracking-wider font-bold">
        Feel No Pain ({threshold}+)
      </div>

      {!resolved ? (
        <>
          <div className="text-xs text-gray-300">
            {model?.name ?? modelId} takes {damage} damage. Roll D6 per wound — {threshold}+ blocks.
          </div>
          <button
            onClick={handleResolve}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Roll Feel No Pain
          </button>
        </>
      ) : result ? (
        <>
          <div className="flex flex-wrap gap-0.5">
            {result.rolls.map((d, i) => (
              <span key={i} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                d >= threshold ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
              }`}>
                {d}
              </span>
            ))}
          </div>
          <div className="text-xs">
            <span className="text-green-400">{result.woundsBlocked} blocked</span>
            {' | '}
            <span className="text-red-400">{result.woundsSuffered} suffered</span>
          </div>
          <button
            onClick={onClose}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
          >
            Done
          </button>
        </>
      ) : null}
    </div>
  );
}
