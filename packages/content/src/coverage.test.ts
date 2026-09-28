import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEditionContent, loadFactionPack } from './loader.js';
import { matchRoster, parseRoster } from './importer.js';

/**
 * Milestone-4 coverage gate: everything the two sample lists use must be
 * covered by the faction packs — datasheets, weapons, army rules, four
 * detachments each — and every deferred ability must be DOCUMENTED in the
 * datasheet's TODO notes, never silently missing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const samples = {
  'tau-empire': JSON.parse(
    readFileSync(join(repoRoot, 'samples', 'tau-empire-1000.json'), 'utf8'),
  ),
  'astra-militarum': JSON.parse(
    readFileSync(join(repoRoot, 'samples', 'astra-militarum-1000.json'), 'utf8'),
  ),
};

const edition = loadEditionContent('wh40k-10e');
const packs = {
  'tau-empire': loadFactionPack('wh40k-10e', 'tau-empire'),
  'astra-militarum': loadFactionPack('wh40k-10e', 'astra-militarum'),
};

// Core-rules ability names as they appear in roster Abilities profiles.
const CORE_ABILITY_NAMES = new Set([
  'leader',
  'deep strike',
  'deadly demise',
  'deadly demise d6',
  'deadly demise 1',
  'scout',
  'scouts',
  'infiltrators',
  'stealth',
  'feel no pain',
  'fights first',
  'firing deck',
  'invulnerable save',
]);

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*d?\d+["+]?\s*$/, '') // trailing X values: "Scout 7\"", "Deadly Demise D6"
    .replace(/[^a-z ]/g, '')
    .trim();
}

describe.each(['tau-empire', 'astra-militarum'] as const)('%s coverage', (factionId) => {
  const pack = packs[factionId];
  const parsed = parseRoster(samples[factionId]);
  const result = matchRoster(parsed, pack.datasheets);

  it('matches every unit and weapon in the sample roster', () => {
    expect(result.issues).toEqual([]);
    for (const unit of result.units) {
      expect(unit.matched, unit.name).toBe(true);
      expect(unit.unmatchedWeapons, unit.name).toEqual([]);
    }
    expect(result.pointsDeclared).toBe(result.pointsFromRoster);
  });

  it('has a real army rule (effects or activated mechanics)', () => {
    const { pack: faction } = pack;
    const hasEffects = faction.armyRule.effects.length > 0;
    const hasMechanics = (faction.mechanics ?? []).length > 0;
    expect(hasEffects || hasMechanics).toBe(true);
  });

  it('ships four detachments, each with a rule, enhancements and stratagems', () => {
    expect(pack.detachments).toHaveLength(4);
    for (const det of pack.detachments) {
      expect(det.rule.effects.length, det.id).toBeGreaterThanOrEqual(1);
      expect(det.enhancements.length, det.id).toBeGreaterThanOrEqual(2);
      expect(det.stratagems.length, det.id).toBeGreaterThanOrEqual(4);
      // Every enhancement/stratagem carries at least one effect definition.
      for (const e of det.enhancements) expect(e.effects.length, e.id).toBeGreaterThan(0);
      for (const s of det.stratagems) expect(s.effects.length, s.id).toBeGreaterThan(0);
    }
  });

  it('covers or documents every datasheet ability used by the sample list', () => {
    for (const unit of parsed.units) {
      const imported = result.units.find((u) => u.name === unit.name)!;
      const sheet = pack.datasheets.find((d) => d.id === imported.datasheetId)!;
      const abilityNames = unit.profiles
        .filter((p) => p.typeName === 'Abilities')
        .map((p) => p.name);
      for (const name of abilityNames) {
        const norm = normalize(name);
        const isArmyRule =
          normalize(pack.pack.armyRule.name) === norm ||
          (pack.pack.mechanics ?? []).some((m) => normalize(m.name).includes(norm));
        const inCore =
          isArmyRule ||
          CORE_ABILITY_NAMES.has(norm) ||
          sheet.coreAbilities.some((c) => normalize(c.id.replace('core.', '')) === norm);
        const authored = sheet.abilities.some(
          (a) => normalize(a.name ?? a.id) === norm || (a.name ?? '').toLowerCase().includes(norm),
        );
        const documented = (sheet.wargearNotes ?? '')
          .toLowerCase()
          .includes(norm.split(' ')[0] ?? norm);
        expect(
          inCore || authored || documented,
          `${sheet.id}: ability "${name}" is neither implemented nor documented as TODO`,
        ).toBe(true);
      }
    }
  });

  it('declares unique effect ids across the whole pack', () => {
    expect(new Set(pack.effectIds).size).toBe(pack.effectIds.length);
  });

  it('marks unimplemented effects with todo.* script ids only', () => {
    // Any scripted effect must either be a documented todo or one of the
    // implemented registry scripts.
    const implemented = new Set([
      'core.command-reroll',
      'core.fire-overwatch',
      'core.tank-shock',
      'core.counter-offensive',
    ]);
    const allEffects = [
      ...pack.pack.armyRule.effects,
      ...(pack.pack.mechanics ?? []).flatMap((m) => m.effects),
      ...pack.detachments.flatMap((d) => [
        ...d.rule.effects,
        ...d.enhancements.flatMap((e) => e.effects),
        ...d.stratagems.flatMap((s) => s.effects),
      ]),
      ...pack.datasheets.flatMap((d) => d.abilities),
    ];
    for (const effect of allEffects) {
      for (const prim of effect.effects) {
        if (prim.type === 'script') {
          const id = (prim as { scriptId: string }).scriptId;
          expect(
            id.startsWith('todo.') || implemented.has(id),
            `${effect.id} references unknown script ${id}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('engine neutrality', () => {
  it('core packages never name a faction', () => {
    // The engine interprets packs; faction knowledge lives in content only.
    // (Guarded here so a lazy special-case cannot slip in unnoticed.)
    const coreDir = join(repoRoot, 'packages', 'core', 'src');
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes('test-helpers')) {
          files.push(p);
        }
      }
    };
    walk(coreDir);
    for (const file of files) {
      const src = readFileSync(file, 'utf8').toLowerCase();
      for (const banned of ["t'au", 'tau-empire', 'astra militarum', 'astra-militarum', 'kroot', 'militarum']) {
        expect(src.includes(banned), `${file} mentions "${banned}"`).toBe(false);
      }
    }
  });
});
