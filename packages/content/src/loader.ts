import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Datasheet,
  DeploymentMapDef,
  DetachmentDef,
  EditionDef,
  EffectDef,
  FactionPack,
  MissionDef,
  StratagemDef,
  TerrainLayoutDef,
  WeaponAbilityDef,
  WeaponAbilityRef,
} from '@openhammer/core';
import { validateContent, formatIssues, type ContentKind } from './validate.js';

/** Repo-root content directory (packages/content/../../content). */
export const DEFAULT_CONTENT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'content',
);

export class ContentLoadError extends Error {
  constructor(
    message: string,
    public readonly file: string,
  ) {
    super(message);
    this.name = 'ContentLoadError';
  }
}

function loadJson(file: string, kind: ContentKind): unknown {
  if (!existsSync(file)) {
    throw new ContentLoadError(`missing content file: ${file}`, file);
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ContentLoadError(`invalid JSON in ${file}: ${(e as Error).message}`, file);
  }
  const result = validateContent(kind, data);
  if (!result.valid) {
    throw new ContentLoadError(formatIssues(file, result.issues), file);
  }
  return data;
}

/** Core-rules ability entry (weapon-ability shape + structural marker). */
export interface CoreAbilityDef extends WeaponAbilityDef {
  structural?: string;
}

export interface LoadedEditionContent {
  edition: EditionDef;
  weaponAbilities: WeaponAbilityDef[];
  coreAbilities: CoreAbilityDef[];
  coreStratagems: StratagemDef[];
  deploymentMaps: DeploymentMapDef[];
  missions: MissionDef[];
  terrainLayouts: TerrainLayoutDef[];
  /**
   * Deterministic content-pack declaration order for every EffectDef id,
   * assigned in load order. Ties on a hook are broken with this.
   */
  effectOrder: Record<string, number>;
  /** Pack versions, keyed by file family — pinned into new games. */
  versions: Record<string, string>;
}

export function loadEditionContent(
  editionId: string,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): LoadedEditionContent {
  const dir = join(contentRoot, 'editions', editionId);
  const edition = loadJson(join(dir, 'edition.json'), 'edition') as EditionDef;
  const weaponAbilitiesFile = loadJson(join(dir, 'weapon-abilities.json'), 'weapon-abilities') as {
    version: string;
    abilities: WeaponAbilityDef[];
  };
  const coreRulesFile = loadJson(join(dir, 'core-rules.json'), 'core-rules') as {
    version: string;
    abilities: CoreAbilityDef[];
  };
  const stratagemsFile = loadJson(join(dir, 'core-stratagems.json'), 'stratagems') as {
    version: string;
    stratagems: StratagemDef[];
  };

  const deploymentMaps: DeploymentMapDef[] = [];
  const missions: MissionDef[] = [];
  const terrainLayouts: TerrainLayoutDef[] = [];
  const missionsDir = join(dir, 'missions');
  if (existsSync(missionsDir)) {
    for (const packName of readdirSync(missionsDir)) {
      const packDir = join(missionsDir, packName);
      const mapsFile = join(packDir, 'deployment-maps.json');
      const missionsFile = join(packDir, 'missions.json');
      const terrainFile = join(packDir, 'terrain-layouts.json');
      if (existsSync(mapsFile)) {
        const parsed = loadJson(mapsFile, 'deployment-maps') as { maps: DeploymentMapDef[] };
        deploymentMaps.push(...parsed.maps);
      }
      if (existsSync(missionsFile)) {
        const parsed = loadJson(missionsFile, 'missions') as { missions: MissionDef[] };
        missions.push(...parsed.missions);
      }
      if (existsSync(terrainFile)) {
        const parsed = loadJson(terrainFile, 'terrain-layouts') as {
          layouts: TerrainLayoutDef[];
        };
        terrainLayouts.push(...parsed.layouts);
      }
    }
  }

  // Assign global declaration order across all effect definitions.
  const effectOrder: Record<string, number> = {};
  let order = 0;
  const visit = (effects: EffectDef[]) => {
    for (const e of effects) {
      if (!(e.id in effectOrder)) effectOrder[e.id] = order++;
    }
  };
  visit(coreRulesFile.abilities.flatMap((a) => a.effects));
  visit(weaponAbilitiesFile.abilities.flatMap((a) => a.effects));
  visit(stratagemsFile.stratagems.flatMap((s) => s.effects));

  return {
    edition,
    weaponAbilities: weaponAbilitiesFile.abilities,
    coreAbilities: coreRulesFile.abilities,
    coreStratagems: stratagemsFile.stratagems,
    deploymentMaps,
    missions,
    terrainLayouts,
    effectOrder,
    versions: {
      edition: edition.version,
      'weapon-abilities': weaponAbilitiesFile.version,
      'core-rules': coreRulesFile.version,
      'core-stratagems': stratagemsFile.version,
    },
  };
}

