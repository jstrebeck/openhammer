import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServerContent } from './content.js';
import { RoomManager } from './rooms.js';

function manager(): RoomManager {
  return new RoomManager(buildServerContent('wh40k-10e'));
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
    // Alice (seat 0) proposes a roster load claiming to be player 1.
    const outcome = m.applyAction(room.id, token, { type: 'loadRoster', player: 1, units: [] });
    expect(outcome.ok).toBe(true);
    // The server rewrote the action to seat 0: it is ALICE's roster slot.
    if (outcome.ok) expect(outcome.room.state.setup?.rostersLoaded).toEqual([true, false]);
  });

  it('rejects out-of-turn actions with the reducer error', () => {
    const m = manager();
    const { room } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');
    // Bob (seat 1) tries to advance while player 0 is the active player.
    const outcome = m.applyAction(room.id, joined.token, { type: 'advanceStep', player: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('OUT_OF_TURN');
  });

  it('drives the full setup flow to round 1 through validated actions', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');
    const tokens: [string, string] = [token, joined.token];

    // Premature advance is rejected until setup completes.
    const early = m.applyAction(room.id, token, { type: 'advanceStep', player: 0 });
    expect(early.ok).toBe(false);

    expect(m.applyAction(room.id, tokens[0], { type: 'loadRoster', player: 0, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[1], { type: 'loadRoster', player: 1, units: [] }).ok).toBe(true);
    expect(m.applyAction(room.id, tokens[0], { type: 'performRollOff', player: 0 }).ok).toBe(true);
    const winner = room.state.setup!.rollOff!.winner;
    expect(
      m.applyAction(room.id, tokens[winner], { type: 'chooseRole', player: winner, role: 'attacker' }).ok,
    ).toBe(true);
    // No units to deploy → straight to the first-turn roll-off.
    expect(m.applyAction(room.id, tokens[0], { type: 'performRollOff', player: 0 }).ok).toBe(true);
    const first = room.state.firstPlayer;
    expect(room.state.setup?.readyToStart).toBe(true);
    const begun = m.applyAction(room.id, tokens[first], { type: 'advanceStep', player: first });
    expect(begun.ok).toBe(true);
    expect(room.state.round).toBe(1);
    expect(room.state.phase).toBe('command');
    expect(room.state.players[0].cp).toBe(1);
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
    m.applyAction(room.id, token, { type: 'loadRoster', player: 0, units: [] }); // ok
    m.applyAction(room.id, token, { type: 'performRollOff', player: 0 }); // rejected: 1 roster
    m.applyAction(room.id, joined.token, { type: 'loadRoster', player: 1, units: [] }); // ok
    expect(room.actionLog).toHaveLength(2);
    expect(room.state.actionSeq).toBe(2);
  });

  it('imports both sample rosters into game state with full matching', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');

    const tau = JSON.parse(
      readFileSync(new URL('../../../samples/tau-empire-1000.json', import.meta.url), 'utf8'),
    );
    const am = JSON.parse(
      readFileSync(new URL('../../../samples/astra-militarum-1000.json', import.meta.url), 'utf8'),
    );

    const tauResult = m.importRoster(room.id, token, tau);
    expect(tauResult.ok).toBe(true);
    if (tauResult.ok) {
      expect(tauResult.issues).toEqual([]);
      expect(tauResult.unitCount).toBe(8);
    }
    const amResult = m.importRoster(room.id, joined.token, am);
    expect(amResult.ok).toBe(true);
    if (amResult.ok) expect(amResult.issues).toEqual([]);

    const p0Units = Object.values(room.state.units).filter((u) => u.owner === 0);
    const p1Units = Object.values(room.state.units).filter((u) => u.owner === 1);
    expect(p0Units).toHaveLength(8);
    expect(p1Units.length).toBeGreaterThan(0);
    expect(room.state.setup?.rostersLoaded).toEqual([true, true]);

    // Matched units carry real weapons with loadouts on real datasheets.
    const strikeTeam = p0Units.find((u) => u.name.toLowerCase().includes('strike team'));
    expect(strikeTeam).toBeDefined();
    expect(strikeTeam!.unmatched).toBeUndefined();
    expect(Object.keys(strikeTeam!.weapons).length).toBeGreaterThan(0);
    const armedModels = strikeTeam!.models.filter(
      (mm) => (strikeTeam!.loadout[mm.id] ?? []).length > 0,
    );
    expect(armedModels.length).toBe(strikeTeam!.models.length);
    // The datasheet is resolvable through the rules content.
    expect(m.rulesContent.getDatasheet(strikeTeam!.datasheetId)?.name).toBeDefined();
  });

  it('imports unknown units as stat-only tokens with a warning', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const tau = JSON.parse(
      readFileSync(new URL('../../../samples/tau-empire-1000.json', import.meta.url), 'utf8'),
    );
    tau.roster.forces[0].selections[0].name = 'Mystery Unit of Doom';
    const result = m.importRoster(room.id, token, tau);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues.some((i) => i.includes('Mystery Unit of Doom'))).toBe(true);
      const mystery = Object.values(room.state.units).find((u) =>
        u.name.includes('Mystery'),
      );
      expect(mystery?.unmatched).toBe(true);
    }
  });

  it('exposes core stratagems and the script registry through the rules env', () => {
    const content = buildServerContent('wh40k-10e');
    const stratagems = content.rules.getStratagems?.() ?? [];
    expect(stratagems).toHaveLength(11);
    // Implemented scripts resolve; deferred ones do not (their stratagems
    // are then silently ineligible in windows rather than broken).
    for (const id of [
      'core.command-reroll',
      'core.fire-overwatch',
      'core.tank-shock',
      'core.counter-offensive',
    ]) {
      expect(content.rules.getScript?.(id), id).toBeTypeOf('function');
    }
    for (const id of ['core.heroic-intervention', 'core.rapid-ingress', 'core.grenade']) {
      expect(content.rules.getScript?.(id), id).toBeUndefined();
    }
  });

  it('serializes and restores a room with seats disconnected', () => {
    const m = manager();
    const { room, token } = m.createRoom('Alice');
    const joined = m.joinRoom(room.id, 'Bob');
    if (!('token' in joined)) throw new Error('join failed');
    m.applyAction(room.id, token, { type: 'loadRoster', player: 0, units: [] });
    const serialized = m.serialize(room.id)!;
    const m2 = manager();
    const restored = m2.restore(JSON.parse(JSON.stringify(serialized)));
    expect(restored.state.setup?.rostersLoaded).toEqual([true, false]);
    expect(restored.seats[0].connected).toBe(false);
    expect(m2.seatForToken(room.id, token)).toBe(0);
    // Play continues after restore, with the other seat's token too.
    const outcome = m2.applyAction(room.id, joined.token, {
      type: 'loadRoster',
      player: 1,
      units: [],
    });
    expect(outcome.ok).toBe(true);
  });
});
