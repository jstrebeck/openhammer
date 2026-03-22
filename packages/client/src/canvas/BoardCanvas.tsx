import { useRef, useEffect, useCallback } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { PIXELS_PER_INCH, BOARD_BG_COLOR } from './constants';
import { toWorld } from './coordinateUtils';
import { drawBoard } from './Board';
import { ModelLayer } from './ModelLayer';
import { TerrainLayer } from './TerrainLayer';
import { SelectionBoxGraphic } from './SelectionBox';
import { RulerGraphic } from './RulerTool';
import { MovementRangeGraphic } from './MovementRangeOverlay';
import { LoSGraphic } from './LoSTool';
import { TerrainPlacementPreview } from './TerrainPlacementPreview';
import { DeploymentZoneLayer } from './DeploymentZoneLayer';
import { ObjectiveLayer } from './ObjectiveLayer';
import { AuraOverlay } from './AuraOverlay';
import { EngagementRangeOverlay } from './EngagementRangeOverlay';
import { CoherencyOverlay } from './CoherencyOverlay';
import type { Point, BaseShape } from '@openhammer/core';
import { offsetPolygon, baseShapeDimensionsInches, distance as measureDistance } from '@openhammer/core';
import { useMultiplayerStore } from '../networking/useMultiplayer';

/** Test if a world-space point is inside a model's base shape (accounting for facing rotation) */
function pointInBaseShape(point: Point, center: Point, shape: BaseShape, facingDeg: number): boolean {
  let dx = point.x - center.x;
  let dy = point.y - center.y;

  if (shape.type === 'circle') {
    const r = shape.diameterMm / 25.4 / 2;
    return dx * dx + dy * dy <= r * r;
  }

  // Rotate point into the shape's local frame (undo facing rotation)
  const rad = -(facingDeg - 90) * (Math.PI / 180);
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

  const dims = baseShapeDimensionsInches(shape);
  const hw = dims.width / 2;
  const hh = dims.height / 2;

  if (shape.type === 'rect') {
    return Math.abs(rx) <= hw && Math.abs(ry) <= hh;
  }

  // oval: test (rx/hw)^2 + (ry/hh)^2 <= 1
  return (rx * rx) / (hw * hw) + (ry * ry) / (hh * hh) <= 1;
}

/** Clamp a model's new position to its max movement distance from its start position.
 *  Returns startPos (no movement) if game is live and not in movement phase or no movement declared. */
function clampToMoveRange(modelId: string, startPos: Point, newPos: Point): Point {
  const gs = useGameStore.getState().gameState;
  const model = gs.models[modelId];
  if (!model?.unitId || gs.rulesConfig.movementRange !== 'enforce') return newPos;

  // Before game starts (setup/deployment): free placement
  const gameStarted = gs.gameStarted;
  if (!gameStarted) return newPos;

  const moveType = gs.turnTracking.unitMovement[model.unitId];
  if (!moveType) return startPos; // no declared movement — block move
  if (moveType === 'stationary') return startPos; // can't move at all

  const moveChar = model.moveCharacteristic;
  const advanceBonus = moveType === 'advance' ? (gs.turnTracking.advanceRolls[model.unitId] ?? 0) : 0;
  const maxDist = moveChar + advanceBonus;

  const dx = newPos.x - startPos.x;
  const dy = newPos.y - startPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= maxDist) return newPos;

  // Clamp to max distance along the same direction
  const ratio = maxDist / dist;
  return {
    x: startPos.x + dx * ratio,
    y: startPos.y + dy * ratio,
  };
}

