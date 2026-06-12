import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gameReducer } from '../state/reducer';
import { createInitialGameState } from '../state/initialState';
import { buildArmyUnits, detectFactionFromRoster } from '../army-list/importer';
import { getFaction } from '../detachments/registry';
import { MISSION_TAKE_AND_HOLD } from '../missions/index';
import {
  applyFactionAndDetachmentRules,
  applyDefensiveDetachmentRules,
} from '../combat/factionModifiers';
import { calculateAttacks, resolveAttackSequence, parseDiceExpression } from '../combat/attackPipeline';
import type { AttackContext } from '../combat/attackPipeline';
import { parseWeaponAbility } from '../combat/abilities';
import type { ParsedAbility } from '../combat/abilities';
import { resolveSave } from '../combat/saves';
import { getWoundAllocationTarget } from '../combat/woundAllocation';
import { rollDice } from '../dice/index';
import { distanceBetweenModels } from '../measurement/index';
import type { BattlescribeRoster } from '../army-list/schema';
import type { GameState, Unit, Model, PendingSaveResult } from '../types/index';
import type { Point } from '../types/geometry';
import '../editions/index';
import '../detachments/index';

/**
 * Full-game integration test: a complete game of 10th Edition between the
 * sample T'au Empire and Astra Militarum armies, driven entirely through the
 * reducer — setup, detachments, mission, alternating deployment, five battle
 * rounds of command/movement/shooting/charge/fight, scoring, and end of battle.
 *
 * Dice are random, so assertions target mechanics (legal flow, saves resolved,
 * scoring occurred, game completes) rather than specific outcomes.
 */

const TAU_PATH = fileURLToPath(new URL('../../../../samples/tau-empire-1000.json', import.meta.url));
const AM_PATH = fileURLToPath(new URL('../../../../samples/astra-militarum-1000.json', import.meta.url));

const TAU = 'p-tau';
const AM = 'p-am';

function loadRoster(path: string): BattlescribeRoster {
  return JSON.parse(readFileSync(path, 'utf-8')) as BattlescribeRoster;
}

function activeModels(state: GameState, unit: Unit): Model[] {
  return unit.modelIds
    .map((id) => state.models[id])
    .filter((m): m is Model => !!m && m.status === 'active');
}

function playerUnits(state: GameState, playerId: string): Unit[] {
  return Object.values(state.units).filter(
    (u) => u.playerId === playerId && activeModels(state, u).length > 0,
  );
}

/** Lay a unit's models out in a grid around a center point. */
function gridPositions(state: GameState, unit: Unit, center: Point, spacing = 1.4): Record<string, Point> {
  const models = activeModels(state, unit);
  const perRow = Math.min(5, models.length);
  const positions: Record<string, Point> = {};
  models.forEach((m, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    positions[m.id] = {
      x: center.x + (col - (perRow - 1) / 2) * spacing,
      y: center.y + row * spacing,
    };
  });
  return positions;
}

/** Resolve all unresolved pending saves (shooting or fight) as the defender would. */
function resolveAllPendingSaves(state: GameState): GameState {
  let current = state;
  const allSaves = [
    ...current.shootingState.pendingSaves,
    ...current.fightState.pendingSaves,
  ].filter((ps) => !ps.resolved);

  for (const ps of allSaves) {
    const targetUnit = current.units[ps.targetUnitId];
    if (!targetUnit) continue;

    const results: PendingSaveResult[] = [];
    let workingModels = { ...current.models };

    for (let w = 0; w < ps.wounds; w++) {
      const liveUnit = {
        ...targetUnit,
        modelIds: targetUnit.modelIds.filter((id) => workingModels[id]?.status === 'active'),
      };
      const target = getWoundAllocationTarget(liveUnit, workingModels);
      if (!target) break;

      const { saveRoll, saved } = resolveSave(
        target.stats.save,
        ps.ap,
        target.stats.invulnSave,
        ps.coverSaveModifier || ps.bonusInvulnSave
          ? { coverSaveModifier: ps.coverSaveModifier, bonusInvulnSave: ps.bonusInvulnSave }
          : undefined,
      );

      let damageApplied = 0;
      if (!saved) {
        damageApplied = parseDiceExpression(ps.damage);
        const newWounds = Math.max(0, target.wounds - damageApplied);
        workingModels = {
          ...workingModels,
          [target.id]: {
            ...target,
            wounds: newWounds,
            status: newWounds === 0 ? ('destroyed' as const) : ('active' as const),
          },
        };
      }
      results.push({ targetModelId: target.id, saveRoll, saved, damageApplied });
    }

    current = gameReducer(current, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: { pendingSaveId: ps.id, results },
    });
  }
  return current;
}

