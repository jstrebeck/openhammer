import { describe, expect, it } from 'vitest';
import { loadEditionContent } from '@openhammer/content';
import { RoomManager } from './rooms.js';

const content = loadEditionContent('wh40k-10e');

function manager(): RoomManager {
  return new RoomManager(content.edition, content.versions);
}

describe('RoomManager', () => {
  it('creates a room with the host in seat 0 and pinned content versions', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    expect(room.seats[0].name).toBe('Alice');
    expect(room.seats[1]).toBeNull();
    expect(token).toHaveLength(32);
    expect(room.state.contentVersions['edition']).toBe('2026-06');
    expect(room.state.phase).toBe('setup');
    expect(room.state.enforcement.movement).toBe('enforce');
  });

  it('seats the second player and rejects a third', () => {
    const m = manager();
    const { room } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    expect('token' in joined).toBe(true);
    if ('token' in joined) {
      expect(joined.playerIndex).toBe(1);
      expect(room.state.players[1].name).toBe('Bob');
    }
    const third = m.joinRoom(room.id, 'Carol');
    expect(third).toEqual({ error: 'room is full' });
  });

  it('resolves seats by token for reconnection', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    expect(m.seatForToken(room.id, token)).toBe(0);
    if ('token' in joined) expect(m.seatForToken(room.id, joined.token)).toBe(1);
    expect(m.seatForToken(room.id, 'bogus')).toBeNull();
  });

  it('forces the acting player to the seat that owns the token — no spoofing', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    m.joinRoom(room.id, 'Bob');
    // Alice (seat 0, active in setup) proposes an action claiming to be player 1.
    const outcome = m.applyAction(room.id, token, { type: 'advanceStep', player: 1 });
    // The server rewrites player to 0, so it succeeds as Alice's own action.
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.room.state.round).toBe(1);
  });

  it('rejects out-of-turn actions with the reducer error', () => {
    const m = manager();
    const { room } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');
    // Bob (seat 1) tries to advance during Alice's turn.
    m.applyAction(room.id, room.seats[0].token, { type: 'advanceStep', player: 0 });
    const outcome = m.applyAction(room.id, joined.token, { type: 'advanceStep', player: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('OUT_OF_TURN');
  });

  it('rejects actions from tokens that are not seated', () => {
    const m = manager();
    const { room } = m.createRoom('Alice');
    const outcome = m.applyAction(room.id, 'spectator-token', { type: 'advanceStep', player: 0 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('NOT_SEATED');
  });

  it('keeps an action log that grows only on accepted actions', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');
    m.applyAction(room.id, token, { type: 'advanceStep', player: 0 });
    m.applyAction(room.id, joined.token, { type: 'advanceStep', player: 1 }); // rejected
    m.applyAction(room.id, token, { type: 'advanceStep', player: 0 });
    expect(room.actionLog).toHaveLength(2);
    expect(room.state.actionSeq).toBe(2);
  });

  it('serializes and restores a room with seats disconnected', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    m.joinRoom(room.id, 'Bob');
    m.applyAction(room.id, token, { type: 'advanceStep', player: 0 });
    const serialized = m.serialize(room.id)!;
    const m2 = manager();
    const restored = m2.restore(JSON.parse(JSON.stringify(serialized)));
    expect(restored.state.round).toBe(1);
    expect(restored.seats[0].connected).toBe(false);
    expect(m2.seatForToken(room.id, token)).toBe(0);
    // Play continues after restore.
    const outcome = m2.applyAction(room.id, token, { type: 'advanceStep', player: 0 });
    expect(outcome.ok).toBe(true);
  });
});
