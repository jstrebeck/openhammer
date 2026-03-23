import { useGameStore } from '../store/gameStore';

/**
 * Sprint H: Warlord selection.
 * Click to designate a CHARACTER model as Warlord.
 */
export function WarlordSelector({ playerId }: { playerId: string }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const playerUnits = Object.values(gameState.units).filter(u => u.playerId === playerId);
  const characterModels = playerUnits
    .filter(u => u.keywords.includes('CHARACTER'))
    .flatMap(u => u.modelIds.map(id => ({ model: gameState.models[id], unit: u })))
    .filter(({ model }) => model && model.status === 'active');

  if (characterModels.length === 0) {
    // No characters — pick any model
    const allModels = playerUnits
      .flatMap(u => u.modelIds.map(id => ({ model: gameState.models[id], unit: u })))
      .filter(({ model }) => model && model.status === 'active');

    if (allModels.length === 0) return null;

    return (
      <div className="space-y-1.5">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Designate Warlord</div>
        <div className="text-[10px] text-gray-400">No CHARACTER models — select any model:</div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {allModels.slice(0, 10).map(({ model, unit }) => (
            <button
              key={model.id}
              onClick={() => dispatch({ type: 'DESIGNATE_WARLORD', payload: { modelId: model.id } })}
              className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                gameState.warlordModelId === model.id
                  ? 'bg-yellow-600/30 border border-yellow-500 text-yellow-200'
                  : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span className="font-medium">{model.name}</span>
              <span className="text-gray-500 ml-1">({unit.name})</span>
              {gameState.warlordModelId === model.id && <span className="text-yellow-400 ml-1">★</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Designate Warlord</div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {characterModels.map(({ model, unit }) => (
          <button
            key={model.id}
            onClick={() => dispatch({ type: 'DESIGNATE_WARLORD', payload: { modelId: model.id } })}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              gameState.warlordModelId === model.id
                ? 'bg-yellow-600/30 border border-yellow-500 text-yellow-200'
                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span className="font-medium">{model.name}</span>
            <span className="text-gray-500 ml-1">({unit.name})</span>
            <span className="text-[9px] ml-1 px-1 py-0 rounded bg-purple-700/50 text-purple-300">CHARACTER</span>
            {gameState.warlordModelId === model.id && <span className="text-yellow-400 ml-1">★ Warlord</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
