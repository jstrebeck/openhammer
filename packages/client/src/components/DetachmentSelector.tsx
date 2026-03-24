import { useGameStore } from '../store/gameStore';
import { getDetachmentsForFaction, getFaction } from '@openhammer/core';
import type { Detachment } from '@openhammer/core';

interface DetachmentSelectorProps {
  playerId: string;
  factionId: string;
  onSelect?: (detachment: Detachment) => void;
}

/**
 * Detachment selector — shows available detachments for a faction.
 */
export function DetachmentSelector({ playerId, factionId, onSelect }: DetachmentSelectorProps) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const faction = getFaction(factionId);
  const detachments = getDetachmentsForFaction(factionId);
  const selectedId = gameState.playerDetachments[playerId]?.id;

  const handleSelect = (detachment: Detachment) => {
    dispatch({ type: 'SELECT_DETACHMENT', payload: { playerId, detachment } });
    onSelect?.(detachment);
  };

  if (detachments.length === 0) {
    return (
      <div className="text-xs text-gray-500">
        No detachments available{faction ? ` for ${faction.name}` : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
        {faction?.name ?? 'Detachment'}
      </div>
      {faction && (
        <div className="bg-gray-700/40 rounded px-2 py-1.5 mb-2">
          <div className="text-[10px] text-yellow-400 font-medium">{faction.factionRuleName}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{faction.factionRuleDescription}</div>
        </div>
      )}
      <div className="space-y-1">
        {detachments.map((d) => (
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
            {d.stratagems && d.stratagems.length > 0 && (
              <div className="text-[10px] text-gray-500 mt-0.5">
                {d.stratagems.length} stratagem{d.stratagems.length !== 1 ? 's' : ''} | {d.enhancements?.length ?? 0} enhancement{(d.enhancements?.length ?? 0) !== 1 ? 's' : ''}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
