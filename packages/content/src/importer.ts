/**
 * Roster importer: walks a BattleScribe / New Recruit roster export into a
 * neutral ParsedRoster shape, then matches units and weapons against loaded
 * datasheets by normalized name. Matching never throws on unknown content —
 * every miss is reported in ImportResult.issues so a roster with homebrew or
 * not-yet-packaged units still imports partially.
 */
import type { Datasheet } from '@openhammer/core';

// ---------------------------------------------------------------------------
// Parsed roster types
// ---------------------------------------------------------------------------

export interface RosterCharacteristic {
  name: string;
  /** The `$text` value from the export, kept verbatim (e.g. '6"', '3+'). */
  value: string;
}

export interface RosterProfile {
  name: string;
  /** 'Unit' | 'Ranged Weapons' | 'Melee Weapons' | 'Abilities' | ... */
  typeName: string;
  characteristics: RosterCharacteristic[];
}

export interface RosterWeapon {
  /** Weapon profile name (a single upgrade can carry several profiles). */
  name: string;
  count: number;
  kind: 'ranged' | 'melee';
}

export interface RosterUnit {
  name: string;
  points: number;
  modelCount: number;
  /** Non-faction categories (Infantry, Battleline, ...). */
  keywords: string[];
  /** 'Faction: X' categories with the prefix stripped. */
  factionKeywords: string[];
  weapons: RosterWeapon[];
  /** Enhancement selection names (prefix like 'Enhancement: ' stripped). */
  enhancements: string[];
  /** All stat profiles found in the unit subtree (fallback for unmatched units). */
  profiles: RosterProfile[];
}

export interface ParsedRoster {
  name: string;
  /** catalogueName of the first force. */
  factionName: string;
  /** roster.costs pts entry. */
  pointsDeclared: number;
  units: RosterUnit[];
}

// ---------------------------------------------------------------------------
// Match result types
// ---------------------------------------------------------------------------

export interface ImportedUnit {
  name: string;
  datasheetId: string | null;
  matched: boolean;
  points: number;
  modelCount: number;
  /** Datasheet weapon-profile ids matched from the roster's weapon selections. */
  weaponIds: string[];
  unmatchedWeapons: string[];
  enhancementName?: string;
}

