import { Container, Graphics, Text } from 'pixi.js';
import type { Model, Unit, Player, Point, BaseShape } from '@openhammer/core';
import { isEmbarkedPosition } from '@openhammer/core';
import { PIXELS_PER_INCH, SELECTION_COLOR, PLAYER_COLORS } from './constants';
import { toScreen, baseShapeToPixels } from './coordinateUtils';

/** Colors used for relative-to-local-player rendering */
const LOCAL_PLAYER_COLOR = '#3b82f6';   // blue — always "you"
const OPPONENT_PLAYER_COLOR = '#ef4444'; // red — always "them"

interface ShapePixels {
  type: 'circle' | 'oval' | 'rect';
  width: number;   // pixels
  height: number;  // pixels
  /** Longest half-axis in pixels — used for facing indicator length */
  maxRadius: number;
}

function toShapePixels(shape: BaseShape): ShapePixels {
  const { width, height } = baseShapeToPixels(shape);
  return {
    type: shape.type,
    width,
    height,
    maxRadius: Math.max(width, height) / 2,
  };
}

interface TokenState {
  container: Container;
  /** Inner container that rotates with model facing (for non-circular shapes) */
  rotatable: Container;
  baseGraphic: Graphics;
  label: Text;
  selectionRing: Graphics;
  woundText: Text;
  facingIndicator: Graphics;
  /** Pulsing red ring for battle-shocked units */
  battleShockedRing: Graphics;
  /** Green glow for charged units */
  chargedGlow: Graphics;
  /** Purple border for fight-eligible units */
  fightEligibleRing: Graphics;
  /** Crown/star icon for warlord model */
  warlordIndicator: Graphics;
  /** Shield icon for cover indicator */
  coverIndicator: Graphics;
  currentColor: number;
  shape: ShapePixels;
}

/** Draw the base shape onto a Graphics object */
function drawBaseShape(g: Graphics, shape: ShapePixels, color: number, alpha: number): void {
  g.clear();
  switch (shape.type) {
    case 'circle':
      g.circle(0, 0, shape.width / 2);
      break;
    case 'oval':
      g.ellipse(0, 0, shape.width / 2, shape.height / 2);
      break;
    case 'rect':
      g.roundRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height, 3);
      break;
  }
  g.fill({ color, alpha });
  g.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
}

/** Draw selection ring around a shape */
function drawSelectionRing(g: Graphics, shape: ShapePixels): void {
  g.clear();
  const pad = 3;
  switch (shape.type) {
    case 'circle':
      g.circle(0, 0, shape.width / 2 + pad);
      break;
    case 'oval':
      g.ellipse(0, 0, shape.width / 2 + pad, shape.height / 2 + pad);
      break;
    case 'rect':
      g.roundRect(
        -shape.width / 2 - pad, -shape.height / 2 - pad,
        shape.width + pad * 2, shape.height + pad * 2,
        5,
      );
      break;
  }
  g.stroke({ color: SELECTION_COLOR, width: 2 });
}

export class ModelLayer {
  private parent: Container;
  private container: Container;
  private tokens: Map<string, TokenState> = new Map();
  /** Model IDs currently being dragged — sync skips position updates for these */
  private draggingIds: Set<string> = new Set();
  /** Model IDs currently being rotated — sync skips facing updates for these */
  private rotatingIds: Set<string> = new Set();

  constructor(parent: Container) {
    this.parent = parent;
    this.container = new Container();
    this.container.label = 'model-layer';
    parent.addChild(this.container);
  }

  /** Mark models as being dragged — sync will skip their position updates */
  setDragging(ids: string[]): void {
    this.draggingIds = new Set(ids);
  }

  /** Clear dragging state — sync resumes position updates from game state */
  clearDragging(): void {
    this.draggingIds.clear();
  }

  /** Mark models as being rotated — sync will skip their facing updates */
  setRotating(ids: string[]): void {
    this.rotatingIds = new Set(ids);
  }

  /** Clear rotating state — sync resumes facing updates from game state */
  clearRotating(): void {
    this.rotatingIds.clear();
  }

