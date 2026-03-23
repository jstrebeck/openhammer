import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import {
  rollDice,
  countSuccesses,
  getWoundThreshold,
  parseDiceExpression,
  checkUnitVisibility,
  canTargetWithRangedWeapon,
} from '@openhammer/core';
import type { Weapon, DiceRoll, VisibilityStatus } from '@openhammer/core';

/** Get Tailwind color class for weapon ability badge */
function getAbilityColor(ability: string): string {
  const upper = ability.toUpperCase();
  if (upper.includes('LETHAL')) return 'bg-red-700/70 text-red-200';
  if (upper.includes('SUSTAINED')) return 'bg-yellow-700/70 text-yellow-200';
  if (upper.includes('DEVASTATING')) return 'bg-purple-700/70 text-purple-200';
  if (upper.includes('MELTA')) return 'bg-orange-700/70 text-orange-200';
  if (upper.includes('RAPID FIRE')) return 'bg-blue-700/70 text-blue-200';
  if (upper.includes('BLAST')) return 'bg-red-600/70 text-red-200';
  if (upper.includes('TORRENT')) return 'bg-green-700/70 text-green-200';
  if (upper.includes('HEAVY')) return 'bg-gray-600/70 text-gray-200';
  if (upper.includes('ASSAULT')) return 'bg-emerald-700/70 text-emerald-200';
  if (upper.includes('PISTOL')) return 'bg-cyan-700/70 text-cyan-200';
  if (upper.includes('ANTI')) return 'bg-pink-700/70 text-pink-200';
  if (upper.includes('LANCE')) return 'bg-amber-700/70 text-amber-200';
  if (upper.includes('TWIN')) return 'bg-indigo-700/70 text-indigo-200';
  if (upper.includes('HAZARDOUS')) return 'bg-yellow-600/70 text-yellow-200';
  if (upper.includes('PRECISION')) return 'bg-violet-700/70 text-violet-200';
  if (upper.includes('INDIRECT')) return 'bg-gray-500/70 text-gray-200';
  if (upper.includes('IGNORES COVER')) return 'bg-teal-700/70 text-teal-200';
  if (upper.includes('ONE SHOT')) return 'bg-rose-700/70 text-rose-200';
  return 'bg-gray-600/70 text-gray-300';
}

interface AttackResult {
  weaponName: string;
  numAttacks: number;
  hitRoll: DiceRoll;
  hits: number;
  woundThreshold: number;
  woundRoll: DiceRoll;
  wounds: number;
  saveResults: Array<{ roll: DiceRoll; saved: boolean; damage: number }>;
  totalDamage: number;
}

