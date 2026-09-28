import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { validateDeepStrikeArrival, validateStrategicReservesArrival } from '@openhammer/core';
import type { ReserveEntry } from '@openhammer/core';

/**
 * Deep Strike / Strategic Reserves arrival UI.
 * Shows when a unit from reserves is being placed on the board.
 * Validates placement (>9" from enemies, within 6" of board edge for strategic, etc.)
 */
export function DeepStrikeArrival({
  unitId,
  reserveEntry,
  onClose,
}: {
  unitId: string;
  reserveEntry: ReserveEntry;
  onClose: () => void;
}) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const setSelectedModelIds = useUIStore((s) => s.setSelectedModelIds);
  const [errors, setErrors] = useState<string[]>([]);
  const [placed, setPlaced] = useState(false);

  const unit = gameState.units[unitId];
  if (!unit) return null;

  const activeModels = unit.modelIds
    .map(id => gameState.models[id])
    .filter(m => m && m.status === 'active');

  const reserveTypeLabel = reserveEntry.type === 'deep_strike' ? 'Deep Strike'
    : reserveEntry.type === 'aircraft' ? 'Aircraft'
    : 'Strategic Reserves';

  const handleSelectModels = () => {
    // Select the unit's models so the user can drag them into position
    setSelectedModelIds(unit.modelIds);
  };

  const handleValidateAndPlace = () => {
    // Collect current positions
    const positions: Record<string, { x: number; y: number }> = {};
    for (const model of activeModels) {
      positions[model.id] = model.position;
    }

    // Validate based on reserve type
    let validationErrors: string[];
    if (reserveEntry.type === 'deep_strike') {
      validationErrors = validateDeepStrikeArrival(gameState, unitId, positions);
    } else if (reserveEntry.type === 'strategic') {
      validationErrors = validateStrategicReservesArrival(gameState, unitId, positions);
    } else {
      validationErrors = [];
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Place the unit
    dispatch({
      type: 'ARRIVE_FROM_RESERVES',
      payload: { unitId, positions },
    });

    setPlaced(true);
    setErrors([]);
  };

  if (placed) {
    return (
      <div className="border border-green-600/50 rounded p-3 bg-green-900/20 space-y-2">
        <div className="text-xs text-green-400 font-medium">
          {unit.name} arrived from {reserveTypeLabel}!
        </div>
        <button
          onClick={onClose}
          className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="border border-purple-600/50 rounded p-3 bg-purple-900/20 space-y-2">
      <div className="text-[10px] text-purple-400 uppercase tracking-wider font-bold">
        {reserveTypeLabel} Arrival
      </div>

      <div className="text-xs text-gray-300">
        <span className="font-medium text-white">{unit.name}</span>
        {' — '}{activeModels.length} model{activeModels.length !== 1 ? 's' : ''}
      </div>

      {/* Placement rules reminder */}
      <div className="bg-gray-700/40 rounded p-2 text-[10px] text-gray-400 space-y-0.5">
        {reserveEntry.type === 'deep_strike' && (
          <>
            <div>• Must be placed &gt;9&quot; from all enemy models</div>
            <div>• Available from Round 2+</div>
          </>
        )}
        {reserveEntry.type === 'strategic' && (
          <>
            <div>• Must be within 6&quot; of a board edge</div>
            <div>• Must be &gt;9&quot; from all enemy models</div>
            <div>• Available from Round 2+</div>
          </>
        )}
        {reserveEntry.type === 'aircraft' && (
          <div>• Place anywhere on the board (aircraft movement rules apply)</div>
        )}
      </div>

      {/* Instructions */}
      <div className="text-[10px] text-gray-500">
        1. Click "Select Models" to highlight them on the board
        <br />
        2. Drag models to valid positions
        <br />
        3. Click "Place Unit" to validate and confirm
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700/50 rounded p-2 space-y-0.5">
          {errors.map((err, i) => (
            <div key={i} className="text-[10px] text-red-300 flex items-start gap-1">
              <span className="text-red-500 mt-0.5 shrink-0">✕</span>
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          onClick={handleSelectModels}
          className="flex-1 px-2 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white"
        >
          Select Models
        </button>
        <button
          onClick={handleValidateAndPlace}
          className="flex-1 px-2 py-1.5 rounded text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white"
        >
          Place Unit
        </button>
      </div>

      <button
        onClick={onClose}
        className="w-full px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white"
      >
        Cancel
      </button>
    </div>
  );
}
