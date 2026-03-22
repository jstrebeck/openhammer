import { useState } from 'react';
import { rollDice, countSuccesses, countFailures } from '@openhammer/core';
import type { DiceRoll } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';

export function DiceRoller() {
  const dispatch = useGameStore((s) => s.dispatch);
  const [count, setCount] = useState(6);
  const [threshold, setThreshold] = useState(3);
  const [purpose, setPurpose] = useState('To Hit');
  const [lastRoll, setLastRoll] = useState<DiceRoll | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleRoll = () => {
    const roll = rollDice(count, 6, purpose, threshold);
    setLastRoll(roll);
    dispatch({ type: 'ROLL_DICE', payload: { roll } });
  };

  const quickPurposes = ['To Hit', 'To Wound', 'Save', 'Damage', 'Battleshock'];

  return (
    <div>
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left"
      >
        Dice Roller {expanded ? '▾' : '▸'}
      </button>

      {expanded && (
        <div className="p-3 space-y-3">
          {/* Quick purpose buttons */}
          <div className="flex flex-wrap gap-1">
            {quickPurposes.map((p) => (
              <button
                key={p}
                onClick={() => setPurpose(p)}
                className={`px-2 py-0.5 rounded text-xs ${
                  purpose === p ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Config */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 uppercase">Dice</label>
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                min={1}
                max={50}
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 uppercase">{threshold}+</label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Math.max(2, Math.min(6, Number(e.target.value))))}
                className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                min={2}
                max={6}
              />
            </div>
          </div>

          {/* Roll button */}
          <button
            onClick={handleRoll}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Roll {count}D6
          </button>

          {/* Result */}
          {lastRoll && (
            <div className="border-t border-gray-700 pt-2">
              <div className="text-xs text-gray-400 mb-1">{lastRoll.purpose} ({lastRoll.threshold}+)</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {lastRoll.dice.map((d, i) => {
                  const pass = lastRoll.threshold != null && d >= lastRoll.threshold;
                  return (
                    <span
                      key={i}
                      className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold ${
                        pass
                          ? 'bg-green-600 text-white'
                          : 'bg-red-900/60 text-red-300'
                      }`}
                    >
                      {d}
                    </span>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-400">{countSuccesses(lastRoll)} pass</span>
                <span className="text-red-400">{countFailures(lastRoll)} fail</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

