import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import {
  rollDice,
  getWoundThreshold,
  parseDiceExpression,
  getFactionState,
  getOrderSaveModifier,
  applyFactionAndDetachmentRules,
  parseWeaponAbility,
} from '@openhammer/core';
import type { Weapon, DiceRoll } from '@openhammer/core';
import type { AttackContext } from '@openhammer/core/src/combat/attackPipeline';

interface MeleeResult {
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

export function FightPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const setSelectedModelIds = useUIStore((s) => s.setSelectedModelIds);

  const [targetUnitId, setTargetUnitId] = useState<string | null>(null);
  const [selectedWeaponIds, setSelectedWeaponIds] = useState<string[]>([]);
  const [attackResults, setAttackResults] = useState<MeleeResult[]>([]);
  const [fightStep, setFightStep] = useState<'select' | 'pile_in' | 'attack' | 'results' | 'consolidate'>('select');

  const { fightState } = gameState;
  const currentFighter = fightState.currentFighter;
  const fighterUnit = currentFighter ? gameState.units[currentFighter] : null;

  const isInitialized = fightState.eligibleUnits.length > 0 || fightState.unitsFought.length > 0 || fightState.currentFighter !== null;

  const handleInitialize = () => {
    dispatch({ type: 'INITIALIZE_FIGHT_PHASE' });
  };

  const handleSelectFighter = (unitId: string) => {
    dispatch({ type: 'SELECT_UNIT_TO_FIGHT', payload: { unitId } });
    // Select the unit's models on the board
    const unit = gameState.units[unitId];
    if (unit) {
      setSelectedModelIds(unit.modelIds.filter((id) => gameState.models[id]?.status === 'active'));
    }
    setFightStep('pile_in');
  };

  const handlePileIn = () => {
    if (!fighterUnit) return;
    const activeModels = fighterUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');
    const positions: Record<string, { x: number; y: number }> = {};
    for (const model of activeModels) {
      positions[model.id] = model.position;
    }
    dispatch({ type: 'PILE_IN', payload: { unitId: fighterUnit.id, positions } });
    setFightStep('attack');
  };

  const handleSkipPileIn = () => {
    setFightStep('attack');
  };

  const toggleWeapon = (wId: string) => {
    setSelectedWeaponIds((prev) =>
      prev.includes(wId) ? prev.filter((id) => id !== wId) : [...prev, wId],
    );
  };

