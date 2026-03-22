import { Container, Graphics, Text } from 'pixi.js';
import type { DeploymentZone } from '@openhammer/core';
import { PIXELS_PER_INCH } from './constants';

interface ZoneToken {
  container: Container;
  fill: Graphics;
  label: Text;
}

export class DeploymentZoneLayer {
  private container: Container;
  private tokens: Map<string, ZoneToken> = new Map();

  constructor(parent: Container) {
    this.container = new Container();
    this.container.label = 'deployment-zone-layer';
    // Insert at the bottom (just above board bg)
    parent.addChildAt(this.container, Math.min(2, parent.children.length));
  }

  sync(zones: Record<string, DeploymentZone>): void {
    for (const [id, token] of this.tokens) {
      if (!zones[id]) {
        this.container.removeChild(token.container);
        token.container.destroy({ children: true });
        this.tokens.delete(id);
      }
    }

    for (const zone of Object.values(zones)) {
      let token = this.tokens.get(zone.id);
      if (!token) {
        token = this.createToken(zone);
        this.tokens.set(zone.id, token);
      } else {
        this.updateToken(token, zone);
      }
    }
  }

  private createToken(zone: DeploymentZone): ZoneToken {
    const container = new Container();
    container.label = `dz-${zone.id}`;

    const color = parseInt(zone.color.replace('#', ''), 16);

    const fill = new Graphics();
    this.drawPoly(fill, zone.polygon, color);
    container.addChild(fill);

    const center = polyCenter(zone.polygon);
    const label = new Text({
      text: zone.label,
      style: { fontSize: 11, fill: color, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    label.anchor.set(0.5);
    label.x = center.x * PIXELS_PER_INCH;
    label.y = center.y * PIXELS_PER_INCH;
    label.alpha = 0.5;
    container.addChild(label);

    this.container.addChild(container);
    return { container, fill, label };
  }

  private updateToken(token: ZoneToken, zone: DeploymentZone): void {
    const color = parseInt(zone.color.replace('#', ''), 16);
    token.fill.clear();
    this.drawPoly(token.fill, zone.polygon, color);
    token.label.text = zone.label;
    const center = polyCenter(zone.polygon);
    token.label.x = center.x * PIXELS_PER_INCH;
    token.label.y = center.y * PIXELS_PER_INCH;
  }

  private drawPoly(g: Graphics, polygon: { x: number; y: number }[], color: number): void {
    if (polygon.length < 3) return;
    const flat = polygon.flatMap((p) => [p.x * PIXELS_PER_INCH, p.y * PIXELS_PER_INCH]);
    g.poly(flat, true);
    g.fill({ color, alpha: 0.08 });
    g.stroke({ color, width: 2, alpha: 0.3 });
  }
}

function polyCenter(polygon: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const p of polygon) { cx += p.x; cy += p.y; }
  return { x: cx / polygon.length, y: cy / polygon.length };
}