  sync(
    models: Record<string, Model>,
    units: Record<string, Unit>,
    players: Record<string, Player>,
    selectedIds: string[],
    localPlayerId?: string | null,
    battleShocked?: string[],
    chargedUnits?: string[],
    fightEligibleUnits?: string[],
    warlordModelId?: string,
    coverUnitIds?: string[],
  ): void {
    const selectedSet = new Set(selectedIds);
    const battleShockedSet = new Set(battleShocked ?? []);
    const chargedSet = new Set(chargedUnits ?? []);
    const fightEligibleSet = new Set(fightEligibleUnits ?? []);
    const coverSet = new Set(coverUnitIds ?? []);

    // Remove tokens for deleted/embarked models
    for (const [id, token] of this.tokens) {
      if (!models[id] || models[id].status === 'destroyed' || isEmbarkedPosition(models[id].position)) {
        this.container.removeChild(token.container);
        token.container.destroy({ children: true });
        this.tokens.delete(id);
      }
    }

    // Add or update tokens
    for (const model of Object.values(models)) {
      if (model.status === 'destroyed') continue;
      if (isEmbarkedPosition(model.position)) continue;

      let token = this.tokens.get(model.id);
      if (!token) {
        token = this.createToken(model, units, players, localPlayerId);
        this.tokens.set(model.id, token);
      }

      // Update color if it changed (e.g. local player ID became known)
      const desiredColor = this.getDisplayColor(model, units, players, localPlayerId);
      if (token.currentColor !== desiredColor) {
        drawBaseShape(token.baseGraphic, token.shape, desiredColor, 0.8);
        token.currentColor = desiredColor;
      }

      // Update position — skip if model is currently being dragged
      if (!this.draggingIds.has(model.id)) {
        const screen = toScreen(model.position);
        token.container.x = screen.x;
        token.container.y = screen.y;
      }

      // Update facing — skip if model is currently being rotated
      if (!this.rotatingIds.has(model.id)) {
        this.applyFacing(token, model.facing);
      }

      // Update selection ring
      const isSelected = selectedSet.has(model.id);
      token.selectionRing.visible = isSelected;

      // Update wound text
      if (model.wounds < model.maxWounds && model.maxWounds > 1) {
        token.woundText.text = `${model.wounds}`;
        token.woundText.visible = true;
      } else {
        token.woundText.visible = false;
      }

      // Battle-shocked indicator (pulsing red ring)
      const isBattleShocked = battleShockedSet.has(model.unitId);
      token.battleShockedRing.visible = isBattleShocked;
      if (isBattleShocked) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        token.battleShockedRing.alpha = 0.4 + 0.6 * pulse;
      }

      // Charged indicator (green glow)
      const isCharged = chargedSet.has(model.unitId);
      token.chargedGlow.visible = isCharged;

      // Fight-eligible indicator (purple border)
      const isFightEligible = fightEligibleSet.has(model.unitId);
      token.fightEligibleRing.visible = isFightEligible;

      // Warlord indicator (gold star)
      token.warlordIndicator.visible = warlordModelId === model.id;

      // Cover indicator (shield icon)
      token.coverIndicator.visible = coverSet.has(model.unitId);
    }
  }

  /** Directly set token position (for drag preview, bypassing game state) */
  setTokenPosition(modelId: string, pos: Point): void {
    const token = this.tokens.get(modelId);
    if (!token) return;
    const screen = toScreen(pos);
    token.container.x = screen.x;
    token.container.y = screen.y;
  }

  /** Directly set token rotation (for rotate preview, bypassing game state) */
  setTokenRotation(modelId: string, facingDeg: number): void {
    const token = this.tokens.get(modelId);
    if (!token) return;
    this.applyFacing(token, facingDeg);
  }

  /** Apply facing to a token — rotates the shape and updates the facing indicator */
  private applyFacing(token: TokenState, facingDeg: number): void {
    // Rotate the shape container (only visually meaningful for non-circles)
    if (token.shape.type !== 'circle') {
      token.rotatable.rotation = (facingDeg - 90) * (Math.PI / 180);
    }
    // Facing indicator always drawn in world space (on the outer container)
    this.drawFacingIndicator(token.facingIndicator, token.shape.maxRadius, facingDeg);
  }

  private drawFacingIndicator(g: Graphics, radius: number, facingDeg: number): void {
    g.clear();
    const rad = (facingDeg - 90) * (Math.PI / 180); // 0° = up
    const endX = Math.cos(rad) * radius;
    const endY = Math.sin(rad) * radius;
    g.moveTo(0, 0);
    g.lineTo(endX, endY);
    g.stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    // Small arrowhead
    const headLen = Math.min(6, radius * 0.4);
    const a1 = rad + Math.PI * 0.8;
    const a2 = rad - Math.PI * 0.8;
    g.moveTo(endX, endY);
    g.lineTo(endX + Math.cos(a1) * headLen, endY + Math.sin(a1) * headLen);
    g.stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    g.moveTo(endX, endY);
    g.lineTo(endX + Math.cos(a2) * headLen, endY + Math.sin(a2) * headLen);
    g.stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
  }

  /** Compute the display color for a model based on local player perspective */
  private getDisplayColor(
    model: Model,
    units: Record<string, Unit>,
    players: Record<string, Player>,
    localPlayerId?: string | null,
  ): number {
    const unit = units[model.unitId];
    if (localPlayerId && unit) {
      // Relative coloring: your models are blue, opponent's are red
      const color = unit.playerId === localPlayerId ? LOCAL_PLAYER_COLOR : OPPONENT_PLAYER_COLOR;
      return parseInt(color.replace('#', ''), 16);
    }
    // Fallback for local/non-multiplayer: use the player's assigned color
    const player = unit ? players[unit.playerId] : undefined;
    const color = player?.color ?? PLAYER_COLORS[0];
    return parseInt(color.replace('#', ''), 16);
  }

  private createToken(
    model: Model,
    units: Record<string, Unit>,
    players: Record<string, Player>,
    localPlayerId?: string | null,
  ): TokenState {
    const container = new Container();
    container.label = `token-${model.id}`;

    const shape = toShapePixels(model.baseShape);
    const colorNum = this.getDisplayColor(model, units, players, localPlayerId);

    // Selection ring (in outer container — doesn't rotate)
    const selectionRing = new Graphics();
    drawSelectionRing(selectionRing, shape);
    selectionRing.visible = false;
    container.addChild(selectionRing);

    // Rotatable inner container for the base shape
    const rotatable = new Container();
    container.addChild(rotatable);

    // Base shape
    const baseGraphic = new Graphics();
    drawBaseShape(baseGraphic, shape, colorNum, 0.8);
    rotatable.addChild(baseGraphic);

    // Apply initial facing rotation for non-circles
    if (shape.type !== 'circle') {
      rotatable.rotation = (model.facing - 90) * (Math.PI / 180);
    }

    // Facing indicator — in outer container (world-space, not rotated with shape)
    const facingIndicator = new Graphics();
    this.drawFacingIndicator(facingIndicator, shape.maxRadius, model.facing);
    container.addChild(facingIndicator);

    // Label (outer container — always upright)
    const displayName = model.name.charAt(0).toUpperCase();
    const labelSize = Math.max(8, Math.min(shape.width, shape.height) / 2);
    const label = new Text({
      text: displayName,
      style: {
        fontSize: labelSize,
        fill: 0xffffff,
        fontFamily: 'monospace',
      },
    });
    label.anchor.set(0.5);
    container.addChild(label);

    // Wound counter (outer container — always upright, below shape)
    const woundText = new Text({
      text: '',
      style: {
        fontSize: 8,
        fill: 0xff4444,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      },
    });
    woundText.anchor.set(0.5);
    woundText.y = shape.height / 2 + 6;
    woundText.visible = false;
    container.addChild(woundText);

    // Battle-shocked ring (red pulsing ring, slightly larger than selection ring)
    const battleShockedRing = new Graphics();
    const bsPad = 5;
    switch (shape.type) {
      case 'circle':
        battleShockedRing.circle(0, 0, shape.width / 2 + bsPad);
        break;
      case 'oval':
        battleShockedRing.ellipse(0, 0, shape.width / 2 + bsPad, shape.height / 2 + bsPad);
        break;
      case 'rect':
        battleShockedRing.roundRect(
          -shape.width / 2 - bsPad, -shape.height / 2 - bsPad,
          shape.width + bsPad * 2, shape.height + bsPad * 2, 5,
        );
        break;
    }
    battleShockedRing.stroke({ color: 0xff2222, width: 2.5 });
    battleShockedRing.visible = false;
    container.addChild(battleShockedRing);

    // Charged glow (green glow ring)
    const chargedGlow = new Graphics();
    const cgPad = 4;
    switch (shape.type) {
      case 'circle':
        chargedGlow.circle(0, 0, shape.width / 2 + cgPad);
        break;
      case 'oval':
        chargedGlow.ellipse(0, 0, shape.width / 2 + cgPad, shape.height / 2 + cgPad);
        break;
      case 'rect':
        chargedGlow.roundRect(
          -shape.width / 2 - cgPad, -shape.height / 2 - cgPad,
          shape.width + cgPad * 2, shape.height + cgPad * 2, 5,
        );
        break;
    }
    chargedGlow.fill({ color: 0x22c55e, alpha: 0.15 });
    chargedGlow.stroke({ color: 0x22c55e, width: 2, alpha: 0.6 });
    chargedGlow.visible = false;
    container.addChild(chargedGlow);

    // Fight-eligible ring (purple border)
    const fightEligibleRing = new Graphics();
    const fePad = 6;
    switch (shape.type) {
      case 'circle':
        fightEligibleRing.circle(0, 0, shape.width / 2 + fePad);
        break;
      case 'oval':
        fightEligibleRing.ellipse(0, 0, shape.width / 2 + fePad, shape.height / 2 + fePad);
        break;
      case 'rect':
        fightEligibleRing.roundRect(
          -shape.width / 2 - fePad, -shape.height / 2 - fePad,
          shape.width + fePad * 2, shape.height + fePad * 2, 5,
        );
        break;
    }
    fightEligibleRing.stroke({ color: 0x8b5cf6, width: 2, alpha: 0.7 });
    fightEligibleRing.visible = false;
    container.addChild(fightEligibleRing);

    // Warlord indicator (gold star above the model)
    const warlordIndicator = new Graphics();
    const starSize = 5;
    const starY = -(shape.height / 2 + 8);
    // Draw a simple 5-pointed star
    for (let i = 0; i < 5; i++) {
      const outerAngle = (i * 72 - 90) * (Math.PI / 180);
      const innerAngle = ((i * 72 + 36) - 90) * (Math.PI / 180);
      const ox = Math.cos(outerAngle) * starSize;
      const oy = starY + Math.sin(outerAngle) * starSize;
      const ix = Math.cos(innerAngle) * (starSize * 0.4);
      const iy = starY + Math.sin(innerAngle) * (starSize * 0.4);
      if (i === 0) warlordIndicator.moveTo(ox, oy);
      else warlordIndicator.lineTo(ox, oy);
      warlordIndicator.lineTo(ix, iy);
    }
    warlordIndicator.closePath();
    warlordIndicator.fill({ color: 0xf59e0b, alpha: 0.9 });
    warlordIndicator.stroke({ color: 0xffffff, width: 0.5, alpha: 0.7 });
    warlordIndicator.visible = false;
    container.addChild(warlordIndicator);

    // Cover indicator (shield icon to the side)
    const coverIndicator = new Graphics();
    const shieldX = shape.width / 2 + 6;
    const shieldY = -shape.height / 2;
    coverIndicator.roundRect(shieldX - 3, shieldY - 3, 6, 8, 1);
    coverIndicator.fill({ color: 0x22c55e, alpha: 0.8 });
    coverIndicator.stroke({ color: 0xffffff, width: 0.5, alpha: 0.5 });
    coverIndicator.visible = false;
    container.addChild(coverIndicator);

    this.container.addChild(container);

    return { container, rotatable, baseGraphic, label, selectionRing, woundText, facingIndicator, battleShockedRing, chargedGlow, fightEligibleRing, warlordIndicator, coverIndicator, currentColor: colorNum, shape };
  }
}
