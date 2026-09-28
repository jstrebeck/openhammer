import { describe, expect, it } from 'vitest';
import type { GameState } from '@openhammer/core';
import { buildServerContent } from './content.js';
import { RoomManager, type Room, type SerializedRoom } from './rooms.js';

function manager(): RoomManager {
  return new RoomManager(buildServerContent('wh40k-10e'));
}

function snapshot(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Create a room with both seats filled; returns tokens per seat. */
function twoSeats(m: RoomManager): { room: Room; tokens: [string, string] } {
  const { room, token } = m.createRoom('Alice');
  const joined = m.joinRoom(room.id, 'Bob');
  if (!('token' in joined)) throw new Error('join failed');
  return { room, tokens: [token, joined.token] };
}

describe('undo / takeback', () => {
  it('performs a free undo of your own dice-less action immediately', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    const before = snapshot(room.state);

    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(room.actionLog).toHaveLength(1);

    const result = m.requestUndo(room.id, tokens[0], 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.performed).toBe(true);
    expect(room.actionLog).toHaveLength(0);
    expect(room.pendingUndo).toBeNull();
    // The rewound state is byte-for-byte the pre-action state.
    expect(snapshot(room.state)).toEqual(before);
  });

  it('needs approval when dice were consumed, and replays the SAME dice after the undo', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    const preRollCounter = room.state.rng.counter;

    expect(m.applyAction(room.id, tokens[0], { type: 'performRollOff', player: 0 }).ok).toBe(true);
    const firstRollOff = snapshot(room.state).setup!.rollOff!;
    const postRollCounter = room.state.rng.counter;
    expect(postRollCounter).toBeGreaterThan(preRollCounter);

    // Undoing the roll-off is the requester's own action, but it consumed dice.
    const request = m.requestUndo(room.id, tokens[0], 1);
    expect(request.ok).toBe(true);
    if (request.ok) expect(request.performed).toBe(false);
    expect(room.pendingUndo).toEqual({ requestedBy: 0, count: 1 });
    expect(room.actionLog).toHaveLength(3); // nothing rewound yet

    const response = m.respondUndo(room.id, tokens[1], true);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.approved).toBe(true);
    expect(room.pendingUndo).toBeNull();
    expect(room.actionLog).toHaveLength(2);
    // The rng state at the cut point is restored exactly — nothing re-rolled.
    expect(room.state.rng.counter).toBe(preRollCounter);
    expect(room.state.setup?.rollOff).toBeNull();

    // A fresh roll-off after the undo yields THE SAME dice (seeded determinism).
    expect(m.applyAction(room.id, tokens[0], { type: 'performRollOff', player: 0 }).ok).toBe(true);
    expect(snapshot(room.state).setup!.rollOff!).toEqual(firstRollOff);
    expect(room.state.rng.counter).toBe(postRollCounter);
  });

  it('needs approval when the suffix contains the opponent’s actions', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    // No dice were consumed, but the 2-action suffix includes Bob's action.
    const request = m.requestUndo(room.id, tokens[0], 2);
    expect(request.ok).toBe(true);
    if (request.ok) expect(request.performed).toBe(false);
    expect(room.pendingUndo).toEqual({ requestedBy: 0, count: 2 });
  });

  it('rejects responses from the requester or a non-seat token', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    expect(m.requestUndo(room.id, tokens[0], 2).ok).toBe(true);

    const byRequester = m.respondUndo(room.id, tokens[0], true);
    expect(byRequester.ok).toBe(false);
    if (!byRequester.ok) expect(byRequester.code).toBe('NOT_OPPONENT');

    const bySpectator = m.respondUndo(room.id, 'bogus-token', true);
    expect(bySpectator.ok).toBe(false);
    if (!bySpectator.ok) expect(bySpectator.code).toBe('NOT_SEATED');

    // Both rejections leave the request pending.
    expect(room.pendingUndo).toEqual({ requestedBy: 0, count: 2 });
  });

  it('deny clears the pending request and changes nothing', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    const before = snapshot(room.state);
    expect(m.requestUndo(room.id, tokens[0], 2).ok).toBe(true);

    const denied = m.respondUndo(room.id, tokens[1], false);
    expect(denied.ok).toBe(true);
    if (denied.ok) expect(denied.approved).toBe(false);
    expect(room.pendingUndo).toBeNull();
    expect(room.actionLog).toHaveLength(2);
    expect(snapshot(room.state)).toEqual(before);
  });

  it('rejects bad counts and duplicate requests', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);

    for (const count of [0, -1, 2, 1.5]) {
      const result = m.requestUndo(room.id, tokens[0], count);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BAD_COUNT');
    }

    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    expect(m.requestUndo(room.id, tokens[0], 2).ok).toBe(true); // pending
    const duplicate = m.requestUndo(room.id, tokens[1], 1);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('UNDO_PENDING');
  });

  it('round-trips initialState + pendingUndo through serialize/restore; replayTo still works', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    const preRollCounter = room.state.rng.counter;
    expect(m.applyAction(room.id, tokens[0], { type: 'performRollOff', player: 0 }).ok).toBe(true);
    expect(m.requestUndo(room.id, tokens[0], 1).ok).toBe(true); // parked as pending

    const serialized = m.serialize(room.id)!;
    const m2 = manager();
    const restored = m2.restore(JSON.parse(JSON.stringify(serialized)) as SerializedRoom);
    expect(restored.pendingUndo).toEqual({ requestedBy: 0, count: 1 });
    expect(restored.actionLog).toHaveLength(3);
    // Full replay over the restored initialState reproduces the current state.
    expect(snapshot(m2.replayTo(room.id, 3))).toEqual(snapshot(restored.state));
    // The pending undo is still actionable after restore.
    const response = m2.respondUndo(room.id, tokens[1], true);
    expect(response.ok).toBe(true);
    expect(restored.state.rng.counter).toBe(preRollCounter);
    expect(restored.actionLog).toHaveLength(2);
  });

  it('restores legacy rooms without initialState by treating the current state as initial', () => {
    const m = manager();
    const { room, tokens } = twoSeats(m);
    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    const serialized = JSON.parse(JSON.stringify(m.serialize(room.id)!)) as SerializedRoom;
    delete serialized.initialState;
    delete serialized.pendingUndo;

    const m2 = manager();
    const restored = m2.restore(serialized);
    expect(restored.actionLog).toHaveLength(0); // history starts fresh
    expect(restored.pendingUndo).toBeNull();
    expect(snapshot(restored.initialState)).toEqual(snapshot(restored.state));
    expect(snapshot(m2.replayTo(room.id, 0))).toEqual(snapshot(restored.state));
    // Play continues, and the new history is undoable.
    expect(m2.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    const undo = m2.requestUndo(room.id, tokens[1], 1);
    expect(undo.ok).toBe(true);
    if (undo.ok) expect(undo.performed).toBe(true);
    expect(restored.state.setup?.rostersLoaded).toEqual([true, false]);
  });
});
