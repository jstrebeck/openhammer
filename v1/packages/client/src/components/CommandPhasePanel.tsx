import { useGameStore } from '../store/gameStore';
import { rollDice, getOrderLeadershipBonus } from '@openhammer/core';
import { OrdersPanel } from './OrdersPanel';

export function CommandPhasePanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const activePlayerId = gameState.turnState.activePlayerId;
  const activePlayer = gameState.players[activePlayerId];
  const hasStarted = gameState.log.entries.some(
    (e) =>
      e.type === 'cp_change' &&
      'reason' in e &&
      e.reason === 'Command Phase CP gain' &&
      e.playerId === activePlayerId &&
      'timestamp' in e &&
      e.timestamp > (gameState.log.entries.find(
        (le) => le.type === 'phase_change' && 'roundNumber' in le && le.roundNumber === gameState.turnState.roundNumber && le.playerId === activePlayerId,
      )?.timestamp ?? 0),
  );

  // Find units needing Battle-shock tests (below half strength)
  const unitsBelowHalf = Object.values(gameState.units)
    .filter((unit) => unit.playerId === activePlayerId)
    .filter((unit) => {
      const activeModels = unit.modelIds.filter(
        (id) => gameState.models[id]?.status === 'active',
      );
      const startingStrength = unit.startingStrength ?? unit.modelIds.length;

      if (startingStrength === 1) {
        // Single model: below half wounds
        const model = gameState.models[unit.modelIds[0]];
        if (!model) return false;
        return model.wounds < model.maxWounds / 2;
      }
      // Multi-model: fewer than half starting strength
      return activeModels.length < startingStrength / 2;
    });

  // Track which units have already been tested this phase
  const testedUnits = new Set<string>();
  for (const entry of gameState.log.entries) {
    if (
      entry.type === 'message' &&
      'text' in entry &&
      (entry.text.includes('passes Battle-shock') || entry.text.includes('fails Battle-shock'))
    ) {
      // Simple heuristic — works for the current phase
    }
  }

  const alreadyShocked = new Set(gameState.battleShocked);

  const handleStart = () => {
    dispatch({ type: 'START_COMMAND_PHASE' });
  };

  const handleBattleShock = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;

    // Find best leadership in the unit (Duty and Honour! improves LD by 1)
    const activeModels = unit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');
    const ldBonus = getOrderLeadershipBonus(gameState, unitId);
    const bestLd = Math.min(...activeModels.map((m) => m.stats.leadership)) - ldBonus;

    // Roll 2D6
    const roll = rollDice(2, 6, 'Battle-shock');
    const total = roll.dice[0] + roll.dice[1];
    const passed = total >= bestLd;

    dispatch({ type: 'RESOLVE_BATTLE_SHOCK', payload: { unitId, roll, passed } });
  };

  // Show scores
  const playerIds = Object.keys(gameState.players);

  return (
    <div className="space-y-3">
      {/* CP Gain */}
      {!hasStarted ? (
        <div className="space-y-2">
          <div className="text-xs text-gray-400">Start the Command Phase to gain CP and run Battle-shock tests.</div>
          <button
            onClick={handleStart}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            Start Command Phase (+1 CP each)
          </button>
        </div>
      ) : (
        <div className="text-xs text-green-400">Both players gained 1 CP</div>
      )}

      {/* CP Display */}
      <div className="flex gap-2">
        {playerIds.map((pid) => {
          const p = gameState.players[pid];
          if (!p) return null;
          return (
            <div key={pid} className="flex-1 bg-gray-700/50 rounded px-2 py-1.5 text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-[10px] text-gray-400">{p.name}</span>
              </div>
              <div className="text-lg font-bold text-white">{p.commandPoints} CP</div>
            </div>
          );
        })}
      </div>

      {/* Battle-shock Tests */}
      {hasStarted && unitsBelowHalf.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Battle-shock Tests</div>
          {unitsBelowHalf.map((unit) => {
            const activeModels = unit.modelIds.filter(
              (id) => gameState.models[id]?.status === 'active',
            );
            const startStr = unit.startingStrength ?? unit.modelIds.length;
            const isShocked = alreadyShocked.has(unit.id);
            const unitLdBonus = getOrderLeadershipBonus(gameState, unit.id);
            const bestLd = Math.min(
              ...unit.modelIds
                .map((id) => gameState.models[id])
                .filter((m) => m && m.status === 'active')
                .map((m) => m.stats.leadership),
            ) - unitLdBonus;

            return (
              <div key={unit.id} className="bg-gray-700/50 rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white font-medium">{unit.name}</span>
                  <span className="text-[10px] text-red-400">
                    {activeModels.length}/{startStr} models
                  </span>
                </div>
                {isShocked ? (
                  <div className="text-xs text-red-400 font-medium">Battle-shocked (OC = 0)</div>
                ) : (
                  <button
                    onClick={() => handleBattleShock(unit.id)}
                    className="w-full px-2 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    Roll Battle-shock (2D6 vs Ld {bestLd}+{unitLdBonus > 0 ? ' (Order)' : ''})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasStarted && unitsBelowHalf.length === 0 && (
        <div className="text-xs text-gray-500 italic">No units below half strength</div>
      )}

      {/* Battle-shocked Units */}
      {gameState.battleShocked.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Battle-shocked Units</div>
          {gameState.battleShocked.map((unitId) => {
            const unit = gameState.units[unitId];
            if (!unit) return null;
            const player = gameState.players[unit.playerId];
            return (
              <div key={unitId} className="flex items-center gap-1.5 text-xs text-red-400">
                {player && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: player.color }} />}
                {unit.name} (OC = 0)
              </div>
            );
          })}
        </div>
      )}

      {/* Orders (Combined Regiment) */}
      {hasStarted && <OrdersPanel />}

      {/* Scores */}
      {playerIds.some((pid) => (gameState.score[pid] ?? 0) > 0) && (
        <div className="border-t border-gray-700 pt-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Victory Points</div>
          <div className="flex gap-2">
            {playerIds.map((pid) => {
              const p = gameState.players[pid];
              if (!p) return null;
              return (
                <div key={pid} className="flex items-center gap-1 text-xs text-white">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}: {gameState.score[pid] ?? 0} VP
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
