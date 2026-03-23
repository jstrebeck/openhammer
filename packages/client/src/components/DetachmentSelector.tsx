import { useGameStore } from '../store/gameStore';
import type { Detachment } from '@openhammer/core';

/** Sample detachments — real data would come from faction codexes */
const SAMPLE_DETACHMENTS: Detachment[] = [
  {
    id: 'battle-line',
    name: 'Battle Line',
    rules: 'Re-roll Hit rolls of 1 for units that are within range of an objective marker you control.',
  },
  {
    id: 'gladius-task-force',
    name: 'Gladius Task Force',
    rules: 'Each time a unit from your army is selected to shoot or fight, you can re-roll one Hit roll and one Wound roll.',
  },
  {
    id: 'combined-regiment',
    name: 'Combined Regiment',
    rules: 'Units from your army that are within 6" of a friendly Officer gain +1 to Hit.',
  },
];

/**
 * Sprint H: Detachment selector dropdown.
 */
export function DetachmentSelector() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const selectedId = gameState.detachment?.id;

  const handleSelect = (detachment: Detachment) => {
    dispatch({ type: 'SELECT_DETACHMENT', payload: { detachment } });
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Detachment</div>
      <div className="space-y-1">
        {SAMPLE_DETACHMENTS.map((d) => (
          <button
            key={d.id}
            onClick={() => handleSelect(d)}
            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
              selectedId === d.id
                ? 'bg-blue-600/30 border border-blue-500 text-blue-200'
                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <div className="font-medium">{d.name}</div>
            {d.rules && (
              <div className="text-[10px] text-gray-400 mt-0.5">{d.rules}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
