import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';

/**
 * Sprint O: Attached unit display.
 * Shows combined unit card for Leader + Bodyguard attached units.
 */
export function AttachedUnitDisplay() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);

  const firstModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const unit = firstModel?.unitId ? gameState.units[firstModel.unitId] : null;

  if (!unit) return null;

  // Check if this unit is a leader or bodyguard in an attached pair
  const isLeader = gameState.attachedUnits[unit.id] !== undefined;
  const isBodyguard = Object.values(gameState.attachedUnits).includes(unit.id);

  if (!isLeader && !isBodyguard) return null;

  let leaderUnit, bodyguardUnit;
  if (isLeader) {
    leaderUnit = unit;
    bodyguardUnit = gameState.units[gameState.attachedUnits[unit.id]];
  } else {
    bodyguardUnit = unit;
    const leaderEntry = Object.entries(gameState.attachedUnits).find(
      ([, bgId]) => bgId === unit.id,
    );
    leaderUnit = leaderEntry ? gameState.units[leaderEntry[0]] : null;
  }

  if (!leaderUnit || !bodyguardUnit) return null;

  const leaderModels = leaderUnit.modelIds
    .map((id) => gameState.models[id])
    .filter((m) => m && m.status === 'active');
  const bodyguardModels = bodyguardUnit.modelIds
    .map((id) => gameState.models[id])
    .filter((m) => m && m.status === 'active');

  return (
    <div className="border border-purple-600/50 rounded p-2 bg-purple-900/20">
      <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">Attached Unit</div>

      <div className="space-y-1.5">
        {/* Leader */}
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400 text-xs">★</span>
          <span className="text-xs font-medium text-white">{leaderUnit.name}</span>
          <span className="text-[10px] text-gray-500">
            ({leaderModels.length} model{leaderModels.length !== 1 ? 's' : ''})
          </span>
          <span className="text-[9px] px-1 py-0 rounded bg-yellow-700/50 text-yellow-300">LEADER</span>
        </div>

        {/* Bodyguard */}
        <div className="flex items-center gap-1.5">
          <span className="text-blue-400 text-xs">🛡</span>
          <span className="text-xs font-medium text-white">{bodyguardUnit.name}</span>
          <span className="text-[10px] text-gray-500">
            ({bodyguardModels.length} model{bodyguardModels.length !== 1 ? 's' : ''})
          </span>
          <span className="text-[9px] px-1 py-0 rounded bg-blue-700/50 text-blue-300">BODYGUARD</span>
        </div>
      </div>

      <div className="text-[10px] text-gray-500 mt-1.5">
        Wounds allocated to Bodyguard first. Precision bypasses.
      </div>
    </div>
  );
}
