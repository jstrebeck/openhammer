import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import {
  rollDice,
  getWoundThreshold,
  parseDiceExpression,
  checkUnitVisibility,
  COMBINED_REGIMENT_ORDERS,
  getFactionState,
  applyFactionAndDetachmentRules,
  parseWeaponAbility,
} from '@openhammer/core';
import type { AttackContext } from '@openhammer/core/src/combat/attackPipeline';
import type { Weapon, DiceRoll, VisibilityStatus } from '@openhammer/core';
import type { AstraMilitarumState } from '@openhammer/core/src/detachments/astra-militarum';
import type { TauEmpireState } from '@openhammer/core/src/detachments/tau-empire';
import { SaveRollPanel } from './SaveRollPanel';

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
}

export function ShootingPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);

  const [targetUnitId, setTargetUnitId] = useState<string | null>(null);
  const [selectedWeaponIds, setSelectedWeaponIds] = useState<string[]>([]);
  const [attackResults, setAttackResults] = useState<AttackResult[]>([]);
  const [step, setStep] = useState<'select' | 'results' | 'guided'>('select');

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

      // Build attack context and apply faction/detachment/order modifiers
      const baseCtx: AttackContext = {
        weapon,
        abilities: (weapon.abilities ?? []).map((a) => parseWeaponAbility(a)).filter(Boolean) as AttackContext['abilities'],
        distanceToTarget: 12,
        targetUnitSize: targetModels.length,
        targetKeywords: targetUnit.keywords,
        attackerStationary: !gameState.turnTracking.unitMovement[attackerUnit.id] || gameState.turnTracking.unitMovement[attackerUnit.id] === 'stationary',
        attackerCharged: false,
        attackerModelCount: activeModels.length,
        targetUnitId: targetUnit.id,
      };
      const { ctx: modifiedCtx } = applyFactionAndDetachmentRules(baseCtx, gameState, attackerUnit);

      // Calculate attacks (with bonus attacks from orders like FRFSRF)
      const attacksPerModel = parseDiceExpression(weapon.attacks);
      const bonusAttacks = modifiedCtx.bonusAttacks ?? 0;
      const totalAttacks = (attacksPerModel + bonusAttacks) * activeModels.length;

      // Apply skill improvement from orders (Take Aim! BS+1)
      const effectiveSkill = Math.max(2, weapon.skill - (modifiedCtx.skillImprovement ?? 0));

      // Hit roll
      const hitRoll = rollDice(totalAttacks, 6, 'To Hit', effectiveSkill);
      const hits = hitRoll.dice.filter((d) => (d === 1 ? false : d >= effectiveSkill || d === 6)).length;

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

      results.push({
        weaponName: weapon.name,
        numAttacks: totalAttacks,
        hitRoll,
        hits,
        woundThreshold,
        woundRoll,
        wounds,
      });
    }

    setAttackResults(results);
    setStep('results');
  };

  // Check if active player is T'au (for guided target prompt)
  const activePlayerId = gameState.turnState.activePlayerId;
  const isTauPlayer = (gameState.playerFactionKeywords[activePlayerId] ?? '').toUpperCase() === "T'AU EMPIRE";

  const handleComplete = () => {
    if (!attackerUnit) return;
    dispatch({ type: 'COMPLETE_SHOOTING', payload: { unitId: attackerUnit.id } });
    setStep('select');
    setAttackResults([]);
    setSelectedWeaponIds([]);
    setTargetUnitId(null);
  };

  const handleCompleteWithGuidedCheck = () => {
    if (!attackerUnit) return;
    // If T'au player and we have a target, offer guided target designation
    if (isTauPlayer && targetUnitId) {
      setStep('guided');
    } else {
      handleComplete();
    }
  };

  const handleDesignateGuided = () => {
    if (targetUnitId) {
      dispatch({ type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId } });
    }
    handleComplete();
  };

  const handleSkipGuided = () => {
    handleComplete();
  };

  const handleSkip = () => {
    if (!attackerUnit) return;
    dispatch({ type: 'COMPLETE_SHOOTING', payload: { unitId: attackerUnit.id } });
  };

  // Active order indicator for the selected unit
  const amState = getFactionState<AstraMilitarumState>(gameState, 'astra-militarum');
  const unitOrder = attackerUnit ? amState?.activeOrders?.[attackerUnit.id] : undefined;
  const unitOrderDef = unitOrder
    ? COMBINED_REGIMENT_ORDERS.find((o) => o.id === unitOrder)
    : undefined;

  // Compute shooting state flags
  const moveType = attackerUnit ? gameState.turnTracking.unitMovement[attackerUnit.id] : undefined;
  const cantShoot = moveType === 'advance' || moveType === 'fall_back';

  // Current guided target indicator
  const tauState = getFactionState<TauEmpireState>(gameState, 'tau-empire');
  const guidedTargetId = tauState?.guidedTargets?.[activePlayerId];
  const guidedTargetUnit = guidedTargetId ? gameState.units[guidedTargetId] : null;

  return (
    <div>
      {/* Guided target indicator for T'au players */}
      {isTauPlayer && (
        <div className="mb-3 pb-3 border-b border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-medium">For the Greater Good</div>
          </div>
          {guidedTargetUnit ? (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-cyan-900/20 border border-cyan-600/30 rounded text-[10px]">
              <span className="text-cyan-300">Guided:</span>
              <span className="text-white font-medium">{guidedTargetUnit.name}</span>
              <span className="text-cyan-400 ml-auto">+1 BS</span>
            </div>
          ) : (
            <div className="text-[10px] text-gray-500 italic">No guided target — shoot a unit, then designate it</div>
          )}
        </div>
      )}
      <ShootingFlow
        attackerUnit={attackerUnit}
        rangedWeapons={rangedWeapons}
        hasShot={hasShot}
        cantShoot={cantShoot}
        moveType={moveType}
        activeShootingUnit={activeShootingUnit}
        unitOrderDef={unitOrderDef}
        handleDeclare={handleDeclare}
        handleSkip={handleSkip}
        handleResolve={handleResolve}
        handleComplete={handleCompleteWithGuidedCheck}
        handleDesignateGuided={handleDesignateGuided}
        handleSkipGuided={handleSkipGuided}
        toggleWeapon={toggleWeapon}
        selectedWeaponIds={selectedWeaponIds}
        targetUnitId={targetUnitId}
        setTargetUnitId={setTargetUnitId}
        step={step}
        attackResults={attackResults}
        gameState={gameState}
        dispatch={dispatch}
        enemyUnits={enemyUnits}
      />
    </div>
  );
}

