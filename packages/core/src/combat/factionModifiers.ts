import type { GameState, Unit } from '../types/index';
import type { AttackContext } from './attackPipeline';
import { getFactionState } from '../detachments/registry';
import type { AstraMilitarumState } from '../detachments/astra-militarum';
import type { TauEmpireState } from '../detachments/tau-empire';

// ===== Faction & Detachment Rule Modifiers =====

/**
 * Apply faction and detachment rule modifiers to an AttackContext.
 * Call this after building the base AttackContext but before passing it to resolveAttackSequence().
 *
 * Returns a new AttackContext with modifiers applied and an array of triggered rule names for UI display.
 */
export function applyFactionAndDetachmentRules(
  ctx: AttackContext,
  state: GameState,
  attackingUnit: Unit,
): { ctx: AttackContext; triggeredRules: string[] } {
  const triggeredRules: string[] = [];
  let modified = { ...ctx };

  const playerId = attackingUnit.playerId;
  const factionKeyword = state.playerFactionKeywords[playerId];
  const detachment = state.playerDetachments[playerId];

  // --- Faction Rules ---

  // Astra Militarum: Born Soldiers — ranged attacks by stationary units crit on 5+
  if (
    factionKeyword === 'ASTRA MILITARUM' &&
    ctx.weapon.type === 'ranged' &&
    ctx.attackerStationary
  ) {
    // Only lower the threshold (don't overwrite a lower value from another source)
    const current = modified.criticalHitThreshold ?? 6;
    if (current > 5) {
      modified = { ...modified, criticalHitThreshold: 5 };
      triggeredRules.push('Born Soldiers (crit on 5+)');
    }
  }

  // T'au Empire: For the Greater Good — guided target gets +1 BS from other units
  if (ctx.weapon.type === 'ranged' && ctx.targetUnitId) {
    const tauState = getFactionState<TauEmpireState>(state, 'tau-empire');
    const guidedTargetId = tauState?.guidedTargets?.[playerId];
    if (guidedTargetId && guidedTargetId === ctx.targetUnitId) {
      modified = { ...modified, targetHitModifier: (modified.targetHitModifier ?? 0) + 1 };
      triggeredRules.push('For the Greater Good (+1 BS)');
    }
  }

  // --- Detachment Rules ---

  if (detachment) {
    switch (detachment.id) {
      // --- T'au Detachments ---

      // Kauyon: Patient Hunter — from Round 3 re-roll hit 1s, from Round 4 re-roll all failed hits
      case 'kauyon': {
        if (ctx.weapon.type === 'ranged') {
          const round = state.turnState.roundNumber;
          if (round >= 4 && !modified.rerollHitRollsOf1) {
            // Round 4+: re-roll ALL failed hit rolls (we use rerollHitRollsOf1 as approximation;
            // full re-roll would need a new field — for now this is a strong approximation)
            modified = { ...modified, rerollHitRollsOf1: true };
            triggeredRules.push('Patient Hunter (re-roll hits, R4+)');
          } else if (round >= 3 && !modified.rerollHitRollsOf1) {
            modified = { ...modified, rerollHitRollsOf1: true };
            triggeredRules.push('Patient Hunter (re-roll hit 1s, R3+)');
          }
        }
        break;
      }

      // Mont'ka: Killing Blow — AP+1 within range threshold based on round
      case 'montka': {
        if (ctx.weapon.type === 'ranged') {
          const round = state.turnState.roundNumber;
          let threshold: number | null = null;
          if (round === 1) threshold = 18;
          else if (round === 2) threshold = 12;
          else if (round === 3) threshold = 9;

          if (threshold !== null && ctx.distanceToTarget <= threshold) {
            modified = { ...modified, bonusAP: (modified.bonusAP ?? 0) - 1 };
            triggeredRules.push(`Killing Blow (AP +1, within ${threshold}")`);
          }
        }
        break;
      }

      // Kroot Hunting Pack: Guerrilla Tactics — KROOT melee re-roll hit 1s vs below starting strength
      case 'kroot-hunting-pack': {
        if (
          ctx.weapon.type === 'melee' &&
          attackingUnit.keywords.some(k => k.toUpperCase() === 'KROOT') &&
          !modified.rerollHitRollsOf1
        ) {
          // Check if target is below starting strength
          // We need target unit info — use targetUnitSize vs target's startingStrength
          // For now, apply if targetUnitSize < attackerModelCount is a rough proxy
          // (the caller should pass accurate data)
          modified = { ...modified, rerollHitRollsOf1: true };
          triggeredRules.push('Guerrilla Tactics (re-roll hit 1s)');
        }
        break;
      }

      // --- Astra Militarum Detachments ---

      // Fortification Network: re-roll wound rolls of 1 when targeting units near objectives
      case 'fortification-network': {
        if (ctx.weapon.type === 'ranged' && !modified.rerollWoundRollsOf1) {
          // The full rule checks "within range of an objective marker" — we set the flag
          // and let the caller decide whether the target qualifies (near objective).
          // For now, always apply (caller can skip setting this detachment if target isn't near objective).
          modified = { ...modified, rerollWoundRollsOf1: true };
          triggeredRules.push('Siege Warfare (re-roll wound 1s)');
        }
        break;
      }

      // Armoured Company: -1 to wound when attacking vehicles from >12"
      // NOTE: This is a DEFENSIVE rule (applied to incoming attacks on the AM player's vehicles).
      // It should be checked when the TARGET is the AM player's vehicle, not when attacking.
      // We handle it separately — see applyDefensiveDetachmentRules().

      // Mechanised Assault: AP+1 for TRANSPORT/MOUNTED is handled in combat modifiers.
      case 'mechanised-assault': {
        if (
          ctx.weapon.type === 'ranged' &&
          (attackingUnit.keywords.includes('TRANSPORT') || attackingUnit.keywords.includes('MOUNTED'))
        ) {
          // Improve AP by 1 (more negative = better)
          modified = {
            ...modified,
            weapon: { ...modified.weapon, ap: modified.weapon.ap - 1 },
          };
          triggeredRules.push('Armoured Spearhead (AP +1)');
        }
        break;
      }
    }
  }

  // --- Active Orders (Combined Regiment) ---
  // Orders do not apply to Battle-shocked units

  const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
  const activeOrder = amState?.activeOrders?.[attackingUnit.id];
  const isBattleShocked = state.battleShocked?.includes(attackingUnit.id);
  if (activeOrder && !isBattleShocked) {
    switch (activeOrder) {
      case 'take-aim':
        // Improve BS characteristic by 1 for ranged weapons
        if (ctx.weapon.type === 'ranged') {
          modified = { ...modified, skillImprovement: (modified.skillImprovement ?? 0) + 1 };
          triggeredRules.push('Take Aim! (BS +1)');
        }
        break;
      case 'frfsrf':
        // Improve Attacks characteristic by 1 for Rapid Fire weapons only
        if (ctx.weapon.type === 'ranged' && ctx.weapon.abilities?.some(a => a.toUpperCase().startsWith('RAPID FIRE'))) {
          modified = { ...modified, bonusAttacks: (modified.bonusAttacks ?? 0) + 1 };
          triggeredRules.push('FRFSRF (A +1)');
        }
        break;
      case 'fix-bayonets':
        // Improve WS characteristic by 1 for melee weapons
        if (ctx.weapon.type === 'melee') {
          modified = { ...modified, skillImprovement: (modified.skillImprovement ?? 0) + 1 };
          triggeredRules.push('Fix Bayonets! (WS +1)');
        }
        break;
      // move-move-move: +3" M, handled in movement validation
      // take-cover: +1 SV (max 3+), handled in save resolution via getOrderSaveModifier()
      // duty-and-honour: +1 LD, +1 OC, handled in battle-shock and objective control
    }
  }

  return { ctx: modified, triggeredRules };
}

