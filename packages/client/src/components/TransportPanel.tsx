import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { canEmbark, canDisembark, getEmbarkedModelCount, getTransportForUnit } from '@openhammer/core';

export function TransportPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);

  const firstModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const unit = firstModel?.unitId ? gameState.units[firstModel.unitId] : null;

  if (!unit) return null;

  // Check if this unit is a transport
  const isTransport = unit.transportCapacity != null;
  // Check if this unit is embarked on something
  const embarkedOnTransportId = getTransportForUnit(gameState, unit.id);

  if (!isTransport && !embarkedOnTransportId) return null;

  // --- Transport view: show capacity and embarked units ---
  if (isTransport) {
    const embarkedUnitIds = gameState.embarkedUnits[unit.id] ?? [];
    const currentLoad = getEmbarkedModelCount(gameState, unit.id);
    const capacity = unit.transportCapacity!;

    // Find nearby friendly units that could embark
    const embarkableUnits = Object.values(gameState.units).filter((u) => {
      if (u.id === unit.id) return false;
      if (u.transportCapacity != null) return false; // no transport nesting
      return canEmbark(gameState, u.id, unit.id).allowed;
    });

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Transport</div>
        <div className="text-xs text-gray-300">
          Capacity: <span className="text-white font-medium">{currentLoad}/{capacity}</span>
          {unit.firingDeck != null && (
            <span className="ml-2 text-amber-400">Firing Deck: {unit.firingDeck}</span>
          )}
        </div>

        {/* Embarked units */}
        {embarkedUnitIds.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Embarked</div>
            {embarkedUnitIds.map((embUnitId) => {
              const embUnit = gameState.units[embUnitId];
              if (!embUnit) return null;
              const canDis = canDisembark(gameState, embUnitId, unit.id);
              return (
                <div key={embUnitId} className="flex items-center justify-between bg-gray-700/50 rounded px-2 py-1">
                  <span className="text-xs text-gray-300">{embUnit.name}</span>
                  <button
                    onClick={() => {
                      if (!canDis.allowed) return;
                      // Place models near the transport
                      const positions: Record<string, { x: number; y: number }> = {};
                      const transportModel = unit.modelIds
                        .map((id) => gameState.models[id])
                        .find((m) => m && m.status === 'active');
                      if (!transportModel) return;

                      let offset = 0;
                      for (const modelId of embUnit.modelIds) {
                        const model = gameState.models[modelId];
                        if (model && model.status === 'active') {
                          positions[modelId] = {
                            x: transportModel.position.x + 2 + offset,
                            y: transportModel.position.y + 2,
                          };
                          offset += 1.5;
                        }
                      }
                      dispatch({
                        type: 'DISEMBARK',
                        payload: { unitId: embUnitId, transportId: unit.id, positions },
                      });
                    }}
                    disabled={!canDis.allowed}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      canDis.allowed
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    }`}
                    title={canDis.reason}
                  >
                    Disembark
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Embarkable units */}
        {embarkableUnits.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Nearby Units</div>
            {embarkableUnits.map((eu) => (
              <div key={eu.id} className="flex items-center justify-between bg-gray-700/50 rounded px-2 py-1">
                <span className="text-xs text-gray-300">{eu.name}</span>
                <button
                  onClick={() => {
                    dispatch({
                      type: 'EMBARK',
                      payload: { unitId: eu.id, transportId: unit.id },
                    });
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  Embark
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Embarked unit view ---
  if (embarkedOnTransportId) {
    const transport = gameState.units[embarkedOnTransportId];
    const canDis = canDisembark(gameState, unit.id, embarkedOnTransportId);
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Embarked</div>
        <div className="text-xs text-gray-300">
          On: <span className="text-white font-medium">{transport?.name ?? 'Unknown'}</span>
        </div>
        <button
          onClick={() => {
            if (!canDis.allowed || !transport) return;
            const transportModel = transport.modelIds
              .map((id) => gameState.models[id])
              .find((m) => m && m.status === 'active');
            if (!transportModel) return;

            const positions: Record<string, { x: number; y: number }> = {};
            let offset = 0;
            for (const modelId of unit.modelIds) {
              const model = gameState.models[modelId];
              if (model && model.status === 'active') {
                positions[modelId] = {
                  x: transportModel.position.x + 2 + offset,
                  y: transportModel.position.y + 2,
                };
                offset += 1.5;
              }
            }
            dispatch({
              type: 'DISEMBARK',
              payload: { unitId: unit.id, transportId: embarkedOnTransportId, positions },
            });
          }}
          disabled={!canDis.allowed}
          className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
            canDis.allowed
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
          title={canDis.reason}
        >
          Disembark
        </button>
        {!canDis.allowed && canDis.reason && (
          <div className="text-[10px] text-red-400">{canDis.reason}</div>
        )}
      </div>
    );
  }

  return null;
}
