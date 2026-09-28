import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { GameStore } from './store';

const StoreContext = createContext<StoreApi<GameStore> | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: StoreApi<GameStore>;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStoreApi(): StoreApi<GameStore> {
  const api = useContext(StoreContext);
  if (!api) throw new Error('StoreProvider is missing');
  return api;
}

export function useGameStore<T>(selector: (state: GameStore) => T): T {
  return useStore(useStoreApi(), selector);
}
