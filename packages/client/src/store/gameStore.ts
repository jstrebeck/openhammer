import { create } from 'zustand';
import {
  type GameState,
  type GameAction,
  gameReducer,
  createInitialGameState,
} from '@openhammer/core';
import { useMultiplayerStore, multiplayerDispatch } from '../networking/useMultiplayer';

interface GameStore {
  gameState: GameState;
  past: GameState[];
  future: GameState[];
  dispatch: (action: GameAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetGame: (options?: {
    editionId?: string;
    boardWidth?: number;
    boardHeight?: number;
  }) => void;
}

const MAX_HISTORY = 200;

export const useGameStore = create<GameStore>((set, get) => ({
  gameState: createInitialGameState(),
  past: [],
  future: [],

  dispatch: (action) => {
    set((state) => {
      const newState = gameReducer(state.gameState, action);
      if (newState === state.gameState) return state;
      const past = [...state.past, state.gameState].slice(-MAX_HISTORY);
      return { gameState: newState, past, future: [] };
    });

    // Forward to server if in a multiplayer session
    if (useMultiplayerStore.getState().roomId) {
      multiplayerDispatch(action);
    }
  },

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;
      // Block undo while pending saves are unresolved
      const hasPending =
        state.gameState.shootingState.pendingSaves.some(ps => !ps.resolved) ||
        state.gameState.fightState.pendingSaves.some(ps => !ps.resolved);
      if (hasPending) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        gameState: previous,
        future: [state.gameState, ...state.future],
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.gameState],
        gameState: next,
        future: state.future.slice(1),
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  resetGame: (options) =>
    set({
      gameState: createInitialGameState(options),
      past: [],
      future: [],
    }),
}));