/** Shoot one weapon from shooter at target through the full ability-aware pipeline. */
function shoot(state: GameState, shooter: Unit, target: Unit): GameState {
  let current = state;
  const shooterModels = activeModels(current, shooter);
  const targetModels = activeModels(current, target);
  if (shooterModels.length === 0 || targetModels.length === 0) return current;

  const distance = Math.min(
    ...shooterModels.flatMap((sm) => targetModels.map((tm) => distanceBetweenModels(sm, tm))),
  );
  const weapon = shooter.weapons.find(
    (w) => w.type === 'ranged' && (w.range ?? 0) >= distance,
  );
  if (!weapon) return current;

  current = gameReducer(current, { type: 'DECLARE_SHOOTING', payload: { unitId: shooter.id } });
  current = gameReducer(current, {
    type: 'ASSIGN_WEAPON_TARGETS',
    payload: {
      assignments: shooterModels.map((m) => ({
        modelId: m.id,
        weaponId: weapon.id,
        targetUnitId: target.id,
      })),
    },
  });

  const moveType = current.turnTracking.unitMovement[shooter.id];
  const { woundRollModifier } = applyDefensiveDetachmentRules(current, target, distance);
  const baseCtx: AttackContext = {
    weapon,
    abilities: (weapon.abilities ?? [])
      .map((a) => parseWeaponAbility(a))
      .filter((a): a is ParsedAbility => !!a),
    distanceToTarget: distance,
    targetUnitSize: targetModels.length,
    targetKeywords: target.keywords,
    attackerStationary: !moveType || moveType === 'stationary',
    attackerCharged: false,
    attackerModelCount: shooterModels.length,
    targetUnitId: target.id,
    woundRollModifier: woundRollModifier !== 0 ? woundRollModifier : undefined,
  };
  const { ctx } = applyFactionAndDetachmentRules(baseCtx, current, shooter);
  const numAttacks = calculateAttacks(ctx);
  const result = resolveAttackSequence(numAttacks, weapon.skill, weapon.strength, targetModels[0].stats.toughness, ctx);

  current = gameReducer(current, {
    type: 'RESOLVE_SHOOTING_ATTACK',
    payload: {
      attackingUnitId: shooter.id,
      attackingModelId: shooterModels[0].id,
      weaponId: weapon.id,
      weaponName: weapon.name,
      targetUnitId: target.id,
      numAttacks: result.numAttacks,
      hitRoll: result.hitRoll,
      hits: result.hits,
      woundRoll: result.woundRoll,
      wounds: result.wounds - result.mortalWounds,
      mortalWounds: result.mortalWounds,
      effectiveDamage: result.effectiveDamage,
      triggeredAbilities: result.triggeredAbilities,
    },
  });

  current = resolveAllPendingSaves(current);
  current = gameReducer(current, { type: 'COMPLETE_SHOOTING', payload: { unitId: shooter.id } });
  return current;
}

/** Find the closest enemy unit that any ranged weapon of `shooter` can reach,
 *  preferring targets not already shot at this phase (spreads casualties). */
