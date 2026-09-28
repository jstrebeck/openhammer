import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { rollDice, distanceBetweenModels } from '@openhammer/core';

export function ChargePanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const firstModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const unit = firstModel?.unitId ? gameState.units[firstModel.unitId] : null;

  if (!unit) {
    return <div className="text-xs text-gray-500 italic">Select a unit to declare a charge</div>;
  }

  const isCompleted = gameState.turnTracking.unitsCompleted[unit.id];
  const declaredTargets = gameState.chargeState.declaredCharges[unit.id];
  const chargeRoll = gameState.chargeState.chargeRolls[unit.id];
  const isSuccessful = gameState.chargeState.successfulCharges.includes(unit.id);
  const moveType = gameState.turnTracking.unitMovement[unit.id];
  const cantCharge = moveType === 'advance' || moveType === 'fall_back';

  // Get eligible enemy units (within 12")
  const activeModels = unit.modelIds
    .map((id) => gameState.models[id])
    .filter((m) => m && m.status === 'active');

  const enemyUnits = Object.values(gameState.units)
    .filter((u) => u.playerId !== unit.playerId)
    .map((eu) => {
      const enemyModels = eu.modelIds
        .map((id) => gameState.models[id])
        .filter((m) => m && m.status === 'active');
      if (enemyModels.length === 0) return null;

      // Find closest distance from any of our models to any enemy model
      let minDist = Infinity;
      for (const am of activeModels) {
        for (const em of enemyModels) {
          const d = distanceBetweenModels(am, em);
          if (d < minDist) minDist = d;
        }
      }
      return { unit: eu, distance: minDist, inRange: minDist <= 12 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.inRange);

  const toggleTarget = (unitId: string) => {
    setSelectedTargets((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId],
    );
  };

  const handleDeclare = () => {
    if (selectedTargets.length === 0) return;
    dispatch({
      type: 'DECLARE_CHARGE',
      payload: { unitId: unit.id, targetUnitIds: selectedTargets },
    });
  };

  const handleRoll = () => {
    const roll = rollDice(2, 6, 'Charge');
    const total = roll.dice[0] + roll.dice[1];
    dispatch({ type: 'ROLL_CHARGE', payload: { unitId: unit.id, roll, total } });
  };

  const handleCommit = () => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const model of activeModels) {
      positions[model.id] = model.position;
    }
    dispatch({ type: 'COMMIT_CHARGE_MOVE', payload: { unitId: unit.id, positions } });
  };

  const handleFail = () => {
    dispatch({ type: 'FAIL_CHARGE', payload: { unitId: unit.id } });
  };

  const handleSkip = () => {
    dispatch({ type: 'COMPLETE_UNIT_ACTIVATION', payload: { unitId: unit.id } });
  };

  // Completed state
  if (isCompleted || isSuccessful) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> — charge {isSuccessful ? 'successful' : 'complete'}
        </div>
        {isSuccessful && (
          <div className="text-xs text-green-400">Gains Fights First this turn</div>
        )}
      </div>
    );
  }

  // Can't charge
  if (cantCharge) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span>
        </div>
        <div className="text-xs text-red-400">
          Cannot charge — {moveType === 'advance' ? 'unit Advanced' : 'unit Fell Back'} this turn
        </div>
      </div>
    );
  }

  // After rolling — commit or fail
  if (chargeRoll !== undefined && declaredTargets) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> — charge roll: <span className="text-lg font-bold text-yellow-400">{chargeRoll}"</span>
        </div>
        <div className="text-xs text-gray-500">
          Targets: {declaredTargets.map((id) => gameState.units[id]?.name ?? id).join(', ')}
        </div>
        <div className="text-xs text-gray-500">
          Drag models into engagement range, then commit or fail.
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={handleCommit}
            className="px-3 py-2 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Commit Charge
          </button>
          <button
            onClick={handleFail}
            className="px-3 py-2 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Charge Failed
          </button>
        </div>
      </div>
    );
  }

  // After declaration — roll
  if (declaredTargets) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> — targets declared
        </div>
        <div className="text-xs text-gray-500">
          Charging: {declaredTargets.map((id) => gameState.units[id]?.name ?? id).join(', ')}
        </div>
        <button
          onClick={handleRoll}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
        >
          Roll Charge (2D6)
        </button>
      </div>
    );
  }

  // Declare charge
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400">
        <span className="font-medium text-white">{unit.name}</span>
      </div>

      {enemyUnits.length === 0 ? (
        <div className="text-xs text-gray-500 italic">No enemy units within 12"</div>
      ) : (
        <>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Select charge targets (within 12")</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {enemyUnits.map(({ unit: eu, distance: dist }) => (
              <button
                key={eu.id}
                onClick={() => toggleTarget(eu.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  selectedTargets.includes(eu.id)
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="font-medium">{eu.name}</span>
                <span className="text-[10px] opacity-70 ml-1">({dist.toFixed(1)}" away)</span>
              </button>
            ))}
          </div>

          <button
            onClick={handleDeclare}
            disabled={selectedTargets.length === 0}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-yellow-600 hover:bg-yellow-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Declare Charge ({selectedTargets.length} target{selectedTargets.length !== 1 ? 's' : ''})
          </button>
        </>
      )}

      <button
        onClick={handleSkip}
        className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
      >
        Skip Charge
      </button>
    </div>
  );
}
