/**
 * Faction-pack generation from the New Recruit sample rosters. This is a
 * dev tool, not engine code: it bootstraps content/factions/** from
 * samples/*.json. The CLI shim lives in packages/content/tools; the logic
 * lives here so tests can run generation programmatically.
 *
 * Real army-rule / datasheet-ability effects are milestone 4 — this emits
 * stat-complete datasheets with core-ability refs, and preserves anything
 * it cannot express in `wargearNotes` ('TODO m4: ...') so nothing is
 * silently lost.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Datasheet,
  DatasheetAbilityRef,
  FactionPack,
  ModelProfile,
  PackHeader,
  WeaponAbilityRef,
  WeaponProfile,
} from '@openhammer/core';
import {
  normalizeName,
  parseRoster,
  type ParsedRoster,
  type RosterProfile,
  type RosterUnit,
} from './importer.js';
import { DEFAULT_CONTENT_ROOT } from './loader.js';
import { SUPPORTED_SCHEMA_VERSION, validateContent, type ValidationIssue } from './validate.js';

/** Repo-root samples directory (packages/content/src/../../../samples). */
export const DEFAULT_SAMPLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'samples',
);

const EDITION_ID = 'wh40k-10e';
const PACK_VERSION = '2026-06';

export interface GeneratedFactionPack {
  faction: FactionPack;
  datasheets: (Datasheet & PackHeader)[];
  /** Unknown weapon abilities and other lossy-parse notes, deduplicated. */
  warnings: string[];
}

interface SampleConfig {
  file: string;
  factionId: string;
  armyRuleName: string;
  armyRuleParaphrase: string;
}

const SAMPLES: SampleConfig[] = [
  {
    file: 'tau-empire-1000.json',
    factionId: 'tau-empire',
    armyRuleName: 'For the Greater Good',
    armyRuleParaphrase:
      'Friendly units can spot for each other, sharpening the aim of guided ranged attacks.',
  },
  {
    file: 'astra-militarum-1000.json',
    factionId: 'astra-militarum',
    armyRuleName: 'Voice of Command',
    armyRuleParaphrase:
      'Officers issue battlefield orders that temporarily bolster nearby regiment units.',
  },
];

// ---------------------------------------------------------------------------
// Small parsers for the $text characteristic conventions
// ---------------------------------------------------------------------------

/** 'strike-team' from 'Strike Team'; shares normalization with the importer. */
function slugify(name: string): string {
  return normalizeName(name).replace(/ /g, '-');
}

function charValue(profile: RosterProfile, name: string, ctx: string): string {
  const ch = profile.characteristics.find((c) => c.name === name);
  if (!ch) throw new Error(`${ctx}: missing characteristic "${name}"`);
  return ch.value.trim();
}

/** '10"' -> 10 (also accepts a bare number string). */
function parseInches(raw: string, ctx: string): number {
  const m = /^([\d.]+)\s*"?$/.exec(raw);
  const v = m?.[1];
  if (v === undefined) throw new Error(`${ctx}: cannot parse inches value "${raw}"`);
  return Number(v);
}

/** '3+' -> 3 (saves, leadership, hit skills). */
function parsePlus(raw: string, ctx: string): number {
  const m = /^(\d+)\+$/.exec(raw);
  const v = m?.[1];
  if (v === undefined) throw new Error(`${ctx}: cannot parse roll value "${raw}"`);
  return Number(v);
}

