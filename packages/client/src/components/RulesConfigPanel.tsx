import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { EnforcementLevel, RulesConfig } from '@openhammer/core';

const RULE_LABELS: Record<keyof RulesConfig, string> = {
  coherency: 'Unit Coherency',
  movementRange: 'Movement Range',
  phaseRestrictions: 'Phase Restrictions',
  lineOfSight: 'Line of Sight',
};

const LEVEL_LABELS: Record<EnforcementLevel, string> = {
  off: 'Off',
  warn: 'Warn',
  enforce: 'Enforce',
};

const LEVEL_COLORS: Record<EnforcementLevel, string> = {
  off: 'bg-gray-700 text-gray-400',
  warn: 'bg-yellow-800/50 text-yellow-300',
  enforce: 'bg-red-800/50 text-red-300',
};

export function RulesConfigPanel() {
  const rulesConfig = useGameStore((s) => s.gameState.rulesConfig);
  const dispatch = useGameStore((s) => s.dispatch);
  const [expanded, setExpanded] = useState(false);

  const handleChange = (key: keyof RulesConfig, level: EnforcementLevel) => {
    dispatch({ type: 'SET_RULES_CONFIG', payload: { config: { [key]: level } } });
  };

  return (
    <div className="absolute top-14 left-[248px]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="px-3 py-1.5 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
      >
        Rules {expanded ? '▾' : '▸'}
      </button>

      {expanded && (
        <div className="mt-1 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 shadow-lg p-3 space-y-3 w-56">
          {(Object.keys(RULE_LABELS) as (keyof RulesConfig)[]).map((key) => (
            <div key={key}>
              <div className="text-xs text-gray-400 mb-1">{RULE_LABELS[key]}</div>
              <div className="flex gap-1">
                {(['off', 'warn', 'enforce'] as EnforcementLevel[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => handleChange(key, level)}
                    className={`flex-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      rulesConfig[key] === level
                        ? LEVEL_COLORS[level]
                        : 'bg-gray-700/50 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {LEVEL_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