function findTargetInRange(
  state: GameState,
  shooter: Unit,
  enemyId: string,
  alreadyTargeted: Set<string>,
): Unit | null {
  const shooterModels = activeModels(state, shooter);
  if (shooterModels.length === 0) return null;
  const maxRange = Math.max(0, ...shooter.weapons.filter((w) => w.type === 'ranged').map((w) => w.range ?? 0));

  let best: { unit: Unit; dist: number } | null = null;
  let bestFresh: { unit: Unit; dist: number } | null = null;
  for (const enemy of playerUnits(state, enemyId)) {
    const enemyModels = activeModels(state, enemy);
    const dist = Math.min(
      ...shooterModels.flatMap((sm) => enemyModels.map((tm) => distanceBetweenModels(sm, tm))),
    );
    if (dist > maxRange) continue;
    if (!best || dist < best.dist) best = { unit: enemy, dist };
    if (!alreadyTargeted.has(enemy.id) && (!bestFresh || dist < bestFresh.dist)) {
      bestFresh = { unit: enemy, dist };
    }
  }
  return bestFresh?.unit ?? best?.unit ?? null;
}

/** Minimum edge-to-edge distance between any two models of opposing players. */
function minArmyGap(state: GameState, pid: string, enemyId: string): number {
  const mine = playerUnits(state, pid).flatMap((u) => activeModels(state, u));
  const theirs = playerUnits(state, enemyId).flatMap((u) => activeModels(state, u));
  if (mine.length === 0 || theirs.length === 0) return Infinity;
  return Math.min(...mine.flatMap((a) => theirs.map((b) => distanceBetweenModels(a, b))));
}

