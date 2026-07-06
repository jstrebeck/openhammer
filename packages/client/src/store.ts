import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Datasheet, GameAction, GameState, PlayerIndex } from '@openhammer/core';
import type { ClientMessage, ServerMessage } from '@openhammer/server';
import type { SocketFactory, SocketHandle } from './net/socket';
import { IDLE, type Interaction } from './game/interaction';

/**
 * The single client store. DOM-free and three-free by design so it can be
 * driven headless (see the integration test): all browser specifics
 * (WebSocket, localStorage) are injected.
 *
 * Server state is never mutated locally — `game` is always the last 'state'
 * message; every mutation goes through dispatch() as a proposed GameAction.
 */

export interface ChatEntry {
  from: string;
  text: string;
  at: number;
}

export interface Rejection {
  error: string;
  code: string;
  at: number;
}

export interface Presence {
  seats: { name: string; connected: boolean }[];
  spectators: number;
}

/** Injected credential persistence (localStorage in the browser). */
export interface CredStorage {
  load(): { roomId: string; token: string } | null;
  save(roomId: string, token: string): void;
  clear(): void;
}

export interface GameStoreOptions {
  url?: string;
  storage?: CredStorage;
  reconnectDelayMs?: number;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface GameStore {
  status: ConnectionStatus;
  roomId: string | null;
  token: string | null;
  playerIndex: PlayerIndex | null;
  spectator: boolean;
  playerName: string;

  datasheets: Record<string, Datasheet>;
  game: GameState | null;
  chat: ChatEntry[];
  presence: Presence | null;
  rejections: Rejection[];
  lastRejection: Rejection | null;
  importIssues: string[];
  importedUnitCount: number | null;
  serverError: string | null;

  interaction: Interaction;
  selectedUnitId: string | null;

  connect(): void;
  disconnect(): void;
  createRoom(name: string): void;
  joinRoom(roomId: string, name: string): void;
  spectate(roomId: string, name: string): void;
  uploadRoster(roster: unknown): void;
  dispatch(action: GameAction): void;
  sendChat(text: string): void;
  setInteraction(interaction: Interaction): void;
  selectUnit(unitId: string | null): void;
}

export function createGameStore(
  socketFactory: SocketFactory,
  options: GameStoreOptions = {},
): StoreApi<GameStore> {
  const url = options.url ?? 'ws://localhost:8787';
  const storage = options.storage;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1500;

  const conn = {
    handle: null as SocketHandle | null,
    open: false,
    queue: [] as string[],
    closedByUs: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    generation: 0,
  };

  const store = createStore<GameStore>()((set, get) => {
    const push = (message: ClientMessage): void => {
      const data = JSON.stringify(message);
      if (conn.open && conn.handle) conn.handle.send(data);
      else conn.queue.push(data);
    };

    const flush = (): void => {
      if (!conn.open || !conn.handle) return;
      const pending = conn.queue.splice(0);
      for (const data of pending) conn.handle.send(data);
    };

    const handleMessage = (raw: string): void => {
      let message: ServerMessage;
      try {
        message = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'created':
          set({
            roomId: message.roomId,
            token: message.token,
            playerIndex: message.playerIndex,
            spectator: false,
            serverError: null,
          });
          storage?.save(message.roomId, message.token);
          break;
        case 'joined':
          set({
            roomId: message.roomId,
            token: message.token,
            playerIndex: message.playerIndex,
            spectator: false,
            serverError: null,
          });
          storage?.save(message.roomId, message.token);
          break;
        case 'spectating':
          set({ roomId: message.roomId, playerIndex: null, spectator: true });
          break;
        case 'reconnected':
          set({
            roomId: message.roomId,
            playerIndex: message.playerIndex,
            spectator: message.playerIndex === null,
            serverError: null,
          });
          if (message.playerIndex === null) storage?.clear();
          break;
        case 'state':
          set((prev) => {
            let interaction = prev.interaction;
            // Deploy done (or unit gone): fall back to idle.
            if (interaction.mode === 'deploying') {
              const unit = message.state.units[interaction.unitId];
              if (!unit || unit.models.some((m) => m.position !== null)) interaction = IDLE;
            }
            // Moving is derived from pendingMove; clear stale mode.
            if (
              interaction.mode === 'moving' &&
              message.state.pendingMove?.unitId !== interaction.unitId
            ) {
              interaction = IDLE;
            }
            return { game: message.state, interaction };
          });
          break;
        case 'content':
          set({ datasheets: message.datasheets });
          break;
        case 'rejected': {
          const rejection: Rejection = {
            error: message.error,
            code: message.code,
            at: Date.now(),
          };
          set((prev) => ({
            rejections: [...prev.rejections.slice(-49), rejection],
            lastRejection: rejection,
            interaction: IDLE,
          }));
          break;
        }
        case 'imported':
          if (message.playerIndex === get().playerIndex) {
            set({ importIssues: message.issues, importedUnitCount: message.unitCount });
          }
          break;
        case 'chat':
          set((prev) => ({
            chat: [...prev.chat.slice(-199), { from: message.from, text: message.text, at: message.at }],
          }));
          break;
        case 'presence':
          set({ presence: { seats: message.seats, spectators: message.spectators } });
          break;
        case 'error':
          set({ serverError: message.error });
          // A failed resume (e.g. "no such room") should not loop forever.
          if (get().roomId === null) storage?.clear();
          break;
      }
    };

    const openSocket = (): void => {
      const generation = ++conn.generation;
      conn.open = false;
      conn.closedByUs = false;
      set({ status: 'connecting' });
      const handle = socketFactory(url, {
        onOpen: () => {
          if (generation !== conn.generation) return;
          conn.open = true;
          set({ status: 'connected' });
          const s = get();
          const creds =
            s.roomId && s.token
              ? { roomId: s.roomId, token: s.token }
              : (storage?.load() ?? null);
          if (creds && !s.spectator) {
            push({ type: 'reconnect', roomId: creds.roomId, token: creds.token });
          }
          flush();
        },
        onMessage: (data) => {
          if (generation === conn.generation) handleMessage(data);
        },
        onClose: () => {
          if (generation !== conn.generation) return;
          conn.open = false;
          set({ status: 'disconnected' });
          if (!conn.closedByUs) {
            conn.timer = setTimeout(openSocket, reconnectDelayMs);
          }
        },
      });
      conn.handle = handle;
      // The factory may fire onOpen synchronously, before `handle` exists.
      flush();
    };

    return {
      status: 'idle',
      roomId: null,
      token: null,
      playerIndex: null,
      spectator: false,
      playerName: '',
      datasheets: {},
      game: null,
      chat: [],
      presence: null,
      rejections: [],
      lastRejection: null,
      importIssues: [],
      importedUnitCount: null,
      serverError: null,
      interaction: IDLE,
      selectedUnitId: null,

      connect: () => {
        if (get().status === 'connected' || get().status === 'connecting') return;
        openSocket();
      },
      disconnect: () => {
        conn.closedByUs = true;
        conn.generation++;
        if (conn.timer !== null) clearTimeout(conn.timer);
        conn.handle?.close();
        conn.handle = null;
        conn.open = false;
        set({ status: 'idle' });
      },
      createRoom: (name) => {
        set({ playerName: name });
        push({ type: 'create', name });
      },
      joinRoom: (roomId, name) => {
        set({ playerName: name });
        push({ type: 'join', roomId, name });
      },
      spectate: (roomId, name) => {
        set({ playerName: name, spectator: true });
        push({ type: 'spectate', roomId, name });
      },
      uploadRoster: (roster) => {
        push({ type: 'uploadRoster', roster });
      },
      dispatch: (action) => {
        const seat = get().playerIndex;
        // The server overwrites `player` with the authenticated seat anyway;
        // stamping it here keeps honest actions honest.
        const stamped: GameAction = seat === null ? action : { ...action, player: seat };
        push({ type: 'action', action: stamped });
      },
      sendChat: (text) => {
        if (text.trim().length === 0) return;
        push({ type: 'chat', text });
      },
      setInteraction: (interaction) => set({ interaction }),
      selectUnit: (unitId) => set({ selectedUnitId: unitId }),
    };
  });

  return store;
}
