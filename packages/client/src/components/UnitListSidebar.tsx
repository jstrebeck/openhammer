import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { getEdition } from '@openhammer/core';
import { ImportArmyDialog } from './ImportArmyDialog';
import { DeploymentZonePanel } from './DeploymentZonePanel';

export function UnitListSidebar() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);
  const setSelectedModelIds = useUIStore((s) => s.setSelectedModelIds);
  const [showImport, setShowImport] = useState(false);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  const edition = getEdition(gameState.editionId);
  const currentPhase = edition?.phases[gameState.turnState.currentPhaseIndex];

  const models = Object.values(gameState.models).filter((m) => m.status === 'active');
  const units = Object.values(gameState.units);

  const unattachedModels = models.filter((m) => !m.unitId);

  const totalPoints = units.reduce((sum, u) => sum + (u.points ?? 0), 0);

  return (
    <>
      <div className="absolute left-0 top-0 h-full w-60 bg-gray-800/90 backdrop-blur border-r border-gray-700 flex flex-col overflow-hidden">
        {/* Turn Info */}
        <div className="p-3 border-b border-gray-700">
          <div className="text-xs text-gray-400">
            Round {gameState.turnState.roundNumber}
          </div>
          {currentPhase && (
            <div className="text-sm text-white font-medium">{currentPhase.name}</div>
          )}
        </div>

        {/* Import button */}
        <div className="p-2 border-b border-gray-700">
          <button
            onClick={() => setShowImport(true)}
            className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            Import Army List
          </button>
          {totalPoints > 0 && (
            <div className="text-xs text-gray-400 mt-1 text-center">{totalPoints} pts</div>
          )}
        </div>

        {/* Unit List */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Deployment Zones */}
          <div className="mb-3 pb-2 border-b border-gray-700">
            <DeploymentZonePanel />
          </div>

          <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 px-1">
            Units ({units.length})
          </div>

          {units.map((unit) => {
            const unitModels = unit.modelIds
              .map((id) => gameState.models[id])
              .filter((m) => m && m.status === 'active');
            const allSelected = unitModels.length > 0 && unitModels.every((m) => selectedModelIds.includes(m.id));
            const isExpanded = expandedUnitId === unit.id;

            return (
              <div key={unit.id} className="mb-1">
                <button
                  onClick={() => {
                    setSelectedModelIds(allSelected ? [] : unitModels.map((m) => m.id));
                    setExpandedUnitId(isExpanded ? null : unit.id);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                    allSelected
                      ? 'bg-blue-600/30 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium truncate">{unit.name}</span>
                    <span className="text-xs text-gray-500 ml-1">{unitModels.length}m</span>
                  </div>
                  {unit.points != null && (
                    <div className="text-xs text-gray-500">{unit.points} pts</div>
                  )}
                </button>

                {/* Expanded unit detail */}
                {isExpanded && (
                  <div className="ml-2 mt-1 mb-2 text-xs space-y-1">
                    {/* Model wound tracking */}
                    {unitModels.map((model) => (
                      <div key={model.id} className="flex items-center gap-1 px-1">
                        <span className="text-gray-400 truncate flex-1">{model.name}</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({ type: 'SET_MODEL_WOUNDS', payload: { modelId: model.id, wounds: model.wounds - 1 } });
                            }}
                            className="w-4 h-4 rounded bg-red-800 hover:bg-red-700 text-white text-[10px] leading-none flex items-center justify-center"
                          >
                            -
                          </button>
                          <span className={`w-8 text-center ${model.wounds < model.maxWounds ? 'text-red-400' : 'text-gray-300'}`}>
                            {model.wounds}/{model.maxWounds}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({ type: 'SET_MODEL_WOUNDS', payload: { modelId: model.id, wounds: model.wounds + 1 } });
                            }}
                            className="w-4 h-4 rounded bg-green-800 hover:bg-green-700 text-white text-[10px] leading-none flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Stats line */}
                    {unitModels[0] && (
                      <div className="px-1 pt-1 text-gray-500 border-t border-gray-700/50">
                        M{unitModels[0].stats.move}" T{unitModels[0].stats.toughness} Sv{unitModels[0].stats.save}+ W{unitModels[0].stats.wounds} Ld{unitModels[0].stats.leadership}+ OC{unitModels[0].stats.objectiveControl}
                      </div>
                    )}

                    {/* Weapons */}
                    {unit.weapons.length > 0 && (
                      <div className="px-1 pt-1 border-t border-gray-700/50">
                        {unit.weapons.map((w) => (
                          <div key={w.id} className="text-gray-500">
                            {w.name} {w.type === 'ranged' ? `${w.range}"` : 'melee'} A{w.attacks} {w.type === 'ranged' ? 'BS' : 'WS'}{w.skill}+ S{w.strength} AP{w.ap} D{w.damage}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Keywords */}
                    {unit.keywords.length > 0 && (
                      <div className="px-1 pt-1 border-t border-gray-700/50 text-gray-500">
                        {unit.keywords.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {unattachedModels.length > 0 && (
            <>
              <div className="text-xs text-gray-400 uppercase tracking-wider mt-3 mb-2 px-1">
                Unattached ({unattachedModels.length})
              </div>
              {unattachedModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModelIds([model.id])}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm mb-0.5 transition-colors ${
                    selectedModelIds.includes(model.id)
                      ? 'bg-blue-600/30 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {model.name}
                </button>
              ))}
            </>
          )}

          {models.length === 0 && units.length === 0 && (
            <div className="text-sm text-gray-500 px-1">
              No models on board. Import an army list or use the Place tool.
            </div>
          )}
        </div>

        {/* Selection Info */}
        {selectedModelIds.length > 0 && (
          <div className="p-3 border-t border-gray-700 text-xs text-gray-400">
            {selectedModelIds.length} selected
          </div>
        )}
      </div>

      {showImport && <ImportArmyDialog onClose={() => setShowImport(false)} />}
    </>
  );
}
