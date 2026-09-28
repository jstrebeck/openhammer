import type {
  Datasheet,
  DetachmentDef,
  GameAction,
  GameState,
  MechanicDef,
} from '@openhammer/core';

/** Faction content the client UI needs (picker lists, ability panels). */
export interface FactionBundle {
  id: string;
  name: string;
  armyRuleName: string;
  mechanics: MechanicDef[];
  detachments: DetachmentDef[];
}

/**
 * Wire protocol. Clients only ever PROPOSE actions; the server validates
 * against the rules engine and the sender's seat before applying.
 */

export type ClientMessage =
  | { type: 'create'; name: string; mode?: 'strict' | 'casual' }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'spectate'; roomId: string; name: string }
  | { type: 'reconnect'; roomId: string; token: string }
  | { type: 'action'; action: GameAction }
  | { type: 'uploadRoster'; roster: unknown }
  | { type: 'requestUndo'; count: number }
  | { type: 'respondUndo'; approve: boolean }
  | { type: 'chat'; text: string };

export type ServerMessage =
  | { type: 'created'; roomId: string; token: string; playerIndex: 0 }
  | { type: 'joined'; roomId: string; token: string; playerIndex: 0 | 1 }
  | { type: 'spectating'; roomId: string }
  | { type: 'reconnected'; roomId: string; playerIndex: 0 | 1 | null }
  | { type: 'state'; state: GameState }
  | { type: 'rejected'; error: string; code: string }
  | { type: 'imported'; playerIndex: 0 | 1; issues: string[]; unitCount: number }
  | { type: 'undoRequested'; by: 0 | 1; count: number }
  | { type: 'undoResolved'; performed: boolean; approved?: boolean }
  | {
      type: 'content';
      datasheets: Record<string, Datasheet>;
      factions?: Record<string, FactionBundle>;
    }
  | { type: 'chat'; from: string; text: string; at: number }
  | { type: 'presence'; seats: { name: string; connected: boolean }[]; spectators: number }
  | { type: 'error'; error: string };
