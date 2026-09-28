import { create } from 'zustand';
import type { ClientMessage, ServerMessage, PlayerRole, GameAction } from '@openhammer/core';
import { gameReducer } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';

interface MultiplayerState {
  connected: boolean;
  roomId: string | null;
  role: PlayerRole | null;
  playerId: string | null;
  error: string | null;
  chatMessages: { playerName: string; text: string; timestamp: number }[];
  setConnected: (connected: boolean) => void;
  setRoom: (roomId: string, role: PlayerRole, playerId: string) => void;
  setError: (error: string | null) => void;
  addChatMessage: (msg: { playerName: string; text: string; timestamp: number }) => void;
  reset: () => void;
}

export const useMultiplayerStore = create<MultiplayerState>((set) => ({
  connected: false,
  roomId: null,
  role: null,
  playerId: null,
  error: null,
  chatMessages: [],
  setConnected: (connected) => set({ connected }),
  setRoom: (roomId, role, playerId) => set({ roomId, role, playerId, error: null }),
  setError: (error) => set({ error }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages.slice(-100), msg] })),
  reset: () => set({ connected: false, roomId: null, role: null, playerId: null, error: null, chatMessages: [] }),
}));

// ---- Module-level WebSocket singleton (survives component unmounts) ----

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastServerUrl: string | null = null;
let lastRoomId: string | null = null;
let lastPlayerName = '';

function sendMessage(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleServerMessage(msg: ServerMessage) {
  const store = useMultiplayerStore.getState();

  switch (msg.type) {
    case 'ROOM_CREATED':
      lastRoomId = msg.payload.roomId;
      store.setRoom(msg.payload.roomId, msg.payload.role, msg.payload.playerId);
      useUIStore.getState().setGameCreated(true);
      useUIStore.getState().setShowGameSetup(true);
      break;

    case 'ROOM_JOINED':
      lastRoomId = msg.payload.roomId;
      store.setRoom(msg.payload.roomId, msg.payload.role, msg.payload.playerId);
      useUIStore.getState().setGameCreated(true);
      useUIStore.getState().setShowGameSetup(true);
      break;

    case 'STATE_SNAPSHOT':
      useGameStore.setState((s) => ({
        gameState: msg.payload.state,
        past: [...s.past, s.gameState].slice(-200),
        future: [],
      }));
      break;

    case 'ACTION_BROADCAST':
      // Apply locally without re-dispatching to server (avoid echo loop)
      useGameStore.setState((s) => {
        const newState = gameReducer(s.gameState, msg.payload.action);
        if (newState === s.gameState) return s;
        return {
          gameState: newState,
          past: [...s.past, s.gameState].slice(-200),
          future: [],
        };
      });
      break;

    case 'CHAT_BROADCAST':
      store.addChatMessage(msg.payload);
      break;

    case 'PLAYER_CONNECTED':
      store.addChatMessage({
        playerName: 'System',
        text: `${msg.payload.playerName} joined as ${msg.payload.role}`,
        timestamp: Date.now(),
      });
      break;

    case 'PLAYER_DISCONNECTED':
      store.addChatMessage({
        playerName: 'System',
        text: `${msg.payload.playerName} disconnected`,
        timestamp: Date.now(),
      });
      break;

    case 'ERROR':
      store.setError(msg.payload.message);
      break;
  }
}

function connect(serverUrl: string) {
  if (ws) {
    ws.close();
    ws = null;
  }

  lastServerUrl = serverUrl;
  const socket = new WebSocket(serverUrl);

  socket.onopen = () => {
    ws = socket;
    useMultiplayerStore.getState().setConnected(true);
    useMultiplayerStore.getState().setError(null);

    // If reconnecting to a known room, rejoin
    if (lastRoomId && lastPlayerName) {
      sendMessage({
        type: 'JOIN_ROOM',
        payload: { roomId: lastRoomId, playerName: lastPlayerName },
      });
    }
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      handleServerMessage(msg);
    } catch {
      // ignore
    }
  };

  socket.onclose = () => {
    ws = null;
    useMultiplayerStore.getState().setConnected(false);

    // Auto-reconnect if we had a room
    if (lastRoomId && lastServerUrl) {
      reconnectTimer = setTimeout(() => {
        connect(lastServerUrl!);
      }, 3000);
    }
  };

  socket.onerror = () => {
    useMultiplayerStore.getState().setError('Connection failed');
  };
}

// ---- Public API (called from components, not tied to lifecycle) ----

export function multiplayerCreateRoom(serverUrl: string, playerName: string) {
  lastPlayerName = playerName;
  lastRoomId = null;
  connect(serverUrl);

  // Poll until connected, then send CREATE_ROOM
  const checkAndSend = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMessage({ type: 'CREATE_ROOM', payload: { playerName } });
    } else {
      setTimeout(checkAndSend, 100);
    }
  };
  setTimeout(checkAndSend, 200);
}

export function multiplayerJoinRoom(serverUrl: string, roomId: string, playerName: string) {
  lastPlayerName = playerName;
  lastRoomId = roomId;
  connect(serverUrl);

  const checkAndSend = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMessage({ type: 'JOIN_ROOM', payload: { roomId, playerName } });
    } else {
      setTimeout(checkAndSend, 100);
    }
  };
  setTimeout(checkAndSend, 200);
}

export function multiplayerDispatch(action: GameAction) {
  sendMessage({ type: 'DISPATCH_ACTION', payload: { action } });
}

export function multiplayerSendChat(text: string) {
  sendMessage({ type: 'CHAT', payload: { text } });
}

export function multiplayerDisconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  lastRoomId = null;
  lastServerUrl = null;
  ws?.close();
  ws = null;
  useMultiplayerStore.getState().reset();
}

/** Convenience hook — just returns the functions, no lifecycle management needed */
export function useMultiplayer() {
  return {
    createRoom: multiplayerCreateRoom,
    joinRoom: multiplayerJoinRoom,
    dispatchToServer: multiplayerDispatch,
    sendChat: multiplayerSendChat,
    disconnect: multiplayerDisconnect,
  };
}
