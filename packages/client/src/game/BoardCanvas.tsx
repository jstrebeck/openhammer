import { useMemo, type ReactElement } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Html, MapControls, OrthographicCamera } from '@react-three/drei';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import type { Datasheet, GameState, UnitState, Vec2 } from '@openhammer/core';
import { useGameStore, useStoreApi } from '../storeContext';
import {
  aliveModels,
  baseDiameterInches,
  deployFormation,
  maxMoveDistance,
  moveFormation,
  profileFor,
  unitCentroid,
} from './interaction';

/**
 * Top-down orthographic view of the battlefield. Game coordinates (x, y) in
 * inches map to three.js (x, 0, y): the board lies on the XZ plane.
 * All state mutations go through dispatched actions; this component only
 * renders the last server state plus local ghost previews.
 */

const P0_COLOR = '#3b82f6';
const P1_COLOR = '#ef4444';

function playerColor(owner: 0 | 1): string {
  return owner === 0 ? P0_COLOR : P1_COLOR;
}

/** Build a flat THREE.Shape from board-space polygon. Rendered inside a
 * group rotated -90° about X, local (x, -y) lands at world (x, 0, y). */
function polygonShape(points: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  });
  shape.closePath();
  return shape;
}

export function BoardCanvas() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  const { width, height } = game.board;
  return (
    <div className="board-wrap">
      <Canvas>
        <OrthographicCamera
          makeDefault
          position={[width / 2, 60, height / 2]}
          up={[0, 0, -1]}
          zoom={14}
          near={0.1}
          far={500}
        />
        <Controls target={[width / 2, 0, height / 2]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[20, 60, 10]} intensity={0.9} />
        <Scene />
      </Canvas>
    </div>
  );
}

function Controls({ target }: { target: [number, number, number] }) {
  return (
    <MapControls
      ref={(controls: MapControlsImpl | null) => {
        if (controls) {
          // Left button is for selecting/placing; pan with right/middle drag.
          controls.mouseButtons = {
            LEFT: undefined as unknown as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          };
          controls.zoomToCursor = true;
        }
      }}
      makeDefault
      enableRotate={false}
      target={target}
    />
  );
}

function Scene() {
  const game = useGameStore((s) => s.game);
  if (!game) return null;
  return (
    <group>
      <BoardPlane game={game} />
      <GridLines game={game} />
      <DeploymentZones game={game} />
      <Objectives game={game} />
      <Terrain game={game} />
      <Units game={game} />
      <InteractionLayer game={game} />
    </group>
  );
}

function BoardPlane({ game }: { game: GameState }) {
  const { width, height } = game.board;
  const store = useStoreApi();
  const setCursor = useBoardCursor((s) => s.setCursor);

  const toBoard = (e: ThreeEvent<PointerEvent>): Vec2 => ({ x: e.point.x, y: e.point.z });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const point = toBoard(e);
    const s = store.getState();
    const g = s.game;
    if (!g || s.playerIndex === null) {
      s.selectUnit(null);
      return;
    }
    const seat = s.playerIndex;
    // Deploy / bring on reserves: place the ghost formation.
    if (s.interaction.mode === 'deploying' || s.interaction.mode === 'placingReserves') {
      const fromReserves = s.interaction.mode === 'placingReserves';
      const unit = g.units[s.interaction.unitId];
      if (unit) {
        const positions = deployFormation(unit, s.datasheets[unit.datasheetId], point);
        s.dispatch({
          type: fromReserves ? 'deployReserves' : 'deployUnit',
          player: seat,
          unitId: unit.id,
          positions,
        });
      }
      return;
    }
    // Scout move: one-shot commit at the cursor (server validates distance).
    if (s.interaction.mode === 'scouting') {
      const unit = g.units[s.interaction.unitId];
      if (unit) {
        const positions = moveFormation(unit, point);
        s.dispatch({ type: 'scoutMove', player: seat, unitId: unit.id, positions });
      }
      s.setInteraction({ mode: 'idle' });
      return;
    }
    // Move in progress for one of my units: commit at the cursor.
    const pending = g.pendingMove;
    if (pending) {
      const unit = g.units[pending.unitId];
      if (unit && unit.owner === seat) {
        const positions = moveFormation(unit, point);
        s.dispatch({ type: 'commitMove', player: seat, unitId: unit.id, positions });
        return;
      }
    }
    // Charge move: stage positions; the panel's Commit button dispatches.
    if (g.charge) {
      const unit = g.units[g.charge.unitId];
      if (unit && unit.owner === seat) {
        s.setInteraction({
          mode: 'charging',
          unitId: unit.id,
          staged: moveFormation(unit, point),
        });
        return;
      }
    }
    // Pile in / consolidate: stage positions for the Confirm button.
    const fight = g.fight;
    if (fight?.activeUnitId && (fight.stage === 'pileIn' || fight.stage === 'consolidate')) {
      const unit = g.units[fight.activeUnitId];
      if (unit && unit.owner === seat) {
        s.setInteraction({
          mode: 'engagement',
          unitId: unit.id,
          stage: fight.stage,
          staged: moveFormation(unit, point),
        });
        return;
      }
    }
    s.selectUnit(null);
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[width / 2, 0, height / 2]}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => setCursor({ x: e.point.x, y: e.point.z })}
    >
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial color="#26332a" />
    </mesh>
  );
}

