import type { BattlescribeRoster, BattlescribeSelection, BattlescribeProfile } from './schema';
import type { GameState, Model, Unit, Weapon, ModelStats } from '../types/index';
import { baseSizeToInches } from '../types/index';
import { gameReducer } from '../state/reducer';

/**
 * Import a Battlescribe JSON roster into the game state for a given player.
 * Parses forces → selections, extracts unit profiles, weapons, and keywords,
 * then creates Unit and Model entries in the GameState.
 */
export interface DeploymentBounds {
  x: number;      // left edge (inches)
  y: number;      // top edge (inches)
  width: number;  // width (inches)
  height: number; // height (inches)
}

export function importArmyList(
  state: GameState,
  roster: BattlescribeRoster,
  playerId: string,
  startPosition: { x: number; y: number } = { x: 5, y: 5 },
  bounds?: DeploymentBounds,
): GameState {
  let current = state;
  const modelSpacing = 1.5;  // inches between models within a unit
  const unitGapX = 2;        // horizontal gap between units
  const unitGapY = 2;        // vertical gap between unit rows

  const startX = bounds?.x ?? startPosition.x;
  const startY = bounds?.y ?? startPosition.y;
  const zoneWidth = bounds?.width ?? 50;
  const zoneHeight = bounds?.height ?? 40;

  // First pass: compute each unit's block size, then lay them out in a flow layout
  interface UnitBlock {
    parsed: ParsedSelection;
    width: number;
    height: number;
  }

  const blocks: UnitBlock[] = [];

  for (const force of roster.roster.forces ?? []) {
    for (const selection of force.selections ?? []) {
      if (selection.type !== 'model' && selection.type !== 'unit') continue;
      const parsed = parseSelection(selection);
      if (!parsed) continue;

      const totalModels = parsed.modelGroups.reduce((sum, g) => sum + g.count, 0);
      if (totalModels === 0) continue;

      // Each unit block: lay models in rows that fit within a reasonable width
      // Use up to 5 models per row, or fewer if the unit is small
      const modelsPerRow = Math.min(5, totalModels);
      const rows = Math.ceil(totalModels / modelsPerRow);
      const blockWidth = modelsPerRow * modelSpacing;
      const blockHeight = rows * modelSpacing;

      blocks.push({ parsed, width: blockWidth, height: blockHeight });
    }
  }

  // Flow layout: place blocks left-to-right, wrapping to next row when width exceeded
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxHeight = 0;

  for (const block of blocks) {
    // Wrap to next row if this block would exceed zone width
    if (cursorX > 0 && cursorX + block.width > zoneWidth) {
      cursorX = 0;
      cursorY += rowMaxHeight + unitGapY;
      rowMaxHeight = 0;
    }

    const unitId = crypto.randomUUID();
    const models: Model[] = [];
    const modelsPerRow = Math.max(1, Math.round(block.width / modelSpacing));
    let col = 0;
    let localRow = 0;

    for (const modelGroup of block.parsed.modelGroups) {
      for (let i = 0; i < modelGroup.count; i++) {
        const modelId = crypto.randomUUID();
        const position = {
          x: startX + cursorX + col * modelSpacing,
          y: startY + cursorY + localRow * modelSpacing,
        };

        models.push({
          id: modelId,
          unitId,
          name: modelGroup.name,
          position,
          baseSizeMm: modelGroup.baseSizeMm,
          baseSizeInches: baseSizeToInches(modelGroup.baseSizeMm),
          facing: 0,
          wounds: modelGroup.stats.wounds,
          maxWounds: modelGroup.stats.wounds,
          moveCharacteristic: modelGroup.stats.move,
          stats: modelGroup.stats,
          status: 'active',
        });

        col++;
        if (col >= modelsPerRow) {
          col = 0;
          localRow++;
        }
      }
    }

    if (models.length === 0) continue;

    rowMaxHeight = Math.max(rowMaxHeight, block.height);
    cursorX += block.width + unitGapX;

    const unit: Unit = {
      id: unitId,
      name: block.parsed.unitName,
      playerId,
      modelIds: models.map((m) => m.id),
      keywords: block.parsed.keywords,
      abilities: block.parsed.abilities,
      weapons: block.parsed.weapons,
      points: block.parsed.points,
    };

    current = gameReducer(current, { type: 'ADD_UNIT', payload: { unit, models } });
  }

  return current;
}

