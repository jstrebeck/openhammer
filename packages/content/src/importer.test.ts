import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Datasheet } from '@openhammer/core';
import { matchRoster, normalizeName, parseRoster } from './importer.js';
import {
  DEFAULT_SAMPLES_DIR,
  generateFactionPacks,
  validateGeneratedPacks,
  writeGeneratedPacks,
} from './generate-packs.js';
import { DEFAULT_CONTENT_ROOT, loadFactionPack } from './loader.js';

const packs = generateFactionPacks();
const tau = packs.find((p) => p.faction.id === 'tau-empire')!;
const am = packs.find((p) => p.faction.id === 'astra-militarum')!;

const loadSample = (file: string): unknown =>
  JSON.parse(readFileSync(join(DEFAULT_SAMPLES_DIR, file), 'utf8'));
const tauJson = loadSample('tau-empire-1000.json');
const amJson = loadSample('astra-militarum-1000.json');

const findSheet = (sheets: Datasheet[], id: string): Datasheet => {
  const sheet = sheets.find((s) => s.id === id);
  expect(sheet, `datasheet ${id} should exist`).toBeDefined();
  return sheet!;
};

describe('generateFactionPacks', () => {
  it('generates both factions with validating content and no warnings', () => {
    expect(packs.map((p) => p.faction.id)).toEqual(['tau-empire', 'astra-militarum']);
    expect(tau.faction.name).toBe("T'au Empire");
    expect(tau.faction.armyRule.name).toBe('For the Greater Good');
    expect(am.faction.name).toBe('Astra Militarum');
    expect(am.faction.armyRule.name).toBe('Voice of Command');
    expect(validateGeneratedPacks(packs)).toEqual([]);
    // Every weapon ability in the samples is a known universal one.
    expect(tau.warnings).toEqual([]);
    expect(am.warnings).toEqual([]);
  });

  it('dedupes repeated units and emits one datasheet per distinct name', () => {
    expect(tau.datasheets.map((d) => d.id).sort()).toEqual([
      'tau-empire/broadside-battlesuit',
      'tau-empire/cadre-fireblade',
      'tau-empire/commander-in-crisis-battlesuit',
      'tau-empire/crisis-battlesuits',
      'tau-empire/kroot-carnivores',
      'tau-empire/pathfinder-team',
      'tau-empire/strike-team',
    ]);
    expect(am.datasheets.map((d) => d.id).sort()).toEqual([
      'astra-militarum/armoured-sentinel',
      'astra-militarum/basilisk',
      'astra-militarum/cadian-castellan',
      'astra-militarum/cadian-shock-troops',
      'astra-militarum/heavy-weapons-squad',
      'astra-militarum/leman-russ-battle-tank',
    ]);
    // Two identical Strike Teams collapse into one size entry.
    const strike = findSheet(tau.datasheets, 'tau-empire/strike-team');
    expect(strike.unitComposition.sizes).toEqual([{ models: 10, points: 120 }]);
  });

  it('parses unit stats, keywords and the base-size heuristic', () => {
    const strike = findSheet(tau.datasheets, 'tau-empire/strike-team');
    expect(strike.models[0]).toMatchObject({
      id: 'default',
      name: 'Fire Warrior',
      move: 6,
      toughness: 3,
      save: 4,
      wounds: 1,
      leadership: 7,
      objectiveControl: 2,
      baseSizeMm: 28, // infantry
      heightInches: 1.2,
    });
    expect(strike.keywords).toContain('Battleline');
    expect(strike.factionKeywords).toEqual(["T'au Empire"]);

    // Battlesuit beats Character in the heuristic order.
    const commander = findSheet(tau.datasheets, 'tau-empire/commander-in-crisis-battlesuit');
    expect(commander.models[0]).toMatchObject({ baseSizeMm: 50, heightInches: 2.2 });
    const fireblade = findSheet(tau.datasheets, 'tau-empire/cadre-fireblade');
    expect(fireblade.models[0]).toMatchObject({ baseSizeMm: 32, heightInches: 1.4 });
    const russ = findSheet(am.datasheets, 'astra-militarum/leman-russ-battle-tank');
    expect(russ.models[0]).toMatchObject({ baseSizeMm: 100, heightInches: 3.5 });
  });

  it('parses weapons with verbatim dice expressions and ability refs', () => {
    const strike = findSheet(tau.datasheets, 'tau-empire/strike-team');
    const pulseRifle = strike.rangedWeapons.find((w) => w.id === 'pulse-rifle')!;
    expect(pulseRifle).toMatchObject({
      kind: 'ranged',
      range: 30,
      attacks: '1',
      skill: 4,
      strength: 5,
      ap: 0,
      damage: '1',
      abilities: [{ id: 'rapid-fire', value: 1 }],
    });
    const ccw = strike.meleeWeapons.find((w) => w.id === 'close-combat-weapon')!;
    expect(ccw).toMatchObject({ kind: 'melee', range: null, skill: 5, abilities: [] });

    // One upgrade selection carrying both a ranged and a melee profile.
    const kroot = findSheet(tau.datasheets, 'tau-empire/kroot-carnivores');
    expect(kroot.rangedWeapons.map((w) => w.id)).toEqual(['kroot-rifle']);
    expect(kroot.meleeWeapons.map((w) => w.id)).toEqual(['kroot-blades']);

    const basilisk = findSheet(am.datasheets, 'astra-militarum/basilisk');
    const earthshaker = basilisk.rangedWeapons.find((w) => w.id === 'earthshaker-cannon')!;
    expect(earthshaker.range).toBe(240);
    expect(earthshaker.attacks).toBe('D6');
    expect(earthshaker.abilities.map((a) => a.id).sort()).toEqual([
      'blast',
      'heavy',
      'indirect-fire',
    ]);
  });

  it('maps core abilities, Leader placeholder and TODO notes', () => {
    const commander = findSheet(tau.datasheets, 'tau-empire/commander-in-crisis-battlesuit');
    expect(commander.coreAbilities).toEqual([{ id: 'core.deep-strike' }, { id: 'core.leader' }]);
    expect(commander.leader).toEqual({ canLead: [] });

    const kroot = findSheet(tau.datasheets, 'tau-empire/kroot-carnivores');
    expect(kroot.coreAbilities).toEqual([{ id: 'core.scout', value: 7 }]);

    const pathfinders = findSheet(tau.datasheets, 'tau-empire/pathfinder-team');
    expect(pathfinders.coreAbilities).toEqual([{ id: 'core.infiltrators' }]);

    // Non-core prose abilities land in wargearNotes, not silently dropped.
    const strike = findSheet(tau.datasheets, 'tau-empire/strike-team');
    expect(strike.wargearNotes).toBe('TODO m4: Photon Grenades');
    expect(strike.abilities).toEqual([]);
    expect(strike.leader).toBeUndefined();

    const sentinel = findSheet(am.datasheets, 'astra-militarum/armoured-sentinel');
    expect(sentinel.coreAbilities).toEqual([{ id: 'core.deadly-demise', value: 1 }]);
    const basilisk = findSheet(am.datasheets, 'astra-militarum/basilisk');
    expect(basilisk.coreAbilities).toEqual([{ id: 'core.deadly-demise' }]);
    expect(basilisk.wargearNotes).toContain('Deadly Demise D6');

    const castellan = findSheet(am.datasheets, 'astra-militarum/cadian-castellan');
    expect(castellan.coreAbilities).toEqual([{ id: 'core.leader' }]);
    expect(castellan.leader).toEqual({ canLead: [] });
    expect(castellan.wargearNotes).toBe('TODO m4: Voice of Command');
  });

  it('emits only weapon-ability ids that exist in the edition vocabulary', () => {
    const editionFile = JSON.parse(
      readFileSync(join(DEFAULT_CONTENT_ROOT, 'editions', 'wh40k-10e', 'weapon-abilities.json'), 'utf8'),
    ) as { abilities: { id: string }[] };
    const universalIds = new Set(editionFile.abilities.map((a) => a.id));
    // Abilities that legitimately are not universal go here instead of failing.
    const allowedNonUniversal: string[] = [];

    const offenders: string[] = [];
    for (const pack of packs) {
      for (const sheet of pack.datasheets) {
        for (const weapon of [...sheet.rangedWeapons, ...sheet.meleeWeapons]) {
          for (const ref of weapon.abilities) {
            if (universalIds.has(ref.id)) continue;
            if (allowedNonUniversal.includes(ref.id)) {
              console.log(`allow-listed non-universal ability "${ref.id}" (${sheet.id} / ${weapon.id})`);
              continue;
            }
            offenders.push(`${sheet.id} / ${weapon.id} -> ${ref.id}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('parseRoster + matchRoster round trip', () => {
  it('imports the tau sample with every unit and weapon matched', () => {
    const parsed = parseRoster(tauJson);
    expect(parsed.factionName).toBe("T'au Empire");
    expect(parsed.pointsDeclared).toBe(1010);
    expect(parsed.units).toHaveLength(8);

    const result = matchRoster(parsed, tau.datasheets);
    expect(result.pointsDeclared).toBe(1010);
    expect(result.pointsFromRoster).toBe(1010);
    expect(result.issues).toEqual([]);
    for (const unit of result.units) {
      expect(unit.matched, `unit ${unit.name} should match`).toBe(true);
      expect(unit.datasheetId).not.toBeNull();
      expect(unit.unmatchedWeapons).toEqual([]);
    }
    const strike = result.units.find((u) => u.name === 'Strike Team')!;
    expect(strike.modelCount).toBe(10);
    expect(strike.points).toBe(120);
    expect(strike.weaponIds.sort()).toEqual(['close-combat-weapon', 'pulse-pistol', 'pulse-rifle']);
  });

  it('imports the astra militarum sample with matching points', () => {
    const parsed = parseRoster(amJson);
    expect(parsed.pointsDeclared).toBe(970);
    expect(parsed.units).toHaveLength(7);

    const result = matchRoster(parsed, am.datasheets);
    expect(result.pointsFromRoster).toBe(970);
    expect(result.issues).toEqual([]);
    for (const unit of result.units) {
      expect(unit.matched, `unit ${unit.name} should match`).toBe(true);
      expect(unit.unmatchedWeapons).toEqual([]);
    }
    const hws = result.units.find((u) => u.name === 'Heavy Weapons Squad')!;
    expect(hws.modelCount).toBe(3);
  });

  it('warns on an unmatched unit without breaking the rest', () => {
    const doc = structuredClone(tauJson) as {
      roster: { forces: { selections: { name: string }[] }[] };
    };
    const selection = doc.roster.forces[0]!.selections.find((s) => s.name === 'Strike Team')!;
    selection.name = 'Mystery Unit of Doom';

    const result = matchRoster(parseRoster(doc), tau.datasheets);
    const mystery = result.units.find((u) => u.name === 'Mystery Unit of Doom')!;
    expect(mystery.matched).toBe(false);
    expect(mystery.datasheetId).toBeNull();
    expect(mystery.weaponIds).toEqual([]);
    expect(mystery.unmatchedWeapons.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes('Mystery Unit of Doom'))).toBe(true);
    for (const unit of result.units) {
      if (unit.name !== 'Mystery Unit of Doom') {
        expect(unit.matched, `unit ${unit.name} should still match`).toBe(true);
      }
    }
  });

  it('matches despite apostrophes, diacritics and case differences', () => {
    expect(normalizeName("T'au Empire")).toBe(normalizeName('TAU  empire'));
    expect(normalizeName('Tàu')).toBe('tau');

    const doc = structuredClone(tauJson) as {
      roster: { forces: { selections: { name: string }[] }[] };
    };
    const selections = doc.roster.forces[0]!.selections;
    selections.find((s) => s.name === 'Kroot Carnivores')!.name = "KROOT Carn'ivores";
    selections.find((s) => s.name === 'Cadre Fireblade')!.name = 'cadre fireblade';

    const result = matchRoster(parseRoster(doc), tau.datasheets);
    expect(result.issues).toEqual([]);
    expect(result.units.find((u) => u.name === "KROOT Carn'ivores")!).toMatchObject({
      matched: true,
      datasheetId: 'tau-empire/kroot-carnivores',
    });
    expect(result.units.find((u) => u.name === 'cadre fireblade')!).toMatchObject({
      matched: true,
      datasheetId: 'tau-empire/cadre-fireblade',
    });
  });

  it('flags a points mismatch between declared and summed costs', () => {
    const doc = structuredClone(tauJson) as {
      roster: { costs: { name: string; value: number }[] };
    };
    doc.roster.costs.find((c) => c.name === 'pts')!.value = 1000;

    const result = matchRoster(parseRoster(doc), tau.datasheets);
    expect(result.pointsDeclared).toBe(1000);
    expect(result.pointsFromRoster).toBe(1010);
    expect(result.issues.some((i) => i.includes('points mismatch'))).toBe(true);
  });
});

describe('writeGeneratedPacks + loadFactionPack', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'openhammer-packs-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes files the validating loader accepts unchanged', () => {
    const files = writeGeneratedPacks(packs, tmp);
    expect(files).toHaveLength(2 + tau.datasheets.length + am.datasheets.length);

    const loadedTau = loadFactionPack('wh40k-10e', 'tau-empire', tmp);
    expect(loadedTau.pack.armyRule.name).toBe('For the Greater Good');
    expect(loadedTau.datasheets.map((d) => d.id).sort()).toEqual(
      tau.datasheets.map((d) => d.id).sort(),
    );

    const loadedAm = loadFactionPack('wh40k-10e', 'astra-militarum', tmp);
    expect(loadedAm.pack.editionId).toBe('wh40k-10e');
    expect(loadedAm.datasheets).toHaveLength(6);
  });
});
