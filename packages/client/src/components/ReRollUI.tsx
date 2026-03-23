import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { rollDice } from '@openhammer/core';
import type { DiceRoll } from '@openhammer/core';

/**
 * Sprint O: Re-roll UI for Command Re-roll stratagem.
 * Select which roll to re-roll, show before/after.
 */
export function ReRollUI({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const [selectedRollId, setSelectedRollId] = useState<string | null>(null);
  const [newRoll, setNewRoll] = useState<DiceRoll | null>(null);

  // Get recent dice rolls from the log (last 10)
  const recentRolls = gameState.log.entries
    .filter((e): e is Extract<typeof e, { type: 'dice_roll' }> => e.type === 'dice_roll')
    .slice(-10)
    .reverse();

  const handleReRoll = () => {
    if (!selectedRollId) return;
    const originalEntry = recentRolls.find((r) => r.roll.id === selectedRollId);
    if (!originalEntry) return;

    const original = originalEntry.roll;
    const reRolledDice = rollDice(
      original.dice.length,
      original.sides,
      `${original.purpose} (re-roll)`,
      original.threshold,
    );
    reRolledDice.reRolled = true;

    setNewRoll(reRolledDice);

    dispatch({
      type: 'APPLY_COMMAND_REROLL',
      payload: { originalRollId: selectedRollId, newRoll: reRolledDice },
    });
  };

  return (
    <div className="border border-blue-600/50 rounded p-2 bg-blue-900/20 space-y-2">
      <div className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">
        Command Re-roll (1 CP)
      </div>

      {!newRoll ? (
        <>
          <div className="text-xs text-gray-300">Select a roll to re-roll:</div>

          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentRolls.map((entry) => {
              const r = entry.roll;
              if (r.reRolled) return null;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedRollId(r.id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                    selectedRollId === r.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="font-medium">{r.purpose}</div>
                  <div className="flex gap-0.5 mt-0.5">
                    {r.dice.map((d, i) => (
                      <span key={i} className="w-4 h-4 rounded flex items-center justify-center text-[9px] bg-gray-600 text-white">
                        {d}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={handleReRoll}
              disabled={!selectedRollId}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
            >
              Re-roll
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-gray-300">Re-roll result:</div>
          <div className="flex flex-wrap gap-0.5">
            {newRoll.dice.map((d, i) => (
              <span key={i} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                d === 6 ? 'bg-yellow-500 text-black' :
                (newRoll.threshold && d >= newRoll.threshold) ? 'bg-green-600 text-white' :
                'bg-red-900/60 text-red-300'
              }`}>
                {d}
              </span>
            ))}
          </div>
          <button
            onClick={onClose}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Done
          </button>
        </>
      )}
    </div>
  );
}
