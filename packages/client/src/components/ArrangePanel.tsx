import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import {
  getFormationOptions,
  gridFormation,
  clusterFormation,
} from '@openhammer/core';
import type { Model, Unit } from '@openhammer/core';

/**
 * Floating panel that shows arrangement options when a full unit is selected.
 * Appears below the toolbar. Lets the player quickly arrange models into
 * grid formations or a tight cluster.
 */
export function ArrangePanel() {
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  // Determine if the selection is a complete unit
  const selectedUnit = useMemo((): { unit: Unit; models: Model[] } | null => {
    if (selectedModelIds.length < 2) return null;

    // Check if all selected models belong to the same unit
    const firstModel = gameState.models[selectedModelIds[0]];
    if (!firstModel) return null;

    const unit = gameState.units[firstModel.unitId];
    if (!unit) return null;

    // Get all active models in this unit
    const activeModels = unit.modelIds
      .map((id) => gameState.models[id])
      .filter((m): m is Model => m != null && m.status === 'active');

    // Check that the selection matches all active models in the unit
    const selectedSet = new Set(selectedModelIds);
    const allSelected = activeModels.every((m) => selectedSet.has(m.id));
    if (!allSelected) return null;

    // Must have the same count (no extra selections from other units)
    if (selectedModelIds.length !== activeModels.length) return null;

    return { unit, models: activeModels };
  }, [selectedModelIds, gameState.models, gameState.units]);

  const formationOptions = useMemo(() => {
    if (!selectedUnit) return [];
    return getFormationOptions(selectedUnit.models.length);
  }, [selectedUnit]);

  if (!selectedUnit || formationOptions.length === 0) return null;

  const { unit, models } = selectedUnit;

  // Compute the center of the currently selected models (centroid)
  const unitCenter = {
    x: models.reduce((sum, m) => sum + m.position.x, 0) / models.length,
    y: models.reduce((sum, m) => sum + m.position.y, 0) / models.length,
  };

  // Use the first model's shape and facing as reference
  const refShape = models[0].baseShape;
  const refFacing = models[0].facing;

  const applyFormation = (positions: { x: number; y: number }[]) => {
    models.forEach((model, i) => {
      if (positions[i]) {
        dispatch({
          type: 'MOVE_MODEL',
          payload: { modelId: model.id, position: positions[i] },
        });
      }
    });
  };

  const handleGrid = (cols: number, rows: number) => {
    const positions = gridFormation(unitCenter, models.length, cols, rows, refShape, refFacing);
    applyFormation(positions);
  };

  const handleCluster = () => {
    const positions = clusterFormation(unitCenter, models.length, refShape);
    applyFormation(positions);
  };

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-gray-800/95 backdrop-blur rounded-lg px-3 py-2 shadow-lg border border-gray-700 z-20">
      <div className="text-xs text-gray-400 mb-1.5">
        Arrange {unit.name} ({models.length} models)
      </div>
      <div className="flex items-center gap-1 flex-wrap max-w-xs">
        {formationOptions.map((opt) => (
          <button
            key={`${opt.cols}x${opt.rows}`}
            onClick={() => handleGrid(opt.cols, opt.rows)}
            className="px-2 py-1 rounded text-xs font-medium text-gray-300 hover:bg-gray-600 bg-gray-700 transition-colors whitespace-nowrap"
            title={`Arrange in a ${opt.cols} column by ${opt.rows} row grid`}
          >
            {opt.label}
          </button>
        ))}
        <div className="w-px h-5 bg-gray-600 mx-0.5" />
        <button
          onClick={handleCluster}
          className="px-2 py-1 rounded text-xs font-medium text-amber-300 hover:bg-amber-800/40 bg-gray-700 transition-colors"
          title="Pack into the tightest possible formation"
        >
          Cluster
        </button>
      </div>
    </div>
  );
}
