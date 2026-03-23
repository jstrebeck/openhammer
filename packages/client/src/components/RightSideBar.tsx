import { CommandPointTracker } from './CommandPointTracker';
import { ScoreTracker } from './ScoreTracker';
import { ScoringConditionsPanel } from './ScoringConditionsPanel';
import { ReservesPanel } from './ReservesPanel';
import { StratagemPanel } from './StratagemPanel';
import { GameLog } from './GameLog';
import { DiceRoller } from './DiceRoller';
import { QuickRollPanel } from './QuickRollPanel';
import { ChatPanel } from './ChatPanel';
import { RulesConfigPanel } from './RulesConfigPanel';
import { RoomInfo } from './RoomInfo';

export function RightSideBar() {
  return (
    <div className="absolute top-0 right-0 w-80 h-full flex flex-col bg-gray-800/95 backdrop-blur border-l border-gray-700 shadow-lg overflow-y-auto">
      {/* Multiplayer room info */}
      <RoomInfo />

      {/* Command Points */}
      <div className="p-3 border-b border-gray-700">
        <CommandPointTracker />
      </div>

      {/* Score Tracker */}
      <div className="border-b border-gray-700">
        <ScoreTracker />
      </div>

      {/* Scoring Conditions (when a mission is active) */}
      <div className="border-b border-gray-700">
        <ScoringConditionsPanel />
      </div>

      {/* Reserves */}
      <div className="border-b border-gray-700">
        <ReservesPanel />
      </div>

      {/* Stratagems */}
      <div className="border-b border-gray-700">
        <StratagemPanel />
      </div>

      {/* Game Log */}
      <div className="border-b border-gray-700">
        <GameLog />
      </div>

      {/* Dice Roller */}
      <div className="border-b border-gray-700">
        <DiceRoller />
      </div>

      {/* Quick Roll */}
      <div className="border-b border-gray-700">
        <QuickRollPanel />
      </div>

      {/* Chat (multiplayer only) */}
      <div className="border-b border-gray-700">
        <ChatPanel />
      </div>

      {/* Rules Config */}
      <div className="border-b border-gray-700">
        <RulesConfigPanel />
      </div>
    </div>
  );
}
