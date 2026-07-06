import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOOK_NAMES } from '@openhammer/core';
import {
  instantiateAbilityEffects,
  loadEditionContent,
} from './loader.js';
import { SUPPORTED_SCHEMA_VERSION, validateContent } from './validate.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('loadEditionContent(wh40k-10e)', () => {
  const loaded = loadEditionContent('wh40k-10e');

  it('loads the edition with 10e phase structure and parameters', () => {
    expect(loaded.edition.id).toBe('wh40k-10e');
    expect(loaded.edition.battleRounds).toBe(5);
    expect(loaded.edition.phases.map((p) => p.id)).toEqual([
      'command',
      'movement',
      'shooting',
      'charge',
      'fight',
    ]);
    expect(loaded.edition.parameters.modifierCaps).toEqual({
      hit: 1,
      wound: 1,
      saveImprovement: 1,
    });
    expect(loaded.edition.parameters.engagementRangeHorizontal).toBe(1);
  });

  it('ships the full universal weapon-ability vocabulary', () => {
    const ids = loaded.weaponAbilities.map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        'anti',
        'assault',
        'blast',
        'conversion',
        'devastating-wounds',
        'extra-attacks',
        'hazardous',
        'heavy',
        'ignores-cover',
        'indirect-fire',
        'lance',
        'lethal-hits',
        'melta',
        'one-shot',
        'pistol',
        'precision',
        'rapid-fire',
        'sustained-hits',
        'torrent',
        'twin-linked',
      ].sort(),
    );
  });

  it('ships all 11 core stratagems with timing windows', () => {
    expect(loaded.coreStratagems).toHaveLength(11);
    const overwatch = loaded.coreStratagems.find((s) => s.id === 'core.fire-overwatch');
    expect(overwatch?.player).toBe('reactive');
    expect(overwatch?.cost).toBe(1);
    expect(overwatch?.window).toContain('charge.completed');
    const insane = loaded.coreStratagems.find((s) => s.id === 'core.insane-bravery');
    expect(insane?.window).toBe('command.battleShockFailed');
  });

  it('loads leviathan terrain layouts as data', () => {
    expect(loaded.terrainLayouts.length).toBeGreaterThanOrEqual(1);
    const layout = loaded.terrainLayouts[0]!;
    expect(layout.boardSize).toEqual({ width: 60, height: 44 });
    expect(layout.pieces.length).toBeGreaterThanOrEqual(6);
    expect(layout.pieces.every((p) => p.footprint.length >= 3)).toBe(true);
    expect(layout.pieces.some((p) => p.traits.includes('ruins'))).toBe(true);
  });

  it('loads leviathan deployment maps and missions', () => {
    expect(loaded.deploymentMaps.map((m) => m.id).sort()).toEqual([
      'dawn-of-war',
      'hammer-and-anvil',
      'search-and-destroy',
    ]);
    for (const map of loaded.deploymentMaps) {
      expect(map.boardSize).toEqual({ width: 60, height: 44 });
      expect(map.objectives).toHaveLength(5);
      expect(map.zones).toHaveLength(2);
    }
    const mission = loaded.missions.find((m) => m.id === 'take-and-hold');
    expect(mission?.primaryScoring[0]?.cadence.fromRound).toBe(2);
    expect(mission?.primaryScoring[0]?.scoring.perObjectiveHeld).toBe(5);
  });

  it('assigns a unique declaration order to every effect id', () => {
    const orders = Object.values(loaded.effectOrder);
    expect(orders.length).toBeGreaterThan(20);
    expect(new Set(orders).size).toBe(orders.length);
    // Deterministic across loads.
    const again = loadEditionContent('wh40k-10e');
    expect(again.effectOrder).toEqual(loaded.effectOrder);
  });

  it('pins pack versions for game creation', () => {
    expect(loaded.versions['edition']).toBe('2026-06');
    expect(loaded.versions['core-stratagems']).toBe('2026-06');
  });
});

describe('schema validation', () => {
  it('rejects a pack targeting an unsupported schema version', () => {
    const result = validateContent('edition', { schemaVersion: 99, version: 'x' });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('schema version 99');
    expect(result.issues[0]?.message).toContain(`version ${SUPPORTED_SCHEMA_VERSION}`);
  });

  it('rejects an effect with an unknown trigger hook', () => {
    const result = validateContent('weapon-abilities', {
      schemaVersion: 1,
      version: 'test',
      abilities: [
        {
          id: 'bad',
          name: 'Bad',
          effects: [{ id: 'bad.effect', trigger: 'attack.nonsense', effects: [] }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes('trigger'))).toBe(true);
  });

  it('rejects an unknown effect primitive type', () => {
    const result = validateContent('weapon-abilities', {
      schemaVersion: 1,
      version: 'test',
      abilities: [
        {
          id: 'bad',
          name: 'Bad',
          effects: [
            {
              id: 'bad.effect',
              trigger: 'attack.beforeHitRoll',
              effects: [{ type: 'summonDaemons' }],
            },
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('keeps the schema hook enum in lockstep with core HOOK_NAMES', () => {
    const schema = JSON.parse(
      readFileSync(join(here, '..', 'schemas', 'common.schema.json'), 'utf8'),
    );
    const schemaHooks: string[] = schema.$defs.hookName.enum;
    expect([...schemaHooks].sort()).toEqual([...HOOK_NAMES].sort());
  });
});

describe('instantiateAbilityEffects', () => {
  const loaded = loadEditionContent('wh40k-10e');

  it('substitutes $X for rapid fire', () => {
    const rapidFire = loaded.weaponAbilities.find((a) => a.id === 'rapid-fire')!;
    const effects = instantiateAbilityEffects(rapidFire, { id: 'rapid-fire', value: 2 });
    expect(effects[0]?.effects[0]).toEqual({ type: 'addAttacks', value: 2 });
    expect(effects[0]?.id).toBe('rapid-fire.bonus#2');
  });

  it('substitutes $X and $KEYWORD for anti', () => {
    const anti = loaded.weaponAbilities.find((a) => a.id === 'anti')!;
    const effects = instantiateAbilityEffects(anti, { id: 'anti', value: 4, keyword: 'Fly' });
    expect(effects[0]?.condition).toEqual({ targetHasKeyword: 'Fly' });
    expect(effects[0]?.effects[0]).toEqual({ type: 'setCriticalWoundOn', value: 4 });
  });

  it('throws a clear error when a required parameter is missing', () => {
    const melta = loaded.weaponAbilities.find((a) => a.id === 'melta')!;
    expect(() => instantiateAbilityEffects(melta, { id: 'melta' })).toThrow(/requires a value/);
  });

  it('leaves non-parameterized abilities untouched', () => {
    const torrent = loaded.weaponAbilities.find((a) => a.id === 'torrent')!;
    const effects = instantiateAbilityEffects(torrent, { id: 'torrent' });
    expect(effects).toEqual(torrent.effects);
  });
});
