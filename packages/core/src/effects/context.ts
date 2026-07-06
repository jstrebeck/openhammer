import type { Datasheet, EffectDef, WeaponProfile } from '../types/content.js';
import type { GameState, PlayerIndex, UnitId } from '../types/state.js';

/**
 * Lookups the engine needs but must not own: keyword/datasheet resolution
 * comes from the loaded content packs. Core stays content-agnostic.
 */
export interface ContentAccess {
  getDatasheet(datasheetId: string): Datasheet | undefined;
  /** Effective keywords for a unit (datasheet keywords + granted tokens). */
  getUnitKeywords(state: GameState, unitId: UnitId): string[];
}

/**
 * The evaluation context for a hook firing. Attack-specific fields are set
 * for attack.* hooks; movement hooks set moveUnitId; etc.
 */
export interface HookContext {
  state: GameState;
  content: ContentAccess;
  activePlayer: PlayerIndex;
  phase: string;

  attackerUnitId?: UnitId;
  targetUnitId?: UnitId;
  weapon?: WeaponProfile;
  /** Attacker-to-target distance in inches, where known. */
  distance?: number;
  /** Whether the target is visible to the attacker (LoS layer sets this). */
  targetVisible?: boolean;

  moveUnitId?: UnitId;

  /** Set per-candidate during evaluation: the unit carrying the effect. */
  bearerUnitId?: UnitId;
}

/** A candidate effect plus the bookkeeping needed for deterministic order. */
export interface EffectCandidate {
  def: EffectDef;
  bearerUnitId?: UnitId;
  player: PlayerIndex;
  /** Content-pack declaration order (loader assigns globally). */
  declOrder: number;
  /** Source for logging/limits, e.g. "stratagem:core.fire-overwatch". */
  sourceId: string;
}
