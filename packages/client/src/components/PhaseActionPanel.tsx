import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getEdition } from '@openhammer/core';
import { CommandPhasePanel } from './CommandPhasePanel';
import { MovementPanel } from './MovementPanel';
import { ShootingPanel } from './ShootingPanel';
import { ChargePanel } from './ChargePanel';
import { FightPanel } from './FightPanel';

const PHASE_COLORS: Record<string, string> = {
  command: 'border-emerald-500',
  movement: 'border-blue-500',
  shooting: 'border-red-500',
  charge: 'border-yellow-500',
  fight: 'border-purple-500',
};

const PHASE_LABELS: Record<string, string> = {
  command: 'Command Phase',
  movement: 'Movement Phase',
  shooting: 'Shooting Phase',
  charge: 'Charge Phase',
  fight: 'Fight Phase',
};

export function PhaseActionPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const [collapsed, setCollapsed] = useState(false);

  const edition = getEdition(gameState.editionId);
  const phases = edition?.phases ?? [];
  const currentPhase = phases[gameState.turnState.currentPhaseIndex];
  const phaseId = currentPhase?.id ?? 'command';

  const borderColor = PHASE_COLORS[phaseId] ?? 'border-gray-500';

  const hasActions = ['command', 'movement', 'shooting', 'charge', 'fight'].includes(phaseId);
  if (!hasActions) return null;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full px-3 py-2 rounded-t-lg border-t-2 ${borderColor} text-left flex items-center justify-between ${
          collapsed ? 'rounded-b-lg' : ''
        }`}
      >
        <span className="text-sm font-medium text-white">
          {PHASE_LABELS[phaseId] ?? currentPhase?.name}
        </span>
        <span className="text-gray-400 text-xs">{collapsed ? '▸' : '▾'}</span>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-3 overflow-y-auto">
          {phaseId === 'command' && <CommandPhasePanel />}
          {phaseId === 'movement' && <MovementPanel />}
          {phaseId === 'shooting' && <ShootingPanel />}
          {phaseId === 'charge' && <ChargePanel />}
          {phaseId === 'fight' && <FightPanel />}
        </div>
      )}
    </div>
  );
}