interface ModelGroup {
  name: string;
  count: number;
  stats: ModelStats;
  baseSizeMm: number;
}

interface ParsedSelection {
  unitName: string;
  modelGroups: ModelGroup[];
  weapons: Weapon[];
  keywords: string[];
  abilities: string[];
  points: number;
}

function parseSelection(selection: BattlescribeSelection): ParsedSelection | null {
  const keywords = extractKeywords(selection.categories ?? []);
  const weapons = extractWeapons(selection);
  const abilities = extractAbilities(selection.profiles ?? [], selection.rules ?? []);
  const points = extractPoints(selection.costs ?? []);

  const modelGroups: ModelGroup[] = [];

  if (selection.type === 'model') {
    // Single-model selection: stats are on the selection itself
    const stats = extractUnitStats(selection.profiles ?? []);
    if (!stats) return null;
    modelGroups.push({
      name: stats.profileName,
      count: selection.number ?? 1,
      stats: stats.stats,
      baseSizeMm: inferBaseSize(keywords),
    });
  } else if (selection.type === 'unit') {
    // Multi-model unit: look for model sub-selections and also the parent profile
    // First, get the unit stats profile from the parent selection
    const parentStats = extractUnitStats(selection.profiles ?? []);

    // Walk sub-selections for type: "model" entries
    const modelSubs = findModelSelections(selection.selections ?? []);

    if (modelSubs.length > 0) {
      for (const sub of modelSubs) {
        // Try to get stats from the sub-selection's own profiles first
        const subStats = extractUnitStats(sub.profiles ?? []);
        const stats = subStats ?? parentStats;
        if (!stats) continue;

        modelGroups.push({
          name: sub.name,
          count: sub.number ?? 1,
          stats: stats.stats,
          baseSizeMm: inferBaseSize(keywords),
        });
      }
    } else if (parentStats) {
      // No model sub-selections found — use the parent directly
      modelGroups.push({
        name: parentStats.profileName,
        count: selection.number ?? 1,
        stats: parentStats.stats,
        baseSizeMm: inferBaseSize(keywords),
      });
    }
  }

  if (modelGroups.length === 0) return null;

  return {
    unitName: selection.name,
    modelGroups,
    weapons,
    keywords,
    abilities,
    points,
  };
}

/** Recursively find all type: "model" selections within nested selections */
function findModelSelections(selections: BattlescribeSelection[]): BattlescribeSelection[] {
  const results: BattlescribeSelection[] = [];
  for (const sel of selections) {
    if (sel.type === 'model') {
      results.push(sel);
    }
    // Also check nested upgrade selections that may contain models
    if (sel.selections) {
      results.push(...findModelSelections(sel.selections));
    }
  }
  return results;
}

function extractUnitStats(profiles: BattlescribeProfile[]): { stats: ModelStats; profileName: string } | null {
  const unitProfile = profiles.find((p) => p.typeName === 'Unit');
  if (!unitProfile) return null;

  const chars = unitProfile.characteristics;
  const get = (name: string): string => chars.find((c) => c.name === name)?.$text ?? '0';

  return {
    profileName: unitProfile.name,
    stats: {
      move: parseStatValue(get('M')),
      toughness: parseStatValue(get('T')),
      save: parseStatValue(get('SV')),
      wounds: parseStatValue(get('W')),
      leadership: parseStatValue(get('LD')),
      objectiveControl: parseStatValue(get('OC')),
    },
  };
}

