import type {
  Datasheet,
  DetachmentDef,
  EditionDef,
  EffectDef,
  EngineFlag,
  FactionPack,
  MechanicDef,
  StratagemDef,
  WeaponAbilityRef,
} from '../types/content.js';
import type { GameState, PlayerIndex, UnitId } from '../types/state.js';

/**
 * The escape hatch: a TS function registered by a content pack for rules
 * too weird for the effect schema. Scripts are pure state transitions.
 */
export type ScriptFn = (
  state: GameState,
  env: ReducerEnv,
  args: {
    /** The player who invoked the stratagem/effect. */
    player: PlayerIndex;
    targetUnitId?: UnitId;
    context: Record<string, unknown>;
  },
) => GameState;

/**
 * Everything the reducer needs from loaded content packs. Core defines the
 * contract and stays content-agnostic; the server implements it with
 * @openhammer/content (packs on disk), tests with in-memory stubs.
 */
export interface RulesContent {
  edition: EditionDef;
  getDatasheet(datasheetId: string): Datasheet | undefined;
  /** Effective keywords: datasheet keywords + faction keywords + tokens. */
  getUnitKeywords(state: GameState, unitId: UnitId): string[];
  /**
   * Instantiated effects + structural flags for a weapon-ability reference
   * (Rapid Fire 2 → addAttacks 2, already parameter-substituted).
   */
  getWeaponAbility(ref: WeaponAbilityRef): { effects: EffectDef[]; flags: EngineFlag[] };
  /** Effects for a datasheet core-ability reference (Stealth, FNP 5+...). */
  getCoreAbility(ref: { id: string; value?: number; keyword?: string }): {
    effects: EffectDef[];
    structural?: string;
  };
  /** Content-pack declaration order for deterministic tie-breaks. */
  effectOrder: Record<string, number>;
  /** All stratagems in play (core + detachment once factions land). */
  getStratagems?(): StratagemDef[];
  /**
   * Stratagems available to a specific player: the core set plus their
   * chosen detachment's. Preferred over getStratagems when present.
   */
  getStratagemsFor?(state: GameState, player: number): StratagemDef[];
  /** Script registry lookup (undefined = script unavailable). */
  getScript?(scriptId: string): ScriptFn | undefined;
  /** Faction pack (army rule + mechanics) by faction id. */
  getFaction?(factionId: string): FactionPack | undefined;
  /** A detachment definition by id. */
  getDetachment?(detachmentId: string): DetachmentDef | undefined;
  /** All detachments shipped for a faction. */
  getDetachmentsFor?(factionId: string): DetachmentDef[];
  /** Activated faction mechanics (Orders, spotter pairings) by faction. */
  getFactionMechanics?(factionId: string): MechanicDef[];
}

export interface ReducerEnv {
  content: RulesContent;
}
