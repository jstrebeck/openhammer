import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { COMBINED_REGIMENT_ORDERS, distanceBetweenModels, getFactionState } from '@openhammer/core';
import type { Unit, OrderDefinition } from '@openhammer/core';
import type { AstraMilitarumState } from '@openhammer/core/src/detachments/astra-militarum';

/**
 * Combined Regiment Orders panel — shown during the Command phase when
 * the active player has the Combined Regiment detachment selected.
 * Officers can issue one order each to friendly units within 6".
 * Orders persist until the start of the owning player's next Command phase.
 */
export function OrdersPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  // Only show for the active player if they have Combined Regiment
  const activePlayerId = gameState.turnState.activePlayerId;
  const playerId = activePlayerId;
  const detachment = gameState.playerDetachments[playerId];

  if (!detachment || detachment.id !== 'combined-regiment') return null;

  const playerUnits = Object.values(gameState.units).filter(
    (u) => u.playerId === playerId && u.modelIds.some((id) => gameState.models[id]?.status === 'active'),
  );

  const amState = getFactionState<AstraMilitarumState>(gameState, 'astra-militarum') ?? { activeOrders: {}, officersUsedThisPhase: [] };

  const officerUnits = playerUnits.filter((u) =>
    u.keywords.some((k) => k.toUpperCase() === 'OFFICER'),
  );
  const availableOfficers = officerUnits.filter((u) => !amState.officersUsedThisPhase.includes(u.id));

  // Units that can receive orders (friendly, active, not battle-shocked)
  // A new order replaces any existing order, so units with orders are still orderable
  const orderableUnits = playerUnits.filter((u) => !gameState.battleShocked.includes(u.id));

  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  if (officerUnits.length === 0) return null;

  // Find units within 6" of selected officer
  const getUnitsInRange = (officerId: string): string[] => {
    const officerUnit = gameState.units[officerId];
    if (!officerUnit) return [];
    const officerModels = officerUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');

    return orderableUnits
      .filter((target) => {
        if (target.id === officerId) return true; // Can order own unit
        const targetModels = target.modelIds
          .map((id) => gameState.models[id])
          .filter((m) => m && m.status === 'active');
        return officerModels.some((om) =>
          targetModels.some((tm) => om && tm && distanceBetweenModels(om, tm) <= 6),
        );
      })
      .map((u) => u.id);
  };

  const unitsInRange = selectedOfficerId ? getUnitsInRange(selectedOfficerId) : [];

  const handleIssueOrder = (orderId: string) => {
    if (!selectedOfficerId || !selectedTargetId) return;
    dispatch({
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: selectedOfficerId, targetUnitId: selectedTargetId, orderId },
    });
    setSelectedOfficerId(null);
    setSelectedTargetId(null);
  };

  // Show active orders summary
  const activeOrderEntries = Object.entries(amState.activeOrders)
    .map(([unitId, orderId]) => {
      const unit = gameState.units[unitId];
      const order = COMBINED_REGIMENT_ORDERS.find((o) => o.id === orderId);
      return unit && order ? { unit, order } : null;
    })
    .filter(Boolean) as Array<{ unit: Unit; order: OrderDefinition }>;

  const allDone = availableOfficers.length === 0;

  return (
    <div className="space-y-2 mb-3 pb-3 border-b border-gray-700">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-yellow-400 uppercase tracking-wider font-medium">Orders</div>
        <div className="text-[10px] text-gray-500">
          {availableOfficers.length}/{officerUnits.length} officer{officerUnits.length !== 1 ? 's' : ''} ready
        </div>
      </div>

      {/* Active orders */}
      {activeOrderEntries.length > 0 && (
        <div className="space-y-0.5">
          {activeOrderEntries.map(({ unit, order }) => (
            <div key={unit.id} className="flex items-center gap-1.5 px-2 py-1 bg-yellow-900/20 border border-yellow-700/30 rounded text-[10px]">
              <span className="text-yellow-400 font-medium">{order.name}</span>
              <span className="text-gray-500">→</span>
              <span className="text-gray-300 truncate">{unit.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Issue new order */}
      {!allDone && (
        <div className="space-y-1.5">
          {/* Officer select */}
          <select
            value={selectedOfficerId ?? ''}
            onChange={(e) => {
              setSelectedOfficerId(e.target.value || null);
              setSelectedTargetId(null);
            }}
            className="w-full bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-yellow-500"
          >
            <option value="">Select officer...</option>
            {availableOfficers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          {/* Target select */}
          {selectedOfficerId && (
            <select
              value={selectedTargetId ?? ''}
              onChange={(e) => setSelectedTargetId(e.target.value || null)}
              className="w-full bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-yellow-500"
            >
              <option value="">Select target unit...</option>
              {orderableUnits.map((u) => {
                const inRange = unitsInRange.includes(u.id);
                return (
                  <option key={u.id} value={u.id} disabled={!inRange}>
                    {u.name}{!inRange ? ' (out of range)' : ''}
                  </option>
                );
              })}
            </select>
          )}

          {/* Order buttons */}
          {selectedOfficerId && selectedTargetId && (
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Choose Order</div>
              {COMBINED_REGIMENT_ORDERS.map((order) => (
                <button
                  key={order.id}
                  onClick={() => handleIssueOrder(order.id)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs bg-gray-700/60 text-gray-300 hover:bg-yellow-700/40 hover:text-yellow-200 transition-colors"
                >
                  <div className="font-medium">{order.name}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{order.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {allDone && activeOrderEntries.length > 0 && (
        <div className="text-[10px] text-gray-500 italic">All officers have issued orders.</div>
      )}
    </div>
  );
}
