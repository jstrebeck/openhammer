import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_INCH } from './constants';
import type { Point } from '@openhammer/core';

const PREVIEW_COLOR = 0xfbbf24;

export class TerrainPlacementPreview {
  private graphic: Graphics;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'terrain-placement-preview';
    parent.addChild(this.graphic);
  }

  /** Draw a preview polygon following the cursor, from committed vertices + current cursor pos */
  draw(vertices: Point[], cursorPos: Point | null): void {
    this.graphic.clear();

    if (vertices.length === 0) return;

    // Draw committed vertices and edges
    const allPoints = cursorPos ? [...vertices, cursorPos] : vertices;

    if (allPoints.length >= 2) {
      const first = allPoints[0];
      this.graphic.moveTo(first.x * PIXELS_PER_INCH, first.y * PIXELS_PER_INCH);
      for (let i = 1; i < allPoints.length; i++) {
        this.graphic.lineTo(allPoints[i].x * PIXELS_PER_INCH, allPoints[i].y * PIXELS_PER_INCH);
      }
      // Close to first point if we have 3+ vertices
      if (allPoints.length >= 3) {
        this.graphic.lineTo(first.x * PIXELS_PER_INCH, first.y * PIXELS_PER_INCH);
      }
      this.graphic.stroke({ color: PREVIEW_COLOR, width: 1.5, alpha: 0.7 });

      // Fill preview if 3+ points
      if (allPoints.length >= 3) {
        const flat = allPoints.flatMap((p) => [p.x * PIXELS_PER_INCH, p.y * PIXELS_PER_INCH]);
        this.graphic.poly(flat, true);
        this.graphic.fill({ color: PREVIEW_COLOR, alpha: 0.1 });
      }
    }

    // Draw vertex dots
    for (const p of vertices) {
      this.graphic.circle(p.x * PIXELS_PER_INCH, p.y * PIXELS_PER_INCH, 3);
      this.graphic.fill({ color: PREVIEW_COLOR, alpha: 0.9 });
    }
  }

  clear(): void {
    this.graphic.clear();
  }
}
