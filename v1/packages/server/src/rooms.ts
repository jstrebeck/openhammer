import type { WebSocket } from 'ws';
import type { GameState } from '@openhammer/core';
import type { PlayerRole, ServerMessage } from '@openhammer/core';
import { createInitialGameState, gameReducer } from '@openhammer/core';
import type { GameAction } from '@openhammer/core';

export interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  playerName: string;
  role: PlayerRole;
}

export interface Room {
  id: string;
  state: GameState;
  clients: Map<WebSocket, ConnectedClient>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function createRoom(ws: WebSocket, playerName: string): Room {
  let roomId = generateRoomId();
  while (rooms.has(roomId)) {
    roomId = generateRoomId();
  }

  const playerId = crypto.randomUUID();
  const state = createInitialGameState();

  // Add the creating player to game state
  const stateWithPlayer = gameReducer(state, {
    type: 'ADD_PLAYER',
    payload: { player: { id: playerId, name: playerName, color: '#3b82f6', commandPoints: 0 } },
  });

  const room: Room = {
    id: roomId,
    state: stateWithPlayer,
    clients: new Map(),
    createdAt: Date.now(),
  };

  const client: ConnectedClient = {
    ws,
    playerId,
    playerName,
    role: 'player1',
  };

  room.clients.set(ws, client);
  rooms.set(roomId, room);

  return room;
}

export function joinRoom(
  roomId: string,
  ws: WebSocket,
  playerName: string,
): { room: Room; client: ConnectedClient } | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  // Check if this player is reconnecting (same name already in game state)
  const existingPlayer = Object.values(room.state.players).find((p) => p.name === playerName);

  // Check if there's already a connected client for this player
  // (prevent duplicate connections for the same player)
  if (existingPlayer) {
    for (const [existingWs, existingClient] of room.clients) {
      if (existingClient.playerId === existingPlayer.id) {
        // Replace the old dead socket with the new one
        room.clients.delete(existingWs);
        break;
      }
    }
  }

  // Determine role
  const existingRoles = new Set(Array.from(room.clients.values()).map((c) => c.role));
  let role: PlayerRole;
  if (!existingRoles.has('player1')) {
    role = 'player1';
  } else if (!existingRoles.has('player2')) {
    role = 'player2';
  } else {
    role = 'spectator';
  }

  let playerId: string;

  if (existingPlayer) {
    // Reconnecting — reuse existing player ID, no new ADD_PLAYER
    playerId = existingPlayer.id;
  } else {
    // New player
    playerId = crypto.randomUUID();
    if (role !== 'spectator') {
      const color = role === 'player1' ? '#3b82f6' : '#ef4444';
      room.state = gameReducer(room.state, {
        type: 'ADD_PLAYER',
        payload: { player: { id: playerId, name: playerName, color, commandPoints: 0 } },
      });
    }
  }

  const client: ConnectedClient = {
    ws,
    playerId,
    playerName,
    role,
  };

  room.clients.set(ws, client);
  return { room, client };
}

export function handleDisconnect(ws: WebSocket): { room: Room; client: ConnectedClient } | null {
  for (const [, room] of rooms) {
    const client = room.clients.get(ws);
    if (client) {
      room.clients.delete(ws);

      // Clean up empty rooms after a delay
      if (room.clients.size === 0) {
        setTimeout(() => {
          if (room.clients.size === 0) {
            rooms.delete(room.id);
          }
        }, 60_000);
      }

      return { room, client };
    }
  }
  return null;
}

export function handleAction(ws: WebSocket, action: GameAction): { room: Room; client: ConnectedClient } | null {
  for (const [, room] of rooms) {
    const client = room.clients.get(ws);
    if (client) {
      // Spectators can't dispatch actions
      if (client.role === 'spectator') return null;

      room.state = gameReducer(room.state, action);
      return { room, client };
    }
  }
  return null;
}

export function findRoomByClient(ws: WebSocket): { room: Room; client: ConnectedClient } | null {
  for (const [, room] of rooms) {
    const client = room.clients.get(ws);
    if (client) return { room, client };
  }
  return null;
}

export function broadcast(room: Room, message: ServerMessage, excludeWs?: WebSocket): void {
  const data = JSON.stringify(message);
  for (const [clientWs] of room.clients) {
    if (clientWs !== excludeWs && clientWs.readyState === 1) {
      clientWs.send(data);
    }
  }
}

export function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}
