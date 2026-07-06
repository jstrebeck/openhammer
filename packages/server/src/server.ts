import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadEditionContent } from '@openhammer/content';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { RoomManager } from './rooms.js';
import { loadRooms, saveRoom } from './persistence.js';

interface Connection {
  ws: WebSocket;
  roomId: string | null;
  token: string | null;
  name: string;
  spectator: boolean;
}

export interface OpenHammerServer {
  port: number;
  rooms: RoomManager;
  close(): Promise<void>;
}

export async function startServer(options: {
  port?: number;
  dataDir?: string;
  editionId?: string;
}): Promise<OpenHammerServer> {
  const editionId = options.editionId ?? 'wh40k-10e';
  const content = loadEditionContent(editionId);
  const rooms = new RoomManager(content.edition, content.versions);
  if (options.dataDir) {
    const restored = loadRooms(options.dataDir, rooms);
    if (restored > 0) console.log(`restored ${restored} room(s) from ${options.dataDir}`);
  }

  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const connections = new Map<WebSocket, Connection>();

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const broadcastRoom = (roomId: string, message: ServerMessage) => {
    for (const [ws, conn] of connections) {
      if (conn.roomId === roomId) send(ws, message);
    }
  };

  const broadcastPresence = (roomId: string) => {
    const room = rooms.getRoom(roomId);
    if (!room) return;
    const seats = [
      { name: room.seats[0].name, connected: room.seats[0].connected },
      ...(room.seats[1] ? [{ name: room.seats[1].name, connected: room.seats[1].connected }] : []),
    ];
    let spectators = 0;
    for (const conn of connections.values()) {
      if (conn.roomId === roomId && conn.spectator) spectators++;
    }
    broadcastRoom(roomId, { type: 'presence', seats, spectators });
  };

  const persist = (roomId: string) => {
    if (!options.dataDir) return;
    const serialized = rooms.serialize(roomId);
    if (serialized) saveRoom(options.dataDir, serialized);
  };

  wss.on('connection', (ws) => {
    const conn: Connection = { ws, roomId: null, token: null, name: '', spectator: false };
    connections.set(ws, conn);

    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(ws, { type: 'error', error: 'malformed message' });
        return;
      }

      switch (message.type) {
        case 'create': {
          const { room, token } = rooms.createRoom(message.name);
          conn.roomId = room.id;
          conn.token = token;
          conn.name = message.name;
          send(ws, { type: 'created', roomId: room.id, token, playerIndex: 0 });
          send(ws, { type: 'state', state: room.state });
          persist(room.id);
          break;
        }
        case 'join': {
          const result = rooms.joinRoom(message.roomId, message.name);
          if ('error' in result) {
            send(ws, { type: 'error', error: result.error });
            return;
          }
          conn.roomId = result.room.id;
          conn.token = result.token;
          conn.name = message.name;
          send(ws, { type: 'joined', roomId: result.room.id, token: result.token, playerIndex: 1 });
          broadcastRoom(result.room.id, { type: 'state', state: result.room.state });
          broadcastPresence(result.room.id);
          persist(result.room.id);
          break;
        }
        case 'spectate': {
          const room = rooms.getRoom(message.roomId);
          if (!room) {
            send(ws, { type: 'error', error: `no such room: ${message.roomId}` });
            return;
          }
          conn.roomId = room.id;
          conn.spectator = true;
          conn.name = message.name;
          send(ws, { type: 'spectating', roomId: room.id });
          send(ws, { type: 'state', state: room.state });
          broadcastPresence(room.id);
          break;
        }
        case 'reconnect': {
          const seat = rooms.seatForToken(message.roomId, message.token);
          const room = rooms.getRoom(message.roomId);
          if (!room) {
            send(ws, { type: 'error', error: `no such room: ${message.roomId}` });
            return;
          }
          conn.roomId = room.id;
          conn.token = seat !== null ? message.token : null;
          conn.spectator = seat === null;
          if (seat !== null) {
            room.seats[seat]!.connected = true;
            conn.name = room.seats[seat]!.name;
          }
          send(ws, { type: 'reconnected', roomId: room.id, playerIndex: seat });
          send(ws, { type: 'state', state: room.state });
          broadcastPresence(room.id);
          break;
        }
        case 'action': {
          if (!conn.roomId || !conn.token) {
            send(ws, { type: 'rejected', error: 'not seated in a game', code: 'NOT_SEATED' });
            return;
          }
          const outcome = rooms.applyAction(conn.roomId, conn.token, message.action);
          if (!outcome.ok) {
            send(ws, { type: 'rejected', error: outcome.error, code: outcome.code });
            return;
          }
          broadcastRoom(conn.roomId, { type: 'state', state: outcome.room.state });
          persist(conn.roomId);
          break;
        }
        case 'chat': {
          if (!conn.roomId) return;
          const room = rooms.getRoom(conn.roomId);
          if (!room) return;
          const entry = { from: conn.name || 'anonymous', text: message.text, at: Date.now() };
          room.chat.push(entry);
          broadcastRoom(conn.roomId, { type: 'chat', ...entry });
          persist(conn.roomId);
          break;
        }
      }
    });

    ws.on('close', () => {
      if (conn.roomId && conn.token) {
        const seat = rooms.seatForToken(conn.roomId, conn.token);
        const room = rooms.getRoom(conn.roomId);
        if (room && seat !== null && room.seats[seat]) {
          room.seats[seat]!.connected = false;
          broadcastPresence(conn.roomId);
        }
      }
      connections.delete(ws);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(options.port ?? 0, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);

  return {
    port,
    rooms,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const ws of connections.keys()) ws.terminate();
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      }),
  };
}