// Extracted shooting flow component
function ShootingFlow({
  attackerUnit,
  rangedWeapons,
  hasShot,
  cantShoot,
  moveType,
  activeShootingUnit,
  unitOrderDef,
  handleDeclare,
  handleSkip,
  handleResolve,
  handleComplete,
  handleDesignateGuided,
  handleSkipGuided,
  toggleWeapon,
  selectedWeaponIds,
  targetUnitId,
  setTargetUnitId,
  step,
  attackResults,
  gameState,
  dispatch,
  enemyUnits,
}: {
  attackerUnit: import('@openhammer/core').Unit | null;
  rangedWeapons: Weapon[];
  hasShot: boolean;
  cantShoot: boolean;
  moveType: string | undefined;
  activeShootingUnit: string | null;
  unitOrderDef: { id: string; name: string; description: string } | undefined;
  handleDeclare: () => void;
  handleSkip: () => void;
  handleResolve: () => void;
  handleComplete: () => void;
  handleDesignateGuided: () => void;
  handleSkipGuided: () => void;
  toggleWeapon: (wId: string) => void;
  selectedWeaponIds: string[];
  targetUnitId: string | null;
  setTargetUnitId: (id: string | null) => void;
  step: 'select' | 'results' | 'guided';
  attackResults: AttackResult[];
  gameState: import('@openhammer/core').GameState;
  dispatch: (action: import('@openhammer/core').GameAction) => void;
  enemyUnits: Array<import('@openhammer/core').Unit & { visibility: import('@openhammer/core').VisibilityStatus }>;
}) {
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
          {unitOrderDef && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-yellow-700/40 text-yellow-300 text-[9px] font-medium">{unitOrderDef.name}</span>
          )}
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
          </div>
        ))}

        {/* Pending Save Rolls */}
        {gameState.shootingState.pendingSaves.map(ps => (
          <SaveRollPanel key={ps.id} pendingSave={ps} />
        ))}

        <button
          onClick={handleComplete}
          className="w-full px-3 py-2 rounded text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // Step: guided target designation (T'au For the Greater Good)
  if (step === 'guided' && targetUnitId) {
    const guidedTarget = gameState.units[targetUnitId];
    const currentGuidedTauState = getFactionState<TauEmpireState>(gameState, 'tau-empire');
    const currentGuided = currentGuidedTauState?.guidedTargets?.[gameState.turnState.activePlayerId];
    const currentGuidedUnit = currentGuided ? gameState.units[currentGuided] : null;
    return (
      <div className="space-y-3">
        <div className="text-xs text-gray-400">
          <span className="font-medium text-white">{attackerUnit.name}</span> — shooting complete
        </div>

        <div className="bg-cyan-900/20 border border-cyan-600/40 rounded p-3 space-y-2">
          <div className="text-xs text-cyan-300 font-medium">For the Greater Good</div>
          <div className="text-[10px] text-gray-400">
            Designate <span className="text-white font-medium">{guidedTarget?.name ?? 'target'}</span> as guided target?
            Other T'au units shooting this target will get +1 BS.
          </div>
          {currentGuidedUnit && currentGuided !== targetUnitId && (
            <div className="text-[10px] text-yellow-400">
              This will replace current guided target: {currentGuidedUnit.name}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleDesignateGuided}
            className="flex-1 px-3 py-2 rounded text-sm font-medium bg-cyan-600 hover:bg-cyan-700 text-white transition-colors"
          >
            Designate
          </button>
          <button
            onClick={handleSkipGuided}
            className="flex-1 px-3 py-2 rounded text-sm font-medium bg-gray-600 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Step: select weapons and targets
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400">
        <span className="font-medium text-white">{attackerUnit.name}</span> — select weapons and target
        {unitOrderDef && (
          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-yellow-700/40 text-yellow-300 text-[9px] font-medium">{unitOrderDef.name}</span>
        )}
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
            const guidedTauState = getFactionState<TauEmpireState>(gameState, 'tau-empire');
            const isGuided = guidedTauState ? Object.values(guidedTauState.guidedTargets).includes(u.id) : false;
            return (
              <option
                key={u.id}
                value={u.id}
                disabled={notVisible}
                className={notVisible ? 'text-gray-600' : ''}
              >
                {u.name} ({alive} model{alive !== 1 ? 's' : ''})
                {isGuided ? ' ★ Guided (+1 BS)' : ''}
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
