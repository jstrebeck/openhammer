import { create } from 'zustand';
import type { Point, TerrainTemplate } from '@openhammer/core';

export type Tool = 'select' | 'place' | 'measure' | 'terrain' | 'los' | 'objective';

interface ContextMenuState {
  type: 'model' | 'terrain';
  targetId: string;
  screenX: number;
  screenY: number;
}

interface TerrainPlacementState {
  mode: 'draw' | 'template';
  vertices: Point[];           // Committed vertices for freehand draw
  template: TerrainTemplate | null; // Selected template for quick-place
}

interface UIStore {
  activeTool: Tool;
  setTool: (tool: Tool) => void;
  selectedModelIds: string[];
  setSelectedModelIds: (ids: string[]) => void;
  toggleModelSelection: (id: string) => void;
  clearSelection: () => void;
  selectedTerrainId: string | null;
  setSelectedTerrainId: (id: string | null) => void;
  contextMenu: ContextMenuState | null;
  openContextMenu: (type: 'model' | 'terrain', targetId: string, screenX: number, screenY: number) => void;
  closeContextMenu: () => void;
  terrainPlacement: TerrainPlacementState;
  setTerrainPlacementMode: (mode: 'draw' | 'template') => void;
  setTerrainTemplate: (template: TerrainTemplate | null) => void;
  addTerrainVertex: (point: Point) => void;
  resetTerrainPlacement: () => void;
  losSourceModelId: string | null;
  setLoSSourceModelId: (id: string | null) => void;
  gameCreated: boolean;
  setGameCreated: (created: boolean) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeTool: 'select',
  setTool: (tool) => set({
    activeTool: tool,
    selectedTerrainId: null,
    losSourceModelId: null,
  }),

  selectedModelIds: [],
  setSelectedModelIds: (ids) => set({ selectedModelIds: ids }),
  toggleModelSelection: (id) =>
    set((state) => {
      const has = state.selectedModelIds.includes(id);
      return {
        selectedModelIds: has
          ? state.selectedModelIds.filter((sid) => sid !== id)
          : [...state.selectedModelIds, id],
      };
    }),
  clearSelection: () => set({ selectedModelIds: [], selectedTerrainId: null }),

  selectedTerrainId: null,
  setSelectedTerrainId: (id) => set({ selectedTerrainId: id, selectedModelIds: [] }),

  contextMenu: null,
  openContextMenu: (type, targetId, screenX, screenY) =>
    set({ contextMenu: { type, targetId, screenX, screenY } }),
  closeContextMenu: () => set({ contextMenu: null }),

  terrainPlacement: {
    mode: 'template',
    vertices: [],
    template: null,
  },
  setTerrainPlacementMode: (mode) =>
    set((state) => ({
      terrainPlacement: { ...state.terrainPlacement, mode, vertices: [] },
    })),
  setTerrainTemplate: (template) =>
    set((state) => ({
      terrainPlacement: { ...state.terrainPlacement, template },
    })),
  addTerrainVertex: (point) =>
    set((state) => ({
      terrainPlacement: {
        ...state.terrainPlacement,
        vertices: [...state.terrainPlacement.vertices, point],
      },
    })),
  resetTerrainPlacement: () =>
    set((state) => ({
      terrainPlacement: { ...state.terrainPlacement, vertices: [] },
    })),

  losSourceModelId: null,
  setLoSSourceModelId: (id) => set({ losSourceModelId: id }),

  gameCreated: false,
  setGameCreated: (created) => set({ gameCreated: created }),

  theme: (localStorage.getItem('oh-theme') ?? 'dark') as 'dark' | 'light',
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('oh-theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return { theme: next };
    }),
}));
