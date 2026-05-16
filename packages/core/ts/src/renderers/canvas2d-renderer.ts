import { ZERO_MARGIN } from "../box-shadow";
import {
  FLOATS_PER_ENTITY,
  PARTICLES_PER_BODY,
  type RenderFrame,
  type Renderer,
} from "./renderer";

const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;

function clampClipRadius(r: number, w: number, h: number): number {
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, Math.min(w, h) / 2);
}

export class Canvas2DRenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    return Promise.resolve();
  }

  resize(_widthPx: number, _heightPx: number, _dpr: number): void {
    // Canvas2D backing-store resize is done by the caller before this is
    // invoked (Decision §15). The 2D context picks it up automatically.
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const { viewport } = frame;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.widthCss, viewport.heightCss);
    ctx.save();

    for (const id of frame.softBodyIds) {
      const lt = Math.round(frame.entities[id * FLOATS_PER_ENTITY + 5]);
      if (lt === 6) continue;
      this.drawSoftBody(ctx, frame, id);
    }
    for (const id of frame.dropletIds) {
      this.drawDroplet(ctx, frame, id);
    }

    ctx.restore();
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
  }

  private drawSoftBody(
    ctx: CanvasRenderingContext2D,
    frame: RenderFrame,
    id: number,
  ): void {
    const off = id * FLOATS_PER_ENTITY;
    const x = frame.entities[off];
    const y = frame.entities[off + 1];
    const w = frame.entities[off + 2];
    const h = frame.entities[off + 3];

    if (w === 0 || h === 0) return;

    const { viewport, theme } = frame;
    const m = viewport.cullMargin;
    if (
      x + w < -m ||
      y + h < -m ||
      x > viewport.widthCss + m ||
      y > viewport.heightCss + m
    ) {
      return;
    }

    const isHover = frame.entities[off + 4] === 1.0;
    const baseColor = theme.themeCache.get(id) ?? theme.colorDefault;
    ctx.fillStyle = isHover ? theme.colorHover : baseColor;

    const clipping = viewport.preserveBackgrounds === true;
    if (clipping) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, viewport.widthCss, viewport.heightCss);
      const shadow = theme.shadowCache.get(id) ?? ZERO_MARGIN;
      const cx = x - shadow.left;
      const cy = y - shadow.top;
      const cw = w + shadow.left + shadow.right;
      const ch = h + shadow.top + shadow.bottom;
      const r = clampClipRadius(frame.entities[off + 8], cw, ch);
      if (r > 0) {
        ctx.roundRect(cx, cy, cw, ch, r);
      } else {
        ctx.rect(cx, cy, cw, ch);
      }
      ctx.clip("evenodd");
    }

    if (frame.particles) {
      this.drawSpline(ctx, frame.particles, id * PARTICLE_FLOATS_PER_BODY);
    } else {
      ctx.fillRect(x, y, w, h);
    }

    if (clipping) ctx.restore();
  }

  private drawDroplet(
    ctx: CanvasRenderingContext2D,
    frame: RenderFrame,
    id: number,
  ): void {
    const off = id * FLOATS_PER_ENTITY;
    const cx = frame.entities[off];
    const cy = frame.entities[off + 1];
    const diameter = frame.entities[off + 2];
    if (diameter === 0) return;

    const r = diameter * 0.5;
    const { viewport, theme } = frame;
    const m = viewport.cullMargin;
    if (
      cx + r < -m ||
      cy + r < -m ||
      cx - r > viewport.widthCss + m ||
      cy - r > viewport.heightCss + m
    ) {
      return;
    }

    ctx.fillStyle = theme.colorDefault;

    if (frame.particles) {
      this.drawSpline(ctx, frame.particles, id * PARTICLE_FLOATS_PER_BODY);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Midpoint-quadratic spline through the 16 perimeter particles. */
  private drawSpline(
    ctx: CanvasRenderingContext2D,
    particles: Float32Array,
    pOff: number,
  ): void {
    const n = PARTICLES_PER_BODY;
    const lastX = particles[pOff + (n - 1) * 2];
    const lastY = particles[pOff + (n - 1) * 2 + 1];
    const firstX = particles[pOff];
    const firstY = particles[pOff + 1];

    ctx.beginPath();
    ctx.moveTo((lastX + firstX) / 2, (lastY + firstY) / 2);

    for (let i = 0; i < n; i++) {
      const cIdx = pOff + i * 2;
      const nIdx = pOff + ((i + 1) % n) * 2;
      const cX = particles[cIdx];
      const cY = particles[cIdx + 1];
      const nX = particles[nIdx];
      const nY = particles[nIdx + 1];
      ctx.quadraticCurveTo(cX, cY, (cX + nX) / 2, (cY + nY) / 2);
    }

    ctx.closePath();
    ctx.fill();
  }
}
