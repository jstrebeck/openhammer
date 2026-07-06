import type {
  Datasheet,
  DeploymentMapDef,
  GameState,
  MissionDef,
  RulesContent,
  UnitId,
} from '@openhammer/core';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONTENT_ROOT,
  instantiateAbilityEffects,
  loadEditionContent,
  loadFactionPack,
  WH40K_10E_SCRIPTS,
  type LoadedEditionContent,
} from '@openhammer/content';

/**
 * Server-side implementation of the core RulesContent contract, backed by
 * the content packs on disk. Faction datasheets are registered as packs
 * load (see registerDatasheets — the importer flow adds them per room's
 * factions).
 */
export interface ServerContent {
  rules: RulesContent;
  deploymentMaps: DeploymentMapDef[];
  missions: MissionDef[];
  versions: Record<string, string>;
  registerDatasheets(datasheets: Datasheet[]): void;
  allDatasheets(): Datasheet[];
  loaded: LoadedEditionContent;
}

export function buildServerContent(editionId: string, contentRoot?: string): ServerContent {
  const loaded = loadEditionContent(editionId, contentRoot);
  const datasheets = new Map<string, Datasheet>();

  // Load every faction pack shipped for this edition.
  const factionsDir = join(contentRoot ?? DEFAULT_CONTENT_ROOT, 'factions', editionId);
  if (existsSync(factionsDir)) {
    for (const factionId of readdirSync(factionsDir)) {
      if (!statSync(join(factionsDir, factionId)).isDirectory()) continue;
      const pack = loadFactionPack(editionId, factionId, contentRoot);
      for (const ds of pack.datasheets) datasheets.set(ds.id, ds);
    }
  }

  const weaponAbilityById = new Map(loaded.weaponAbilities.map((a) => [a.id, a]));
  const coreAbilityById = new Map(loaded.coreAbilities.map((a) => [a.id, a]));

  const rules: RulesContent = {
    edition: loaded.edition,
    getDatasheet: (id) => datasheets.get(id),
    getUnitKeywords: (state: GameState, unitId: UnitId) => {
      const unit = state.units[unitId];
      if (!unit) return [];
      const ds = datasheets.get(unit.datasheetId);
      return [...(ds?.keywords ?? []), ...(ds?.factionKeywords ?? []), ...unit.tokens];
    },
    getWeaponAbility: (ref) => {
      const def = weaponAbilityById.get(ref.id);
      if (!def) return { effects: [], flags: [] };
      return {
        effects: instantiateAbilityEffects(def, ref),
        flags: def.engineFlags ?? [],
      };
    },
    getCoreAbility: (ref) => {
      const def = coreAbilityById.get(ref.id);
      if (!def) return { effects: [] };
      return {
        effects: instantiateAbilityEffects(def, {
          id: ref.id,
          ...(ref.value !== undefined ? { value: ref.value } : {}),
          ...(ref.keyword !== undefined ? { keyword: ref.keyword } : {}),
        }),
        structural: def.structural,
      };
    },
    effectOrder: loaded.effectOrder,
    getStratagems: () => loaded.coreStratagems,
    getScript: (scriptId) =>
      editionId === 'wh40k-10e' ? WH40K_10E_SCRIPTS[scriptId] : undefined,
  };

  return {
    rules,
    deploymentMaps: loaded.deploymentMaps,
    missions: loaded.missions,
    versions: loaded.versions,
    registerDatasheets: (sheets) => {
      for (const ds of sheets) datasheets.set(ds.id, ds);
    },
    allDatasheets: () => [...datasheets.values()],
    loaded,
  };
}