export function ShootingPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);

  const [targetUnitId, setTargetUnitId] = useState<string | null>(null);
  const [selectedWeaponIds, setSelectedWeaponIds] = useState<string[]>([]);
  const [attackResults, setAttackResults] = useState<AttackResult[]>([]);
  const [step, setStep] = useState<'select' | 'results'>('select');

  const firstModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const attackerUnit = firstModel?.unitId ? gameState.units[firstModel.unitId] : null;

  const activeShootingUnit = gameState.shootingState.activeShootingUnit;
  const hasShot = attackerUnit ? gameState.shootingState.unitsShot.includes(attackerUnit.id) : false;

  // Get enemy units with visibility info
  const enemyUnitsRaw = attackerUnit
    ? Object.values(gameState.units).filter(
        (u) =>
          u.playerId !== attackerUnit.playerId &&
          u.modelIds.some((id) => gameState.models[id]?.status === 'active'),
      )
    : [];

  // Compute visibility for each enemy unit
  const enemyUnits = enemyUnitsRaw.map((u) => {
    let visibility: VisibilityStatus = 'fully_visible';
    if (attackerUnit) {
      const visResult = checkUnitVisibility(attackerUnit, u, gameState);
      visibility = visResult.status;
    }
    return { ...u, visibility };
  });

  const rangedWeapons = attackerUnit?.weapons.filter((w) => w.type === 'ranged') ?? [];
  const targetUnit = targetUnitId ? gameState.units[targetUnitId] : null;

  const handleDeclare = () => {
    if (!attackerUnit) return;
    dispatch({ type: 'DECLARE_SHOOTING', payload: { unitId: attackerUnit.id } });
  };

  const toggleWeapon = (wId: string) => {
    setSelectedWeaponIds((prev) =>
      prev.includes(wId) ? prev.filter((id) => id !== wId) : [...prev, wId],
    );
  };

  const handleResolve = () => {
    if (!attackerUnit || !targetUnit || selectedWeaponIds.length === 0) return;

    const activeModels = attackerUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');

    const targetModels = targetUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');

    if (activeModels.length === 0 || targetModels.length === 0) return;

    const firstTarget = targetModels[0];
    const results: AttackResult[] = [];

    // Assign weapons
    const assignments = selectedWeaponIds.flatMap((wId) =>
      activeModels.map((m) => ({ modelId: m.id, weaponId: wId, targetUnitId: targetUnit.id })),
    );
    dispatch({ type: 'ASSIGN_WEAPON_TARGETS', payload: { assignments } });

    // Resolve each weapon
    for (const weaponId of selectedWeaponIds) {
      const weapon = rangedWeapons.find((w) => w.id === weaponId);
      if (!weapon) continue;

      // Calculate attacks
      const attacksPerModel = parseDiceExpression(weapon.attacks);
      const totalAttacks = attacksPerModel * activeModels.length;

      // Hit roll
      const hitRoll = rollDice(totalAttacks, 6, 'To Hit', weapon.skill);
      const hits = hitRoll.dice.filter((d) => (d === 1 ? false : d >= weapon.skill || d === 6)).length;

      // Wound roll
      const woundThreshold = getWoundThreshold(weapon.strength, firstTarget.stats.toughness);
      const woundRoll = hits > 0 ? rollDice(hits, 6, 'To Wound', woundThreshold) : rollDice(0, 6, 'To Wound', woundThreshold);
      const wounds = woundRoll.dice.filter((d) => (d === 1 ? false : d >= woundThreshold || d === 6)).length;

      // Dispatch attack resolution
      dispatch({
        type: 'RESOLVE_SHOOTING_ATTACK',
        payload: {
          attackingUnitId: attackerUnit.id,
          attackingModelId: activeModels[0].id,
          weaponId: weapon.id,
          weaponName: weapon.name,
          targetUnitId: targetUnit.id,
          numAttacks: totalAttacks,
          hitRoll,
          hits,
          woundRoll,
          wounds,
        },
      });

      // Save rolls
      const saveResults: AttackResult['saveResults'] = [];
      let totalDamage = 0;

      // Allocate wounds to target models
      let currentTargetIdx = 0;
      for (let i = 0; i < wounds; i++) {
        const target = targetModels[currentTargetIdx];
        if (!target) break;

        const modifiedSave = target.stats.save + Math.abs(weapon.ap);
        const invuln = target.stats.invulnSave;
        const effectiveSave = invuln ? Math.min(modifiedSave, invuln) : modifiedSave;

        const saveRoll = rollDice(1, 6, 'Save', effectiveSave);
        const dieResult = saveRoll.dice[0];
        const saved = dieResult !== 1 && dieResult >= effectiveSave;

        const dmg = saved ? 0 : parseDiceExpression(weapon.damage);
        totalDamage += dmg;

        saveResults.push({ roll: saveRoll, saved, damage: dmg });

        if (!saved && dmg > 0) {
          dispatch({
            type: 'RESOLVE_SAVE_ROLL',
            payload: {
              targetModelId: target.id,
              saveRoll,
              saved: false,
              damageToApply: dmg,
            },
          });

          // Check if target is destroyed, move to next
          const updatedTarget = gameState.models[target.id];
          if (updatedTarget && updatedTarget.wounds - dmg <= 0) {
            currentTargetIdx++;
          }
        }
      }

      results.push({
        weaponName: weapon.name,
        numAttacks: totalAttacks,
        hitRoll,
        hits,
        woundThreshold,
        woundRoll,
        wounds,
        saveResults,
        totalDamage,
      });
    }

    setAttackResults(results);
    setStep('results');
  };

  const handleComplete = () => {
    if (!attackerUnit) return;
    dispatch({ type: 'COMPLETE_SHOOTING', payload: { unitId: attackerUnit.id } });
    setStep('select');
    setAttackResults([]);
    setSelectedWeaponIds([]);
    setTargetUnitId(null);
  };

  const handleSkip = () => {
    if (!attackerUnit) return;
    dispatch({ type: 'COMPLETE_SHOOTING', payload: { unitId: attackerUnit.id } });
  };

  if (!attackerUnit) {
    return <div className="text-xs text-gray-500 italic">Select a unit to shoot with</div>;
  }

  if (rangedWeapons.length === 0) {
    return <div className="text-xs text-gray-500 italic">{attackerUnit.name} has no ranged weapons</div>;
  }

  if (hasShot) {
    return (
      <div className="text-xs text-gray-400">
        <span className="font-medium text-white">{attackerUnit.name}</span> — shooting complete
      </div>
    );
  }

  // Movement restriction warning
  const moveType = gameState.turnTracking.unitMovement[attackerUnit.id];
  const cantShoot = moveType === 'advance' || moveType === 'fall_back';

  if (cantShoot) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{attackerUnit.name}</span>
        </div>
        <div className="text-xs text-red-400">
          Cannot shoot — {moveType === 'advance' ? 'unit Advanced' : 'unit Fell Back'} this turn
        </div>
        <button
          onClick={handleSkip}
          className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
        >
          Skip Shooting
        </button>
      </div>
    );
  }

  // Step: declare shooting
  if (activeShootingUnit !== attackerUnit.id) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{attackerUnit.name}</span> — {rangedWeapons.length} ranged weapon{rangedWeapons.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={handleDeclare}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          Declare Shooting
        </button>
        <button
          onClick={handleSkip}
          className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Skip Shooting
        </button>
      </div>
    );
  }

  // Step: results
  if (step === 'results' && attackResults.length > 0) {
    const totalDmg = attackResults.reduce((sum, r) => sum + r.totalDamage, 0);
    return (
      <div className="space-y-3">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{attackerUnit.name}</span> shooting results
        </div>

        {attackResults.map((result, idx) => (
          <div key={idx} className="border border-gray-700 rounded p-2 space-y-1.5">
            <div className="text-xs font-medium text-white">{result.weaponName}</div>

            {/* Hit Roll */}
            <div>
              <div className="text-[10px] text-gray-500">To Hit ({result.hitRoll.threshold}+): {result.hits}/{result.numAttacks}</div>
              <div className="flex flex-wrap gap-0.5 mt-0.5">
                {result.hitRoll.dice.map((d, j) => (
                  <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    d === 6 ? 'bg-yellow-500 text-black' : d >= (result.hitRoll.threshold ?? 4) ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                  }`}>
                    {d}
                  </span>
                ))}
              </div>
            </div>

            {/* Wound Roll */}
            {result.hits > 0 && (
              <div>
                <div className="text-[10px] text-gray-500">To Wound ({result.woundThreshold}+): {result.wounds}/{result.hits}</div>
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {result.woundRoll.dice.map((d, j) => (
                    <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                      d === 6 ? 'bg-yellow-500 text-black' : d >= result.woundThreshold ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                    }`}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Save Results */}
            {result.saveResults.length > 0 && (
              <div>
                <div className="text-[10px] text-gray-500">
                  Saves: {result.saveResults.filter((s) => s.saved).length} saved, {result.saveResults.filter((s) => !s.saved).length} failed
                </div>
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {result.saveResults.map((s, j) => (
                    <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                      s.saved ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                    }`}>
                      {s.roll.dice[0]}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs font-medium text-red-400">
              {result.totalDamage} damage dealt
            </div>
          </div>
        ))}

        <div className="border-t border-gray-600 pt-2 text-sm font-bold text-red-400">
          Total: {totalDmg} damage
        </div>

        <button
          onClick={handleComplete}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // Step: select weapons and targets
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400">
        <span className="font-medium text-white">{attackerUnit.name}</span> — select weapons and target
      </div>

      {/* Weapons */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Weapons</div>
        <div className="space-y-1">
          {rangedWeapons.map((w) => (
            <button
              key={w.id}
              onClick={() => toggleWeapon(w.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                selectedWeaponIds.includes(w.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-medium">{w.name}</div>
              <div className="text-[10px] opacity-70 mt-0.5">
                {w.range}" | A{typeof w.attacks === 'number' ? w.attacks : w.attacks} | BS{w.skill}+ | S{w.strength} | AP{w.ap} | D{typeof w.damage === 'number' ? w.damage : w.damage}
              </div>
              {w.abilities.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {w.abilities.map((a, i) => {
                    const abilityColor = getAbilityColor(a);
                    return (
                      <span
                        key={i}
                        className={`inline-block px-1 py-0 rounded text-[9px] font-medium ${abilityColor}`}
                      >
                        {a}
                      </span>
                    );
                  })}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Target */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Target</div>
        <select
          value={targetUnitId ?? ''}
          onChange={(e) => setTargetUnitId(e.target.value || null)}
          className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs border border-gray-600 focus:outline-none focus:border-blue-500"
        >
          <option value="">Select target...</option>
          {enemyUnits.map((u) => {
            const alive = u.modelIds.filter((id) => gameState.models[id]?.status === 'active').length;
            const notVisible = u.visibility === 'not_visible';
            return (
              <option
                key={u.id}
                value={u.id}
                disabled={notVisible}
                className={notVisible ? 'text-gray-600' : ''}
              >
                {u.name} ({alive} model{alive !== 1 ? 's' : ''})
                {u.visibility === 'not_visible' ? ' — Not Visible' : ''}
                {u.visibility === 'partially_visible' ? ' — Partial' : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* Resolve */}
      <button
        onClick={handleResolve}
        disabled={selectedWeaponIds.length === 0 || !targetUnitId}
        className="w-full px-3 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Roll Attack Sequence
      </button>

      <button
        onClick={handleComplete}
        className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
      >
        Skip Shooting
      </button>
    </div>
  );
}