// ---------------------------------------------------------------------------
// Faction packs
// ---------------------------------------------------------------------------

export interface LoadedFactionPack {
  pack: FactionPack;
  datasheets: Datasheet[];
  detachments: DetachmentDef[];
  /** Effect ids declared by this pack, in declaration order. */
  effectIds: string[];
}

/**
 * Load one faction pack (faction.json + datasheets/*.json +
 * detachments/*.json) from content/factions/<editionId>/<factionId>/,
 * validating every file.
 */
export function loadFactionPack(
  editionId: string,
  factionId: string,
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): LoadedFactionPack {
  const dir = join(contentRoot, 'factions', editionId, factionId);
  const pack = loadJson(join(dir, 'faction.json'), 'faction') as FactionPack;
  const datasheets: Datasheet[] = [];
  const sheetsDir = join(dir, 'datasheets');
  if (existsSync(sheetsDir)) {
    for (const file of readdirSync(sheetsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      datasheets.push(loadJson(join(sheetsDir, file), 'datasheet') as Datasheet);
    }
  }
  const detachments: DetachmentDef[] = [];
  const detachmentsDir = join(dir, 'detachments');
  if (existsSync(detachmentsDir)) {
    for (const file of readdirSync(detachmentsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      detachments.push(loadJson(join(detachmentsDir, file), 'detachment') as DetachmentDef);
    }
  }

  // Declaration order for deterministic effect resolution ties.
  const effectIds: string[] = [];
  const visit = (effects: { id: string }[]) => {
    for (const e of effects) if (!effectIds.includes(e.id)) effectIds.push(e.id);
  };
  visit(pack.armyRule.effects);
  for (const mechanic of pack.mechanics ?? []) visit(mechanic.effects);
  for (const ds of datasheets) visit(ds.abilities);
  for (const det of detachments) {
    visit(det.rule.effects);
    for (const e of det.enhancements) visit(e.effects);
    for (const s of det.stratagems) visit(s.effects);
  }
  return { pack, datasheets, detachments, effectIds };
}

// ---------------------------------------------------------------------------
// Parameter substitution: "$X" / "$KEYWORD" placeholders in ability effects
// ---------------------------------------------------------------------------

/**
 * Resolve a parameterized ability's effects for a concrete weapon ref,
 * e.g. Rapid Fire 2 turns {"type":"addAttacks","value":"$X"} into value 2.
 */
export function instantiateAbilityEffects(
  ability: WeaponAbilityDef,
  ref: WeaponAbilityRef,
): EffectDef[] {
  const substitute = (value: unknown): unknown => {
    if (value === '$X') {
      if (ref.value === undefined) {
        throw new Error(`ability "${ability.id}" requires a value (X) but the reference has none`);
      }
      return ref.value;
    }
    if (value === '$KEYWORD') {
      if (ref.keyword === undefined) {
        throw new Error(`ability "${ability.id}" requires a keyword but the reference has none`);
      }
      return ref.keyword;
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = substitute(v);
      return out;
    }
    return value;
  };
  return ability.effects.map((e) => {
    const inst = substitute(e) as EffectDef;
    // Distinct id per instantiation so usage tracking stays per-weapon-ref.
    const suffix = [ref.value, ref.keyword].filter((v) => v !== undefined).join('-');
    return suffix ? { ...inst, id: `${inst.id}#${suffix}` } : inst;
  });
}
