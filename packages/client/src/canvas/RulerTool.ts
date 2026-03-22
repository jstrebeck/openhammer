import { Container, Graphics, Text } from 'pixi.js';
import { PIXELS_PER_INCH, RULER_COLOR } from './constants';
import { distance as measureDistance } from '@openhammer/core';
import type { Point } from '@openhammer/core';

export class RulerGraphic {
  private graphic: Graphics;
  private label: Text;
  private start: Point | null = null;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'ruler';
    parent.addChild(this.graphic);

    this.label = new Text({
      text: '',
      style: {
        fontSize: 12,
        fill: RULER_COLOR,
        fontFamily: 'monospace',
        fontWeight: 'bold',
      },
    });
    this.label.anchor.set(0.5);
    this.label.visible = false;
    parent.addChild(this.label);
  }

  startRuler(worldPos: Point): void {
    this.start = worldPos;
    this.graphic.clear();
    this.label.visible = false;
  }

  updateRuler(worldPos: Point): void {
    if (!this.start) return;
    this.drawLine(this.start, worldPos);
  }

  endRuler(worldPos: Point): void {
    if (!this.start) return;
    this.drawLine(this.start, worldPos);
    this.start = null;
    // Keep the line visible until next ruler start
  }

  clear(): void {
    this.graphic.clear();
    this.label.visible = false;
    this.start = null;
  }

  private drawLine(from: Point, to: Point): void {
    const x1 = from.x * PIXELS_PER_INCH;
    const y1 = from.y * PIXELS_PER_INCH;
    const x2 = to.x * PIXELS_PER_INCH;
    const y2 = to.y * PIXELS_PER_INCH;

    this.graphic.clear();
    this.graphic.moveTo(x1, y1);
    this.graphic.lineTo(x2, y2);
    this.graphic.stroke({ color: RULER_COLOR, width: 2 });

    // End circles
    this.graphic.circle(x1, y1, 3);
    this.graphic.fill({ color: RULER_COLOR });
    this.graphic.circle(x2, y2, 3);
    this.graphic.fill({ color: RULER_COLOR });

    // Distance label
    const dist = measureDistance(from, to);
    this.label.text = `${dist.toFixed(1)}"`;
    this.label.x = (x1 + x2) / 2;
    this.label.y = (y1 + y2) / 2 - 12;
    this.label.visible = true;
  }
}
