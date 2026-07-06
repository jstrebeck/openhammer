import type { Datasheet, UnitState } from '@openhammer/core';
import type { ImportResult, ParsedRoster } from '@openhammer/content';

/**
 * Turn an import result into engine unit state. Matched units get their
 * datasheet stats and weapon loadouts; unmatched units become stat-only
 * tokens (warned about, never blocking — the v2 prompt's rule).
 */
export function materializeRoster(
  parsed: ParsedRoster,
  result: ImportResult,
  getDatasheet: (id: string) => Datasheet | undefined,
): UnitState[] {
  const out: UnitState[] = [];
  const nameCounts = new Map<string, number>();

  result.units.forEach((imported, index) => {
    const parsedUnit = parsed.units[index];
    const slugBase = slug(imported.name);
    const n = (nameCounts.get(slugBase) ?? 0) + 1;
    nameCounts.set(slugBase, n);
    const unitId = n > 1 ? `${slugBase}-${n}` : slugBase;

    const ds = imported.datasheetId ? getDatasheet(imported.datasheetId) : undefined;
    const profile = ds?.models[0];
    const wounds =
      profile?.wounds ??
      intFromProfile(parsedUnit?.profiles.find((p) => p.typeName === 'Unit'), 'W') ??
      1;

    const models = Array.from({ length: Math.max(1, imported.modelCount) }, (_, i) => ({
      id: `${unitId}-m${i}`,
      profileId: profile?.id ?? 'default',
      position: null,
      woundsRemaining: wounds,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    }));

    // Weapons: copy matched profiles; distribute per roster counts.
    const weapons: UnitState['weapons'] = {};
    const loadout: UnitState['loadout'] = {};
    for (const m of models) loadout[m.id] = [];
    if (ds) {
      const byId = new Map(
        [...ds.rangedWeapons, ...ds.meleeWeapons].map((w) => [w.id, w] as const),
      );
      const byName = new Map(
        [...ds.rangedWeapons, ...ds.meleeWeapons].map((w) => [norm(w.name), w] as const),
      );
      for (const rosterWeapon of parsedUnit?.weapons ?? []) {
        const weapon = byName.get(norm(rosterWeapon.name));
        if (!weapon || !imported.weaponIds.includes(weapon.id)) continue;
        weapons[weapon.id] = byId.get(weapon.id)!;
        for (let k = 0; k < rosterWeapon.count; k++) {
          const model = models[k % models.length]!;
          const list = loadout[model.id]!;
          if (!list.includes(weapon.id)) list.push(weapon.id);
        }
      }
    }

    out.push({
      id: unitId,
      owner: 0, // overwritten by the reducer from the authenticated action
      datasheetId: imported.datasheetId ?? `unmatched:${slugBase}`,
      name: imported.name,
      models,
      startingStrength: models.length,
      loadout,
      weapons,
      battleShocked: false,
      tokens: [],
      reserves: 'none',
      embarkedIn: null,
      attachedTo: null,
      leaderOf: null,
      enhancementId: imported.enhancementName ? slug(imported.enhancementName) : null,
      isWarlord: false,
      oneShotFired: [],
      turnFlags: {
        moveKind: null,
        advanceRoll: null,
        chargeRoll: null,
        chargeTargets: [],
        hasShot: false,
        hasFought: false,
        fightsFirst: false,
        arrivedFromReserves: false,
      },
      ...(imported.matched ? {} : { unmatched: true }),
    });
  });

  return out;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function norm(name: string): string {
  return slug(name);
}

function intFromProfile(
  profile: { characteristics: { name: string; value: string }[] } | undefined,
  characteristic: string,
): number | null {
  const raw = profile?.characteristics.find((c) => c.name === characteristic)?.value;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
