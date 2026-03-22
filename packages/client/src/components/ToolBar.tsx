import { useUIStore, type Tool } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { getEdition } from '@openhammer/core';
import { SaveLoadMenu } from './SaveLoadMenu';

function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  return (
    <button
      onClick={toggleTheme}
      className="px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

const tools: { id: Tool; label: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'rotate', label: 'Rotate', shortcut: 'R' },
  { id: 'terrain', label: 'Terrain', shortcut: 'T' },
  { id: 'measure', label: 'Measure', shortcut: 'M' },
  { id: 'los', label: 'LoS', shortcut: 'L' },
  { id: 'objective', label: 'Objective', shortcut: 'O' },
];

/** Map of phase ID to which tools are enabled during that phase */
const phaseToolMap: Record<string, Set<Tool>> = {
  command:  new Set(['select']),
  movement: new Set(['select', 'rotate', 'measure']),
  shooting: new Set(['select', 'measure', 'los']),
  charge:   new Set(['select', 'measure']),
  fight:    new Set(['select']),
  morale:   new Set(['select']),
};

function isToolEnabledForPhase(toolId: Tool, phaseId: string | undefined, gameStarted: boolean): boolean {
  // Before the game starts, all tools are available
  if (!gameStarted) return true;
  // Terrain and Objective are always available (but greyed during gameplay phases)
  if (toolId === 'terrain' || toolId === 'objective') return false;
  if (!phaseId) return true;
  const allowed = phaseToolMap[phaseId];
  return allowed ? allowed.has(toolId) : true;
}

export function ToolBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const gameState = useGameStore((s) => s.gameState);

  const edition = getEdition(gameState.editionId);
  const currentPhase = edition?.phases[gameState.turnState.currentPhaseIndex];
  const gameStarted = gameState.gameStarted;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-gray-800/90 backdrop-blur rounded-lg px-2 py-1 shadow-lg border border-gray-700">
      {tools.map((tool) => {
        const enabled = isToolEnabledForPhase(tool.id, currentPhase?.id, gameStarted);
        return (
          <button
            key={tool.id}
            onClick={() => enabled && setTool(tool.id)}
            disabled={!enabled}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              !enabled
                ? 'opacity-50 cursor-not-allowed text-gray-500'
                : activeTool === tool.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
            }`}
            title={enabled ? `${tool.label} (${tool.shortcut})` : 'Not available in this phase'}
          >
            {tool.label}
          </button>
        );
      })}

      <div className="w-px h-6 bg-gray-600 mx-1" />

      <button
        onClick={undo}
        className="px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        onClick={redo}
        className="px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        title="Redo (Ctrl+Shift+Z)"
      >
        Redo
      </button>

      <div className="w-px h-6 bg-gray-600 mx-1" />

      <SaveLoadMenu />

      <div className="w-px h-6 bg-gray-600 mx-1" />

      <ThemeToggle />
    </div>
  );
}
