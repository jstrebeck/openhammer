import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildArmyUnits, detectFactionFromRoster } from '../importer';
import { parseWeaponAbility } from '../../combat/abilities';
import type { BattlescribeRoster } from '../schema';
import '../../detachments/index';

function loadRoster(relativePath: string): BattlescribeRoster {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf-8')) as BattlescribeRoster;
}

function totalPoints(roster: BattlescribeRoster): number {
  let total = 0;
  for (const force of roster.roster.forces ?? []) {
    for (const selection of force.selections ?? []) {
      const pts = selection.costs?.find((c) => c.name === 'pts');
      total += pts?.value ?? 0;
    }
  }
  return total;
}

function hasRapidFireWeapon(units: ReturnType<typeof buildArmyUnits>): boolean {
  return units.some(({ unit }) =>
    unit.weapons.some((w) =>
      w.abilities.some((a) => parseWeaponAbility(a).name === 'RAPID FIRE'),
    ),
  );
}

describe('sample army lists', () => {
  describe("T'au Empire — Sample Cadre", () => {
    const roster = loadRoster('../../../../../samples/tau-empire-1000.json');
    const units = buildArmyUnits(roster, 'p1');

    it('imports at least 7 units', () => {
      expect(units.length).toBeGreaterThanOrEqual(7);
    });

    it('every unit has models with valid stats and at least one weapon', () => {
      for (const { unit, models } of units) {
        expect(models.length).toBeGreaterThanOrEqual(1);
        expect(unit.weapons.length).toBeGreaterThanOrEqual(1);
        for (const model of models) {
          expect(model.stats.toughness).toBeGreaterThan(0);
          expect(model.stats.save).toBeGreaterThan(0);
          expect(model.wounds).toBeGreaterThan(0);
        }
      }
    });

    it('Kroot Carnivores have the KROOT keyword', () => {
      const kroot = units.find(({ unit }) => unit.name === 'Kroot Carnivores');
      expect(kroot).toBeDefined();
      const keywords = kroot!.unit.keywords.map((k) => k.toUpperCase());
      expect(keywords).toContain('KROOT');
    });

    it('Strike Teams have 10 Fire Warrior models each', () => {
      const strikeTeams = units.filter(({ unit }) => unit.name === 'Strike Team');
      expect(strikeTeams.length).toBe(2);
      for (const { models } of strikeTeams) {
        expect(models.length).toBe(10);
      }
    });

    it("detects faction as tau-empire", () => {
      expect(detectFactionFromRoster(roster)).toBe('tau-empire');
    });

    it('totals between 900 and 1100 points', () => {
      const pts = totalPoints(roster);
      expect(pts).toBeGreaterThanOrEqual(900);
      expect(pts).toBeLessThanOrEqual(1100);
    });

    it('has at least one weapon with RAPID FIRE', () => {
      expect(hasRapidFireWeapon(units)).toBe(true);
    });
  });

  describe('Astra Militarum — Sample Regiment', () => {
    const roster = loadRoster('../../../../../samples/astra-militarum-1000.json');
    const units = buildArmyUnits(roster, 'p1');

    it('imports at least 6 units', () => {
      expect(units.length).toBeGreaterThanOrEqual(6);
    });

    it('every unit has models with valid stats and at least one weapon', () => {
      for (const { unit, models } of units) {
        expect(models.length).toBeGreaterThanOrEqual(1);
        expect(unit.weapons.length).toBeGreaterThanOrEqual(1);
        for (const model of models) {
          expect(model.stats.toughness).toBeGreaterThan(0);
          expect(model.stats.save).toBeGreaterThan(0);
          expect(model.wounds).toBeGreaterThan(0);
        }
      }
    });

    it('detects faction as astra-militarum', () => {
      expect(detectFactionFromRoster(roster)).toBe('astra-militarum');
    });

    it('totals between 900 and 1100 points', () => {
      const pts = totalPoints(roster);
      expect(pts).toBeGreaterThanOrEqual(900);
      expect(pts).toBeLessThanOrEqual(1100);
    });

    it('has at least one weapon with RAPID FIRE', () => {
      expect(hasRapidFireWeapon(units)).toBe(true);
    });
  });
});
