import { describe, it, expect } from 'vitest';
import { importArmyList } from '../importer';
import { createInitialGameState } from '../../state/initialState';
import { gameReducer } from '../../state/reducer';
import type { BattlescribeRoster } from '../schema';
import { makePlayer } from '../../test-helpers';
import '../../editions/index';

function sampleRoster(): BattlescribeRoster {
  return {
    roster: {
      costs: [{ name: 'pts', value: 265 }],
      forces: [
        {
          selections: [
            // Configuration upgrade — should be skipped
            {
              name: 'Battle Size',
              number: 1,
              type: 'upgrade',
            },
            // Single model selection (character)
            {
              name: 'Cadian Castellan',
              number: 1,
              type: 'model',
              costs: [{ name: 'pts', value: 55 }],
              profiles: [
                {
                  name: 'Castellan',
                  typeName: 'Unit',
                  characteristics: [
                    { $text: '6"', name: 'M' },
                    { $text: '3', name: 'T' },
                    { $text: '5+', name: 'SV' },
                    { $text: '3', name: 'W' },
                    { $text: '6+', name: 'LD' },
                    { $text: '1', name: 'OC' },
                  ],
                },
                {
                  name: 'Summary Execution',
                  typeName: 'Abilities',
                  characteristics: [{ $text: 'Some ability text', name: 'Description' }],
                },
              ],
              rules: [
                { name: 'Voice Of Command', description: 'Orders stuff' },
                { name: 'Leader', description: 'Leader stuff' },
              ],
              categories: [
                { name: 'Cadian Castellan', primary: false },
                { name: 'Faction: Astra Militarum', primary: false },
                { name: 'Imperium', primary: false },
                { name: 'Officer', primary: false },
                { name: 'Character', primary: false },
                { name: 'Infantry', primary: false },
              ],
              selections: [
                {
                  name: 'Chainsword',
                  number: 1,
                  type: 'upgrade',
                  profiles: [
                    {
                      name: 'Chainsword',
                      typeName: 'Melee Weapons',
                      characteristics: [
                        { $text: 'Melee', name: 'Range' },
                        { $text: '4', name: 'A' },
                        { $text: '3+', name: 'WS' },
                        { $text: '3', name: 'S' },
                        { $text: '0', name: 'AP' },
                        { $text: '1', name: 'D' },
                        { $text: '-', name: 'Keywords' },
                      ],
                    },
                  ],
                },
                {
                  name: 'Laspistol',
                  number: 1,
                  type: 'upgrade',
                  profiles: [
                    {
                      name: 'Laspistol',
                      typeName: 'Ranged Weapons',
                      characteristics: [
                        { $text: '12"', name: 'Range' },
                        { $text: '1', name: 'A' },
                        { $text: '3+', name: 'BS' },
                        { $text: '3', name: 'S' },
                        { $text: '0', name: 'AP' },
                        { $text: '1', name: 'D' },
                        { $text: 'Pistol', name: 'Keywords' },
                      ],
                    },
                  ],
                },
              ],
            },
            // Multi-model unit
            {
              name: 'Ogryn Bodyguard',
              number: 1,
              type: 'unit',
              costs: [{ name: 'pts', value: 210 }],
              profiles: [
                {
                  name: 'Ogryn Bodyguard',
                  typeName: 'Unit',
                  characteristics: [
                    { $text: '6"', name: 'M' },
                    { $text: '6', name: 'T' },
                    { $text: '5+', name: 'SV' },
                    { $text: '6', name: 'W' },
                    { $text: '7+', name: 'LD' },
                    { $text: '1', name: 'OC' },
                  ],
                },
                {
                  name: 'Loyal Protector',
                  typeName: 'Abilities',
                  characteristics: [{ $text: 'Ability text', name: 'Description' }],
                },
              ],
              rules: [
                { name: 'Feel No Pain 6+', description: 'FNP stuff' },
              ],
              categories: [
                { name: 'Ogryn Bodyguard', primary: false },
                { name: 'Faction: Astra Militarum', primary: false },
              ],
              selections: [
                {
                  name: 'Close combat weapon',
                  number: 1,
                  type: 'upgrade',
                  profiles: [
                    {
                      name: 'Close combat weapon',
                      typeName: 'Melee Weapons',
                      characteristics: [
                        { $text: 'Melee', name: 'Range' },
                        { $text: '4', name: 'A' },
                        { $text: '3+', name: 'WS' },
                        { $text: '6', name: 'S' },
                        { $text: '0', name: 'AP' },
                        { $text: '1', name: 'D' },
                        { $text: '-', name: 'Keywords' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('importArmyList (Battlescribe format)', () => {
  it('creates units from model and unit selections', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const units = Object.values(state.units);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.name).sort()).toEqual(['Cadian Castellan', 'Ogryn Bodyguard']);
  });

  it('skips upgrade-only selections', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    // "Battle Size" upgrade should not create a unit
    const units = Object.values(state.units);
    expect(units.every((u) => u.name !== 'Battle Size')).toBe(true);
  });

  it('extracts stats from Unit profiles', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const castellanUnit = Object.values(state.units).find((u) => u.name === 'Cadian Castellan')!;
    const model = state.models[castellanUnit.modelIds[0]];
    expect(model.stats.move).toBe(6);
    expect(model.stats.toughness).toBe(3);
    expect(model.stats.save).toBe(5);
    expect(model.stats.wounds).toBe(3);
    expect(model.stats.leadership).toBe(6);
    expect(model.stats.objectiveControl).toBe(1);
    expect(model.maxWounds).toBe(3);
  });

  it('extracts weapons from nested selections', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const castellanUnit = Object.values(state.units).find((u) => u.name === 'Cadian Castellan')!;
    expect(castellanUnit.weapons).toHaveLength(2);

    const laspistol = castellanUnit.weapons.find((w) => w.name === 'Laspistol')!;
    expect(laspistol.type).toBe('ranged');
    expect(laspistol.range).toBe(12);
    expect(laspistol.skill).toBe(3);
    expect(laspistol.strength).toBe(3);
    expect(laspistol.abilities).toContain('Pistol');

    const chainsword = castellanUnit.weapons.find((w) => w.name === 'Chainsword')!;
    expect(chainsword.type).toBe('melee');
    expect(chainsword.range).toBeUndefined();
  });

  it('extracts points from costs', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const castellanUnit = Object.values(state.units).find((u) => u.name === 'Cadian Castellan')!;
    expect(castellanUnit.points).toBe(55);

    const ogrynUnit = Object.values(state.units).find((u) => u.name === 'Ogryn Bodyguard')!;
    expect(ogrynUnit.points).toBe(210);
  });

  it('extracts keywords from categories', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const castellanUnit = Object.values(state.units).find((u) => u.name === 'Cadian Castellan')!;
    expect(castellanUnit.keywords).toContain('Infantry');
    expect(castellanUnit.keywords).toContain('Character');
    expect(castellanUnit.keywords).toContain('Officer');
    // Should not include Faction categories
    expect(castellanUnit.keywords.every((k) => !k.startsWith('Faction:'))).toBe(true);
  });

  it('extracts abilities from profiles and rules', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1');

    const castellanUnit = Object.values(state.units).find((u) => u.name === 'Cadian Castellan')!;
    expect(castellanUnit.abilities).toContain('Summary Execution');
    expect(castellanUnit.abilities).toContain('Voice Of Command');
    expect(castellanUnit.abilities).toContain('Leader');
  });

  it('places units in a flow layout from the start position', () => {
    let state = createInitialGameState();
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: makePlayer({ id: 'p1' }) } });

    state = importArmyList(state, sampleRoster(), 'p1', { x: 10, y: 10 });

    const units = Object.values(state.units);
    const unit1Models = units[0].modelIds.map((id) => state.models[id]);
    const unit2Models = units[1].modelIds.map((id) => state.models[id]);

    // First unit's first model starts at the start position
    expect(unit1Models[0].position).toEqual({ x: 10, y: 10 });

    // Second unit is offset from the first (either to the right or below)
    const differentX = unit2Models[0].position.x !== unit1Models[0].position.x;
    const differentY = unit2Models[0].position.y !== unit1Models[0].position.y;
    expect(differentX || differentY).toBe(true);
  });
});
