import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { Enhancement } from '@openhammer/core';

/**
 * Sprint H: Enhancement assignment dialog.
 * Assign enhancements to eligible CHARACTER models.
 */
export function EnhancementAssignment({ playerId }: { playerId: string }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [cost, setCost] = useState(0);
  const [selectedModelId, setSelectedModelId] = useState('');

  const playerUnits = Object.values(gameState.units).filter(u => u.playerId === playerId);
  const characterModels = playerUnits
    .filter(u => u.keywords.includes('CHARACTER'))
    .flatMap(u => u.modelIds.map(id => ({ model: gameState.models[id], unit: u })))
    .filter(({ model }) => model && model.status === 'active');

  // Models already assigned an enhancement
  const assignedModelIds = new Set(
    gameState.enhancements.filter(e => e.assignedToModelId).map(e => e.assignedToModelId!),
  );

  const handleAssign = () => {
    if (!name.trim() || !selectedModelId) return;
    const enhancement: Enhancement = {
      id: crypto.randomUUID(),
      name: name.trim(),
      pointsCost: cost,
      assignedToModelId: selectedModelId,
    };
    dispatch({ type: 'ASSIGN_ENHANCEMENT', payload: { enhancement, modelId: selectedModelId } });
    setName('');
    setCost(0);
    setSelectedModelId('');
    setShowForm(false);
  };

  const handleRemove = (enhancementId: string) => {
    dispatch({ type: 'REMOVE_ENHANCEMENT', payload: { enhancementId } });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Enhancements</div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[10px] text-blue-400 hover:text-blue-300"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Existing enhancements */}
      {gameState.enhancements.length > 0 && (
        <div className="space-y-1">
          {gameState.enhancements.map((e) => {
            const model = e.assignedToModelId ? gameState.models[e.assignedToModelId] : null;
            return (
              <div key={e.id} className="flex items-center gap-1.5 text-xs bg-gray-700/40 rounded px-2 py-1">
                <span className="text-purple-300 font-medium">{e.name}</span>
                <span className="text-gray-500">({e.pointsCost} pts)</span>
                <span className="text-gray-500">→</span>
                <span className="text-white">{model?.name ?? '?'}</span>
                <button
                  onClick={() => handleRemove(e.id)}
                  className="ml-auto text-red-400 hover:text-red-300 text-[10px]"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="bg-gray-700/40 rounded p-2 space-y-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enhancement name"
            className="w-full bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-blue-500"
          />
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(parseInt(e.target.value) || 0)}
            placeholder="Points cost"
            className="w-full bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-blue-500"
          />
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="w-full bg-gray-800 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-blue-500"
          >
            <option value="">Select CHARACTER model...</option>
            {characterModels
              .filter(({ model }) => !assignedModelIds.has(model.id))
              .map(({ model, unit }) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({unit.name})
                </option>
              ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!name.trim() || !selectedModelId}
            className="w-full px-2 py-1 rounded text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40"
          >
            Assign Enhancement
          </button>
        </div>
      )}
    </div>
  );
}
