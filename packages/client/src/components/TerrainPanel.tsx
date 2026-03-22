import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { TERRAIN_TEMPLATES } from '@openhammer/core';

export function TerrainPanel() {
  const activeTool = useUIStore((s) => s.activeTool);
  const terrainPlacement = useUIStore((s) => s.terrainPlacement);
  const setTerrainPlacementMode = useUIStore((s) => s.setTerrainPlacementMode);
  const setTerrainTemplate = useUIStore((s) => s.setTerrainTemplate);
  const resetTerrainPlacement = useUIStore((s) => s.resetTerrainPlacement);
  const dispatch = useGameStore((s) => s.dispatch);

  if (activeTool !== 'terrain') return null;

  const handleFinishDraw = () => {
    const { vertices } = terrainPlacement;
    if (vertices.length < 3) return;
    const terrain = {
      id: crypto.randomUUID(),
      polygon: vertices,
      height: 5,
      traits: [] as string[],
      label: 'Custom Terrain',
    };
    dispatch({ type: 'PLACE_TERRAIN', payload: { terrain: terrain as any } });
    resetTerrainPlacement();
  };

  return (
    <div className="absolute right-0 top-0 h-full w-56 bg-gray-800/90 backdrop-blur border-l border-gray-700 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700">
        <div className="text-sm text-white font-medium mb-2">Terrain Placement</div>
        <div className="flex gap-1">
          <button
            onClick={() => setTerrainPlacementMode('template')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
              terrainPlacement.mode === 'template' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => setTerrainPlacementMode('draw')}
            className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
              terrainPlacement.mode === 'draw' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            Draw
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {terrainPlacement.mode === 'template' && (
          <>
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 px-1">
              Click board to place
            </div>
            {TERRAIN_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.name}
                onClick={() => setTerrainTemplate(tmpl)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm mb-0.5 transition-colors ${
                  terrainPlacement.template?.name === tmpl.name
                    ? 'bg-blue-600/30 text-blue-300'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <div className="font-medium">{tmpl.name}</div>
                <div className="text-xs text-gray-400">
                  {tmpl.height}" tall — {tmpl.traits.join(', ') || 'no traits'}
                </div>
              </button>
            ))}
          </>
        )}

        {terrainPlacement.mode === 'draw' && (
          <>
            <div className="text-xs text-gray-400 px-1 mb-2">
              Click to add vertices. Finish with the button below when you have 3+ points.
            </div>
            <div className="text-sm text-gray-300 px-1 mb-2">
              Vertices: {terrainPlacement.vertices.length}
            </div>
            <div className="flex gap-1 px-1">
              <button
                onClick={handleFinishDraw}
                disabled={terrainPlacement.vertices.length < 3}
                className="flex-1 px-2 py-1.5 rounded text-sm font-medium bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-700 transition-colors"
              >
                Finish
              </button>
              <button
                onClick={resetTerrainPlacement}
                className="flex-1 px-2 py-1.5 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                Reset
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
