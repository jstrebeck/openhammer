import type { Unit, Model, Weapon } from '@openhammer/core';

interface UnitDataCardProps {
  unit: Unit;
  models: Model[];
}

function WeaponTable({ weapons, type, label }: { weapons: Weapon[]; type: 'ranged' | 'melee'; label: string }) {
  const filtered = weapons.filter((w) => w.type === type);
  if (filtered.length === 0) return null;

  return (
    <div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className={type === 'ranged' ? 'bg-red-900/60' : 'bg-orange-900/60'}>
            <th className="text-left px-2 py-1 font-medium text-white">{label}</th>
            <th className="px-1.5 py-1 font-medium text-white w-12">Range</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">A</th>
            <th className="px-1.5 py-1 font-medium text-white w-10">{type === 'ranged' ? 'BS' : 'WS'}</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">S</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">AP</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">D</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((w) => (
            <tr key={w.id} className="border-t border-gray-700/50">
              <td className="px-2 py-1 text-gray-200">
                <div>{w.name}</div>
                {w.abilities.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    [{w.abilities.join(', ')}]
                  </div>
                )}
              </td>
              <td className="px-1.5 py-1 text-center text-gray-300">{type === 'ranged' ? `${w.range}"` : 'Melee'}</td>
              <td className="px-1.5 py-1 text-center text-gray-300">{w.attacks}</td>
              <td className="px-1.5 py-1 text-center text-gray-300">{w.skill}+</td>
              <td className="px-1.5 py-1 text-center text-gray-300">{w.strength}</td>
              <td className="px-1.5 py-1 text-center text-gray-300">{w.ap}</td>
              <td className="px-1.5 py-1 text-center text-gray-300">{w.damage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UnitDataCard({ unit, models }: UnitDataCardProps) {
  const activeModels = models.filter((m) => m.status === 'active');
  const representativeModel = activeModels[0] ?? models[0];
  if (!representativeModel) return null;

  const stats = representativeModel.stats;
  const hasInvuln = stats.invulnSave != null;

  return (
    <div className="w-80 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl overflow-hidden text-xs">
      {/* Unit Name Header */}
      <div className="bg-gray-700 px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-bold text-white">{unit.name}</span>
        {unit.points != null && (
          <span className="text-xs text-gray-400">{unit.points} pts</span>
        )}
      </div>

      {/* Stat Line */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-blue-900/60">
            <th className="text-left px-2 py-1 font-medium text-white">Unit</th>
            <th className="px-1.5 py-1 font-medium text-white w-10">M</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">T</th>
            <th className="px-1.5 py-1 font-medium text-white w-10">SV</th>
            <th className="px-1.5 py-1 font-medium text-white w-8">W</th>
            <th className="px-1.5 py-1 font-medium text-white w-10">LD</th>
            <th className="px-1.5 py-1 font-medium text-white w-10">OC</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1.5 text-gray-200">{representativeModel.name}</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.move}"</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.toughness}</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.save}+</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.wounds}</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.leadership}+</td>
            <td className="px-1.5 py-1.5 text-center text-gray-300">{stats.objectiveControl}</td>
          </tr>
        </tbody>
      </table>

      {/* Ranged Weapons */}
      <WeaponTable weapons={unit.weapons} type="ranged" label="Ranged Weapons" />

      {/* Melee Weapons */}
      <WeaponTable weapons={unit.weapons} type="melee" label="Melee Weapons" />

      {/* Abilities & Invuln */}
      {(unit.abilities.length > 0 || hasInvuln) && (
        <div className="px-3 py-2 border-t border-gray-700">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Abilities</div>
          <div className="flex flex-wrap gap-1">
            {hasInvuln && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-800/50 text-yellow-300 text-[10px] font-medium">
                Invulnerable Save {stats.invulnSave}+
              </span>
            )}
            {unit.abilities.map((ability, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 text-[10px]"
              >
                {ability}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Keywords */}
      {unit.keywords.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-700">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Keywords</div>
          <div className="text-[10px] text-gray-400">
            {unit.keywords.join(' \u2022 ')}
          </div>
        </div>
      )}

      {/* Model Count Footer */}
      <div className="px-3 py-1.5 border-t border-gray-700 bg-gray-800/50 flex justify-between text-[10px] text-gray-500">
        <span>{activeModels.length}/{models.length} models active</span>
        {unit.startingStrength != null && (
          <span>Starting strength: {unit.startingStrength}</span>
        )}
      </div>
    </div>
  );
}
