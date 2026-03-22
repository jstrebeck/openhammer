import { useGameStore } from '../store/gameStore';

export function SaveLoadMenu() {
  const gameState = useGameStore((s) => s.gameState);

  const handleSave = () => {
    const json = JSON.stringify(gameState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openhammer-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const state = JSON.parse(text);
        // Basic validation: check for expected top-level keys
        if (!state.board || !state.models || !state.units || !state.turnState) {
          alert('Invalid save file — missing required fields');
          return;
        }
        useGameStore.setState((s) => ({
          gameState: state,
          past: [...s.past, s.gameState].slice(-200),
          future: [],
        }));
      } catch {
        alert('Failed to load save file — invalid JSON');
      }
    };
    input.click();
  };

  return (
    <>
      <button
        onClick={handleSave}
        className="px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        title="Save game to file"
      >
        Save
      </button>
      <button
        onClick={handleLoad}
        className="px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        title="Load game from file"
      >
        Load
      </button>
    </>
  );
}
