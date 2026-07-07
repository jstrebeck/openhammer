/**
 * @vitest-environment node
 *
 * Full-game integration test: two HEADLESS client stores (the real store,
 * the real dispatch path) against the REAL server and reducer, over real
 * WebSockets, with the real sample rosters. No DOM, no three.js.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { StoreApi } from 'zustand/vanilla';
import type { Datasheet, GameAction, GameState, PlayerIndex, UnitState } from '@openhammer/core';
import { startServer, type OpenHammerServer } from '@openhammer/server';
import { createGameStore, type GameStore } from '../store';
import type { SocketFactory } from '../net/socket';
import { canFightThisStep, currentPositions, unitEdgeDistance } from '../game/interaction';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nodeSocketFactory: SocketFactory = (url, callbacks) => {
  const ws = new WebSocket(url);
  ws.on('open', () => callbacks.onOpen());
  ws.on('message', (data) => callbacks.onMessage(String(data)));
  ws.on('close', () => callbacks.onClose());
  ws.on('error', () => {});
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
};

type Store = StoreApi<GameStore>;

function waitFor<T>(
  store: Store,
  check: (s: GameStore) => T | undefined | false | null,
  label: string,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let unsub: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      unsub();
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };
    const evaluate = () => {
      try {
        const result = check(store.getState());
        if (result) finish(() => resolve(result));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    unsub = store.subscribe(evaluate);
    timer = setTimeout(() => finish(() => reject(new Error(`timeout: ${label}`))), timeoutMs);
    evaluate();
  });
}

function other(seat: PlayerIndex): PlayerIndex {
  return seat === 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Shared driver: auto-pass stratagem windows + rejection-safe dispatch
// ---------------------------------------------------------------------------

interface Driver {
  game(seat: PlayerIndex): GameState;
  act(
    seat: PlayerIndex,
    action: GameAction,
    pred: (g: GameState) => boolean,
    label: string,
  ): Promise<GameState>;
  stop(): void;
}

function makeDriver(stores: [Store, Store]): Driver {
  const game = (seat: PlayerIndex): GameState => {
    const g = stores[seat].getState().game;
    if (!g) throw new Error('no game state yet');
    return g;
  };

  /** Milestone 3 opens reactive stratagem windows (Overwatch, Smoke-
   * screen...). This driver plays a stratagem-free game: whichever
   * store owns an open window passes it, exercising passWindow over
   * the wire. */
  const passedWindows = new Set<string>();
  const passOpenWindows = () => {
    for (const seat of [0, 1] as const) {
      const g = stores[seat].getState().game;
      const d = g?.pendingDecision;
      if (d && d.kind === 'stratagemWindow' && d.player === seat && !passedWindows.has(d.id)) {
        passedWindows.add(d.id);
        stores[seat].getState().dispatch({ type: 'passWindow', player: seat });
      }
    }
  };
  // Auto-pass reacts to EITHER store's updates — window ownership can
  // land on the defender's store while only the attacker is awaited.
  const unsubscribers = stores.map((s) => s.subscribe(passOpenWindows));

  /** Dispatch from `seat`, fail fast on rejection, wait until BOTH
   * stores see a state satisfying the predicate. */
  const act = async (
    seat: PlayerIndex,
    action: GameAction,
    pred: (g: GameState) => boolean,
    label: string,
  ): Promise<GameState> => {
    const store = stores[seat];
    const before = store.getState().rejections.length;
    store.getState().dispatch(action);
    const result = await waitFor(
      store,
      (s) => {
        if (s.rejections.length > before) {
          const r = s.rejections[s.rejections.length - 1]!;
          throw new Error(`${label} rejected: [${r.code}] ${r.error}`);
        }
        passOpenWindows();
        return s.game && pred(s.game) ? s.game : undefined;
      },
      label,
    );
    await waitFor(
      stores[other(seat)],
      (s) => {
        passOpenWindows();
        return s.game && pred(s.game) ? s.game : undefined;
      },
      `${label} (peer sync)`,
    );
    return result;
  };

  return { game, act, stop: () => unsubscribers.forEach((u) => u()) };
}

