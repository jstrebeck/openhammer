import { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { LogEntry } from '@openhammer/core';

export function GameLog() {
  const log = useGameStore((s) => s.gameState.log);
  const players = useGameStore((s) => s.gameState.players);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.entries.length]);

  const formatEntry = (entry: LogEntry): { text: string; color: string } => {
    switch (entry.type) {
      case 'phase_change': {
        const player = players[entry.playerId];
        return {
          text: `Round ${entry.roundNumber} — ${player?.name ?? '?'} — ${entry.phase}`,
          color: 'text-blue-400',
        };
      }
      case 'dice_roll': {
        const { roll } = entry;
        const passes = roll.threshold != null
          ? roll.dice.filter((d) => d >= roll.threshold!).length
          : roll.dice.length;
        return {
          text: `${roll.purpose}: [${roll.dice.join(', ')}] → ${passes}/${roll.dice.length} pass${roll.threshold != null ? ` (${roll.threshold}+)` : ''}`,
          color: 'text-yellow-300',
        };
      }
      case 'cp_change': {
        const player = players[entry.playerId];
        return {
          text: `${player?.name ?? '?'} CP: ${entry.oldValue} → ${entry.newValue} (${entry.reason})`,
          color: 'text-purple-400',
        };
      }
      case 'message':
        return { text: entry.text, color: 'text-gray-300' };
    }
  };

  return (
    <div className="absolute bottom-16 left-[248px] w-72">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 transition-colors text-left"
      >
        Game Log ({log.entries.length}) {expanded ? '▾' : '▸'}
      </button>

      {expanded && (
        <div className="mt-1 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 shadow-lg max-h-60 overflow-y-auto">
          {log.entries.length === 0 ? (
            <div className="p-3 text-xs text-gray-500">No log entries yet.</div>
          ) : (
            <div className="p-2 space-y-0.5">
              {log.entries.map((entry, i) => {
                const { text, color } = formatEntry(entry);
                return (
                  <div key={i} className={`text-xs ${color} leading-relaxed`}>
                    {text}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
