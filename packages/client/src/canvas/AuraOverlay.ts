import { Container, Graphics, Text } from 'pixi.js';
import { PIXELS_PER_INCH } from './constants';
import type { Point } from '@openhammer/core';

const AURA_COLOR = 0xa855f7; // purple

export class AuraOverlay {
  private graphic: Graphics;
  private label: Text;

  constructor(parent: Container) {
    this.graphic = new Graphics();
    this.graphic.label = 'aura-overlay';
    parent.addChild(this.graphic);

    this.label = new Text({
      text: '',
      style: { fontSize: 10, fill: AURA_COLOR, fontFamily: 'monospace' },
    });
    this.label.anchor.set(0.5);
    this.label.visible = false;
    parent.addChild(this.label);
  }

  show(center: Point, radiusInches: number): void {
    const cx = center.x * PIXELS_PER_INCH;
    const cy = center.y * PIXELS_PER_INCH;
    const r = radiusInches * PIXELS_PER_INCH;

    this.graphic.clear();
    this.graphic.circle(cx, cy, r);
    this.graphic.fill({ color: AURA_COLOR, alpha: 0.04 });
    this.graphic.stroke({ color: AURA_COLOR, width: 1.5, alpha: 0.4 });

    this.label.text = `${radiusInches}" aura`;
    this.label.x = cx;
    this.label.y = cy + r + 10;
    this.label.visible = true;
  }

  hide(): void {
    this.graphic.clear();
    this.label.visible = false;
  }
}
