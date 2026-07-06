import type {
  Datasheet,
  EditionDef,
  EffectDef,
  EngineFlag,
  WeaponAbilityRef,
} from '../types/content.js';
import type { GameState, UnitId } from '../types/state.js';

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
}

export interface ReducerEnv {
  content: RulesContent;
}
