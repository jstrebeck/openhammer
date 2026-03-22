import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_INCH } from './constants';
import type { Point } from '@openhammer/core';

const ENGAGEMENT_RANGE_COLOR = 0xff4444; // red

export class EngagementRangeOverlay {
  private graphic: Graphics;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'engagement-range-overlay';
    parent.addChild(this.graphic);
  }

  show(enemyModels: Array<{ position: Point; baseSizeInches: number }>): void {
    this.graphic.clear();

    for (const model of enemyModels) {
      const cx = model.position.x * PIXELS_PER_INCH;
      const cy = model.position.y * PIXELS_PER_INCH;
      // Engagement range is 1" from the base edge, so total radius = base radius + 1"
      const baseRadius = (model.baseSizeInches / 2) * PIXELS_PER_INCH;
      const engagementRadius = baseRadius + 1 * PIXELS_PER_INCH;

      this.graphic.circle(cx, cy, engagementRadius);
      this.graphic.fill({ color: ENGAGEMENT_RANGE_COLOR, alpha: 0.08 });
      this.graphic.stroke({ color: ENGAGEMENT_RANGE_COLOR, width: 1, alpha: 0.4 });
    }
  }

  hide(): void {
    this.graphic.clear();
  }
}
