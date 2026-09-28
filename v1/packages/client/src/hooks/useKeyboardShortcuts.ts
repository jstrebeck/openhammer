import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          useUIStore.getState().setTool('select');
          break;
        case 'r':
          useUIStore.getState().setTool('rotate');
          break;
        case 'm':
          useUIStore.getState().setTool('measure');
          break;
        case 't':
          useUIStore.getState().setTool('terrain');
          break;
        case 'l':
          useUIStore.getState().setTool('los');
          break;
        case 'o':
          useUIStore.getState().setTool('objective');
          break;
        case 'escape':
          useUIStore.getState().clearSelection();
          useUIStore.getState().closeContextMenu();
          useUIStore.getState().resetTerrainPlacement();
          useUIStore.getState().setLoSSourceModelId(null);
          break;
        case 'delete':
        case 'backspace': {
          // Delete selected models
          const selectedModels = useUIStore.getState().selectedModelIds;
          for (const id of selectedModels) {
            useGameStore.getState().dispatch({ type: 'REMOVE_MODEL', payload: { modelId: id } });
          }
          // Delete selected terrain
          const selectedTerrain = useUIStore.getState().selectedTerrainId;
          if (selectedTerrain) {
            useGameStore.getState().dispatch({ type: 'REMOVE_TERRAIN', payload: { terrainId: selectedTerrain } });
          }
          useUIStore.getState().clearSelection();
          break;
        }
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useGameStore.getState().redo();
        } else {
          useGameStore.getState().undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        useGameStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
