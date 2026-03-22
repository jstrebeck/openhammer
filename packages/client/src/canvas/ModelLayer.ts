import { Container, Graphics, Text } from 'pixi.js';
import type { Model, Unit, Player, Point } from '@openhammer/core';
import { PIXELS_PER_INCH, SELECTION_COLOR, PLAYER_COLORS } from './constants';
import { toScreen, baseRadiusToPixels } from './coordinateUtils';

interface TokenState {
  container: Container;
  circle: Graphics;
  label: Text;
  selectionRing: Graphics;
  woundText: Text;
}

export class ModelLayer {
  private parent: Container;
  private container: Container;
  private tokens: Map<string, TokenState> = new Map();

  constructor(parent: Container) {
    this.parent = parent;
    this.container = new Container();
    this.container.label = 'model-layer';
    parent.addChild(this.container);
  }

  sync(
    models: Record<string, Model>,
    units: Record<string, Unit>,
    players: Record<string, Player>,
    selectedIds: string[],
  ): void {
    const selectedSet = new Set(selectedIds);

    // Remove tokens for deleted models
    for (const [id, token] of this.tokens) {
      if (!models[id] || models[id].status === 'destroyed') {
        this.container.removeChild(token.container);
        token.container.destroy({ children: true });
        this.tokens.delete(id);
      }
    }

    // Add or update tokens
    for (const model of Object.values(models)) {
      if (model.status === 'destroyed') continue;

      let token = this.tokens.get(model.id);
      if (!token) {
        token = this.createToken(model, units, players);
        this.tokens.set(model.id, token);
      }

      // Update position
      const screen = toScreen(model.position);
      token.container.x = screen.x;
      token.container.y = screen.y;

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

  private createToken(model: Model, units: Record<string, Unit>, players: Record<string, Player>): TokenState {
    const container = new Container();
    container.label = `token-${model.id}`;

    const radius = baseRadiusToPixels(model.baseSizeInches);

    // Determine color
    const unit = units[model.unitId];
    const player = unit ? players[unit.playerId] : undefined;
    const color = player?.color ?? PLAYER_COLORS[0];
    const colorNum = parseInt(color.replace('#', ''), 16);

    // Selection ring
    const selectionRing = new Graphics();
    selectionRing.circle(0, 0, radius + 3);
    selectionRing.stroke({ color: SELECTION_COLOR, width: 2 });
    selectionRing.visible = false;
    container.addChild(selectionRing);

    // Base circle
    const circle = new Graphics();
    circle.circle(0, 0, radius);
    circle.fill({ color: colorNum, alpha: 0.8 });
    circle.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
    container.addChild(circle);

    // Label
    const displayName = model.name.charAt(0).toUpperCase();
    const label = new Text({
      text: displayName,
      style: {
        fontSize: Math.max(8, radius),
        fill: 0xffffff,
        fontFamily: 'monospace',
      },
    });
    label.anchor.set(0.5);
    container.addChild(label);

    // Wound counter
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
    woundText.y = radius + 6;
    woundText.visible = false;
    container.addChild(woundText);

    this.container.addChild(container);

    return { container, circle, label, selectionRing, woundText };
  }
}
