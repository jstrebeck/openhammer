import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { GameState } from '@openhammer/core';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { startServer, type OpenHammerServer } from './server.js';

/** Thin test client: send messages, await specific reply types. */
class TestClient {
  private ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  open(): Promise<void> {
    return new Promise((resolve) => this.ws.on('open', () => resolve()));
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async nextOfType<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (let i = 0; i < 20; i++) {
      const message = await this.next();
      if (message.type === type) return message as Extract<ServerMessage, { type: T }>;
    }
    throw new Error(`no ${type} message received within 20 messages`);
  }

  close(): void {
    this.ws.close();
  }
}

describe('WebSocket server', () => {
  let server: OpenHammerServer;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'openhammer-test-'));
    server = await startServer({ dataDir });
  });

  afterAll(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('runs a two-client session: create, join, act, reject, broadcast', async () => {
    const alice = new TestClient(server.port);
    const bob = new TestClient(server.port);
    await alice.open();
    await bob.open();

    alice.send({ type: 'create', name: 'Alice' });
    const created = await alice.nextOfType('created');
    expect(created.playerIndex).toBe(0);
    await alice.nextOfType('state');

    bob.send({ type: 'join', roomId: created.roomId, name: 'Bob' });
    const joined = await bob.nextOfType('joined');
    expect(joined.playerIndex).toBe(1);
    await bob.nextOfType('state');
    // The join is broadcast to everyone in the room — drain Alice's copy.
    await alice.nextOfType('state');

    // Bob acts out of turn: rejected, and only Bob hears about it.
    bob.send({ type: 'action', action: { type: 'advanceStep', player: 1 } });
    const rejected = await bob.nextOfType('rejected');
    expect(rejected.code).toBe('OUT_OF_TURN');

    // Drive the whole setup flow over the wire; every accepted action is
    // broadcast to both clients.
    const both = async (): Promise<GameState> => {
      const [a] = await Promise.all([alice.nextOfType('state'), bob.nextOfType('state')]);
      return a.state as GameState;
    };
    const clientFor = (index: number) => (index === 0 ? alice : bob);

    alice.send({ type: 'action', action: { type: 'loadRoster', player: 0, units: [] } });
    await both();
    bob.send({ type: 'action', action: { type: 'loadRoster', player: 1, units: [] } });
    await both();
    alice.send({ type: 'action', action: { type: 'performRollOff', player: 0 } });
    let state = await both();
    const winner = state.setup!.rollOff!.winner;
    clientFor(winner).send({
      type: 'action',
      action: { type: 'chooseRole', player: winner, role: 'attacker' },
    });
    await both();
    alice.send({ type: 'action', action: { type: 'performRollOff', player: 0 } });
    state = await both();
    const first = state.firstPlayer;
    expect(state.setup?.readyToStart).toBe(true);
    clientFor(first).send({ type: 'action', action: { type: 'advanceStep', player: first } });
    state = await both();
    expect(state.round).toBe(1);
    expect(state.phase).toBe('command');

    // Chat reaches both.
    bob.send({ type: 'chat', text: 'glhf' });
    const chatAtAlice = await alice.nextOfType('chat');
    expect(chatAtAlice.from).toBe('Bob');
    expect(chatAtAlice.text).toBe('glhf');

    // Reconnect with the token restores the seat.
    const reconnector = new TestClient(server.port);
    await reconnector.open();
    reconnector.send({ type: 'reconnect', roomId: created.roomId, token: created.token });
    const reconnected = await reconnector.nextOfType('reconnected');
    expect(reconnected.playerIndex).toBe(0);
    const resyncState = await reconnector.nextOfType('state');
    expect((resyncState.state as GameState).round).toBe(1);
    expect((resyncState.state as GameState).phase).toBe('command');

    // Spectators are read-only.
    const spec = new TestClient(server.port);
    await spec.open();
    spec.send({ type: 'spectate', roomId: created.roomId, name: 'Watcher' });
    await spec.nextOfType('spectating');
    await spec.nextOfType('state');
    spec.send({ type: 'action', action: { type: 'advanceStep', player: 0 } });
    const specRejected = await spec.nextOfType('rejected');
    expect(specRejected.code).toBe('NOT_SEATED');

    alice.close();
    bob.close();
    reconnector.close();
    spec.close();
  });

  it('persists rooms so a new server instance can restore them', async () => {
    const alice = new TestClient(server.port);
    await alice.open();
    alice.send({ type: 'create', name: 'Alice' });
    const created = await alice.nextOfType('created');
    await alice.nextOfType('state');
    alice.send({ type: 'action', action: { type: 'loadRoster', player: 0, units: [] } });
    await alice.nextOfType('state');
    alice.close();

    const server2 = await startServer({ dataDir });
    try {
      const room = server2.rooms.getRoom(created.roomId);
      expect(room).toBeDefined();
      expect(room!.state.setup?.rostersLoaded).toEqual([true, false]);
      // The original session token still works after restart.
      const outcome = server2.rooms.applyAction(created.roomId, created.token, {
        type: 'loadRoster',
        player: 0,
        units: [],
      });
      expect(outcome.ok).toBe(true);
    } finally {
      await server2.close();
    }
  });
});