function unitsOf(g: GameState, seat: PlayerIndex): UnitState[] {
  return Object.values(g.units).filter((u) => u.owner === seat);
}

function laneUnitIdOf(g: GameState, seat: PlayerIndex): string {
  const lane = unitsOf(g, seat).find(isLaneUnit);
  if (!lane) throw new Error(`no lane unit for seat ${seat}`);
  return lane.id;
}

// ---------------------------------------------------------------------------
// Deployment planning: simple legal grid placement inside the owner's zone
// ---------------------------------------------------------------------------

interface Placement {
  unitId: string;
  positions: { modelId: string; x: number; y: number }[];
}

function maxBaseDiameter(unit: UnitState, datasheets: Record<string, Datasheet>): number {
  const ds = datasheets[unit.datasheetId];
  let max = 25;
  for (const m of unit.models) {
    if (m.destroyed) continue;
    const profile = ds?.models.find((p) => p.id === m.profileId) ?? ds?.models[0];
    if (profile && profile.baseSizeMm > max) max = profile.baseSizeMm;
  }
  return max / 25.4;
}

function isLaneUnit(unit: UnitState): boolean {
  return (
    unit.models.filter((m) => !m.destroyed).length >= 5 &&
    (unit.weapons['pulse-rifle'] !== undefined || unit.weapons['lasgun'] !== undefined)
  );
}

/**
 * Grid deployment: the "lane" unit (pulse rifles / lasguns) is centered on
 * the board's clear middle corridor so it has line of sight through the
 * default ruins; everything else packs left-to-right at the back of the
 * zone, skipping the corridor. Rows are spaced base-diameter + 0.4"
 * (coherent, non-overlapping); all centers stay >= 1.5" inside the zone.
 */
