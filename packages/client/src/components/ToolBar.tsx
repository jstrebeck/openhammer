import { useUIStore, type Tool } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
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
  { id: 'place', label: 'Place', shortcut: 'P' },
  { id: 'terrain', label: 'Terrain', shortcut: 'T' },
  { id: 'measure', label: 'Measure', shortcut: 'M' },
  { id: 'los', label: 'LoS', shortcut: 'L' },
  { id: 'objective', label: 'Objective', shortcut: 'O' },
];

export function ToolBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-gray-800/90 backdrop-blur rounded-lg px-2 py-1 shadow-lg border border-gray-700">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setTool(tool.id)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            activeTool === tool.id
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-700'
          }`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          {tool.label}
        </button>
      ))}

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