describe('Full game: T\'au Empire vs Astra Militarum', () => {
  it('plays a complete 5-round game through the reducer', () => {
    let state = createInitialGameState();

    // --- Muster ---
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: TAU, name: 'Shas\'O Player', color: '#22d3ee', commandPoints: 0 } },
    });
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: AM, name: 'Lord General', color: '#84cc16', commandPoints: 0 } },
    });

    const tauRoster = loadRoster(TAU_PATH);
    const amRoster = loadRoster(AM_PATH);
    expect(detectFactionFromRoster(tauRoster)).toBe('tau-empire');
    expect(detectFactionFromRoster(amRoster)).toBe('astra-militarum');

    // Import into off-board staging areas
    state = gameReducer(state, {
      type: 'IMPORT_ARMY',
      payload: { units: buildArmyUnits(tauRoster, TAU, { x: -20, y: 2 }, { x: -20, y: 2, width: 15, height: 40 }) },
    });
    state = gameReducer(state, {
      type: 'IMPORT_ARMY',
      payload: { units: buildArmyUnits(amRoster, AM, { x: 65, y: 2 }, { x: 65, y: 2, width: 15, height: 40 }) },
    });

    expect(playerUnits(state, TAU).length).toBeGreaterThanOrEqual(6);
    expect(playerUnits(state, AM).length).toBeGreaterThanOrEqual(5);

    // Faction keywords + detachments: Mont'ka for T'au, Combined Regiment for AM
    state = gameReducer(state, { type: 'SET_FACTION_KEYWORD', payload: { playerId: TAU, keyword: "T'AU EMPIRE" } });
    state = gameReducer(state, { type: 'SET_FACTION_KEYWORD', payload: { playerId: AM, keyword: 'ASTRA MILITARUM' } });
    const montka = getFaction('tau-empire')!.detachments.find((d) => d.id === 'montka')!;
    const combinedRegiment = getFaction('astra-militarum')!.detachments.find((d) => d.id === 'combined-regiment')!;
    state = gameReducer(state, { type: 'SELECT_DETACHMENT', payload: { playerId: TAU, detachment: montka } });
    state = gameReducer(state, { type: 'SELECT_DETACHMENT', payload: { playerId: AM, detachment: combinedRegiment } });

    // --- Battlefield & roles ---
    state = gameReducer(state, { type: 'DETERMINE_ATTACKER_DEFENDER', payload: { attackerId: TAU, defenderId: AM } });
    state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_TAKE_AND_HOLD } });
    expect(Object.keys(state.objectives)).toHaveLength(5);
    expect(state.maxBattleRounds).toBe(5);

    // --- Alternating deployment ---
    // Attacker (T'au) zone: x 0–18; defender (AM) zone: x 42–60. Home objectives at (12,22) / (48,22).
    state = gameReducer(state, { type: 'BEGIN_DEPLOYMENT', payload: { firstDeployingPlayerId: TAU } });

    const deployCenters: Record<string, Point[]> = {
      // First unit goes onto the home objective so primary scoring can happen
      [TAU]: [
        { x: 12, y: 22 }, { x: 8, y: 8 }, { x: 8, y: 32 }, { x: 14, y: 12 },
        { x: 14, y: 30 }, { x: 5, y: 16 }, { x: 5, y: 24 }, { x: 10, y: 38 }, { x: 4, y: 38 },
      ],
      [AM]: [
        { x: 48, y: 22 }, { x: 52, y: 8 }, { x: 52, y: 32 }, { x: 46, y: 12 },
        // Officer deploy spot is next to the (48,22) squad so orders are in 6" range
        { x: 48, y: 26 }, { x: 55, y: 16 }, { x: 55, y: 26 }, { x: 50, y: 38 }, { x: 44, y: 38 },
      ],
    };
    const deployCounts: Record<string, number> = { [TAU]: 0, [AM]: 0 };

    // Deploy the AM officer adjacent to a battleline squad: reorder so OFFICER deploys 5th (index 4)
    let guard = 0;
    while (Object.values(state.deploymentState.unitsRemaining).some((ids) => ids.length > 0) && guard++ < 50) {
      const pid = state.deploymentState.currentDeployingPlayerId;
      const remaining = state.deploymentState.unitsRemaining[pid] ?? [];
      if (remaining.length === 0) break;

      // AM: hold the OFFICER back until slot 4 (next to home-objective squad)
      let unitId = remaining[0];
      if (pid === AM) {
        const officerIds = remaining.filter((id) =>
          state.units[id]?.keywords.some((k) => k.toUpperCase() === 'OFFICER'),
        );
        if (deployCounts[pid] === 4 && officerIds.length > 0) {
          unitId = officerIds[0];
        } else if (officerIds.includes(unitId) && remaining.length > 1 && deployCounts[pid] < 4) {
          unitId = remaining.find((id) => !officerIds.includes(id)) ?? unitId;
        }
      }

      const unit = state.units[unitId];
      const center = deployCenters[pid][Math.min(deployCounts[pid], deployCenters[pid].length - 1)];
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId, positions: gridPositions(state, unit, center) },
      });
      deployCounts[pid]++;
    }
    expect(Object.values(state.deploymentState.unitsRemaining).every((ids) => ids.length === 0)).toBe(true);

    state = gameReducer(state, { type: 'DETERMINE_FIRST_TURN', payload: { playerId: TAU } });
    expect(state.turnState.activePlayerId).toBe(TAU);

    // --- Battle rounds ---
    let guidedDesignated = false;
    let orderIssued = false;
    let bornSoldiersSeen = false;
    let killingBlowSeen = false;

    for (let round = 1; round <= 5; round++) {
      expect(state.turnState.roundNumber).toBe(round);

      for (const pid of [TAU, AM]) {
        const enemyId = pid === TAU ? AM : TAU;
        expect(state.turnState.activePlayerId).toBe(pid);

        // ── Command phase ──
        state = gameReducer(state, { type: 'START_COMMAND_PHASE' });
        // Battle-shock tests for units below half strength
        for (const unit of playerUnits(state, pid)) {
          const starting = unit.startingStrength ?? unit.modelIds.length;
          const alive = activeModels(state, unit).length;
          const belowHalf =
            unit.modelIds.length > 1
              ? alive < starting / 2
              : activeModels(state, unit)[0]!.wounds < activeModels(state, unit)[0]!.maxWounds / 2;
          if (belowHalf) {
            const roll = rollDice(2, 6, 'Battle-shock');
            const total = roll.dice.reduce((s, d) => s + d, 0);
            const ld = activeModels(state, unit)[0]!.stats.leadership;
            state = gameReducer(state, {
              type: 'RESOLVE_BATTLE_SHOCK',
              payload: { unitId: unit.id, roll, passed: total >= ld },
            });
          }
        }

        // ── Movement phase ──
        state = gameReducer(state, { type: 'ADVANCE_PHASE' });
        // Each turn, the infantry unit closest to the enemy advances toward them,
        // stopping 3" short (outside Engagement Range). Home-objective holders and
        // everyone else Remain Stationary — which keeps Born Soldiers live for AM
        // and closes the gap so Mont'ka's Killing Blow range thresholds trigger.
        {
          const home = pid === TAU ? { x: 12, y: 22 } : { x: 48, y: 22 };
          const candidates = playerUnits(state, pid).filter((u) => {
            if (!u.keywords.some((k) => ['INFANTRY', 'BATTLELINE'].includes(k.toUpperCase()))) return false;
            return !activeModels(state, u).some(
              (m) => Math.hypot(m.position.x - home.x, m.position.y - home.y) <= 4,
            );
          });
          let mover: Unit | null = null;
          let moverGap = Infinity;
          let moverEnemy: Model | null = null;
          const enemyModels = playerUnits(state, enemyId).flatMap((eu) => activeModels(state, eu));
          for (const u of candidates) {
            for (const m of activeModels(state, u)) {
              for (const e of enemyModels) {
                const d = distanceBetweenModels(m, e);
                if (d < moverGap) {
                  moverGap = d;
                  mover = u;
                  moverEnemy = e;
                }
              }
            }
          }
          if (mover && moverEnemy && moverGap > 3.5) {
            const ms = activeModels(state, mover);
            const moveChar = Math.min(...ms.map((m) => m.moveCharacteristic));
            const step = Math.min(moveChar, moverGap - 3);
            const cx = ms.reduce((s, m) => s + m.position.x, 0) / ms.length;
            const cy = ms.reduce((s, m) => s + m.position.y, 0) / ms.length;
            const len = Math.hypot(moverEnemy.position.x - cx, moverEnemy.position.y - cy) || 1;
            const dx = ((moverEnemy.position.x - cx) / len) * step;
            const dy = ((moverEnemy.position.y - cy) / len) * step;
            state = gameReducer(state, { type: 'DECLARE_MOVEMENT', payload: { unitId: mover.id, moveType: 'normal' } });
            const positions: Record<string, Point> = {};
            for (const m of ms) {
              positions[m.id] = { x: m.position.x + dx, y: m.position.y + dy };
            }
            state = gameReducer(state, { type: 'COMMIT_MOVEMENT', payload: { unitId: mover.id, positions } });
          }
        }

        // ── Shooting phase ──
        state = gameReducer(state, { type: 'ADVANCE_PHASE' });

        // AM: issue Take Aim! from the officer to a nearby squad
        if (pid === AM) {
          const officer = playerUnits(state, AM).find((u) =>
            u.keywords.some((k) => k.toUpperCase() === 'OFFICER'),
          );
          if (officer) {
            const officerModels = activeModels(state, officer);
            const nearby = playerUnits(state, AM).find((u) => {
              if (u.id === officer.id) return false;
              if (state.battleShocked.includes(u.id)) return false; // shocked units refuse orders
              return activeModels(state, u).some((tm) =>
                officerModels.some((om) => distanceBetweenModels(om, tm) <= 6),
              );
            });
            if (nearby) {
              state = gameReducer(state, {
                type: 'ISSUE_ORDER',
                payload: { officerUnitId: officer.id, targetUnitId: nearby.id, orderId: 'take-aim' },
              });
              const amState = state.factionState['astra-militarum'] as { activeOrders?: Record<string, string> };
              if (amState?.activeOrders?.[nearby.id] === 'take-aim') orderIssued = true;
            }
          }
        }

        // Probe faction rules at the army's closest point of contact — independent of
        // who ends up shooting — so we can assert the rules genuinely come live in-game.
        {
          const gap = minArmyGap(state, pid, enemyId);
          const probeUnit = playerUnits(state, pid).find((u) => u.weapons.some((w) => w.type === 'ranged'));
          const probeEnemy = playerUnits(state, enemyId)[0];
          const probeWeapon = probeUnit?.weapons.find((w) => w.type === 'ranged');
          if (probeUnit && probeEnemy && probeWeapon && Number.isFinite(gap)) {
            const moveType = state.turnTracking.unitMovement[probeUnit.id];
            const probe: AttackContext = {
              weapon: probeWeapon,
              abilities: [],
              distanceToTarget: gap,
              targetUnitSize: activeModels(state, probeEnemy).length,
              targetKeywords: probeEnemy.keywords,
              attackerStationary: !moveType || moveType === 'stationary',
              attackerCharged: false,
              attackerModelCount: activeModels(state, probeUnit).length,
              targetUnitId: probeEnemy.id,
            };
            const { triggeredRules } = applyFactionAndDetachmentRules(probe, state, probeUnit);
            if (triggeredRules.some((r) => r.includes('Born Soldiers'))) bornSoldiersSeen = true;
            if (triggeredRules.some((r) => r.includes('Killing Blow'))) killingBlowSeen = true;
          }
        }

        // Each unit with a target in range shoots (up to 3 units to keep the test fast)
        let shotsFired = 0;
        let lastTargetId: string | null = null;
        const targetedThisPhase = new Set<string>();
        for (const shooter of playerUnits(state, pid)) {
          if (shotsFired >= 3) break;
          if (state.shootingState.unitsShot.includes(shooter.id)) continue;
          const moveType = state.turnTracking.unitMovement[shooter.id];
          if (moveType === 'advance' || moveType === 'fall_back') continue;
          const target = findTargetInRange(state, shooter, enemyId, targetedThisPhase);
          if (!target) continue;

          state = shoot(state, shooter, target);
          targetedThisPhase.add(target.id);
          lastTargetId = target.id;
          shotsFired++;
        }

        // T'au: designate the last target as Guided (For the Greater Good)
        if (pid === TAU && lastTargetId && state.units[lastTargetId]) {
          state = gameReducer(state, {
            type: 'DESIGNATE_GUIDED_TARGET',
            payload: { targetUnitId: lastTargetId },
          });
          const tauState = state.factionState['tau-empire'] as { guidedTargets?: Record<string, string> };
          if (tauState?.guidedTargets?.[TAU] === lastTargetId) guidedDesignated = true;
        }

        // ── Charge phase ── (no charges declared in this scripted game)
        state = gameReducer(state, { type: 'ADVANCE_PHASE' });

        // ── Fight phase ──
        state = gameReducer(state, { type: 'ADVANCE_PHASE' });
        state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

        // ── Morale / end of turn ──
        state = gameReducer(state, { type: 'ADVANCE_PHASE' });
        state = gameReducer(state, { type: 'END_TURN' });

        if (pid === AM) {
          state = gameReducer(state, { type: 'END_BATTLE_ROUND' });
        } else {
          state = gameReducer(state, { type: 'NEXT_TURN' });
        }
      }
    }

    // --- End of battle ---
    expect(state.gameResult).toBeDefined();
    expect(state.gameResult!.reason).toBe('max_rounds');
    expect(state.gameResult!.finalScores[TAU]).toBeGreaterThan(0); // held home objective all game
    expect(state.gameResult!.finalScores[AM]).toBeGreaterThan(0);

    // Faction rules actually fired during the game
    expect(orderIssued).toBe(true);
    expect(guidedDesignated).toBe(true);
    expect(bornSoldiersSeen).toBe(true);
    expect(killingBlowSeen).toBe(true);

    // Command points accumulated each Command phase
    expect(state.players[TAU].commandPoints).toBeGreaterThan(0);
    expect(state.players[AM].commandPoints).toBeGreaterThan(0);

    // Every save the engine queued got resolved — nothing left dangling
    expect(state.shootingState.pendingSaves.some((ps) => !ps.resolved)).toBe(false);
    expect(state.fightState.pendingSaves.some((ps) => !ps.resolved)).toBe(false);

    // The scripted game was fully legal: nothing was blocked by rules enforcement
    const blocked = state.log.entries.filter(
      (e) => e.type === 'message' && e.text.includes('[BLOCKED]'),
    );
    expect(blocked).toEqual([]);
  });
});
