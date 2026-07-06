import { randomBytes, randomInt } from 'node:crypto';
import {
  createInitialGameState,
  reduce,
  type ActionResult,
  type GameAction,
  type GameState,
  type PlayerIndex,
} from '@openhammer/core';
import { matchRoster, parseRoster } from '@openhammer/content';
import type { ServerContent } from './content.js';
import { materializeRoster } from './materialize.js';

/**
 * Room management, decoupled from the transport so it is unit-testable.
 * The server owns the state: every action is validated against the seat
 * that proposed it — the client-supplied player index is overwritten.
 */

export interface Seat {
  token: string;
  name: string;
  connected: boolean;
}

/** An undo awaiting the opponent's approval. */
export interface PendingUndo {
  requestedBy: PlayerIndex;
  count: number;
}

export interface Room {
  id: string;
  createdAt: number;
  state: GameState;
  /** State at room creation — replaying `actionLog` over it reproduces `state`. */
  initialState: GameState;
  /** Applied actions, in order — replaying them reproduces `state`. */
  actionLog: GameAction[];
  seats: [Seat, Seat | null];
  chat: { from: string; text: string; at: number }[];
  pendingUndo: PendingUndo | null;
}

export interface SerializedRoom {
  id: string;
  createdAt: number;
  state: GameState;
  /** Absent in rooms persisted before undo support — see restore(). */
  initialState?: GameState;
  actionLog: GameAction[];
  seats: [Seat, Seat | null];
  chat: { from: string; text: string; at: number }[];
  pendingUndo?: PendingUndo | null;
}

export type ApplyOutcome =
  | { ok: true; room: Room }
  | { ok: false; error: string; code: string };

export type UndoRequestOutcome =
  | { ok: true; performed: true; room: Room }
  | { ok: true; performed: false; room: Room; requestedBy: PlayerIndex }
  | { ok: false; error: string; code: string };

