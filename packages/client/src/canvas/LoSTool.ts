import { Container, Graphics, Text } from 'pixi.js';
import { PIXELS_PER_INCH } from './constants';
import { checkLineOfSight } from '@openhammer/core';
import type { Model, TerrainPiece } from '@openhammer/core';

const LOS_CLEAR_COLOR = 0x22c55e;
const LOS_BLOCKED_COLOR = 0xef4444;

export class LoSGraphic {
  private graphic: Graphics;
  private label: Text;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'los-tool';
    parent.addChild(this.graphic);

    this.label = new Text({
      text: '',
      style: { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    this.label.anchor.set(0.5);
    this.label.visible = false;
    parent.addChild(this.label);
  }

  /** Draw LoS check result between two models */
  draw(from: Model, to: Model, terrain: Record<string, TerrainPiece>): void {
    const result = checkLineOfSight(from, to, terrain);

    const x1 = from.position.x * PIXELS_PER_INCH;
    const y1 = from.position.y * PIXELS_PER_INCH;
    const x2 = to.position.x * PIXELS_PER_INCH;
    const y2 = to.position.y * PIXELS_PER_INCH;

    const color = result.clear ? LOS_CLEAR_COLOR : LOS_BLOCKED_COLOR;

    this.graphic.clear();

    // Main line
    this.graphic.moveTo(x1, y1);
    this.graphic.lineTo(x2, y2);
    this.graphic.stroke({ color, width: 2, alpha: 0.8 });

    // Endpoint circles
    this.graphic.circle(x1, y1, 4);
    this.graphic.fill({ color, alpha: 0.9 });
    this.graphic.circle(x2, y2, 4);
    this.graphic.fill({ color, alpha: 0.9 });

    // If blocked, draw an X at the intersection point
    if (!result.clear && result.intersectionPoint) {
      const ix = result.intersectionPoint.x * PIXELS_PER_INCH;
      const iy = result.intersectionPoint.y * PIXELS_PER_INCH;
      const s = 6;
      this.graphic.moveTo(ix - s, iy - s);
      this.graphic.lineTo(ix + s, iy + s);
      this.graphic.stroke({ color: LOS_BLOCKED_COLOR, width: 3 });
      this.graphic.moveTo(ix + s, iy - s);
      this.graphic.lineTo(ix - s, iy + s);
      this.graphic.stroke({ color: LOS_BLOCKED_COLOR, width: 3 });
    }

    // Label
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const statusText = result.clear ? 'CLEAR' : 'BLOCKED';
    const denseNote = result.denseTerrainIds.length > 0 ? ' (Dense)' : '';
    this.label.text = statusText + denseNote;
    this.label.style.fill = color;
    this.label.x = midX;
    this.label.y = midY - 14;
    this.label.visible = true;
  }

  clear(): void {
    this.graphic.clear();
    this.label.visible = false;
  }
}