  const handleResolveAttack = () => {
    if (!fighterUnit || !targetUnitId) return;

    const targetUnit = gameState.units[targetUnitId];
    if (!targetUnit) return;

    const activeModels = fighterUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');
    const targetModels = targetUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');
    if (activeModels.length === 0 || targetModels.length === 0) return;

    const firstTarget = targetModels[0];
    const meleeWeapons = fighterUnit.weapons.filter((w) => w.type === 'melee');
    const weaponsToUse = selectedWeaponIds.length > 0
      ? meleeWeapons.filter((w) => selectedWeaponIds.includes(w.id))
      : meleeWeapons;

    if (weaponsToUse.length === 0) return;

    const results: MeleeResult[] = [];

    for (const weapon of weaponsToUse) {
      // Build attack context and apply faction/detachment/order modifiers
      const baseCtx: AttackContext = {
        weapon,
        abilities: (weapon.abilities ?? []).map((a) => parseWeaponAbility(a)).filter(Boolean) as AttackContext['abilities'],
        distanceToTarget: 1,
        targetUnitSize: targetModels.length,
        targetKeywords: targetUnit.keywords,
        attackerStationary: false,
        attackerCharged: gameState.turnTracking.chargedUnits?.includes(fighterUnit.id) ?? false,
        attackerModelCount: activeModels.length,
        targetUnitId: targetUnit.id,
      };
      const { ctx: modifiedCtx } = applyFactionAndDetachmentRules(baseCtx, gameState, fighterUnit);

      const attacksPerModel = parseDiceExpression(weapon.attacks);
      const bonusAttacks = modifiedCtx.bonusAttacks ?? 0;
      const totalAttacks = (attacksPerModel + bonusAttacks) * activeModels.length;

      // Apply skill improvement from orders (Fix Bayonets! WS+1)
      const effectiveSkill = Math.max(2, weapon.skill - (modifiedCtx.skillImprovement ?? 0));

      const hitRoll = rollDice(totalAttacks, 6, 'To Hit', effectiveSkill);
      const hits = hitRoll.dice.filter((d) => (d === 1 ? false : d >= effectiveSkill || d === 6)).length;

      const woundThreshold = getWoundThreshold(weapon.strength, firstTarget.stats.toughness);
      const woundRoll = hits > 0 ? rollDice(hits, 6, 'To Wound', woundThreshold) : rollDice(0, 6, 'To Wound', woundThreshold);
      const wounds = woundRoll.dice.filter((d) => (d === 1 ? false : d >= woundThreshold || d === 6)).length;

      dispatch({
        type: 'RESOLVE_MELEE_ATTACK',
        payload: {
          attackingUnitId: fighterUnit.id,
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

      const saveResults: MeleeResult['saveResults'] = [];
      let totalDamage = 0;
      let currentTargetIdx = 0;

      for (let i = 0; i < wounds; i++) {
        const target = targetModels[currentTargetIdx];
        if (!target) break;

        // Apply Take Cover! save bonus (+1 SV, max 3+)
        const targetUnitForSave = gameState.units[target.unitId];
        const orderSaveBonus = targetUnitForSave ? getOrderSaveModifier(gameState, targetUnitForSave) : 0;
        let baseSave = target.stats.save;
        if (orderSaveBonus > 0) {
          baseSave = Math.max(3, baseSave - orderSaveBonus);
        }
        const modifiedSave = baseSave + Math.abs(weapon.ap);
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
            payload: { targetModelId: target.id, saveRoll, saved: false, damageToApply: dmg },
          });
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
    setFightStep('results');
  };

  const handleConsolidate = () => {
    if (!fighterUnit) return;
    const activeModels = fighterUnit.modelIds
      .map((id) => gameState.models[id])
      .filter((m) => m && m.status === 'active');
    const positions: Record<string, { x: number; y: number }> = {};
    for (const model of activeModels) {
      positions[model.id] = model.position;
    }
    dispatch({ type: 'CONSOLIDATE', payload: { unitId: fighterUnit.id, positions } });
    handleCompleteFight();
  };

  const handleSkipConsolidate = () => {
    handleCompleteFight();
  };

  const handleCompleteFight = () => {
    if (!fighterUnit) return;
    dispatch({ type: 'COMPLETE_FIGHT', payload: { unitId: fighterUnit.id } });
    setFightStep('select');
    setAttackResults([]);
    setSelectedWeaponIds([]);
    setTargetUnitId(null);
  };

  // Not yet initialized
  if (!isInitialized) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-gray-500">Initialize the fight phase to determine eligible units.</div>
        <button
          onClick={handleInitialize}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
        >
          Initialize Fight Phase
        </button>
      </div>
    );
  }

  // All fights complete
  if (fightState.eligibleUnits.length === 0 && !currentFighter) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-400">All combats resolved</div>
        <div className="text-xs text-gray-500">
          {fightState.unitsFought.length} unit{fightState.unitsFought.length !== 1 ? 's' : ''} fought this phase
        </div>
      </div>
    );
  }

  // A unit is currently fighting
  if (currentFighter && fighterUnit) {
    const meleeWeapons = fighterUnit.weapons.filter((w) => w.type === 'melee');
    const enemyUnits = Object.values(gameState.units).filter(
      (u) => u.playerId !== fighterUnit.playerId && u.modelIds.some((id) => gameState.models[id]?.status === 'active'),
    );

    // Pile In step
    if (fightStep === 'pile_in') {
      return (
        <div className="space-y-2">
          <div className="text-xs text-gray-400">
            <span className="font-medium text-white">{fighterUnit.name}</span> — Pile In (up to 3")
          </div>
          <div className="text-xs text-gray-500">Drag models closer to the nearest enemy, then confirm.</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handlePileIn}
              className="px-3 py-2 rounded text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              Confirm Pile In
            </button>
            <button
              onClick={handleSkipPileIn}
              className="px-3 py-2 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Skip Pile In
            </button>
          </div>
        </div>
      );
    }

    // Attack step
    if (fightStep === 'attack') {
      return (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">
            <span className="font-medium text-white">{fighterUnit.name}</span> — Melee Attacks
          </div>

          {meleeWeapons.length === 0 ? (
            <div className="text-xs text-gray-500 italic">No melee weapons</div>
          ) : (
            <>
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Melee Weapons</div>
                <div className="space-y-1">
                  {meleeWeapons.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => toggleWeapon(w.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        selectedWeaponIds.includes(w.id)
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <div className="font-medium">{w.name}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">
                        A{typeof w.attacks === 'number' ? w.attacks : w.attacks} | WS{w.skill}+ | S{w.strength} | AP{w.ap} | D{typeof w.damage === 'number' ? w.damage : w.damage}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Target</div>
                <select
                  value={targetUnitId ?? ''}
                  onChange={(e) => setTargetUnitId(e.target.value || null)}
                  className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs border border-gray-600 focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select target...</option>
                  {enemyUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleResolveAttack}
                disabled={!targetUnitId}
                className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Roll Melee Attacks
              </button>
            </>
          )}

          <button
            onClick={() => setFightStep('consolidate')}
            className="w-full px-3 py-1.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Skip to Consolidate
          </button>
        </div>
      );
    }

    // Results step
    if (fightStep === 'results') {
      const totalDmg = attackResults.reduce((sum, r) => sum + r.totalDamage, 0);
      return (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">
            <span className="font-medium text-white">{fighterUnit.name}</span> — melee results
          </div>

          {attackResults.map((result, idx) => (
            <div key={idx} className="border border-gray-700 rounded p-2 space-y-1.5">
              <div className="text-xs font-medium text-white">{result.weaponName}</div>
              <div>
                <div className="text-[10px] text-gray-500">To Hit ({result.hitRoll.threshold}+): {result.hits}/{result.numAttacks}</div>
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {result.hitRoll.dice.map((d, j) => (
                    <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                      d === 6 ? 'bg-yellow-500 text-black' : d >= (result.hitRoll.threshold ?? 4) ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                    }`}>{d}</span>
                  ))}
                </div>
              </div>
              {result.hits > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500">To Wound ({result.woundThreshold}+): {result.wounds}/{result.hits}</div>
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {result.woundRoll.dice.map((d, j) => (
                      <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                        d === 6 ? 'bg-yellow-500 text-black' : d >= result.woundThreshold ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                      }`}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.saveResults.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500">
                    Saves: {result.saveResults.filter((s) => s.saved).length} saved, {result.saveResults.filter((s) => !s.saved).length} failed
                  </div>
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {result.saveResults.map((s, j) => (
                      <span key={j} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                        s.saved ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                      }`}>{s.roll.dice[0]}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-xs font-medium text-purple-400">{result.totalDamage} damage</div>
            </div>
          ))}

          <div className="border-t border-gray-600 pt-2 text-sm font-bold text-purple-400">
            Total: {totalDmg} damage
          </div>

          <button
            onClick={() => setFightStep('consolidate')}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            Consolidate
          </button>
        </div>
      );
    }

    // Consolidate step
    if (fightStep === 'consolidate') {
      return (
        <div className="space-y-2">
          <div className="text-xs text-gray-400">
            <span className="font-medium text-white">{fighterUnit.name}</span> — Consolidate (up to 3")
          </div>
          <div className="text-xs text-gray-500">Drag models closer to nearest enemy, then confirm.</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleConsolidate}
              className="px-3 py-2 rounded text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              Confirm Consolidate
            </button>
            <button
              onClick={handleSkipConsolidate}
              className="px-3 py-2 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      );
    }
  }

  // Unit selection — show eligible units
  const selector = fightState.nextToSelect;
  const selectorPlayer = selector ? gameState.players[selector] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs text-gray-400">
          {fightState.fightStep === 'fights_first' ? (
            <span className="text-yellow-400 font-medium">Fights First</span>
          ) : (
            <span className="text-purple-400 font-medium">Remaining Combats</span>
          )}
        </div>
      </div>

      {selectorPlayer && (
        <div className="text-xs text-gray-400 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectorPlayer.color }} />
          {selectorPlayer.name}'s turn to select
        </div>
      )}

      <div className="text-[10px] text-gray-500 uppercase tracking-wider">Eligible units</div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {fightState.eligibleUnits.map((unitId) => {
          const u = gameState.units[unitId];
          if (!u) return null;
          const player = gameState.players[u.playerId];
          return (
            <button
              key={unitId}
              onClick={() => handleSelectFighter(unitId)}
              className="w-full text-left px-2 py-1.5 rounded text-xs bg-gray-700/60 text-gray-300 hover:bg-purple-600 hover:text-white transition-colors flex items-center gap-1.5"
            >
              {player && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: player.color }} />}
              <span className="font-medium">{u.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