export type UndoRespondOutcome =
  | { ok: true; approved: boolean; room: Room }
  | { ok: false; error: string; code: string };

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private readonly content: ServerContent) {}

  createRoom(hostName: string, deploymentMapId = 'dawn-of-war'): { room: Room; token: string } {
    const id = randomBytes(4).toString('hex');
    const token = randomBytes(16).toString('hex');
    const map =
      this.content.deploymentMaps.find((m) => m.id === deploymentMapId) ??
      this.content.deploymentMaps[0];
    const mission = this.content.missions[0];
    const state = createInitialGameState({
      editionId: this.content.rules.edition.id,
      missionId: mission?.id ?? 'take-and-hold',
      deploymentMapId: map?.id ?? deploymentMapId,
      contentVersions: this.content.versions,
      board: map
        ? {
            width: map.boardSize.width,
            height: map.boardSize.height,
            terrain: terrainFromLayout(this.content, map.boardSize),
            objectives: map.objectives.map((o) => ({ id: o.id, position: { x: o.x, y: o.y } })),
            deploymentZones: map.zones.map((z) => ({ player: z.player, polygon: z.polygon })),
          }
        : { width: 60, height: 44, terrain: [], objectives: [], deploymentZones: [] },
      players: [
        { name: hostName, factionId: '', detachmentId: '' },
        { name: 'Awaiting opponent', factionId: '', detachmentId: '' },
      ],
      rngSeed: randomInt(2 ** 31),
    });
    const room: Room = {
      id,
      createdAt: Date.now(),
      state,
      initialState: state,
      actionLog: [],
      seats: [{ token, name: hostName, connected: true }, null],
      chat: [],
      pendingUndo: null,
    };
    this.rooms.set(id, room);
    return { room, token };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }

  joinRoom(roomId: string, name: string): { room: Room; token: string; playerIndex: 1 } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: `no such room: ${roomId}` };
    if (room.seats[1] !== null) return { error: 'room is full' };
    const token = randomBytes(16).toString('hex');
    room.seats[1] = { token, name, connected: true };
    room.state = {
      ...room.state,
      players: [room.state.players[0], { ...room.state.players[1], name }],
    };
    // The rename is not a logged action, so mirror it into initialState —
    // otherwise a replay from the start would resurrect the placeholder name.
    room.initialState = {
      ...room.initialState,
      players: [room.initialState.players[0], { ...room.initialState.players[1], name }],
    };
    return { room, token, playerIndex: 1 };
  }

  /** Resolve a session token to a seat; reconnection restores the seat. */
  seatForToken(roomId: string, token: string): PlayerIndex | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.seats[0].token === token) return 0;
    if (room.seats[1]?.token === token) return 1;
    return null;
  }

  /**
   * Validate and apply an action proposed by the holder of `token`.
   * The action's player field is forced to the seat index — a client can
   * never act as the other player, whatever it sends.
   */
  applyAction(roomId: string, token: string, action: GameAction): ApplyOutcome {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: `no such room: ${roomId}`, code: 'NO_ROOM' };
    const seat = this.seatForToken(roomId, token);
    if (seat === null) {
      return { ok: false, error: 'not seated in this game (spectators are read-only)', code: 'NOT_SEATED' };
    }
    const authoritative: GameAction = { ...action, player: seat };
    const result: ActionResult = reduce(room.state, authoritative, {
      content: this.content.rules,
    });
    if (!result.ok) return { ok: false, error: result.error, code: result.code };
    room.state = { ...result.state, actionSeq: room.state.actionSeq + 1 };
    room.actionLog.push(authoritative);
    return { ok: true, room };
  }

  /**
   * Pure replay of actionLog[0..count) over initialState. Replaying applies
   * the same actionSeq bump as applyAction so derived ids match exactly.
   * A rejected action during replay is a bug (the log only ever contains
   * accepted actions), so it throws with the failing index.
   */
  replayTo(roomId: string, count: number): GameState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`no such room: ${roomId}`);
    if (!Number.isInteger(count) || count < 0 || count > room.actionLog.length) {
      throw new Error(`replayTo count out of range: ${count} (log has ${room.actionLog.length})`);
    }
    let state = room.initialState;
    for (let i = 0; i < count; i++) {
      const action = room.actionLog[i]!;
      const result = reduce(state, action, { content: this.content.rules });
      if (!result.ok) {
        throw new Error(
          `replay failed at action ${i} (${action.type}): ${result.error} [${result.code}]`,
        );
      }
      state = { ...result.state, actionSeq: state.actionSeq + 1 };
    }
    return state;
  }

  /**
   * Ask to rewind the last `count` actions. Free (performed immediately) iff
   * every undone action belongs to the requester AND the suffix consumed no
   * dice (rng.counter identical at the cut point) — otherwise the request is
   * parked as pendingUndo for the opponent to approve or deny.
   */
  requestUndo(roomId: string, token: string, count: number): UndoRequestOutcome {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: `no such room: ${roomId}`, code: 'NO_ROOM' };
    const seat = this.seatForToken(roomId, token);
    if (seat === null) {
      return { ok: false, error: 'not seated in this game (spectators are read-only)', code: 'NOT_SEATED' };
    }
    if (!Number.isInteger(count) || count < 1 || count > room.actionLog.length) {
      return {
        ok: false,
        error: `cannot undo ${count} action(s): log has ${room.actionLog.length}`,
        code: 'BAD_COUNT',
      };
    }
    if (room.pendingUndo) {
      return { ok: false, error: 'an undo request is already pending', code: 'UNDO_PENDING' };
    }
    const suffix = room.actionLog.slice(room.actionLog.length - count);
    const ownActionsOnly = suffix.every((a) => a.player === seat);
    if (ownActionsOnly) {
      const replayed = this.replayTo(roomId, room.actionLog.length - count);
      if (replayed.rng.counter === room.state.rng.counter) {
        this.performRewind(room, replayed, count);
        return { ok: true, performed: true, room };
      }
    }
    room.pendingUndo = { requestedBy: seat, count };
    return { ok: true, performed: false, room, requestedBy: seat };
  }

  /** Resolve a pending undo request. Only the seat that did NOT request it may respond. */
  respondUndo(roomId: string, token: string, approve: boolean): UndoRespondOutcome {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: `no such room: ${roomId}`, code: 'NO_ROOM' };
    const seat = this.seatForToken(roomId, token);
    if (seat === null) {
      return { ok: false, error: 'not seated in this game (spectators are read-only)', code: 'NOT_SEATED' };
    }
    const pending = room.pendingUndo;
    if (!pending) {
      return { ok: false, error: 'no undo request is pending', code: 'NO_PENDING_UNDO' };
    }
    if (seat === pending.requestedBy) {
      return { ok: false, error: 'only the opponent may respond to an undo request', code: 'NOT_OPPONENT' };
    }
    room.pendingUndo = null;
    if (!approve) return { ok: true, approved: false, room };
    const replayed = this.replayTo(roomId, room.actionLog.length - pending.count);
    this.performRewind(room, replayed, pending.count);
    return { ok: true, approved: true, room };
  }

  /** Rewind the last `count` actions to the already-replayed cut-point state. */
  private performRewind(room: Room, replayed: GameState, count: number): void {
    room.state = replayed;
    room.actionLog = room.actionLog.slice(0, room.actionLog.length - count);
  }

  serialize(roomId: string): SerializedRoom | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return {
      id: room.id,
      createdAt: room.createdAt,
      state: room.state,
      initialState: room.initialState,
      actionLog: room.actionLog,
      seats: room.seats,
      chat: room.chat,
      pendingUndo: room.pendingUndo,
    };
  }

  get rulesContent() {
    return this.content.rules;
  }

  /**
   * Parse + match an uploaded roster, materialize units, and load them
   * into the game via a validated loadRoster action. Unmatched units are
   * reported but never block (stat-only tokens).
   */
  importRoster(
    roomId: string,
    token: string,
    rosterJson: unknown,
  ):
    | { ok: true; room: Room; issues: string[]; unitCount: number; playerIndex: PlayerIndex }
    | { ok: false; error: string; code: string } {
    const seat = this.seatForToken(roomId, token);
    if (seat === null) {
      return { ok: false, error: 'not seated in this game', code: 'NOT_SEATED' };
    }
    let parsed;
    try {
      parsed = parseRoster(rosterJson);
    } catch (e) {
      return { ok: false, error: `could not parse roster: ${(e as Error).message}`, code: 'BAD_ROSTER' };
    }
    const result = matchRoster(parsed, this.content.allDatasheets());
    const units = materializeRoster(parsed, result, (id) =>
      this.content.rules.getDatasheet(id),
    );
    const outcome = this.applyAction(roomId, token, {
      type: 'loadRoster',
      player: seat,
      units,
    });
    if (!outcome.ok) return outcome;
    return { ok: true, room: outcome.room, issues: result.issues, unitCount: units.length, playerIndex: seat };
  }

  restore(serialized: SerializedRoom): Room {
    // Rooms persisted before undo support have no initialState, so their log
    // cannot be replayed from the true beginning. Fall back to treating the
    // CURRENT state as initial with an empty log: play continues normally,
    // but undo history starts fresh from the restore point.
    const hasInitial = serialized.initialState !== undefined;
    const room: Room = {
      ...serialized,
      initialState: serialized.initialState ?? serialized.state,
      actionLog: hasInitial ? serialized.actionLog : [],
      pendingUndo: serialized.pendingUndo ?? null,
      seats: [
        { ...serialized.seats[0], connected: false },
        serialized.seats[1] ? { ...serialized.seats[1], connected: false } : null,
      ],
    };
    this.rooms.set(room.id, room);
    return room;
  }
}

/** Pick the first terrain layout from content matching the board size. */
function terrainFromLayout(
  content: ServerContent,
  boardSize: { width: number; height: number },
) {
  const layout =
    content.loaded.terrainLayouts.find(
      (l) => l.boardSize.width === boardSize.width && l.boardSize.height === boardSize.height,
    ) ?? content.loaded.terrainLayouts[0];
  if (!layout) return [];
  return layout.pieces.map((p) => ({
    id: p.id,
    name: p.name,
    footprint: p.footprint.map((v) => ({ x: v.x, y: v.y })),
    height: p.height,
    traits: p.traits as import('@openhammer/core').TerrainTrait[],
  }));
}
