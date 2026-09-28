/**
 * Thin transport abstraction. The store owns queuing, reconnect timing and
 * message handling; a SocketFactory only opens one connection and forwards
 * events. This keeps the store injectable: the browser passes a WebSocket
 * factory, the integration test passes a 'ws'-package factory.
 */

export interface SocketHandle {
  send(data: string): void;
  close(): void;
}

export interface SocketCallbacks {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
}

export type SocketFactory = (url: string, callbacks: SocketCallbacks) => SocketHandle;

/** Browser WebSocket factory. */
export const browserSocketFactory: SocketFactory = (url, callbacks) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => callbacks.onOpen());
  ws.addEventListener('message', (event) => callbacks.onMessage(String(event.data)));
  ws.addEventListener('close', () => callbacks.onClose());
  // Errors are always followed by close; nothing extra to do.
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
};

export function defaultWsUrl(): string {
  const fromEnv = import.meta.env?.VITE_WS_URL as string | undefined;
  return fromEnv ?? 'ws://localhost:8787';
}
