import React from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { rollDice, getTransportForUnit, getOrderMovementBonus } from '@openhammer/core';
import type { MoveType } from '@openhammer/core';
import { TransportPanel } from './TransportPanel';

export function MovementPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);

  const firstModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const unit = firstModel?.unitId ? gameState.units[firstModel.unitId] : null;

  // Check if unit is embarked
  const isEmbarked = unit ? getTransportForUnit(gameState, unit.id) !== null : false;

  const moveType = unit ? gameState.turnTracking.unitMovement[unit.id] : undefined;
  const isCompleted = unit ? gameState.turnTracking.unitsCompleted[unit.id] : undefined;

  const activeModels = unit
    ? unit.modelIds
        .map((id) => gameState.models[id])
        .filter((m) => m && m.status === 'active')
    : [];

  // Hooks must be called unconditionally (before any early returns)
  const originalPositionsRef = React.useRef<Record<string, { x: number; y: number }>>({});

  React.useEffect(() => {
    if (unit && moveType && moveType !== 'stationary' && !isCompleted) {
      if (Object.keys(originalPositionsRef.current).length === 0) {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const model of activeModels) {
          positions[model.id] = { ...model.position };
        }
        originalPositionsRef.current = positions;
      }
    } else {
      originalPositionsRef.current = {};
    }
  }, [moveType, isCompleted, unit?.id]);

  if (!unit) {
    return (
      <div className="text-xs text-gray-500 italic">Select a unit to declare movement</div>
    );
  }

  // If unit is embarked, show transport panel instead of movement
  if (isEmbarked) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> — Embarked
        </div>
        <TransportPanel />
      </div>
    );
  }

  const advanceRoll = gameState.turnTracking.advanceRolls[unit.id];
  const baseMoveChar = activeModels[0]?.moveCharacteristic ?? 6;
  const orderBonus = unit ? getOrderMovementBonus(gameState, unit.id) : 0;
  const moveChar = baseMoveChar + orderBonus;

  const handleDeclare = (type: MoveType) => {
    dispatch({ type: 'ACTIVATE_UNIT', payload: { unitId: unit.id } });
    dispatch({ type: 'DECLARE_MOVEMENT', payload: { unitId: unit.id, moveType: type } });

    if (type === 'advance') {
      const roll = rollDice(1, 6, 'Advance');
      dispatch({ type: 'ROLL_ADVANCE', payload: { unitId: unit.id, roll } });
    }

    if (type === 'stationary') {
      dispatch({ type: 'COMPLETE_UNIT_ACTIVATION', payload: { unitId: unit.id } });
    }
  };

  const handleResetPositions = () => {
    for (const [modelId, pos] of Object.entries(originalPositionsRef.current)) {
      dispatch({
        type: 'MOVE_MODEL',
        payload: { modelId, position: pos },
      });
    }
  };

  const handleCommitMovement = () => {
    // Commit current positions of all models in the unit
    const positions: Record<string, { x: number; y: number }> = {};
    for (const model of activeModels) {
      positions[model.id] = model.position;
    }
    dispatch({ type: 'COMMIT_MOVEMENT', payload: { unitId: unit.id, positions } });
    dispatch({ type: 'COMPLETE_UNIT_ACTIVATION', payload: { unitId: unit.id } });
    originalPositionsRef.current = {};
  };

  if (isCompleted) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> — movement complete
        </div>
        <div className="text-xs text-green-400">
          {moveType === 'stationary' && 'Remained Stationary'}
          {moveType === 'normal' && 'Normal Move'}
          {moveType === 'advance' && `Advanced (+${advanceRoll ?? '?'}")`}
          {moveType === 'fall_back' && 'Fell Back'}
        </div>
      </div>
    );
  }

  if (moveType && moveType !== 'stationary') {
    const maxMove = moveType === 'advance' ? moveChar + (advanceRoll ?? 0) : moveChar;
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{unit.name}</span> —{' '}
          {moveType === 'normal' && 'Normal Move'}
          {moveType === 'advance' && `Advance (+${advanceRoll}")`}
          {moveType === 'fall_back' && 'Fall Back'}
        </div>
        <div className="text-sm text-blue-300">
          Max: {maxMove}" per model (M{baseMoveChar}
          {orderBonus > 0 ? ` +${orderBonus}" Order` : ''}
          {moveType === 'advance' ? ` + ${advanceRoll}"` : ''})
        </div>
        <div className="text-xs text-gray-500">
          Drag models on the board to move them, then commit.
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleResetPositions}
            className="flex-1 px-3 py-2 rounded text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
          >
            Reset Positions
          </button>
          <button
            onClick={handleCommitMovement}
            className="flex-1 px-3 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Commit Movement
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400">
        <span className="font-medium text-white">{unit.name}</span> — {activeModels.length} model{activeModels.length !== 1 ? 's' : ''}, M{moveChar}"
      </div>

      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Declare Movement</div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => handleDeclare('normal')}
          className="px-2 py-2 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Normal Move
          <div className="text-[10px] opacity-70 mt-0.5">Up to {moveChar}"</div>
        </button>
        <button
          onClick={() => handleDeclare('advance')}
          className="px-2 py-2 rounded text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
        >
          Advance
          <div className="text-[10px] opacity-70 mt-0.5">{moveChar}" + D6</div>
        </button>
        <button
          onClick={() => handleDeclare('fall_back')}
          className="px-2 py-2 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          Fall Back
          <div className="text-[10px] opacity-70 mt-0.5">Up to {moveChar}"</div>
        </button>
        <button
          onClick={() => handleDeclare('stationary')}
          className="px-2 py-2 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
        >
          Stationary
          <div className="text-[10px] opacity-70 mt-0.5">No move</div>
        </button>
      </div>

      {/* Transport controls */}
      {unit.transportCapacity != null && (
        <div className="pt-2 border-t border-gray-700/50">
          <TransportPanel />
        </div>
      )}
    </div>
  );
}
