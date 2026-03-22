import { BoardCanvas } from '../canvas/BoardCanvas';
import { ToolBar } from './ToolBar';
import { UnitListSidebar } from './UnitListSidebar';
import { TerrainPanel } from './TerrainPanel';
import { ContextMenu } from './ContextMenu';
import { TurnTracker } from './TurnTracker';
import { DiceRoller } from './DiceRoller';
import { CommandPointTracker } from './CommandPointTracker';
import { GameLog } from './GameLog';
import { ChatPanel } from './ChatPanel';
import { RoomInfo } from './RoomInfo';
import { QuickRollPanel } from './QuickRollPanel';
import { RulesConfigPanel } from './RulesConfigPanel';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

export function GameLayout() {
  useKeyboardShortcuts();

  return (
    <div className="h-screen w-screen bg-gray-100 dark:bg-gray-900 relative overflow-hidden">
      <BoardCanvas />
      <UnitListSidebar />
      <TerrainPanel />
      <ToolBar />
      <TurnTracker />
      <RoomInfo />
      <CommandPointTracker />
      <DiceRoller />
      <GameLog />
      <QuickRollPanel />
      <ChatPanel />
      <RulesConfigPanel />
      <ContextMenu />
    </div>
  );
}