/**
 * Extract weapons from a selection and all its nested sub-selections.
 */
function extractWeapons(selection: BattlescribeSelection): Weapon[] {
  const weapons: Weapon[] = [];
  const seen = new Set<string>();

  function walk(sel: BattlescribeSelection) {
    for (const profile of sel.profiles ?? []) {
      if (profile.typeName === 'Ranged Weapons' || profile.typeName === 'Melee Weapons') {
        if (seen.has(profile.name)) continue;
        seen.add(profile.name);
        const w = parseWeaponProfile(profile);
        if (w) weapons.push(w);
      }
    }
    for (const sub of sel.selections ?? []) {
      walk(sub);
    }
  }

  walk(selection);
  return weapons;
}

function parseWeaponProfile(profile: BattlescribeProfile): Weapon | null {
  const chars = profile.characteristics;
  const get = (name: string): string => chars.find((c) => c.name === name)?.$text ?? '';

  const rangeStr = get('Range');
  const isRanged = rangeStr !== '' && rangeStr !== 'Melee' && rangeStr !== '-';
  const skillStr = isRanged ? get('BS') : get('WS');
  const keywordsStr = get('Keywords');

  return {
    id: crypto.randomUUID(),
    name: profile.name,
    type: isRanged ? 'ranged' : 'melee',
    range: isRanged ? parseStatValue(rangeStr) : undefined,
    attacks: parseStatOrString(get('A')),
    skill: parseStatValue(skillStr),
    strength: parseStatValue(get('S')),
    ap: parseAP(get('AP')),
    damage: parseStatOrString(get('D')),
    abilities: keywordsStr && keywordsStr !== '-' ? keywordsStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}

function extractKeywords(categories: BattlescribeSelection['categories']): string[] {
  if (!categories) return [];
  return categories
    .filter((c) => !c.primary && !c.name.startsWith('Faction:'))
    .map((c) => c.name)
    .filter(Boolean);
}

function extractAbilities(profiles: BattlescribeProfile[], rules: BattlescribeSelection['rules']): string[] {
  const abilities: string[] = [];

  for (const profile of profiles) {
    if (profile.typeName === 'Abilities') {
      abilities.push(profile.name);
    }
  }

  for (const rule of rules ?? []) {
    abilities.push(rule.name);
  }

  return abilities;
}

function extractPoints(costs: BattlescribeSelection['costs']): number {
  if (!costs) return 0;
  const pts = costs.find((c) => c.name === 'pts');
  return pts?.value ?? 0;
}

/** Parse a stat value like "6\"", "3+", "5+", "12", "D6" → number */
function parseStatValue(str: string): number {
  const cleaned = str.replace(/["+\s]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/** Parse a stat that might be a number or a dice expression like "D6", "D3+1" */
function parseStatOrString(str: string): number | string {
  const cleaned = str.replace(/"/g, '').trim();
  const num = parseInt(cleaned, 10);
  if (!isNaN(num) && String(num) === cleaned) return num;
  return cleaned || 0;
}

/** Parse AP value — handle "-1", "0", etc. */
function parseAP(str: string): number {
  const cleaned = str.replace(/["+\s]/g, '');
  if (cleaned === '-' || cleaned === '') return 0;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/** Infer base size from keywords. Defaults to 32mm for infantry, larger for vehicles/monsters. */
function inferBaseSize(keywords: string[]): number {
  const kwSet = new Set(keywords.map((k) => k.toLowerCase()));
  if (kwSet.has('vehicle') || kwSet.has('monster')) return 60;
  if (kwSet.has('cavalry') || kwSet.has('mounted')) return 60;
  if (kwSet.has('walker') || kwSet.has('dreadnought')) return 60;
  if (kwSet.has('beast') || kwSet.has('swarm')) return 40;
  if (kwSet.has('character') || kwSet.has('officer')) return 28;
  return 32; // default infantry
}
