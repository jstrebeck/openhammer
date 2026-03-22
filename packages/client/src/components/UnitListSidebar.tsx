import { useState, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { getEdition, getTransportForUnit, getEmbarkedModelCount } from '@openhammer/core';
import { ImportArmyDialog } from './ImportArmyDialog';
import { DeploymentZonePanel } from './DeploymentZonePanel';
import { StratagemPanel } from './StratagemPanel';
import { UnitDataCard } from './UnitDataCard';

export function UnitListSidebar() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);
  const setSelectedModelIds = useUIStore((s) => s.setSelectedModelIds);
  const gameSetupComplete = useUIStore((s) => s.gameSetupComplete);
  const showDeploymentZones = useUIStore((s) => s.showDeploymentZones);
  const setShowDeploymentZones = useUIStore((s) => s.setShowDeploymentZones);
  const [showImport, setShowImport] = useState(false);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [activePlayerTab, setActivePlayerTab] = useState<string | null>(null);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [hoverY, setHoverY] = useState(0);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleUnitMouseEnter = useCallback((unitId: string, e: React.MouseEvent) => {
    const rect = sidebarRef.current?.getBoundingClientRect();
    if (!rect) return;
    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredUnitId(unitId);
    setHoverY(targetRect.top - rect.top);
  }, []);

  const handleUnitMouseLeave = useCallback(() => {
    setHoveredUnitId(null);
  }, []);

  const edition = getEdition(gameState.editionId);
  const currentPhase = edition?.phases[gameState.turnState.currentPhaseIndex];
  const hasZones = Object.keys(gameState.deploymentZones).length > 0;

  const models = Object.values(gameState.models).filter((m) => m.status === 'active');
  const units = Object.values(gameState.units);
  const players = Object.values(gameState.players);

  const unattachedModels = models.filter((m) => !m.unitId);

  const totalPoints = units.reduce((sum, u) => sum + (u.points ?? 0), 0);

  // Resolve active tab: default to first player if not set or if selected player was removed
  const resolvedTab = players.find((p) => p.id === activePlayerTab)
    ? activePlayerTab
    : players[0]?.id ?? null;

  // Filter units by active player tab (when multiple players exist)
  const filteredUnits = players.length > 1 && resolvedTab
    ? units.filter((u) => u.playerId === resolvedTab)
    : units;

  return (
    <>
      <div ref={sidebarRef} className="absolute left-0 top-0 h-full w-60 bg-gray-800/90 backdrop-blur border-r border-gray-700 flex flex-col overflow-hidden">
        {/* Turn Info */}
        <div className="p-3 border-b border-gray-700">
          <div className="text-xs text-gray-400">
            Round {gameState.turnState.roundNumber}
          </div>
          {currentPhase && (
            <div className="text-sm text-white font-medium">{currentPhase.name}</div>
          )}
        </div>

        {/* Import & Deployment — shown before setup is complete */}
        {!gameSetupComplete && (
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
        )}

        {/* Points total when setup is complete */}
        {gameSetupComplete && totalPoints > 0 && (
          <div className="px-3 py-1.5 border-b border-gray-700">
            <div className="text-xs text-gray-400 text-center">{totalPoints} pts</div>
          </div>
        )}

        {/* Deployment Zones — presets before setup, toggle after */}
        {!gameSetupComplete ? (
          <div className="px-2 py-2 border-b border-gray-700">
            <DeploymentZonePanel />
          </div>
        ) : hasZones ? (
          <div className="px-2 py-1.5 border-b border-gray-700">
            <button
              onClick={() => setShowDeploymentZones(!showDeploymentZones)}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center justify-between"
            >
              <span>Deployment Zones</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${showDeploymentZones ? 'bg-blue-600/30 text-blue-300' : 'bg-gray-700 text-gray-500'}`}>
                {showDeploymentZones ? 'Visible' : 'Hidden'}
              </span>
            </button>
          </div>
        ) : null}

        {/* Player Tabs */}
        {players.length > 1 && (
          <div className="flex border-b border-gray-700">
            {players.map((player) => {
              const isActive = resolvedTab === player.id;
              const playerUnits = units.filter((u) => u.playerId === player.id);
              const pts = playerUnits.reduce((sum, u) => sum + (u.points ?? 0), 0);
              return (
                <button
                  key={player.id}
                  onClick={() => setActivePlayerTab(player.id)}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
                    isActive
                      ? 'text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className="truncate">{player.name}</span>
                  </div>
                  {pts > 0 && (
                    <div className="text-[10px] text-gray-500 mt-0.5">{pts} pts</div>
                  )}
                  {isActive && (
                    <div
                      className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Unit List */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 px-1">
            Units ({filteredUnits.length})
          </div>

          {filteredUnits.map((unit) => {
            const unitModels = unit.modelIds
              .map((id) => gameState.models[id])
              .filter((m) => m && m.status === 'active');
            const allSelected = unitModels.length > 0 && unitModels.every((m) => selectedModelIds.includes(m.id));
            const isExpanded = expandedUnitId === unit.id;

            return (
              <div
                key={unit.id}
                className="mb-1"
                onMouseEnter={(e) => handleUnitMouseEnter(unit.id, e)}
                onMouseLeave={handleUnitMouseLeave}
              >
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
                  <div className="flex items-center gap-1 flex-wrap">
                    {unit.points != null && (
                      <span className="text-xs text-gray-500">{unit.points} pts</span>
                    )}
                    {getTransportForUnit(gameState, unit.id) && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-900/50 text-cyan-300">Embarked</span>
                    )}
                    {gameState.reserves[unit.id] && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300">Reserves</span>
                    )}
                    {gameState.hoverModeUnits.includes(unit.id) && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-900/50 text-amber-300">Hover</span>
                    )}
                    {unit.transportCapacity != null && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-teal-900/50 text-teal-300">
                        {getEmbarkedModelCount(gameState, unit.id)}/{unit.transportCapacity}
                      </span>
                    )}
                  </div>
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
              No models on board. Import an army list to get started.
            </div>
          )}
        </div>

        {/* Stratagems */}
        <div className="border-t border-gray-700">
          <StratagemPanel />
        </div>

        {/* Selection Info */}
        {selectedModelIds.length > 0 && (
          <div className="p-3 border-t border-gray-700 text-xs text-gray-400">
            {selectedModelIds.length} selected
          </div>
        )}
      </div>

      {/* Hover Data Card — positioned to the right of the sidebar */}
      {hoveredUnitId && (() => {
        const hoveredUnit = gameState.units[hoveredUnitId];
        if (!hoveredUnit) return null;
        const hoveredModels = hoveredUnit.modelIds
          .map((id) => gameState.models[id])
          .filter(Boolean);
        if (hoveredModels.length === 0) return null;
        // Clamp Y so the card doesn't overflow below the viewport
        const clampedY = Math.min(hoverY, window.innerHeight - 400);
        return (
          <div
            className="absolute z-50 pointer-events-none"
            style={{ left: 244, top: Math.max(0, clampedY) }}
          >
            <UnitDataCard unit={hoveredUnit} models={hoveredModels} />
          </div>
        );
      })()}

      {showImport && <ImportArmyDialog onClose={() => setShowImport(false)} />}
    </>
  );
}