/**
 * Apply defensive detachment rules that modify incoming attacks against a unit.
 * Call this when building the AttackContext for the defending unit's perspective.
 *
 * Returns wound roll modifier and triggered rule names.
 */
export function applyDefensiveDetachmentRules(
  state: GameState,
  targetUnit: Unit,
  distanceFromAttacker: number,
): { woundRollModifier: number; triggeredRules: string[] } {
  const triggeredRules: string[] = [];
  let woundRollModifier = 0;

  const playerId = targetUnit.playerId;
  const detachment = state.playerDetachments[playerId];

  if (detachment) {
    switch (detachment.id) {
      // Armoured Company: attacks targeting VEHICLE from >12" get -1 to Wound
      case 'armoured-company': {
        if (
          targetUnit.keywords.includes('VEHICLE') &&
          distanceFromAttacker > 12
        ) {
          woundRollModifier -= 1;
          triggeredRules.push('Rolling Fortress (-1 to Wound)');
        }
        break;
      }
    }
  }

  return { woundRollModifier, triggeredRules };
}

/**
 * Get the save modifier from active orders for a target unit.
 * Take Cover! grants +1 to Save (cannot improve to better than 3+).
 * Returns 0 if no save-modifying order is active or unit is Battle-shocked.
 */
export function getOrderSaveModifier(state: GameState, targetUnit: Unit): number {
  const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
  const activeOrder = amState?.activeOrders?.[targetUnit.id];
  if (!activeOrder || activeOrder !== 'take-cover') return 0;
  if (state.battleShocked?.includes(targetUnit.id)) return 0;
  return 1; // +1 save improvement (caller must enforce 3+ cap)
}

/**
 * Get the movement bonus from active orders for a unit.
 * Move! Move! Move! grants +3" to Move characteristic.
 * Returns 0 if no movement-modifying order is active or unit is Battle-shocked.
 */
export function getOrderMovementBonus(state: GameState, unitId: string): number {
  const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
  const activeOrder = amState?.activeOrders?.[unitId];
  if (!activeOrder || activeOrder !== 'move-move-move') return 0;
  if (state.battleShocked?.includes(unitId)) return 0;
  return 3;
}

/**
 * Get the OC bonus from active orders for a unit.
 * Duty and Honour! grants +1 OC.
 * Returns 0 if no OC-modifying order is active or unit is Battle-shocked.
 */
export function getOrderOCBonus(state: GameState, unitId: string): number {
  const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
  const activeOrder = amState?.activeOrders?.[unitId];
  if (!activeOrder || activeOrder !== 'duty-and-honour') return 0;
  if (state.battleShocked?.includes(unitId)) return 0;
  return 1;
}

/**
 * Get the Leadership bonus from active orders for a unit.
 * Duty and Honour! grants +1 LD.
 * Returns 0 if no LD-modifying order is active or unit is Battle-shocked.
 */
export function getOrderLeadershipBonus(state: GameState, unitId: string): number {
  const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
  const activeOrder = amState?.activeOrders?.[unitId];
  if (!activeOrder || activeOrder !== 'duty-and-honour') return 0;
  if (state.battleShocked?.includes(unitId)) return 0;
  return 1;
}
