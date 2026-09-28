import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_INCH, SELECTION_COLOR } from './constants';
import type { Point } from '@openhammer/core';

export class SelectionBoxGraphic {
  private graphic: Graphics;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'selection-box';
    parent.addChild(this.graphic);
  }

  draw(start: Point, end: Point): void {
    const x1 = start.x * PIXELS_PER_INCH;
    const y1 = start.y * PIXELS_PER_INCH;
    const x2 = end.x * PIXELS_PER_INCH;
    const y2 = end.y * PIXELS_PER_INCH;

    this.graphic.clear();
    this.graphic.rect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.abs(x2 - x1),
      Math.abs(y2 - y1),
    );
    this.graphic.fill({ color: SELECTION_COLOR, alpha: 0.1 });
    this.graphic.stroke({ color: SELECTION_COLOR, width: 1, alpha: 0.6 });
  }

  clear(): void {
    this.graphic.clear();
  }
}
