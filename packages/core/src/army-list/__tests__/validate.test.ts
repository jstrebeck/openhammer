import { describe, it, expect } from 'vitest';
import { validateArmyList } from '../validate';
import '../../editions/index';

function validRoster() {
  return {
    roster: {
      costs: [{ name: 'pts', value: 500 }],
      forces: [
        {
          selections: [
            {
              name: 'Cadian Castellan',
              number: 1,
              type: 'model' as const,
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
              ],
              categories: [],
              costs: [{ name: 'pts', value: 55 }],
              selections: [],
            },
          ],
        },
      ],
    },
  };
}

describe('validateArmyList (Battlescribe format)', () => {
  it('accepts a valid Battlescribe roster', () => {
    const result = validateArmyList(validRoster());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.roster).not.toBeNull();
  });

  it('rejects non-object input', () => {
    const result = validateArmyList('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('JSON object');
  });

  it('rejects null input', () => {
    expect(validateArmyList(null).valid).toBe(false);
  });

  it('rejects missing roster field', () => {
    const result = validateArmyList({ notRoster: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('roster');
  });

  it('rejects empty forces', () => {
    const result = validateArmyList({ roster: { forces: [] } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('roster.forces');
  });

  it('rejects force with no unit/model selections', () => {
    const data = {
      roster: {
        forces: [
          {
            selections: [
              { name: 'Battle Size', type: 'upgrade', number: 1 },
            ],
          },
        ],
      },
    };
    const result = validateArmyList(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('no unit or model');
  });

  it('rejects force with missing selections array', () => {
    const result = validateArmyList({ roster: { forces: [{}] } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toContain('selections');
  });
});
