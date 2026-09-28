import { useState, useEffect, useRef } from 'react';
import { BoardCanvas } from '../canvas/BoardCanvas';
import { ToolBar } from './ToolBar';
import { ArrangePanel } from './ArrangePanel';
import { UnitListSidebar } from './UnitListSidebar';
import { TerrainPanel } from './TerrainPanel';
import { ContextMenu } from './ContextMenu';
import { TurnTracker } from './TurnTracker';
import { RightSideBar } from './RightSideBar';
import { GameSetupDialog } from './GameSetupDialog';
import { DeploymentWizard } from './DeploymentWizard';
import { PhaseActionPanel } from './PhaseActionPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';

function BlockedActionToast() {
  const log = useGameStore((s) => s.gameState.log);
  const [toast, setToast] = useState<string | null>(null);
  const prevLengthRef = useRef(log.entries.length);

  useEffect(() => {
    const prevLength = prevLengthRef.current;
    prevLengthRef.current = log.entries.length;

    if (log.entries.length <= prevLength) return;

    // Check new entries for [BLOCKED] messages
    const newEntries = log.entries.slice(prevLength);
    for (const entry of newEntries) {
      if (entry.type === 'message' && entry.text.includes('[BLOCKED]')) {
        setToast(entry.text);
        break;
      }
    }
  }, [log.entries.length, log.entries]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-700/95 text-white text-sm rounded-lg shadow-lg border border-red-600 max-w-lg text-center backdrop-blur animate-pulse">
      {toast}
    </div>
  );
}

export function GameLayout() {
  useKeyboardShortcuts();
  const showGameSetup = useUIStore((s) => s.showGameSetup);
  const gameSetupComplete = useUIStore((s) => s.gameSetupComplete);
  const setupPhase = useGameStore((s) => s.gameState.setupPhase);
  const playerCount = useGameStore((s) => Object.keys(s.gameState.players).length);
  const [deploymentDismissed, setDeploymentDismissed] = useState(false);

  // Show deployment wizard after game setup completes, before game is ready
  const showDeploymentWizard =
    gameSetupComplete &&
    !showGameSetup &&
    !deploymentDismissed &&
    setupPhase !== 'ready' &&
    playerCount >= 2;

  return (
    <div className="h-screen w-screen bg-gray-100 dark:bg-gray-900 relative overflow-hidden">
      <BoardCanvas />
      <UnitListSidebar />
      <TerrainPanel />
      <ToolBar />
      <ArrangePanel />
      <TurnTracker />
      <RightSideBar />
      <ContextMenu />
      <BlockedActionToast />
      {showGameSetup && <GameSetupDialog />}
      {showDeploymentWizard && (
        <DeploymentWizard onClose={() => setDeploymentDismissed(true)} />
      )}
      {setupPhase === 'ready' && (
        <div className="absolute top-1/2 -translate-y-1/2 right-[22rem] z-40 w-[300px] max-h-[60vh] bg-gray-800/95 backdrop-blur rounded-lg shadow-xl border border-gray-600 overflow-y-auto">
          <PhaseActionPanel />
        </div>
      )}
    </div>
  );
}