function parseIntStrict(raw: string, ctx: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${ctx}: cannot parse integer "${raw}"`);
  return n;
}

// ---------------------------------------------------------------------------
// Weapon ability parsing ('Rapid Fire 1, Lethal Hits' -> WeaponAbilityRef[])
// ---------------------------------------------------------------------------

/** Universal abilities that take no parameter — slug must land on these ids. */
const KNOWN_BARE_ABILITIES = new Set([
  'torrent',
  'pistol',
  'blast',
  'heavy',
  'assault',
  'twin-linked',
  'lethal-hits',
  'devastating-wounds',
  'ignores-cover',
  'indirect-fire',
  'lance',
  'hazardous',
  'precision',
  'one-shot',
  'extra-attacks',
]);

/** Universal abilities carrying an X value ('Rapid Fire 1' -> value 1). */
const KNOWN_PARAM_ABILITIES = new Set(['rapid-fire', 'melta', 'sustained-hits']);

function parseWeaponAbilities(raw: string, ctx: string, warnings: string[]): WeaponAbilityRef[] {
  const refs: WeaponAbilityRef[] = [];
  if (raw === '' || raw === '-') return refs;
  for (const token of raw.split(',')) {
    const text = token.trim();
    if (text === '' || text === '-') continue;

    // 'Anti-Infantry 4+' -> { id: 'anti', keyword: 'Infantry', value: 4 }
    const anti = /^anti[-\s](.+?)\s+(\d+)\+$/i.exec(text);
    if (anti && anti[1] !== undefined && anti[2] !== undefined) {
      refs.push({ id: 'anti', keyword: anti[1], value: Number(anti[2]) });
      continue;
    }

    // Trailing integer (optionally 'N+') -> parameterized ref.
    const param = /^(.+?)\s+(\d+)\+?$/.exec(text);
    if (param && param[1] !== undefined && param[2] !== undefined) {
      const id = slugify(param[1]);
      refs.push({ id, value: Number(param[2]) });
      if (!KNOWN_PARAM_ABILITIES.has(id)) {
        warnings.push(`unknown weapon ability "${text}" on ${ctx} — emitted ref id "${id}"`);
      }
      continue;
    }

    const id = slugify(text);
    refs.push({ id });
    if (!KNOWN_BARE_ABILITIES.has(id)) {
      warnings.push(`unknown weapon ability "${text}" on ${ctx} — emitted ref id "${id}"`);
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Datasheet 'Abilities' profiles -> core ability refs (rest is milestone 4)
// ---------------------------------------------------------------------------

interface MappedAbilities {
  coreAbilities: DatasheetAbilityRef[];
  hasLeader: boolean;
  /** Ability names that are NOT core — preserved in wargearNotes. */
  todo: string[];
}

function mapAbilityProfiles(profiles: RosterProfile[]): MappedAbilities {
  const coreAbilities: DatasheetAbilityRef[] = [];
  const todo: string[] = [];
  let hasLeader = false;

  const plain: Record<string, string> = {
    'deep strike': 'core.deep-strike',
    infiltrators: 'core.infiltrators',
    stealth: 'core.stealth',
    'fights first': 'core.fights-first',
  };

  for (const profile of profiles) {
    const name = profile.name.trim();
    const norm = normalizeName(name);
    const plainId = plain[norm];
    if (plainId !== undefined) {
      coreAbilities.push({ id: plainId });
      continue;
    }
    if (norm === 'leader') {
      coreAbilities.push({ id: 'core.leader' });
      hasLeader = true;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^scouts? (\d+)$/.exec(norm)) && m[1] !== undefined) {
      coreAbilities.push({ id: 'core.scout', value: Number(m[1]) });
      continue;
    }
    if ((m = /^feel no pain (\d+)$/.exec(norm)) && m[1] !== undefined) {
      coreAbilities.push({ id: 'core.feel-no-pain', value: Number(m[1]) });
      continue;
    }
    if ((m = /^firing deck (\d+)$/.exec(norm)) && m[1] !== undefined) {
      coreAbilities.push({ id: 'core.firing-deck', value: Number(m[1]) });
      continue;
    }
    if ((m = /^deadly demise (.+)$/.exec(norm)) && m[1] !== undefined) {
      if (/^\d+$/.test(m[1])) {
        coreAbilities.push({ id: 'core.deadly-demise', value: Number(m[1]) });
      } else {
        // 'Deadly Demise D6': the ref's value slot is numeric-only, so keep
        // the ref and preserve the dice value for milestone 4.
        coreAbilities.push({ id: 'core.deadly-demise' });
        todo.push(`${name} (non-numeric value)`);
      }
      continue;
    }
    // Non-core prose ability (Photon Grenades, Voice of Command, ...):
    // effects are milestone 4 — record the name so it is not silently lost.
    todo.push(name);
  }
  return { coreAbilities, hasLeader, todo };
}

// ---------------------------------------------------------------------------
// Base-size heuristic
// ---------------------------------------------------------------------------

/**
 * Base size / model height heuristic from unit keywords, checked in order
 * (so a BATTLESUIT CHARACTER gets the battlesuit base):
 *   VEHICLE                -> 100 mm base, 3.5" tall
 *   MONSTER                ->  80 mm base, 3.5" tall
 *   BATTLESUIT             ->  50 mm base, 2.2" tall
 *   CHARACTER (non-vehicle)->  32 mm base, 1.4" tall
 *   otherwise (infantry)   ->  28 mm base, 1.2" tall
 * These are placeholder physical footprints for 3D/LoS until packs carry
 * curated values.
 */
function baseSizeFor(keywords: string[]): { baseSizeMm: number; heightInches: number } {
  const has = (kw: string): boolean => keywords.some((k) => k.toLowerCase() === kw);
  if (has('vehicle')) return { baseSizeMm: 100, heightInches: 3.5 };
  if (has('monster')) return { baseSizeMm: 80, heightInches: 3.5 };
  if (has('battlesuit')) return { baseSizeMm: 50, heightInches: 2.2 };
  if (has('character')) return { baseSizeMm: 32, heightInches: 1.4 };
  return { baseSizeMm: 28, heightInches: 1.2 };
}

// ---------------------------------------------------------------------------
// Datasheet construction
// ---------------------------------------------------------------------------

function buildWeapon(
  profile: RosterProfile,
  kind: 'ranged' | 'melee',
  unitName: string,
  warnings: string[],
): WeaponProfile {
  const ctx = `${unitName} / ${profile.name}`;
  const rangeRaw = charValue(profile, 'Range', ctx);
  const range = kind === 'melee' || /^melee$/i.test(rangeRaw) ? null : parseInches(rangeRaw, ctx);
  const skillRaw = charValue(profile, kind === 'melee' ? 'WS' : 'BS', ctx);
  // 'N/A' -> null: the weapon auto-hits (Torrent).
  const skill = /^n\/?a$/i.test(skillRaw) ? null : parsePlus(skillRaw, ctx);
  return {
    id: slugify(profile.name),
    name: profile.name,
    kind,
    range,
    attacks: charValue(profile, 'A', ctx),
    skill,
    strength: parseIntStrict(charValue(profile, 'S', ctx), ctx),
    ap: parseIntStrict(charValue(profile, 'AP', ctx), ctx),
    damage: charValue(profile, 'D', ctx),
    abilities: parseWeaponAbilities(charValue(profile, 'Keywords', ctx), ctx, warnings),
  };
}

function buildDatasheet(
  unit: RosterUnit,
  factionId: string,
  warnings: string[],
): Datasheet & PackHeader {
  const ctx = `${factionId}/${slugify(unit.name)}`;
  const unitProfile = unit.profiles.find((p) => p.typeName === 'Unit');
  if (!unitProfile) throw new Error(`${ctx}: no 'Unit' stat profile in the sample selection`);

  const { baseSizeMm, heightInches } = baseSizeFor(unit.keywords);
  const model: ModelProfile = {
    id: 'default',
    name: unitProfile.name,
    move: parseInches(charValue(unitProfile, 'M', ctx), ctx),
    toughness: parseIntStrict(charValue(unitProfile, 'T', ctx), ctx),
    save: parsePlus(charValue(unitProfile, 'SV', ctx), ctx),
    wounds: parseIntStrict(charValue(unitProfile, 'W', ctx), ctx),
    leadership: parsePlus(charValue(unitProfile, 'LD', ctx), ctx),
    objectiveControl: parseIntStrict(charValue(unitProfile, 'OC', ctx), ctx),
    baseSizeMm,
    heightInches,
  };

  const rangedWeapons: WeaponProfile[] = [];
  const meleeWeapons: WeaponProfile[] = [];
  for (const profile of unit.profiles) {
    if (profile.typeName !== 'Ranged Weapons' && profile.typeName !== 'Melee Weapons') continue;
    const kind = profile.typeName === 'Melee Weapons' ? 'melee' : 'ranged';
    const list = kind === 'melee' ? meleeWeapons : rangedWeapons;
    const weapon = buildWeapon(profile, kind, unit.name, warnings);
    if (!list.some((w) => w.id === weapon.id)) list.push(weapon);
  }

  const { coreAbilities, hasLeader, todo } = mapAbilityProfiles(
    unit.profiles.filter((p) => p.typeName === 'Abilities'),
  );

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    version: PACK_VERSION,
    id: `${factionId}/${slugify(unit.name)}`,
    name: unit.name,
    factionId,
    keywords: unit.keywords,
    factionKeywords: unit.factionKeywords,
    models: [model],
    unitComposition: { sizes: [{ models: unit.modelCount, points: unit.points }] },
    rangedWeapons,
    meleeWeapons,
    coreAbilities,
    abilities: [],
    ...(todo.length > 0 ? { wargearNotes: `TODO m4: ${todo.join(', ')}` } : {}),
    // Placeholder: which datasheets this CHARACTER can lead is milestone 4.
    ...(hasLeader ? { leader: { canLead: [] } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Generation entry points
// ---------------------------------------------------------------------------

function generateFromRoster(parsed: ParsedRoster, cfg: SampleConfig): GeneratedFactionPack {
  const warnings: string[] = [];
  const sheets = new Map<string, Datasheet & PackHeader>();

  for (const unit of parsed.units) {
    const key = normalizeName(unit.name);
    const built = buildDatasheet(unit, cfg.factionId, warnings);
    const existing = sheets.get(key);
    if (!existing) {
      sheets.set(key, built);
      continue;
    }
    // Same unit name again: merge distinct sizes and weapons into one sheet.
    for (const size of built.unitComposition.sizes) {
      if (
        !existing.unitComposition.sizes.some(
          (s) => s.models === size.models && s.points === size.points,
        )
      ) {
        existing.unitComposition.sizes.push(size);
      }
    }
    for (const weapon of built.rangedWeapons) {
      if (!existing.rangedWeapons.some((w) => w.id === weapon.id)) {
        existing.rangedWeapons.push(weapon);
      }
    }
    for (const weapon of built.meleeWeapons) {
      if (!existing.meleeWeapons.some((w) => w.id === weapon.id)) {
        existing.meleeWeapons.push(weapon);
      }
    }
  }

  const faction: FactionPack = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    version: PACK_VERSION,
    id: cfg.factionId,
    name: parsed.factionName,
    editionId: EDITION_ID,
    armyRule: {
      name: cfg.armyRuleName,
      paraphrase: cfg.armyRuleParaphrase,
      // Real army-rule effects are milestone 4.
      effects: [],
    },
  };

  return { faction, datasheets: [...sheets.values()], warnings: [...new Set(warnings)] };
}

/** Generate both faction packs from the sample rosters (no file writes). */
export function generateFactionPacks(samplesDir: string = DEFAULT_SAMPLES_DIR): GeneratedFactionPack[] {
  return SAMPLES.map((cfg) => {
    const raw = JSON.parse(readFileSync(join(samplesDir, cfg.file), 'utf8')) as unknown;
    return generateFromRoster(parseRoster(raw), cfg);
  });
}

export interface GeneratedFileIssues {
  file: string;
  issues: ValidationIssue[];
}

/** Validate every emitted object against its schema; returns failures. */
export function validateGeneratedPacks(packs: GeneratedFactionPack[]): GeneratedFileIssues[] {
  const failures: GeneratedFileIssues[] = [];
  for (const pack of packs) {
    const factionResult = validateContent('faction', pack.faction);
    if (!factionResult.valid) {
      failures.push({ file: `${pack.faction.id}/faction.json`, issues: factionResult.issues });
    }
    for (const sheet of pack.datasheets) {
      const result = validateContent('datasheet', sheet);
      if (!result.valid) {
        failures.push({
          file: `${pack.faction.id}/datasheets/${slugify(sheet.name)}.json`,
          issues: result.issues,
        });
      }
    }
  }
  return failures;
}

/** Write packs under content/factions/<edition>/<faction>/; returns paths. */
export function writeGeneratedPacks(
  packs: GeneratedFactionPack[],
  contentRoot: string = DEFAULT_CONTENT_ROOT,
): string[] {
  const written: string[] = [];
  for (const pack of packs) {
    const dir = join(contentRoot, 'factions', EDITION_ID, pack.faction.id);
    mkdirSync(join(dir, 'datasheets'), { recursive: true });
    const factionFile = join(dir, 'faction.json');
    writeFileSync(factionFile, `${JSON.stringify(pack.faction, null, 2)}\n`);
    written.push(factionFile);
    for (const sheet of pack.datasheets) {
      const file = join(dir, 'datasheets', `${slugify(sheet.name)}.json`);
      writeFileSync(file, `${JSON.stringify(sheet, null, 2)}\n`);
      written.push(file);
    }
  }
  return written;
}