export interface ImportResult {
  units: ImportedUnit[];
  pointsDeclared: number;
  /** Sum of the top-level unit entry costs. */
  pointsFromRoster: number;
  /** Human-readable warnings: unmatched units/weapons, points mismatch. */
  issues: string[];
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a name for matching: case-insensitive, diacritics and
 * apostrophes stripped, punctuation collapsed to single spaces.
 * "T'au Empire" and "Tau  empire" normalize identically.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['‘’`´]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// parseRoster
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Extract the 'pts' entry from a BattleScribe costs array. */
function costPts(costs: unknown): number {
  for (const raw of asArray(costs)) {
    const cost = asRecord(raw);
    if (cost && cost.name === 'pts' && typeof cost.value === 'number') {
      return Math.round(cost.value);
    }
  }
  return 0;
}

function parseProfiles(raw: unknown): RosterProfile[] {
  const out: RosterProfile[] = [];
  for (const pRaw of asArray(raw)) {
    const profile = asRecord(pRaw);
    if (!profile || typeof profile.name !== 'string' || typeof profile.typeName !== 'string') {
      continue;
    }
    const characteristics: RosterCharacteristic[] = [];
    for (const cRaw of asArray(profile.characteristics)) {
      const ch = asRecord(cRaw);
      if (!ch || typeof ch.name !== 'string') continue;
      const text = ch['$text'];
      characteristics.push({ name: ch.name, value: typeof text === 'string' ? text : '' });
    }
    out.push({ name: profile.name, typeName: profile.typeName, characteristics });
  }
  return out;
}

/**
 * Heuristic: an 'upgrade' selection with no weapon profiles is an
 * enhancement when it costs points, is categorized 'Enhancement', or is
 * named like one. Free non-weapon wargear falls through and is ignored
 * (its profiles are still kept in RosterUnit.profiles).
 */
function isEnhancementSelection(node: Record<string, unknown>): boolean {
  if (costPts(node.costs) > 0) return true;
  if (typeof node.name === 'string' && /^enhancements?\b/i.test(node.name)) return true;
  for (const cRaw of asArray(node.categories)) {
    const cat = asRecord(cRaw);
    if (cat && typeof cat.name === 'string' && /^enhancements?$/i.test(cat.name)) return true;
  }
  return false;
}

function parseUnit(sel: Record<string, unknown>): RosterUnit {
  const name = typeof sel.name === 'string' ? sel.name : 'Unknown unit';
  const keywords: string[] = [];
  const factionKeywords: string[] = [];
  for (const cRaw of asArray(sel.categories)) {
    const cat = asRecord(cRaw);
    if (!cat || typeof cat.name !== 'string') continue;
    if (cat.name.startsWith('Faction: ')) {
      factionKeywords.push(cat.name.slice('Faction: '.length));
    } else {
      keywords.push(cat.name);
    }
  }

  const weapons = new Map<string, RosterWeapon>();
  const enhancements: string[] = [];
  const profiles = new Map<string, RosterProfile>();
  let nestedModelCount = 0;

  const visit = (node: Record<string, unknown>, isRoot: boolean): void => {
    const nodeProfiles = parseProfiles(node.profiles);
    for (const profile of nodeProfiles) {
      const key = `${profile.typeName}::${normalizeName(profile.name)}`;
      if (!profiles.has(key)) profiles.set(key, profile);
    }
    if (!isRoot) {
      const count = typeof node.number === 'number' ? node.number : 1;
      if (node.type === 'model') nestedModelCount += count;
      if (node.type === 'upgrade') {
        const weaponProfiles = nodeProfiles.filter(
          (p) => p.typeName === 'Ranged Weapons' || p.typeName === 'Melee Weapons',
        );
        if (weaponProfiles.length > 0) {
          for (const wp of weaponProfiles) {
            const kind: RosterWeapon['kind'] =
              wp.typeName === 'Melee Weapons' ? 'melee' : 'ranged';
            const key = `${kind}::${normalizeName(wp.name)}`;
            const existing = weapons.get(key);
            if (existing) existing.count += count;
            else weapons.set(key, { name: wp.name, count, kind });
          }
        } else if (isEnhancementSelection(node)) {
          const rawName = typeof node.name === 'string' ? node.name : 'Unknown enhancement';
          enhancements.push(rawName.replace(/^enhancements?:\s*/i, ''));
        }
      }
    }
    for (const subRaw of asArray(node.selections)) {
      const sub = asRecord(subRaw);
      if (sub) visit(sub, false);
    }
  };
  visit(sel, true);

  const ownCount = typeof sel.number === 'number' ? sel.number : 1;
  const modelCount =
    sel.type === 'model'
      ? Math.max(1, ownCount)
      : nestedModelCount > 0
        ? nestedModelCount
        : Math.max(1, ownCount);

  return {
    name,
    points: costPts(sel.costs),
    modelCount,
    keywords,
    factionKeywords,
    weapons: [...weapons.values()],
    enhancements,
    profiles: [...profiles.values()],
  };
}

/**
 * Parse a New Recruit / BattleScribe JSON roster export into the neutral
 * ParsedRoster shape. Top-level 'unit' and 'model' selections become units;
 * everything else at the top level (e.g. detachment configuration) is
 * ignored.
 */
export function parseRoster(json: unknown): ParsedRoster {
  const root = asRecord(json);
  const roster = asRecord(root?.roster);
  if (!roster) {
    throw new Error('not a roster export: expected a top-level "roster" object');
  }
  const units: RosterUnit[] = [];
  let factionName = '';
  for (const forceRaw of asArray(roster.forces)) {
    const force = asRecord(forceRaw);
    if (!force) continue;
    if (!factionName && typeof force.catalogueName === 'string') {
      factionName = force.catalogueName;
    }
    for (const selRaw of asArray(force.selections)) {
      const sel = asRecord(selRaw);
      if (!sel) continue;
      if (sel.type !== 'unit' && sel.type !== 'model') continue;
      units.push(parseUnit(sel));
    }
  }
  return {
    name: typeof roster.name === 'string' ? roster.name : 'Unnamed roster',
    factionName,
    pointsDeclared: costPts(roster.costs),
    units,
  };
}

// ---------------------------------------------------------------------------
// matchRoster
// ---------------------------------------------------------------------------

/**
 * Match every parsed unit to a datasheet by normalized name (including
 * datasheet aliases) and each weapon selection to a weapon profile on the
 * matched datasheet. Misses are warnings in `issues`, never errors.
 */
export function matchRoster(parsed: ParsedRoster, datasheets: Datasheet[]): ImportResult {
  const sheetsByName = new Map<string, Datasheet>();
  for (const sheet of datasheets) {
    sheetsByName.set(normalizeName(sheet.name), sheet);
    for (const alias of sheet.aliases ?? []) {
      sheetsByName.set(normalizeName(alias), sheet);
    }
  }

  const issues: string[] = [];
  const units: ImportedUnit[] = [];
  let pointsFromRoster = 0;

  for (const unit of parsed.units) {
    pointsFromRoster += unit.points;
    const base = {
      name: unit.name,
      points: unit.points,
      modelCount: unit.modelCount,
      ...(unit.enhancements[0] !== undefined ? { enhancementName: unit.enhancements[0] } : {}),
    };

    const sheet = sheetsByName.get(normalizeName(unit.name));
    if (!sheet) {
      issues.push(`unit "${unit.name}" (${unit.points} pts) did not match any datasheet`);
      units.push({
        ...base,
        datasheetId: null,
        matched: false,
        weaponIds: [],
        unmatchedWeapons: unit.weapons.map((w) => w.name),
      });
      continue;
    }

    const weaponIdsByName = new Map<string, string>();
    for (const weapon of [...sheet.rangedWeapons, ...sheet.meleeWeapons]) {
      weaponIdsByName.set(normalizeName(weapon.name), weapon.id);
    }
    const weaponIds: string[] = [];
    const unmatchedWeapons: string[] = [];
    for (const weapon of unit.weapons) {
      const id = weaponIdsByName.get(normalizeName(weapon.name));
      if (id !== undefined) {
        if (!weaponIds.includes(id)) weaponIds.push(id);
      } else {
        unmatchedWeapons.push(weapon.name);
        issues.push(`unit "${unit.name}": weapon "${weapon.name}" not found on datasheet "${sheet.id}"`);
      }
    }
    units.push({ ...base, datasheetId: sheet.id, matched: true, weaponIds, unmatchedWeapons });
  }

  if (pointsFromRoster !== parsed.pointsDeclared) {
    issues.push(
      `points mismatch: roster declares ${parsed.pointsDeclared} pts but unit entries sum to ${pointsFromRoster} pts`,
    );
  }

  return { units, pointsDeclared: parsed.pointsDeclared, pointsFromRoster, issues };
}
