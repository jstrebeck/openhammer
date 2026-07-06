import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { GameAction, GameState, PlayerIndex } from '@openhammer/core';
import type { ClientMessage } from '@openhammer/server';
import { createGameStore, type GameStore } from '../store';
import { StoreProvider } from '../storeContext';
import type { SocketFactory } from '../net/socket';

/**
 * Component-test harness: a REAL store wired to a mock socket, so clicking
 * a button exercises the actual dispatch path and we assert on the wire
 * frames the server would receive.
 */
export interface Harness {
  sent: ClientMessage[];
  actions: () => GameAction[];
  store: ReturnType<typeof createGameStore>;
}

export function makeHarness(
  game: GameState,
  seat: PlayerIndex | null = 0,
  extra: Partial<GameStore> = {},
): Harness {
  const sent: ClientMessage[] = [];
  const factory: SocketFactory = (_url, callbacks) => {
    // Open synchronously; the store flushes its queue after construction.
    callbacks.onOpen();
    return {
      send: (data: string) => sent.push(JSON.parse(data) as ClientMessage),
      close: () => {},
    };
  };
  const store = createGameStore(factory, { url: 'ws://mock' });
  store.getState().connect();
  store.setState({
    game,
    playerIndex: seat,
    roomId: 'room',
    token: seat === null ? null : 'token',
    spectator: false,
    ...extra,
  });
  return {
    sent,
    actions: () =>
      sent
        .filter((m): m is Extract<ClientMessage, { type: 'action' }> => m.type === 'action')
        .map((m) => m.action),
    store,
  };
}

export function renderWithStore(harness: Harness, ui: ReactElement) {
  return render(<StoreProvider store={harness.store}>{ui}</StoreProvider>);
}
