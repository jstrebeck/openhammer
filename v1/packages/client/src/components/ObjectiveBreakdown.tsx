import { useGameStore } from '../store/gameStore';
import { distanceToPoint } from '@openhammer/core';

/**
 * Sprint O: OC breakdown on hover.
 * Shows per-player OC totals when hovering over objectives.
 */
export function ObjectiveBreakdown({ objectiveId }: { objectiveId: string }) {
  const gameState = useGameStore((s) => s.gameState);
  const objective = gameState.objectives[objectiveId];

  if (!objective) return null;

  // Calculate OC per player within 3" of objective
  const ocByPlayer: Record<string, { playerId: string; playerName: string; color: string; oc: number }> = {};

  for (const unit of Object.values(gameState.units)) {
    const player = gameState.players[unit.playerId];
    if (!player) continue;

    for (const modelId of unit.modelIds) {
      const model = gameState.models[modelId];
      if (!model || model.status !== 'active') continue;

      const dist = distanceToPoint(model, objective.position);
      if (dist <= 3) {
        // Check battle-shock (OC = 0)
        const isBattleShocked = gameState.battleShocked.includes(unit.id);
        const oc = isBattleShocked ? 0 : model.stats.objectiveControl;

        if (!ocByPlayer[unit.playerId]) {
          ocByPlayer[unit.playerId] = {
            playerId: unit.playerId,
            playerName: player.name,
            color: player.color,
            oc: 0,
          };
        }
        ocByPlayer[unit.playerId].oc += oc;
      }
    }
  }

  const entries = Object.values(ocByPlayer);

  if (entries.length === 0) {
    return (
      <div className="text-xs text-gray-500">No models within range</div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
        Objective {objective.number} — OC Breakdown
      </div>
      {entries.map((e) => (
        <div key={e.playerId} className="flex items-center gap-2 text-xs">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="text-gray-300">{e.playerName}</span>
          <span className="font-bold text-white ml-auto">{e.oc} OC</span>
        </div>
      ))}
      {objective.controllingPlayerId ? (
        <div className="text-[10px] text-green-400 mt-1">
          Controlled by {gameState.players[objective.controllingPlayerId]?.name}
        </div>
      ) : entries.length > 1 ? (
        <div className="text-[10px] text-yellow-400 mt-1">Contested</div>
      ) : null}
    </div>
  );
}
