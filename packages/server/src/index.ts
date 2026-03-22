import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMessage } from '@openhammer/core';
import {
  createRoom,
  joinRoom,
  handleDisconnect,
  handleAction,
  findRoomByClient,
  broadcast,
  send,
} from './rooms';

// Ensure editions are registered — import from rooms.ts which imports core

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT ?? 3001;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'ERROR', payload: { message: 'Invalid JSON' } });
      return;
    }

    switch (msg.type) {
      case 'CREATE_ROOM': {
        const room = createRoom(ws, msg.payload.playerName);
        const client = room.clients.get(ws)!;
        send(ws, {
          type: 'ROOM_CREATED',
          payload: { roomId: room.id, role: client.role, playerId: client.playerId },
        });
        send(ws, { type: 'STATE_SNAPSHOT', payload: { state: room.state } });
        break;
      }

      case 'JOIN_ROOM': {
        const result = joinRoom(msg.payload.roomId.toUpperCase(), ws, msg.payload.playerName);
        if (!result) {
          send(ws, { type: 'ERROR', payload: { message: `Room "${msg.payload.roomId}" not found` } });
          return;
        }
        const { room, client } = result;

        send(ws, {
          type: 'ROOM_JOINED',
          payload: { roomId: room.id, role: client.role, playerId: client.playerId },
        });
        send(ws, { type: 'STATE_SNAPSHOT', payload: { state: room.state } });

        // Notify others
        broadcast(room, {
          type: 'PLAYER_CONNECTED',
          payload: { playerName: client.playerName, role: client.role },
        }, ws);
        break;
      }

      case 'DISPATCH_ACTION': {
        const result = handleAction(ws, msg.payload.action);
        if (!result) {
          send(ws, { type: 'ERROR', payload: { message: 'Cannot dispatch action' } });
          return;
        }
        const { room, client } = result;

        // Broadcast the action to all OTHER clients
        broadcast(room, {
          type: 'ACTION_BROADCAST',
          payload: { action: msg.payload.action, fromPlayerId: client.playerId },
        }, ws);

        // Send updated state snapshot to the dispatching client for reconciliation
        send(ws, { type: 'STATE_SNAPSHOT', payload: { state: room.state } });
        break;
      }

      case 'CHAT': {
        const found = findRoomByClient(ws);
        if (!found) return;
        const { room, client } = found;

        broadcast(room, {
          type: 'CHAT_BROADCAST',
          payload: { playerName: client.playerName, text: msg.payload.text, timestamp: Date.now() },
        });
        // Also echo back to sender
        send(ws, {
          type: 'CHAT_BROADCAST',
          payload: { playerName: client.playerName, text: msg.payload.text, timestamp: Date.now() },
        });
        break;
      }

      case 'REQUEST_STATE': {
        const found = findRoomByClient(ws);
        if (!found) return;
        send(ws, { type: 'STATE_SNAPSHOT', payload: { state: found.room.state } });
        break;
      }
    }
  });

  ws.on('close', () => {
    const result = handleDisconnect(ws);
    if (result) {
      broadcast(result.room, {
        type: 'PLAYER_DISCONNECTED',
        payload: { playerName: result.client.playerName, role: result.client.role },
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`OpenHammer server listening on port ${PORT}`);
});