function GridLines({ game }: { game: GameState }) {
  const { width, height } = game.board;
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (let x = 0; x <= width; x += 6) points.push(x, 0.02, 0, x, 0.02, height);
    for (let y = 0; y <= height; y += 6) points.push(0, 0.02, y, width, 0.02, y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geo;
  }, [width, height]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#3a4a3f" transparent opacity={0.6} />
    </lineSegments>
  );
}

function DeploymentZones({ game }: { game: GameState }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      {game.board.deploymentZones.map((zone) => (
        <mesh key={zone.player}>
          <shapeGeometry args={[polygonShape(zone.polygon)]} />
          <meshBasicMaterial
            color={playerColor(zone.player)}
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Objectives({ game }: { game: GameState }) {
  return (
    <group>
      {game.board.objectives.map((o) => (
        <group key={o.id} position={[o.position.x, 0, o.position.y]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.79, 0.79, 0.12, 24]} />
            <meshStandardMaterial color="#d4af37" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[2.9, 3.0, 48]} />
            <meshBasicMaterial color="#d4af37" transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Terrain({ game }: { game: GameState }) {
  const pieces = useMemo(
    () =>
      game.board.terrain.map((t) => ({
        id: t.id,
        geometry: new THREE.ExtrudeGeometry(polygonShape(t.footprint), {
          depth: t.height,
          bevelEnabled: false,
        }),
      })),
    [game.board.terrain],
  );
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {pieces.map((p) => (
        <mesh key={p.id} geometry={p.geometry}>
          <meshStandardMaterial color="#6b7280" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Units({ game }: { game: GameState }) {
  const datasheets = useGameStore((s) => s.datasheets);
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  return (
    <group>
      {Object.values(game.units).map((unit) => (
        <UnitMeshes
          key={unit.id}
          unit={unit}
          datasheet={datasheets[unit.datasheetId]}
          selected={unit.id === selectedUnitId}
        />
      ))}
    </group>
  );
}

function UnitMeshes({
  unit,
  datasheet,
  selected,
}: {
  unit: UnitState;
  datasheet: Datasheet | undefined;
  selected: boolean;
}) {
  const selectUnit = useGameStore((s) => s.selectUnit);
  const color = playerColor(unit.owner);
  return (
    <group>
      {aliveModels(unit)
        .filter((m) => m.position !== null)
        .map((m) => {
          const profile = profileFor(datasheet, m);
          const radius = (profile?.baseSizeMm ?? 25) / 25.4 / 2;
          const h = profile?.heightInches ?? 1.5;
          return (
            <mesh
              key={m.id}
              position={[m.position!.x, h / 2, m.position!.y]}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                selectUnit(unit.id);
              }}
            >
              <cylinderGeometry args={[radius, radius, h, 20]} />
              <meshStandardMaterial
                color={color}
                emissive={selected ? color : '#000000'}
                emissiveIntensity={selected ? 0.55 : 0}
              />
            </mesh>
          );
        })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cursor-following ghosts: deploy formation & move preview + budget ring
// ---------------------------------------------------------------------------

/** Tiny local store for the board cursor so ghosts re-render cheaply. */
const useBoardCursor = create<{ cursor: Vec2 | null; setCursor: (c: Vec2) => void }>((set) => ({
  cursor: null,
  setCursor: (cursor) => set({ cursor }),
}));

function InteractionLayer({ game }: { game: GameState }) {
  const interaction = useGameStore((s) => s.interaction);
  const seat = useGameStore((s) => s.playerIndex);
  const datasheets = useGameStore((s) => s.datasheets);
  const cursor = useBoardCursor((s) => s.cursor);

  const elements: ReactElement[] = [];

  /** Budget ring + ghost formation + live distance readout for a move-like
   * preview. `positions` fall back to a cursor-following formation. */
  const pushMovePreview = (
    key: string,
    unit: UnitState,
    budget: number,
    staged: { modelId: string; x: number; y: number }[] | null,
    color: string,
  ) => {
    const centroid = unitCentroid(unit);
    const ds = datasheets[unit.datasheetId];
    if (centroid) {
      elements.push(
        <mesh
          key={`${key}-ring`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[centroid.x, 0.04, centroid.y]}
        >
          <ringGeometry args={[Math.max(0.01, budget - 0.06), budget, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
        </mesh>,
      );
    }
    const positions = staged ?? (cursor ? moveFormation(unit, cursor) : null);
    if (positions && positions.length > 0) {
      const dist = maxMoveDistance(unit, positions);
      const over = dist > budget + 1e-6;
      const anchor = staged ? positions[0]! : { x: cursor!.x, y: cursor!.y };
      elements.push(
        <GhostFormation
          key={`${key}-ghost`}
          positions={positions}
          radius={baseDiameterInches(ds, aliveModels(unit)[0]!) / 2}
          color={over ? '#f87171' : color}
        />,
        <Html key={`${key}-dist`} position={[anchor.x + 1, 1.5, anchor.y + 1]}>
          <div className={`distance-readout ${over ? 'over' : ''}`}>
            {dist.toFixed(1)}" / {budget}"
          </div>
        </Html>,
      );
    }
  };

  // Deploy / reserves-arrival ghost.
  if ((interaction.mode === 'deploying' || interaction.mode === 'placingReserves') && cursor) {
    const unit = game.units[interaction.unitId];
    if (unit) {
      const ds = datasheets[unit.datasheetId];
      const positions = deployFormation(unit, ds, cursor);
      elements.push(
        <GhostFormation
          key="deploy-ghost"
          positions={positions}
          radius={baseDiameterInches(ds, aliveModels(unit)[0]!) / 2}
          color={playerColor(unit.owner)}
        />,
      );
    }
  }

  // Scout move preview.
  if (interaction.mode === 'scouting') {
    const unit = game.units[interaction.unitId];
    if (unit) pushMovePreview('scout', unit, interaction.budget, null, '#facc15');
  }

  // Move preview: budget ring around the unit + ghost at the cursor +
  // live distance readout.
  const pending = game.pendingMove;
  if (pending && seat !== null) {
    const unit = game.units[pending.unitId];
    if (unit && unit.owner === seat) {
      pushMovePreview('move', unit, pending.budget, null, '#facc15');
    }
  }

  // Charge move preview: ring = the 2D6 roll; clicked positions stay staged.
  if (game.charge && seat !== null) {
    const unit = game.units[game.charge.unitId];
    if (unit && unit.owner === seat) {
      const staged =
        interaction.mode === 'charging' && interaction.unitId === unit.id
          ? interaction.staged
          : null;
      pushMovePreview('charge', unit, game.charge.roll, staged, '#fb923c');
    }
  }

  // Pile in / consolidate preview: 3" budget, staged by clicking.
  const fight = game.fight;
  if (
    fight?.activeUnitId &&
    (fight.stage === 'pileIn' || fight.stage === 'consolidate') &&
    seat !== null
  ) {
    const unit = game.units[fight.activeUnitId];
    if (unit && unit.owner === seat) {
      const staged =
        interaction.mode === 'engagement' && interaction.unitId === unit.id
          ? interaction.staged
          : null;
      pushMovePreview('engagement', unit, 3, staged, '#fb923c');
    }
  }

  return <group>{elements}</group>;
}

function GhostFormation({
  positions,
  radius,
  color,
}: {
  positions: { modelId: string; x: number; y: number }[];
  radius: number;
  color: string;
}) {
  return (
    <group>
      {positions.map((p) => (
        <mesh key={p.modelId} position={[p.x, 0.5, p.y]}>
          <cylinderGeometry args={[radius, radius, 1, 16]} />
          <meshStandardMaterial color={color} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
