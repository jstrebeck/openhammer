import { useRef, useEffect, useCallback } from 'react';
import { Application, Container } from 'pixi.js';
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
import type { Point } from '@openhammer/core';
import { baseSizeToInches, offsetPolygon } from '@openhammer/core';

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
        modelLayer.sync(gameState.models, gameState.units, gameState.players, uiState.selectedModelIds);
        terrainLayer.sync(gameState.terrain, uiState.selectedTerrainId);
        deploymentZoneLayer.sync(gameState.deploymentZones);
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
      const dx = worldPos.x - model.position.x;
      const dy = worldPos.y - model.position.y;
      const r = model.baseSizeInches / 2;
      if (dx * dx + dy * dy <= r * r) return model.id;
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
        isDraggingModel.current = true;
        dragStartWorld.current = worldPos;
        dragModelStartPositions.current.clear();
        const { models } = useGameStore.getState().gameState;
        const selected = useUIStore.getState().selectedModelIds;
        for (const id of selected) {
          const m = models[id];
          if (m) dragModelStartPositions.current.set(id, { ...m.position });
        }
        const firstSelected = models[selected[0]];
        if (firstSelected) {
          movementRangeRef.current?.show(firstSelected.position, firstSelected.moveCharacteristic);
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
    } else if (tool === 'place') {
      const { board } = useGameStore.getState().gameState;
      if (worldPos.x < 0 || worldPos.x > board.width || worldPos.y < 0 || worldPos.y > board.height) return;

      const id = crypto.randomUUID();
      const model = {
        id,
        unitId: '',
        name: 'Model',
        position: worldPos,
        baseSizeMm: 32,
        baseSizeInches: baseSizeToInches(32),
        facing: 0,
        wounds: 1,
        maxWounds: 1,
        moveCharacteristic: 6,
        stats: { move: 6, toughness: 4, save: 3, wounds: 1, leadership: 6, objectiveControl: 2 },
        status: 'active' as const,
      };
      useGameStore.getState().dispatch({ type: 'PLACE_MODEL', payload: { model } });
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
      const { board } = useGameStore.getState().gameState;
      for (const [id, startPos] of dragModelStartPositions.current) {
        const newX = Math.max(0, Math.min(board.width, startPos.x + dx));
        const newY = Math.max(0, Math.min(board.height, startPos.y + dy));
        modelLayerRef.current?.setTokenPosition(id, { x: newX, y: newY });
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
          const newX = Math.max(0, Math.min(board.width, startPos.x + dx));
          const newY = Math.max(0, Math.min(board.height, startPos.y + dy));
          useGameStore.getState().dispatch({
            type: 'MOVE_MODEL',
            payload: { modelId: id, position: { x: newX, y: newY } },
          });
        }
      }

      isDraggingModel.current = false;
      dragStartWorld.current = null;
      dragModelStartPositions.current.clear();
      movementRangeRef.current?.hide();
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
