import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_INCH, MOVEMENT_RANGE_COLOR } from './constants';
import type { Point } from '@openhammer/core';

export class MovementRangeGraphic {
  private graphic: Graphics;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'movement-range';
    parent.addChild(this.graphic);
  }

  show(center: Point, rangeInches: number): void {
    const cx = center.x * PIXELS_PER_INCH;
    const cy = center.y * PIXELS_PER_INCH;
    const r = rangeInches * PIXELS_PER_INCH;

    this.graphic.clear();
    this.graphic.circle(cx, cy, r);
    this.graphic.fill({ color: MOVEMENT_RANGE_COLOR, alpha: 0.05 });
    this.graphic.stroke({ color: MOVEMENT_RANGE_COLOR, width: 1.5, alpha: 0.4 });
  }

  hide(): void {
    this.graphic.clear();
  }
}
