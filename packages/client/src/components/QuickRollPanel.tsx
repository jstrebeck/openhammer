import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { rollDice, countSuccesses } from '@openhammer/core';
import type { Weapon, Unit, DiceRoll } from '@openhammer/core';

interface RollStep {
  label: string;
  roll: DiceRoll;
  successes: number;
}

export function QuickRollPanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const selectedModelIds = useUIStore((s) => s.selectedModelIds);
  const [targetUnitId, setTargetUnitId] = useState<string | null>(null);
  const [selectedWeaponId, setSelectedWeaponId] = useState<string | null>(null);
  const [steps, setSteps] = useState<RollStep[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Find the selected unit
  const firstSelectedModel = selectedModelIds.length > 0 ? gameState.models[selectedModelIds[0]] : null;
  const attackerUnit = firstSelectedModel?.unitId ? gameState.units[firstSelectedModel.unitId] : null;

  // Get available target units (enemy units — different player)
  const allUnits = Object.values(gameState.units);
  const enemyUnits = attackerUnit
    ? allUnits.filter((u) => u.playerId !== attackerUnit.playerId)
    : [];

  const selectedWeapon = attackerUnit?.weapons.find((w) => w.id === selectedWeaponId) ?? null;
  const targetUnit = targetUnitId ? gameState.units[targetUnitId] : null;
  const targetModel = targetUnit?.modelIds[0] ? gameState.models[targetUnit.modelIds[0]] : null;

  const handleQuickRoll = () => {
    if (!attackerUnit || !selectedWeapon || !targetModel) return;

    const numAttackingModels = attackerUnit.modelIds.filter(
      (id) => gameState.models[id]?.status === 'active',
    ).length;

    const attacks = typeof selectedWeapon.attacks === 'number'
      ? selectedWeapon.attacks * numAttackingModels
      : numAttackingModels; // fallback for dice expressions

    const newSteps: RollStep[] = [];

    // Step 1: To Hit
    const hitRoll = rollDice(attacks, 6, 'To Hit', selectedWeapon.skill);
    dispatch({ type: 'ROLL_DICE', payload: { roll: hitRoll } });
    const hits = countSuccesses(hitRoll);
    newSteps.push({ label: `To Hit (${selectedWeapon.skill}+)`, roll: hitRoll, successes: hits });

    if (hits === 0) {
      setSteps(newSteps);
      return;
    }

    // Step 2: To Wound
    const woundThreshold = calcWoundThreshold(selectedWeapon.strength, targetModel.stats.toughness);
    const woundRoll = rollDice(hits, 6, 'To Wound', woundThreshold);
    dispatch({ type: 'ROLL_DICE', payload: { roll: woundRoll } });
    const wounds = countSuccesses(woundRoll);
    newSteps.push({ label: `To Wound (${woundThreshold}+)`, roll: woundRoll, successes: wounds });

    if (wounds === 0) {
      setSteps(newSteps);
      return;
    }

    // Step 3: Save
    const modifiedSave = targetModel.stats.save + Math.abs(selectedWeapon.ap);
    const saveThreshold = Math.min(7, modifiedSave); // 7+ = auto-fail
    const saveRoll = rollDice(wounds, 6, 'Save', saveThreshold);
    dispatch({ type: 'ROLL_DICE', payload: { roll: saveRoll } });
    const saves = countSuccesses(saveRoll);
    const unsaved = wounds - saves;
    newSteps.push({ label: `Save (${saveThreshold}+)`, roll: saveRoll, successes: saves });

    // Summary
    if (unsaved > 0) {
      const dmg = typeof selectedWeapon.damage === 'number' ? selectedWeapon.damage : 1;
      newSteps.push({
        label: `${unsaved} unsaved × ${dmg}D = ${unsaved * dmg} damage`,
        roll: { id: '', dice: [], sides: 6, purpose: 'Damage', timestamp: Date.now() },
        successes: unsaved * dmg,
      });
    }

    setSteps(newSteps);
  };

  if (!attackerUnit || attackerUnit.weapons.length === 0) return null;

  return (
    <div className="absolute bottom-16 left-[528px] w-72">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 transition-colors text-left"
      >
        Quick Roll {expanded ? '▾' : '▸'}
      </button>

      {expanded && (
        <div className="mt-1 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 shadow-lg p-3 space-y-3">
          <div className="text-xs text-gray-400">Attacker: {attackerUnit.name}</div>

          {/* Weapon select */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase mb-1">Weapon</div>
            <div className="flex flex-wrap gap-1">
              {attackerUnit.weapons.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWeaponId(w.id)}
                  className={`px-2 py-0.5 rounded text-xs ${
                    selectedWeaponId === w.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          {/* Target select */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase mb-1">Target</div>
            <select
              value={targetUnitId ?? ''}
              onChange={(e) => setTargetUnitId(e.target.value || null)}
              className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600 focus:outline-none"
            >
              <option value="">Select target...</option>
              {enemyUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Roll button */}
          <button
            onClick={handleQuickRoll}
            disabled={!selectedWeapon || !targetUnit}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Roll Attack Sequence
          </button>

          {/* Results */}
          {steps.length > 0 && (
            <div className="border-t border-gray-700 pt-2 space-y-2">
              {steps.map((step, i) => (
                <div key={i}>
                  <div className="text-xs text-gray-400 mb-1">{step.label}</div>
                  {step.roll.dice.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {step.roll.dice.map((d, j) => {
                        const pass = step.roll.threshold != null && d >= step.roll.threshold;
                        return (
                          <span
                            key={j}
                            className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                              pass ? 'bg-green-600 text-white' : 'bg-red-900/60 text-red-300'
                            }`}
                          >
                            {d}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="text-xs text-green-400 mt-0.5">{step.successes} success{step.successes !== 1 ? 'es' : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Calculate wound threshold based on S vs T (10th edition rules) */
function calcWoundThreshold(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}