export function BoardCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const modelLayerRef = useRef<ModelLayer | null>(null);
  const terrainLayerRef = useRef<TerrainLayer | null>(null);
  const selectionBoxRef = useRef<SelectionBoxGraphic | null>(null);
  const rulerRef = useRef<RulerGraphic | null>(null);
  const movementRangeRef = useRef<MovementRangeGraphic | null>(null);
  const losRef = useRef<LoSGraphic | null>(null);
  const terrainPreviewRef = useRef<TerrainPlacementPreview | null>(null);
  const deploymentZoneLayerRef = useRef<DeploymentZoneLayer | null>(null);
  const objectiveLayerRef = useRef<ObjectiveLayer | null>(null);
  const auraRef = useRef<AuraOverlay | null>(null);
  const engagementRangeRef = useRef<EngagementRangeOverlay | null>(null);
  const coherencyRef = useRef<CoherencyOverlay | null>(null);
  const pathLineRef = useRef<Graphics | null>(null);
  const pathLabelRef = useRef<Text | null>(null);
  const weaponRangeRef = useRef<Graphics | null>(null);

  // Drag state refs
  const isDraggingModel = useRef(false);
  const dragStartWorld = useRef<Point | null>(null);
  const dragModelStartPositions = useRef<Map<string, Point>>(new Map());
  const isBoxSelecting = useRef(false);
  const boxSelectStart = useRef<{ x: number; y: number } | null>(null);
  const isPanning = useRef(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const isRuling = useRef(false);
  const rulerStart = useRef<Point | null>(null);
  const cursorWorld = useRef<Point | null>(null);
  // Rotation state refs
  const isRotating = useRef(false);
  const rotateModelIds = useRef<string[]>([]);
  const rotateCenters = useRef<Map<string, Point>>(new Map());

  // Init PixiJS
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    let app: Application | null = null;

    (async () => {
      const newApp = new Application();

      await newApp.init({
        background: BOARD_BG_COLOR,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      // StrictMode cleanup may have run during await — bail out safely
      if (destroyed) {
        newApp.destroy(true, { children: true });
        return;
      }

      app = newApp;
      appRef.current = app;

      // Manually size the canvas to the container (avoid resizeTo race condition)
      app.renderer.resize(container.clientWidth, container.clientHeight);
      container.appendChild(app.canvas);

      const world = new Container();
      world.label = 'world';
      worldRef.current = world;
      app.stage.addChild(world);

      const { board } = useGameStore.getState().gameState;
      drawBoard(world, board.width, board.height);

      // Layers ordered bottom to top
      const deploymentZoneLayer = new DeploymentZoneLayer(world);
      deploymentZoneLayerRef.current = deploymentZoneLayer;

      const terrainLayer = new TerrainLayer(world);
      terrainLayerRef.current = terrainLayer;

      const objectiveLayer = new ObjectiveLayer(world);
      objectiveLayerRef.current = objectiveLayer;

      const modelLayer = new ModelLayer(world);
      modelLayerRef.current = modelLayer;

      const selBox = new SelectionBoxGraphic(world);
      selectionBoxRef.current = selBox;

      const ruler = new RulerGraphic(world);
      rulerRef.current = ruler;

      const moveRange = new MovementRangeGraphic(world);
      movementRangeRef.current = moveRange;

      const los = new LoSGraphic(world);
      losRef.current = los;

      const terrainPreview = new TerrainPlacementPreview(world);
      terrainPreviewRef.current = terrainPreview;

      const aura = new AuraOverlay(world);
      auraRef.current = aura;

      const engagementRange = new EngagementRangeOverlay(world);
      engagementRangeRef.current = engagementRange;

      const coherency = new CoherencyOverlay(world);
      coherencyRef.current = coherency;

      const pathLine = new Graphics();
      pathLine.label = 'path-line';
      world.addChild(pathLine);
      pathLineRef.current = pathLine;

      const pathLabel = new Text({
        text: '',
        style: { fontSize: 12, fill: 0xfbbf24, fontFamily: 'monospace', fontWeight: 'bold' },
      });
      pathLabel.anchor.set(0.5);
      pathLabel.visible = false;
      world.addChild(pathLabel);
      pathLabelRef.current = pathLabel;

      const weaponRange = new Graphics();
      weaponRange.label = 'weapon-range';
      world.addChild(weaponRange);
      weaponRangeRef.current = weaponRange;

      // Center the board
      const bw = board.width * PIXELS_PER_INCH;
      const bh = board.height * PIXELS_PER_INCH;
      world.x = (app.screen.width - bw) / 2;
      world.y = (app.screen.height - bh) / 2;

      // Handle window resize
      const onResize = () => {
        if (!app || destroyed) return;
        app.renderer.resize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener('resize', onResize);

      // Sync loop
      app.ticker.add(() => {
        if (destroyed) return;
        const { gameState } = useGameStore.getState();
        const uiState = useUIStore.getState();
        const localPlayerId = useMultiplayerStore.getState().playerId;
        modelLayer.sync(
          gameState.models, gameState.units, gameState.players, uiState.selectedModelIds, localPlayerId,
          gameState.battleShocked,
          gameState.turnTracking.chargedUnits,
          gameState.fightState?.eligibleUnits,
        );
        terrainLayer.sync(gameState.terrain, uiState.selectedTerrainId);
        if (uiState.showDeploymentZones) {
          deploymentZoneLayer.sync(gameState.deploymentZones);
        } else {
          deploymentZoneLayer.sync({});
        }
        objectiveLayer.sync(gameState.objectives, gameState.players);

        // Update terrain placement preview
        if (uiState.activeTool === 'terrain' && uiState.terrainPlacement.mode === 'draw') {
          terrainPreview.draw(uiState.terrainPlacement.vertices, cursorWorld.current);
        } else {
          terrainPreview.clear();
        }

        // Aura: show 6" aura ring when exactly one model is selected (select tool)
        if (uiState.activeTool === 'select' && uiState.selectedModelIds.length === 1) {
          const m = gameState.models[uiState.selectedModelIds[0]];
          if (m && m.status === 'active') {
            aura.show(m.position, 6);
          } else {
            aura.hide();
          }
        } else {
          aura.hide();
        }

        // Coherency overlay: show when a unit with >1 model is selected
        if (uiState.selectedModelIds.length > 0) {
          const firstModel = gameState.models[uiState.selectedModelIds[0]];
          if (firstModel?.unitId) {
            const unit = gameState.units[firstModel.unitId];
            if (unit && unit.modelIds.length > 1) {
              const unitModels = unit.modelIds
                .map((id) => gameState.models[id])
                .filter((m) => m && m.status === 'active')
                .map((m) => ({ id: m.id, position: m.position }));
              if (unitModels.length > 1) {
                coherency.show(unitModels, 2);
              } else {
                coherency.hide();
              }
            } else {
              coherency.hide();
            }
          } else {
            coherency.hide();
          }
        } else {
          coherency.hide();
        }

        // Weapon range rings: show during shooting phase when a unit is selected
        const editionPhaseNames = ['command', 'movement', 'shooting', 'charge', 'fight', 'morale'];
        const currentPhaseName = editionPhaseNames[gameState.turnState.currentPhaseIndex] ?? '';
        if (currentPhaseName === 'shooting' && uiState.selectedModelIds.length > 0) {
          const firstModel = gameState.models[uiState.selectedModelIds[0]];
          if (firstModel?.unitId) {
            const unit = gameState.units[firstModel.unitId];
            if (unit) {
              // Find max range of ranged weapons
              const maxRange = unit.weapons
                .filter((w) => w.type === 'ranged' && w.range != null)
                .reduce((max, w) => Math.max(max, w.range!), 0);

              if (maxRange > 0) {
                weaponRange.clear();
                // Draw range ring from each active model in the unit
                const activeModels = unit.modelIds
                  .map((id) => gameState.models[id])
                  .filter((m) => m && m.status === 'active');
                for (const m of activeModels) {
                  const cx = m.position.x * PIXELS_PER_INCH;
                  const cy = m.position.y * PIXELS_PER_INCH;
                  const r = maxRange * PIXELS_PER_INCH;
                  weaponRange.circle(cx, cy, r);
                  weaponRange.fill({ color: 0xf59e0b, alpha: 0.03 });
                  weaponRange.stroke({ color: 0xf59e0b, width: 1, alpha: 0.3 });
                }
              } else {
                weaponRange.clear();
              }
            } else {
              weaponRange.clear();
            }
          } else {
            weaponRange.clear();
          }
        } else {
          weaponRange.clear();
        }
      });
    })();

    return () => {
      destroyed = true;
      if (app) {
        app.destroy(true, { children: true });
      }
      appRef.current = null;
      worldRef.current = null;
    };
  }, []);

  const eventToWorld = useCallback((e: React.MouseEvent): Point => {
    const world = worldRef.current;
    if (!world) return { x: 0, y: 0 };
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return toWorld((sx - world.x) / world.scale.x, (sy - world.y) / world.scale.y);
  }, []);

  const eventToScreen = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const hitTestModel = useCallback((worldPos: Point): string | null => {
    const { models } = useGameStore.getState().gameState;
    for (const model of Object.values(models)) {
      if (model.status === 'destroyed') continue;
      if (pointInBaseShape(worldPos, model.position, model.baseShape, model.facing)) {
        return model.id;
      }
    }
    return null;
  }, []);

  const hitTestTerrain = useCallback((worldPos: Point): string | null => {
    const { terrain } = useGameStore.getState().gameState;
    return terrainLayerRef.current?.hitTest(worldPos.x, worldPos.y, terrain) ?? null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const tool = useUIStore.getState().activeTool;
    const worldPos = eventToWorld(e);
    const screenPos = eventToScreen(e);

    useUIStore.getState().closeContextMenu();

    // Right-click: context menu
    if (e.button === 2) {
      const hitModelId = hitTestModel(worldPos);
      if (hitModelId) {
        useUIStore.getState().openContextMenu('model', hitModelId, e.clientX, e.clientY);
        return;
      }
      const hitTerrainId = hitTestTerrain(worldPos);
      if (hitTerrainId) {
        useUIStore.getState().openContextMenu('terrain', hitTerrainId, e.clientX, e.clientY);
        return;
      }
      return;
    }

    // Middle mouse: pan
    if (e.button === 1) {
      isPanning.current = true;
      panStart.current = screenPos;
      return;
    }

    if (tool === 'select') {
      const hitModelId = hitTestModel(worldPos);
      if (hitModelId) {
        const { selectedModelIds } = useUIStore.getState();
        if (e.shiftKey) {
          useUIStore.getState().toggleModelSelection(hitModelId);
        } else if (!selectedModelIds.includes(hitModelId)) {
          useUIStore.getState().setSelectedModelIds([hitModelId]);
        }

        // Check if dragging is allowed: before game starts (setup) or during movement phase
        const gs = useGameStore.getState().gameState;
        const gameStarted = gs.gameStarted;
        const editionPhases = [
          'command', 'movement', 'shooting', 'charge', 'fight', 'morale',
        ];
        const currentPhaseId = editionPhases[gs.turnState.currentPhaseIndex] ?? '';
        const canDrag = !gameStarted || currentPhaseId === 'movement';

        if (canDrag) {
          isDraggingModel.current = true;
          dragStartWorld.current = worldPos;
          dragModelStartPositions.current.clear();
          const { models } = gs;
          const selected = useUIStore.getState().selectedModelIds;
          for (const id of selected) {
            const m = models[id];
            if (m) dragModelStartPositions.current.set(id, { ...m.position });
          }
          // Tell model layer to skip syncing positions for dragged models
          modelLayerRef.current?.setDragging(selected);
          const firstSelected = models[selected[0]];
          if (firstSelected) {
            let moveRange = firstSelected.moveCharacteristic;
            if (firstSelected.unitId) {
              const moveType = gs.turnTracking.unitMovement[firstSelected.unitId];
              if (moveType === 'advance') {
                moveRange += gs.turnTracking.advanceRolls[firstSelected.unitId] ?? 0;
              }
            }
            movementRangeRef.current?.show(firstSelected.position, moveRange);
          }
        }
      } else {
        // Check terrain hit
        const hitTerrainId = hitTestTerrain(worldPos);
        if (hitTerrainId) {
          useUIStore.getState().setSelectedTerrainId(hitTerrainId);
        } else {
          if (!e.shiftKey) useUIStore.getState().clearSelection();
          isBoxSelecting.current = true;
          boxSelectStart.current = worldPos;
        }
      }
    } else if (tool === 'rotate') {
      const hitModelId = hitTestModel(worldPos);
      if (hitModelId) {
        const gs = useGameStore.getState().gameState;
        // If clicked model is already selected, rotate all selected; otherwise just this one
        const { selectedModelIds } = useUIStore.getState();
        let ids: string[];
        if (selectedModelIds.includes(hitModelId)) {
          ids = selectedModelIds;
        } else {
          ids = [hitModelId];
          useUIStore.getState().setSelectedModelIds(ids);
        }
        isRotating.current = true;
        rotateModelIds.current = ids;
        rotateCenters.current.clear();
        for (const id of ids) {
          const m = gs.models[id];
          if (m) rotateCenters.current.set(id, { ...m.position });
        }
        modelLayerRef.current?.setRotating(ids);
      }
    } else if (tool === 'measure') {
      if (!isRuling.current) {
        isRuling.current = true;
        rulerStart.current = worldPos;
        rulerRef.current?.startRuler(worldPos);
      } else {
        rulerRef.current?.endRuler(worldPos);
        isRuling.current = false;
        rulerStart.current = null;
      }
    } else if (tool === 'terrain') {
      const { terrainPlacement } = useUIStore.getState();

      if (terrainPlacement.mode === 'template' && terrainPlacement.template) {
        // Place the selected template at click position
        const polygon = offsetPolygon(terrainPlacement.template.polygon, worldPos);
        const terrain = {
          id: crypto.randomUUID(),
          polygon,
          height: terrainPlacement.template.height,
          traits: [...terrainPlacement.template.traits],
          label: terrainPlacement.template.name,
        };
        useGameStore.getState().dispatch({ type: 'PLACE_TERRAIN', payload: { terrain } });
      } else if (terrainPlacement.mode === 'draw') {
        // Add vertex to the polygon being drawn
        useUIStore.getState().addTerrainVertex(worldPos);
      }
    } else if (tool === 'los') {
      const hitId = hitTestModel(worldPos);
      if (!hitId) return;

      const { losSourceModelId } = useUIStore.getState();
      if (!losSourceModelId) {
        useUIStore.getState().setLoSSourceModelId(hitId);
        useUIStore.getState().setSelectedModelIds([hitId]);
      } else {
        // Draw LoS between source and target
        const { models, terrain } = useGameStore.getState().gameState;
        const from = models[losSourceModelId];
        const to = models[hitId];
        if (from && to) {
          losRef.current?.draw(from, to, terrain);
        }
        useUIStore.getState().setLoSSourceModelId(null);
        useUIStore.getState().setSelectedModelIds([]);
      }
    } else if (tool === 'objective') {
      const { board, objectives } = useGameStore.getState().gameState;
      if (worldPos.x < 0 || worldPos.x > board.width || worldPos.y < 0 || worldPos.y > board.height) return;
      const nextNumber = Object.keys(objectives).length + 1;
      const objective = {
        id: crypto.randomUUID(),
        position: worldPos,
        number: nextNumber,
      };
      useGameStore.getState().dispatch({ type: 'PLACE_OBJECTIVE', payload: { objective } });
    }
  }, [eventToWorld, eventToScreen, hitTestModel, hitTestTerrain]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = eventToWorld(e);
    const screenPos = eventToScreen(e);
    cursorWorld.current = worldPos;

    if (isPanning.current && panStart.current && worldRef.current) {
      const dx = screenPos.x - panStart.current.x;
      const dy = screenPos.y - panStart.current.y;
      worldRef.current.x += dx;
      worldRef.current.y += dy;
      panStart.current = screenPos;
      return;
    }

    if (isDraggingModel.current && dragStartWorld.current) {
      const dx = worldPos.x - dragStartWorld.current.x;
      const dy = worldPos.y - dragStartWorld.current.y;
      const gs = useGameStore.getState().gameState;
      const { board } = gs;
      for (const [id, startPos] of dragModelStartPositions.current) {
        let newX = Math.max(0, Math.min(board.width, startPos.x + dx));
        let newY = Math.max(0, Math.min(board.height, startPos.y + dy));
        const clamped = clampToMoveRange(id, startPos, { x: newX, y: newY });
        newX = Math.max(0, Math.min(board.width, clamped.x));
        newY = Math.max(0, Math.min(board.height, clamped.y));
        modelLayerRef.current?.setTokenPosition(id, { x: newX, y: newY });

        // Draw path line from start to current position (first selected model)
        if (id === [...dragModelStartPositions.current.keys()][0]) {
          const pathLine = pathLineRef.current;
          const pathLabel = pathLabelRef.current;
          if (pathLine && pathLabel) {
            const x1 = startPos.x * PIXELS_PER_INCH;
            const y1 = startPos.y * PIXELS_PER_INCH;
            const x2 = newX * PIXELS_PER_INCH;
            const y2 = newY * PIXELS_PER_INCH;
            pathLine.clear();
            pathLine.moveTo(x1, y1);
            pathLine.lineTo(x2, y2);
            pathLine.stroke({ color: 0xfbbf24, width: 2, alpha: 0.7 });
            pathLine.circle(x1, y1, 3);
            pathLine.fill({ color: 0xfbbf24 });
            pathLine.circle(x2, y2, 3);
            pathLine.fill({ color: 0xfbbf24 });

            const dist = measureDistance(startPos, { x: newX, y: newY });
            pathLabel.text = `${dist.toFixed(1)}"`;
            pathLabel.x = (x1 + x2) / 2;
            pathLabel.y = (y1 + y2) / 2 - 12;
            pathLabel.visible = true;
          }
        }
      }

      // Show engagement range overlay for enemy models during drag
      const selectedIds = useUIStore.getState().selectedModelIds;
      const firstSelected = gs.models[selectedIds[0]];
      if (firstSelected?.unitId) {
        const selectedUnit = gs.units[firstSelected.unitId];
        if (selectedUnit) {
          const enemyModels = Object.values(gs.models)
            .filter((m) => m.status === 'active' && m.unitId)
            .filter((m) => {
              const u = gs.units[m.unitId];
              return u && u.playerId !== selectedUnit.playerId;
            })
            .map((m) => ({ position: m.position, baseSizeInches: m.baseSizeInches }));
          engagementRangeRef.current?.show(enemyModels);
        }
      }

      return;
    }

    if (isRotating.current) {
      for (const [id, center] of rotateCenters.current) {
        const dx = worldPos.x - center.x;
        const dy = worldPos.y - center.y;
        // atan2 gives angle from positive-x; add 90° so 0° = up (north)
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const normalized = ((angleDeg % 360) + 360) % 360;
        modelLayerRef.current?.setTokenRotation(id, normalized);
      }
      return;
    }

    if (isBoxSelecting.current && boxSelectStart.current) {
      selectionBoxRef.current?.draw(boxSelectStart.current, worldPos);
      return;
    }

    if (isRuling.current && rulerStart.current) {
      rulerRef.current?.updateRuler(worldPos);
    }
  }, [eventToWorld, eventToScreen]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const worldPos = eventToWorld(e);

    if (isPanning.current) {
      isPanning.current = false;
      panStart.current = null;
      return;
    }

    if (isDraggingModel.current && dragStartWorld.current) {
      const dx = worldPos.x - dragStartWorld.current.x;
      const dy = worldPos.y - dragStartWorld.current.y;
      const { board } = useGameStore.getState().gameState;

      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        for (const [id, startPos] of dragModelStartPositions.current) {
          let newX = Math.max(0, Math.min(board.width, startPos.x + dx));
          let newY = Math.max(0, Math.min(board.height, startPos.y + dy));
          const clamped = clampToMoveRange(id, startPos, { x: newX, y: newY });
          newX = Math.max(0, Math.min(board.width, clamped.x));
          newY = Math.max(0, Math.min(board.height, clamped.y));
          useGameStore.getState().dispatch({
            type: 'MOVE_MODEL',
            payload: { modelId: id, position: { x: newX, y: newY } },
          });
        }
      }

      isDraggingModel.current = false;
      dragStartWorld.current = null;
      dragModelStartPositions.current.clear();
      modelLayerRef.current?.clearDragging();
      movementRangeRef.current?.hide();
      pathLineRef.current?.clear();
      if (pathLabelRef.current) pathLabelRef.current.visible = false;
      engagementRangeRef.current?.hide();
      return;
    }

    if (isRotating.current) {
      // Commit rotation for all models
      for (const [id, center] of rotateCenters.current) {
        const dx = worldPos.x - center.x;
        const dy = worldPos.y - center.y;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const normalized = ((angleDeg % 360) + 360) % 360;
        useGameStore.getState().dispatch({
          type: 'ROTATE_MODEL',
          payload: { modelId: id, facing: normalized },
        });
      }
      isRotating.current = false;
      rotateModelIds.current = [];
      rotateCenters.current.clear();
      modelLayerRef.current?.clearRotating();
      return;
    }

    if (isBoxSelecting.current && boxSelectStart.current) {
      const minX = Math.min(boxSelectStart.current.x, worldPos.x);
      const maxX = Math.max(boxSelectStart.current.x, worldPos.x);
      const minY = Math.min(boxSelectStart.current.y, worldPos.y);
      const maxY = Math.max(boxSelectStart.current.y, worldPos.y);

      const { models } = useGameStore.getState().gameState;
      const selected: string[] = [];
      for (const model of Object.values(models)) {
        if (model.status === 'destroyed') continue;
        if (
          model.position.x >= minX &&
          model.position.x <= maxX &&
          model.position.y >= minY &&
          model.position.y <= maxY
        ) {
          selected.push(model.id);
        }
      }

      const prev = useUIStore.getState().selectedModelIds;
      useUIStore.getState().setSelectedModelIds([...new Set([...prev, ...selected])]);

      isBoxSelecting.current = false;
      boxSelectStart.current = null;
      selectionBoxRef.current?.clear();
    }
  }, [eventToWorld]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const world = worldRef.current;
    if (!world) return;

    const rect = containerRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.25, Math.min(3, world.scale.x * zoomFactor));

    const worldX = (mouseX - world.x) / world.scale.x;
    const worldY = (mouseY - world.y) / world.scale.y;

    world.scale.set(newScale);
    world.x = mouseX - worldX * newScale;
    world.y = mouseY - worldY * newScale;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // --- Touch support ---
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef<number>(1);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartScale.current = worldRef.current?.scale.x ?? 1;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const world = worldRef.current;
    if (!world) return;

    if (e.touches.length === 1 && touchStartRef.current) {
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      world.x += dx;
      world.y += dy;
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2 && pinchStartDist.current != null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = Math.max(0.25, Math.min(3, pinchStartScale.current * (dist / pinchStartDist.current)));
      world.scale.set(scale);
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Tap-to-select: if touch didn't move much, treat as a click
    if (e.changedTouches.length === 1 && touchStartRef.current) {
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        // Simulate a click at this position
        const world = worldRef.current;
        if (world) {
          const rect = containerRef.current!.getBoundingClientRect();
          const sx = t.clientX - rect.left;
          const sy = t.clientY - rect.top;
          const worldPos = toWorld((sx - world.x) / world.scale.x, (sy - world.y) / world.scale.y);
          const hitId = hitTestModel(worldPos);
          if (hitId) {
            useUIStore.getState().setSelectedModelIds([hitId]);
          } else {
            useUIStore.getState().clearSelection();
          }
        }
      }
    }
    touchStartRef.current = null;
    pinchStartDist.current = null;
  }, [hitTestModel]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full touch-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
}