function planDeployments(
  game: GameState,
  datasheets: Record<string, Datasheet>,
  seat: PlayerIndex,
): Placement[] {
  const zone = game.board.deploymentZones.find((z) => z.player === seat);
  if (!zone) throw new Error(`no deployment zone for seat ${seat}`);
  const xs = zone.polygon.map((p) => p.x);
  const ys = zone.polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const northern = maxY <= game.board.height / 2;
  const margin = 1.5;
  const frontY = northern ? maxY - margin : minY + margin; // nearest the enemy
  const backY = northern ? minY + margin : maxY - margin;
  const awayDir = northern ? -1 : 1; // +row moves away from the enemy

  const laneX = game.board.width / 2;
  const laneHalfWidth = 6;

  const units = Object.values(game.units).filter(
    (u) => u.owner === seat && u.models.some((m) => !m.destroyed),
  );
  const lane = units.find(isLaneUnit);
  const plans: Placement[] = [];

  const gridPositions = (
    unit: UnitState,
    firstColCenterX: number,
    rowY0: number,
    rowStep: number,
    spacing: number,
  ) => {
    const alive = unit.models.filter((m) => !m.destroyed);
    return alive.map((m, i) => ({
      modelId: m.id,
      x: firstColCenterX + (i % 5) * spacing,
      y: rowY0 + Math.floor(i / 5) * rowStep,
    }));
  };

  if (lane) {
    const d = maxBaseDiameter(lane, datasheets);
    const spacing = d + 0.4;
    const cols = Math.min(5, lane.models.filter((m) => !m.destroyed).length);
    const firstCol = laneX - ((cols - 1) * spacing) / 2;
    plans.push({
      unitId: lane.id,
      positions: gridPositions(lane, firstCol, frontY, awayDir * spacing, spacing),
    });
  }

  let cursorX = minX + margin;
  for (const unit of units) {
    if (unit === lane) continue;
    const d = maxBaseDiameter(unit, datasheets);
    const spacing = d + 0.4;
    const alive = unit.models.filter((m) => !m.destroyed).length;
    const cols = Math.min(5, alive);
    const blockWidth = (cols - 1) * spacing + d;
    // Skip the central corridor so the lane units keep line of sight.
    if (cursorX + blockWidth > laneX - laneHalfWidth && cursorX < laneX + laneHalfWidth) {
      cursorX = laneX + laneHalfWidth;
    }
    if (cursorX + blockWidth > maxX - margin) {
      throw new Error(`deployment overflow for seat ${seat} at ${unit.name}`);
    }
    plans.push({
      unitId: unit.id,
      // Back rows step TOWARD the front (into the zone's interior).
      positions: gridPositions(unit, cursorX + d / 2, backY, -awayDir * spacing, spacing),
    });
    cursorX += blockWidth + 1.2;
  }
  return plans;
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe('full game over the wire (client stores <-> real server)', () => {
  let server: OpenHammerServer;
  let dataDir: string;
  let stores: [Store, Store];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'openhammer-client-it-'));
    server = await startServer({ dataDir }); // ephemeral port
    const url = `ws://127.0.0.1:${server.port}`;
    stores = [
      createGameStore(nodeSocketFactory, { url, reconnectDelayMs: 60_000 }),
      createGameStore(nodeSocketFactory, { url, reconnectDelayMs: 60_000 }),
    ];
  });

  afterAll(async () => {
    stores?.forEach((s) => s.getState().disconnect());
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it(
    'creates, joins, imports rosters, rolls off, deploys, moves, shoots and saves',
    async () => {
      const [A, B] = stores;
      const expectedRejections: [number, number] = [0, 0];

      const driver = makeDriver(stores);
      const { game, act } = driver;

      // --- connect, create, join ---------------------------------------
      A.getState().connect();
      B.getState().connect();
      await waitFor(A, (s) => s.status === 'connected', 'A connected');
      await waitFor(B, (s) => s.status === 'connected', 'B connected');

      A.getState().createRoom('Alice');
      await waitFor(A, (s) => s.roomId !== null && s.game !== null, 'room created');
      expect(A.getState().playerIndex).toBe(0);
      const roomId = A.getState().roomId!;

      B.getState().joinRoom(roomId, 'Bob');
      await waitFor(B, (s) => s.playerIndex === 1 && s.game !== null, 'joined');
      await waitFor(A, (s) => s.game?.players[1].name === 'Bob', 'join broadcast');
      await waitFor(A, (s) => Object.keys(s.datasheets).length > 0, 'A content');
      await waitFor(B, (s) => Object.keys(s.datasheets).length > 0, 'B content');

      // --- roster upload (REAL sample files) ---------------------------
      const tau = JSON.parse(
        readFileSync(join(repoRoot, 'samples', 'tau-empire-1000.json'), 'utf8'),
      ) as unknown;
      const militarum = JSON.parse(
        readFileSync(join(repoRoot, 'samples', 'astra-militarum-1000.json'), 'utf8'),
      ) as unknown;

      A.getState().uploadRoster(tau);
      await waitFor(
        A,
        (s) => s.game?.setup?.rostersLoaded[0] === true && s.importedUnitCount !== null,
        'tau roster imported',
      );
      B.getState().uploadRoster(militarum);
      await waitFor(
        B,
        (s) => s.game?.setup?.rostersLoaded[1] === true && s.importedUnitCount !== null,
        'militarum roster imported',
      );
      await waitFor(B, (s) => s.game?.setup?.rostersLoaded[0] === true, 'B sees tau roster');

      expect(A.getState().importedUnitCount).toBe(unitsOf(game(0), 0).length);
      expect(B.getState().importedUnitCount).toBe(unitsOf(game(1), 1).length);
      expect(unitsOf(game(0), 0).length).toBeGreaterThanOrEqual(6);
      expect(unitsOf(game(1), 1).length).toBeGreaterThanOrEqual(6);

      // --- attacker/defender roll-off ----------------------------------
      await act(
        0,
        { type: 'performRollOff', player: 0 },
        (g) => g.setup?.rollOff?.purpose === 'attackerChoice',
        'attacker roll-off',
      );
      const winner = game(0).setup!.rollOff!.winner;
      await act(
        winner,
        { type: 'chooseRole', player: winner, role: 'attacker' },
        (g) => g.setup?.attacker === winner,
        'chooseRole(attacker) by winner',
      );

      // --- alternating deployment of EVERY unit ------------------------
      const datasheets = A.getState().datasheets;
      const plans: [Placement[], Placement[]] = [
        planDeployments(game(0), datasheets, 0),
        planDeployments(game(1), datasheets, 1),
      ];
      const deployed: [number, number] = [0, 0];
      for (let guard = 0; guard < 32; guard++) {
        const next = game(0).setup?.deployNext ?? null;
        if (next === null) break;
        const plan = plans[next][deployed[next]];
        if (!plan) throw new Error(`no remaining plan for seat ${next}`);
        deployed[next]++;
        await act(
          next,
          { type: 'deployUnit', player: next, unitId: plan.unitId, positions: plan.positions },
          (g) => g.units[plan.unitId]!.models.every((m) => m.destroyed || m.position !== null),
          `deploy ${plan.unitId}`,
        );
      }
      expect(game(0).setup?.deployNext).toBeNull();
      expect(deployed[0]).toBe(plans[0].length);
      expect(deployed[1]).toBe(plans[1].length);
      for (const unit of Object.values(game(0).units)) {
        expect(unit.models.every((m) => m.destroyed || m.position !== null)).toBe(true);
      }

      // --- first-turn roll-off, begin the battle ------------------------
      await act(
        0,
        { type: 'performRollOff', player: 0 },
        (g) => g.setup?.readyToStart === true,
        'first-turn roll-off',
      );
      const first = game(0).firstPlayer;
      await act(
        first,
        { type: 'advanceStep', player: first },
        (g) => g.round === 1 && g.phase === 'command',
        'begin battle',
      );

      // --- expected rejection: the OTHER player acts out of turn --------
      const wrong = other(first);
      const rejBefore = stores[wrong].getState().rejections.length;
      stores[wrong].getState().dispatch({ type: 'advanceStep', player: wrong });
      const rejection = await waitFor(
        stores[wrong],
        (s) => (s.rejections.length > rejBefore ? s.rejections[s.rejections.length - 1] : undefined),
        'out-of-turn advanceStep rejected',
      );
      expect(rejection.code).toBe('OUT_OF_TURN');
      expectedRejections[wrong]++;
      // The rejection must NOT have advanced the game.
      expect(game(0).phase).toBe('command');

      // --- battle turns: move 3" forward, shoot, defender saves ---------
      const northSeat: PlayerIndex =
        Math.max(...game(0).board.deploymentZones.find((z) => z.player === 0)!.polygon.map((p) => p.y)) <=
        game(0).board.height / 2
          ? 0
          : 1;

      let savesResolved = false;
      for (let turn = 0; turn < 4 && !savesResolved; turn++) {
        const active = game(0).activePlayer;
        const startRound = game(0).round;

        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.step === 'battleShock',
          `t${turn}: command -> battleShock`,
        );
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.phase === 'movement',
          `t${turn}: -> movement`,
        );

        // Normal move: whole unit 3" straight toward the enemy.
        const moverId = laneUnitIdOf(game(active), active);
        const dy = active === northSeat ? 3 : -3;
        await act(
          active,
          { type: 'startMove', player: active, unitId: moverId, kind: 'normal' },
          (g) => g.pendingMove?.unitId === moverId,
          `t${turn}: startMove normal`,
        );
        expect(game(active).pendingMove!.budget).toBeGreaterThanOrEqual(3);
        const mover = game(active).units[moverId]!;
        const destinations = mover.models
          .filter((m) => !m.destroyed && m.position !== null)
          .map((m) => ({ modelId: m.id, x: m.position!.x, y: m.position!.y + dy }));
        await act(
          active,
          { type: 'commitMove', player: active, unitId: moverId, positions: destinations },
          (g) => g.pendingMove === null && g.units[moverId]!.turnFlags.moveKind === 'normal',
          `t${turn}: commitMove 3" forward`,
        );

        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.step === 'reinforcements',
          `t${turn}: -> reinforcements`,
        );
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.phase === 'shooting',
          `t${turn}: -> shooting`,
        );

        // Shoot the pulse-rifle / lasgun unit at the nearest enemy (the
        // opposing lane unit straight across the corridor).
        const shooter = game(active).units[moverId]!;
        const weapon = Object.values(shooter.weapons).find(
          (w) => w.kind === 'ranged' && /pulse rifle|lasgun/i.test(w.name),
        );
        if (!weapon) throw new Error(`no pulse rifle / lasgun on ${shooter.name}`);
        const targetId = laneUnitIdOf(game(active), other(active));
        const woundsBefore = game(active)
          .units[targetId]!.models.reduce(
            (sum, m) => sum + (m.destroyed ? 0 : m.woundsRemaining),
            0,
          );

        await act(
          active,
          {
            type: 'declareShoot',
            player: active,
            unitId: moverId,
            assignments: [{ weaponId: weapon.id, targetUnitId: targetId }],
          },
          // The Smokescreen/Go-to-Ground window may open first; the driver
          // passes it, so wait specifically for saves (or a no-wound volley).
          (g) => g.pendingDecision?.kind === 'saves' || g.units[moverId]!.turnFlags.hasShot,
          `t${turn}: declareShoot ${weapon.id} -> ${targetId}`,
        );

        const decision = game(active).pendingDecision;
        if (decision) {
          // The reactive window belongs to the DEFENDER.
          expect(decision.kind).toBe('saves');
          const defender = other(active);
          expect(decision.player).toBe(defender);
          expect(decision.context.targetUnitId).toBe(targetId);
          expect(
            (decision.context.wounds as number) + (decision.context.mortalWounds as number),
          ).toBeGreaterThan(0);

          // The attacker cannot resolve the defender's saves — and the
          // defender's store is the one that dispatches.
          await act(
            defender,
            { type: 'resolveSaves', player: defender },
            (g) => g.pendingDecision === null && g.units[moverId]!.turnFlags.hasShot,
            `t${turn}: resolveSaves by defender`,
          );

          const g = game(defender);
          const woundsAfter = g.units[targetId]!.models.reduce(
            (sum, m) => sum + (m.destroyed ? 0 : m.woundsRemaining),
            0,
          );
          const savesLog = g.log.find((l) => l.kind === 'saves');
          expect(woundsAfter < woundsBefore || savesLog !== undefined).toBe(true);
          expect(savesLog?.message).toContain('resolves saves');
          expect(g.units[moverId]!.turnFlags.hasShot).toBe(true);
          savesResolved = true;
          break;
        }

        // Whiffed completely (rare) — finish the turn and let the other
        // player try from closer range.
        expect(game(active).units[moverId]!.turnFlags.hasShot).toBe(true);
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.phase === 'charge',
          `t${turn}: -> charge`,
        );
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.phase === 'fight',
          `t${turn}: -> fight`,
        );
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.step === 'remainingCombats',
          `t${turn}: -> remaining combats`,
        );
        await act(
          active,
          { type: 'advanceStep', player: active },
          (g) => g.phase === 'command' && (g.activePlayer !== active || g.round > startRound),
          `t${turn}: -> next turn`,
        );
      }
      expect(savesResolved).toBe(true);
      driver.stop();

      // --- every dispatch accepted except the deliberate one ------------
      expect(A.getState().rejections.length).toBe(expectedRejections[0]);
      expect(B.getState().rejections.length).toBe(expectedRejections[1]);
    },
    120_000,
  );

  it(
    'drives a charge and the fight phase (milestone-3 leg, same game)',
    async () => {
      const driver = makeDriver(stores);
      const { game, act } = driver;
      const datasheets = stores[0].getState().datasheets;
      const rejBase: [number, number] = [
        stores[0].getState().rejections.length,
        stores[1].getState().rejections.length,
      ];

      /** Wait until the acting store sees no open decision/window — the
       * auto-pass driver resolves stratagem windows asynchronously. */
      const quiet = (seat: PlayerIndex) =>
        waitFor(
          stores[seat],
          (s) =>
            s.game &&
            s.game.pendingDecision === null &&
            (s.game.windowQueue?.length ?? 0) === 0
              ? s.game
              : undefined,
          `seat ${seat} quiet`,
        );
      const qact = async (
        seat: PlayerIndex,
        action: GameAction,
        pred: (g: GameState) => boolean,
        label: string,
      ): Promise<GameState> => {
        if (action.type !== 'resolveSaves') await quiet(seat);
        return act(seat, action, pred, label);
      };
      const adv = (seat: PlayerIndex, pred: (g: GameState) => boolean, label: string) =>
        qact(seat, { type: 'advanceStep', player: seat }, pred, label);

      const centroidOf = (unit: UnitState): { x: number; y: number } => {
        const placed = unit.models.filter((m) => !m.destroyed && m.position !== null);
        return {
          x: placed.reduce((a, m) => a + m.position!.x, 0) / placed.length,
          y: placed.reduce((a, m) => a + m.position!.y, 0) / placed.length,
        };
      };
      const towards = (fromU: UnitState, toU: UnitState): { x: number; y: number } => {
        const a = centroidOf(fromU);
        const b = centroidOf(toU);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      };
      const translated = (unit: UnitState, dx: number, dy: number) =>
        unit.models
          .filter((m) => !m.destroyed && m.position !== null)
          .map((m) => ({ modelId: m.id, x: m.position!.x + dx, y: m.position!.y + dy }));

      let chargeCommitted = false;
      let chargeFailed = false;
      let meleeSavesResolved = false;

      /** Normal-move the active lane straight at the enemy lane, stopping
       * 1.5" out (a Normal move may not end within Engagement Range). */
      const moveLaneCloser = async (active: PlayerIndex): Promise<void> => {
        const moverId = laneUnitIdOf(game(active), active);
        const targetId = laneUnitIdOf(game(active), other(active));
        let g = game(active);
        if (g.units[moverId]!.turnFlags.moveKind !== null) return;
        const gap = unitEdgeDistance(g.units[moverId]!, g.units[targetId]!, datasheets);
        if (gap === null) return;
        await qact(
          active,
          { type: 'startMove', player: active, unitId: moverId, kind: 'normal' },
          (g2) => g2.pendingMove?.unitId === moverId,
          'leg2: startMove',
        );
        g = game(active);
        const step = Math.max(0, Math.min(g.pendingMove!.budget, gap - 1.5));
        const dir = towards(g.units[moverId]!, g.units[targetId]!);
        await qact(
          active,
          {
            type: 'commitMove',
            player: active,
            unitId: moverId,
            positions: translated(g.units[moverId]!, dir.x * step, dir.y * step),
          },
          (g2) => g2.pendingMove === null && g2.units[moverId]!.turnFlags.moveKind === 'normal',
          'leg2: commitMove toward enemy',
        );
      };

      /** Declare against the opposing lane when within 12", read the rolled
       * 2D6 from state, then commit (step adjacent) or concede the fail. */
      const attemptCharge = async (active: PlayerIndex): Promise<void> => {
        const unitId = laneUnitIdOf(game(active), active);
        const targetId = laneUnitIdOf(game(active), other(active));
        const g = game(active);
        const gap = unitEdgeDistance(g.units[unitId]!, g.units[targetId]!, datasheets);
        if (
          gap === null ||
          gap > 11.5 ||
          gap <= 1.1 ||
          g.units[unitId]!.turnFlags.chargeDeclared
        ) {
          return;
        }
        await qact(
          active,
          { type: 'declareCharge', player: active, unitId, targetIds: [targetId] },
          (g2) => g2.charge?.unitId === unitId && g2.charge.roll !== null,
          'leg2: declareCharge',
        );
        const seq = game(active).charge!;
        expect(seq.roll).toBe(seq.rolls![0] + seq.rolls![1]);
        expect(seq.targetIds).toEqual([targetId]);
        expect(game(active).units[unitId]!.turnFlags.chargeDeclared).toBe(true);

        const needed = Math.max(0.6, gap - 0.5); // end ~0.5" out: inside ER
        if (seq.roll! + 1e-6 >= needed) {
          const cur = game(active).units[unitId]!;
          const dir = towards(cur, game(active).units[targetId]!);
          await qact(
            active,
            {
              type: 'commitCharge',
              player: active,
              unitId,
              positions: translated(cur, dir.x * needed, dir.y * needed),
            },
            (g2) => g2.charge === null && g2.units[unitId]!.turnFlags.moveKind === 'charge',
            'leg2: commitCharge',
          );
          chargeCommitted = true;
          expect(game(active).units[unitId]!.turnFlags.fightsFirst).toBe(true);
        } else {
          await qact(
            active,
            { type: 'failCharge', player: active, unitId },
            (g2) => g2.charge === null,
            'leg2: failCharge',
          );
          chargeFailed = true;
          expect(game(active).units[unitId]!.turnFlags.moveKind).not.toBe('charge');
        }
      };

      /** Drive one fight step to completion, respecting fight.selector
       * ownership: the selecting STORE acts, whoever it is. */
      const runFightStep = async (): Promise<void> => {
        for (let guard = 0; guard < 6; guard++) {
          await quiet(0);
          const g = game(0);
          if (
            g.phase !== 'fight' ||
            !g.fight ||
            g.fight.stage !== 'select' ||
            g.fight.selector === null
          ) {
            return;
          }
          const sel = g.fight.selector;
          const fighter = Object.values(g.units).find(
            (u) => u.owner === sel && canFightThisStep(g, u, datasheets),
          );
          if (!fighter) throw new Error(`selector ${sel} set but no eligible fighter found`);
          await qact(
            sel,
            { type: 'selectFighter', player: sel, unitId: fighter.id },
            (g2) => g2.fight?.activeUnitId === fighter.id && g2.fight.stage === 'pileIn',
            `leg2: selectFighter ${fighter.id}`,
          );
          await qact(
            sel,
            {
              type: 'pileIn',
              player: sel,
              unitId: fighter.id,
              positions: currentPositions(game(sel).units[fighter.id]!),
            },
            (g2) => g2.fight?.stage === 'attacks',
            'leg2: pileIn (stay put)',
          );
          const unit = game(sel).units[fighter.id]!;
          const melee = Object.values(unit.weapons).find((w) => w.kind === 'melee');
          const enemy = Object.values(game(sel).units).find(
            (u) => u.owner !== sel && (unitEdgeDistance(unit, u, datasheets) ?? Infinity) <= 1,
          );
          if (melee && enemy) {
            await qact(
              sel,
              {
                type: 'declareMelee',
                player: sel,
                unitId: fighter.id,
                assignments: [{ weaponId: melee.id, targetUnitId: enemy.id }],
              },
              (g2) => g2.pendingDecision?.kind === 'saves' || g2.fight?.stage === 'consolidate',
              `leg2: declareMelee ${melee.id} -> ${enemy.id}`,
            );
            const decision = game(sel).pendingDecision;
            if (decision && decision.kind === 'saves') {
              const defender = decision.player;
              expect(defender).toBe(other(sel));
              await act(
                defender,
                { type: 'resolveSaves', player: defender },
                (g2) => g2.fight?.stage === 'consolidate',
                'leg2: melee resolveSaves by defender',
              );
              meleeSavesResolved = true;
            }
          } else {
            await qact(
              sel,
              { type: 'declareMelee', player: sel, unitId: fighter.id, assignments: [] },
              (g2) => g2.fight?.stage === 'consolidate',
              'leg2: declareMelee (no attacks)',
            );
          }
          await qact(
            sel,
            {
              type: 'consolidate',
              player: sel,
              unitId: fighter.id,
              positions: currentPositions(game(sel).units[fighter.id]!),
            },
            (g2) => (g2.fight?.fought ?? []).includes(fighter.id),
            'leg2: consolidate (stay put)',
          );
          expect(game(sel).units[fighter.id]!.turnFlags.hasFought).toBe(true);
        }
      };

      /** charge phase -> fight (both steps, with activations) -> next turn. */
      const finishTurn = async (active: PlayerIndex): Promise<void> => {
        await adv(active, (g) => g.phase === 'fight' && g.step === 'fightsFirst', 'leg2: -> fight');
        await runFightStep();
        await adv(active, (g) => g.step === 'remainingCombats', 'leg2: -> remainingCombats');
        await runFightStep();
        const round = game(active).round;
        await adv(
          active,
          (g) =>
            g.phase === 'ended' ||
            (g.phase === 'command' && (g.activePlayer !== active || g.round > round)),
          'leg2: -> next turn',
        );
      };

      // --- finish the turn leg 1 left mid-shooting ----------------------
      expect(game(0).phase).toBe('shooting');
      {
        const active = game(0).activePlayer;
        await adv(active, (g) => g.phase === 'charge', 'leg2: -> charge');
        await attemptCharge(active); // usually out of 12" this early
        await finishTurn(active);
      }

      // --- close the gap turn by turn until a charge sticks --------------
      for (let turn = 0; turn < 4 && !chargeCommitted && game(0).phase === 'command'; turn++) {
        const active = game(0).activePlayer;
        await adv(active, (g) => g.step === 'battleShock', `leg2 t${turn}: -> battleShock`);
        await adv(active, (g) => g.phase === 'movement', `leg2 t${turn}: -> movement`);
        await moveLaneCloser(active);
        await adv(active, (g) => g.step === 'reinforcements', `leg2 t${turn}: -> reinforcements`);
        await adv(active, (g) => g.phase === 'shooting', `leg2 t${turn}: -> shooting`);
        await adv(active, (g) => g.phase === 'charge', `leg2 t${turn}: -> charge`);
        await attemptCharge(active);
        await finishTurn(active);
      }

      // A failed 2D6 is a legal outcome mid-run, but the closing strategy
      // guarantees a committed charge within the retry budget (once the
      // lanes sit 1.5" apart the required move is 1", i.e. any roll).
      expect(chargeCommitted).toBe(true);
      const log = game(0).log;
      expect(log.some((l) => l.kind === 'charge' && /declares a charge/.test(l.message))).toBe(true);
      expect(log.some((l) => l.kind === 'charge' && /charges into combat/.test(l.message))).toBe(true);
      expect(log.some((l) => l.kind === 'fight' && /piles in/.test(l.message))).toBe(true);
      expect(log.some((l) => l.kind === 'fight' && /consolidates/.test(l.message))).toBe(true);
      if (chargeFailed) {
        expect(log.some((l) => l.kind === 'charge' && /charge fails/i.test(l.message))).toBe(true);
      }
      // Surface which legs ran for the reporter.
      // eslint-disable-next-line no-console
      console.info(
        `[fullGame leg 2] charge committed=${chargeCommitted} failedAttempts=${chargeFailed} meleeSaves=${meleeSavesResolved}`,
      );

      // --- no unexpected rejections in this leg --------------------------
      expect(stores[0].getState().rejections.length).toBe(rejBase[0]);
      expect(stores[1].getState().rejections.length).toBe(rejBase[1]);
      driver.stop();
    },
    180_000,
  );
});
