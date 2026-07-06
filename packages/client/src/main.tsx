import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './storeContext';
import { createGameStore, type CredStorage } from './store';
import { browserSocketFactory, defaultWsUrl } from './net/socket';
import './styles.css';

const SESSION_KEY = 'openhammer.session';

const storage: CredStorage = {
  load: () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { roomId?: string; token?: string };
      if (typeof parsed.roomId === 'string' && typeof parsed.token === 'string') {
        return { roomId: parsed.roomId, token: parsed.token };
      }
      return null;
    } catch {
      return null;
    }
  },
  save: (roomId, token) => localStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, token })),
  clear: () => localStorage.removeItem(SESSION_KEY),
};

const store = createGameStore(browserSocketFactory, { url: defaultWsUrl(), storage });
store.getState().connect();

// Dev-only automation hook: browser-based verification drivers (and manual
// debugging) can reach the real store; never present in production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ohStore = store;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
