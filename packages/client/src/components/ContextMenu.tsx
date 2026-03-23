import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import type { TerrainTrait } from '@openhammer/core';
import { TERRAIN_TRAIT_DESCRIPTIONS, unitHasAbility, getTransportForUnit } from '@openhammer/core';

const ALL_TRAITS: TerrainTrait[] = ['obscuring', 'dense', 'breachable', 'defensible', 'unstable', 'smoke'];

export function ContextMenu() {
  const contextMenu = useUIStore((s) => s.contextMenu);
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const dispatch = useGameStore((s) => s.dispatch);
  const gameState = useGameStore((s) => s.gameState);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editingWounds, setEditingWounds] = useState(false);
  const [woundValue, setWoundValue] = useState('');
  const [editingHeight, setEditingHeight] = useState(false);
  const [heightValue, setHeightValue] = useState('');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      setEditingWounds(false);
      setEditingHeight(false);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  // Model context menu
  if (contextMenu.type === 'model') {
    const model = gameState.models[contextMenu.targetId];
    if (!model) return null;

    const handleRemove = () => {
      dispatch({ type: 'REMOVE_MODEL', payload: { modelId: model.id } });
      closeContextMenu();
    };

    const handleSetWounds = () => {
      setEditingWounds(true);
      setWoundValue(String(model.wounds));
    };

    const handleWoundsSubmit = () => {
      const w = parseInt(woundValue, 10);
      if (!isNaN(w)) {
        dispatch({ type: 'SET_MODEL_WOUNDS', payload: { modelId: model.id, wounds: w } });
      }
      setEditingWounds(false);
      closeContextMenu();
    };

    const unit = model.unitId ? gameState.units[model.unitId] : null;
    const isInReserves = unit ? !!gameState.reserves[unit.id] : false;
    const hasDeepStrike = unit ? unitHasAbility(unit, 'DEEP STRIKE') : false;
    const isEmbarked = unit ? getTransportForUnit(gameState, unit.id) !== null : false;

    const handleSendToDeepStrike = () => {
      if (!unit) return;
      dispatch({
        type: 'SET_UNIT_IN_RESERVES',
        payload: { unitId: unit.id, reserveType: 'deep_strike', availableFromRound: 2 },
      });
      closeContextMenu();
    };

    const handleSendToStrategicReserves = () => {
      if (!unit) return;
      dispatch({
        type: 'SET_UNIT_IN_RESERVES',
        payload: { unitId: unit.id, reserveType: 'strategic', availableFromRound: 2 },
      });
      closeContextMenu();
    };

    return (
      <div
        ref={menuRef}
        className="fixed z-50 bg-gray-800 rounded-lg shadow-xl border border-gray-600 py-1 min-w-[180px]"
        style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
      >
        <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700">
          {model.name}
          {unit && <span className="text-gray-500"> ({unit.name})</span>}
        </div>
        {!editingWounds ? (
          <>
            <button onClick={handleSetWounds} className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">
              Set Wounds ({model.wounds}/{model.maxWounds})
            </button>

            {/* Deep Strike / Reserves options — only when not already in reserves and not embarked */}
            {unit && !isInReserves && !isEmbarked && !gameState.gameStarted && (
              <div className="border-t border-gray-700 mt-1 pt-1">
                {hasDeepStrike && (
                  <button onClick={handleSendToDeepStrike} className="w-full text-left px-3 py-1.5 text-sm text-purple-300 hover:bg-gray-700">
                    Send to Deep Strike
                  </button>
                )}
                <button onClick={handleSendToStrategicReserves} className="w-full text-left px-3 py-1.5 text-sm text-blue-300 hover:bg-gray-700">
                  Send to Strategic Reserves
                </button>
              </div>
            )}

            <div className="border-t border-gray-700 mt-1 pt-1">
              <button onClick={handleRemove} className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-gray-700">
                Remove
              </button>
            </div>
          </>
        ) : (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <input
              type="number"
              value={woundValue}
              onChange={(e) => setWoundValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWoundsSubmit()}
              className="w-16 bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
              min={0} max={model.maxWounds} autoFocus
            />
            <button onClick={handleWoundsSubmit} className="text-sm text-blue-400 hover:text-blue-300">Set</button>
          </div>
        )}
      </div>
    );
  }

  // Terrain context menu
  if (contextMenu.type === 'terrain') {
    const terrain = gameState.terrain[contextMenu.targetId];
    if (!terrain) return null;

    const handleRemove = () => {
      dispatch({ type: 'REMOVE_TERRAIN', payload: { terrainId: terrain.id } });
      closeContextMenu();
    };

    const handleToggleTrait = (trait: TerrainTrait) => {
      const hasIt = terrain.traits.includes(trait);
      const newTraits = hasIt
        ? terrain.traits.filter((t) => t !== trait)
        : [...terrain.traits, trait];
      dispatch({ type: 'UPDATE_TERRAIN', payload: { terrainId: terrain.id, changes: { traits: newTraits } } });
    };

    const handleHeightSubmit = () => {
      const h = parseFloat(heightValue);
      if (!isNaN(h) && h >= 0) {
        dispatch({ type: 'UPDATE_TERRAIN', payload: { terrainId: terrain.id, changes: { height: h } } });
      }
      setEditingHeight(false);
    };

    return (
      <div
        ref={menuRef}
        className="fixed z-50 bg-gray-800 rounded-lg shadow-xl border border-gray-600 py-1 min-w-[200px]"
        style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
      >
        <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700">
          {terrain.label}
        </div>

        {/* Height */}
        {!editingHeight ? (
          <button
            onClick={() => { setEditingHeight(true); setHeightValue(String(terrain.height)); }}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
          >
            Height: {terrain.height}"
          </button>
        ) : (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <input
              type="number"
              value={heightValue}
              onChange={(e) => setHeightValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleHeightSubmit()}
              className="w-16 bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
              min={0} step={0.5} autoFocus
            />
            <button onClick={handleHeightSubmit} className="text-sm text-blue-400 hover:text-blue-300">Set</button>
          </div>
        )}

        {/* Traits */}
        <div className="border-t border-gray-700 mt-1 pt-1">
          <div className="px-3 py-1 text-xs text-gray-400">Traits</div>
          {ALL_TRAITS.map((trait) => (
            <button
              key={trait}
              onClick={() => handleToggleTrait(trait)}
              className="w-full text-left px-3 py-1 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
              title={TERRAIN_TRAIT_DESCRIPTIONS[trait]}
            >
              <span className={`w-3 h-3 rounded border ${terrain.traits.includes(trait) ? 'bg-blue-500 border-blue-400' : 'border-gray-500'}`} />
              {trait}
            </button>
          ))}
        </div>

        <div className="border-t border-gray-700 mt-1 pt-1">
          <button onClick={handleRemove} className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-gray-700">
            Remove
          </button>
        </div>
      </div>
    );
  }

  return null;
}
