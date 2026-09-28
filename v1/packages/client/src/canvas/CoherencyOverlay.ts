import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_INCH } from './constants';
import { distance } from '@openhammer/core';
import type { Point } from '@openhammer/core';

const COHERENCY_OK_COLOR = 0x22c55e;   // green
const COHERENCY_FAIL_COLOR = 0xef4444; // red

export class CoherencyOverlay {
  private graphic: Graphics;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'coherency-overlay';
    parent.addChild(this.graphic);
  }

  show(models: Array<{ id: string; position: Point }>, coherencyRange: number): void {
    this.graphic.clear();

    if (models.length < 2) return;

    // Check each pair and draw lines
    for (let i = 0; i < models.length; i++) {
      // Find the nearest other model
      let nearestDist = Infinity;
      let nearestIdx = -1;
      for (let j = 0; j < models.length; j++) {
        if (i === j) continue;
        const d = distance(models[i].position, models[j].position);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = j;
        }
      }

      if (nearestIdx < 0) continue;
      // Only draw from i to nearest if i < nearestIdx to avoid duplicate lines in good cases,
      // but always draw failing lines
      const inCoherency = nearestDist <= coherencyRange;
      const color = inCoherency ? COHERENCY_OK_COLOR : COHERENCY_FAIL_COLOR;
      const alpha = inCoherency ? 0.4 : 0.8;

      // Avoid duplicate green lines (only draw when i < nearestIdx)
      // Always draw red lines to make failures obvious
      if (inCoherency && i > nearestIdx) continue;

      const x1 = models[i].position.x * PIXELS_PER_INCH;
      const y1 = models[i].position.y * PIXELS_PER_INCH;
      const x2 = models[nearestIdx].position.x * PIXELS_PER_INCH;
      const y2 = models[nearestIdx].position.y * PIXELS_PER_INCH;

      this.graphic.moveTo(x1, y1);
      this.graphic.lineTo(x2, y2);

      if (inCoherency) {
        this.graphic.stroke({ color, width: 1.5, alpha });
      } else {
        // Dashed line for failing coherency — draw as short segments
        this.drawDashedLine(x1, y1, x2, y2, color, alpha);
      }
    }
  }

  hide(): void {
    this.graphic.clear();
  }

  private drawDashedLine(
    x1: number, y1: number, x2: number, y2: number,
    color: number, alpha: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const dashLen = 4;
    const gapLen = 3;
    const nx = dx / len;
    const ny = dy / len;

    let pos = 0;
    let drawing = true;
    while (pos < len) {
      const segLen = drawing ? dashLen : gapLen;
      const end = Math.min(pos + segLen, len);
      if (drawing) {
        this.graphic.moveTo(x1 + nx * pos, y1 + ny * pos);
        this.graphic.lineTo(x1 + nx * end, y1 + ny * end);
        this.graphic.stroke({ color, width: 2, alpha });
      }
      pos = end;
      drawing = !drawing;
    }
  }
}
