/**
 * Canvas2D fluid renderer (spec §3 "Canvas2D fallback", decision D64-11):
 * moving particles go through the density grid (blended colour, threshold),
 * resting elements are an exact `roundRect` at their home rect (plan
 * resolution B1), cross-faded by `restAlpha`. No liquid text: the DOM text is
 * always visible.
 *
 * Plan resolution A6: never `new ImageData` / `new OffscreenCanvas`; the
 * density buffer is a `document.createElement("canvas")` and its pixels come
 * from `ctx.createImageData`.
 */
import { Dyn, type HomeRect, homeRectInto, St, STATE_STRIDE, Stat } from "../fluid-layout";
import {
  DEFAULT_SCALE_PX,
  DensityGrid,
  KERNEL_RADIUS_CAP_PX,
  KERNEL_RADIUS_PER_SPACING,
} from "./density-grid";
import type { ElementPaint, RenderFrame, Renderer } from "./frame";

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

export class FluidCanvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null = null;
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private readonly grid: DensityGrid;
  private readonly scratch: HomeRect = { x: 0, y: 0, w: 0, h: 0, r: 0 };
  // Per-slot fillStyle cache, keyed on paint object identity.
  private readonly fillPaint: Array<ElementPaint | undefined> = [];
  private readonly fillStyles: string[] = [];

  constructor(scalePx: number = DEFAULT_SCALE_PX) {
    this.grid = new DensityGrid(scalePx);
  }

  /** Decision D64-5: a missing 2d context rejects (no silent mode). */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("[liquiddom] Canvas2D context unavailable: canvas.getContext('2d') returned null.");
    }
    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d");
    if (!offCtx) {
      throw new Error("[liquiddom] Canvas2D context unavailable for the density buffer.");
    }
    this.ctx = ctx;
    this.off = off;
    this.offCtx = offCtx;
  }

  resize(widthPx: number, heightPx: number, dpr: number): void {
    if (!this.off || !this.offCtx) return;
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    this.grid.resize(widthPx / d, heightPx / d);
    this.off.width = this.grid.width;
    this.off.height = this.grid.height;
    this.img = this.offCtx.createImageData(this.grid.width, this.grid.height);
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { widthCss, heightCss, dpr } = frame.viewport;
    // DPR via setTransform every frame, never a cumulative scale().
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, heightCss);
    this.splatMoving(frame);
    this.drawDensity(ctx);
    this.drawResting(ctx, frame);
  }

  destroy(): void {
    this.ctx = null;
    this.off = null;
    this.offCtx = null;
    this.img = null;
    this.fillPaint.length = 0;
    this.fillStyles.length = 0;
  }

  private splatMoving(frame: RenderFrame): void {
    const grid = this.grid;
    grid.clear();
    if (frame.activeParticles === 0) return;
    const cap = frame.particleCapacity;
    const { dynamicView: dyn, staticView: st, stateView: state, paints } = frame;
    for (let i = 0; i < cap; i++) {
      const home = st[Stat.HOME * cap + i];
      if (!(home >= 0)) continue; // HOME_NONE (-1) or NaN (B12)
      const id = home | 0;
      const paint = paints[id];
      if (!paint) continue; // no paint record (B12)
      const weight = 1 - clamp01(state[id * STATE_STRIDE + St.REST_ALPHA]);
      if (weight <= 0) continue;
      const radius = Math.min(KERNEL_RADIUS_PER_SPACING * paint.spacingPx, KERNEL_RADIUS_CAP_PX);
      grid.splat(
        dyn[Dyn.X * cap + i],
        dyn[Dyn.Y * cap + i],
        paint.areaPerParticle,
        radius,
        paint.background,
        weight,
      );
    }
  }

  private drawDensity(ctx: CanvasRenderingContext2D): void {
    const { img, off, offCtx, grid } = this;
    if (!img || !off || !offCtx || grid.isEmpty) return;
    img.data.fill(0);
    grid.writeImage(img.data);
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, grid.width * grid.scalePx, grid.height * grid.scalePx);
  }

  private drawResting(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
    const { paints, stateView, elementView, reducedMotion } = frame;
    for (let id = 0; id < paints.length; id++) {
      const paint = paints[id];
      if (!paint) continue;
      const restAlpha = clamp01(stateView[id * STATE_STRIDE + St.REST_ALPHA]);
      if (restAlpha <= 0) continue;
      const r = this.scratch;
      if (!homeRectInto(r, elementView, id, reducedMotion)) continue;
      const bg = paint.background;
      ctx.globalAlpha = restAlpha * bg[3];
      if (this.fillPaint[id] !== paint) {
        this.fillPaint[id] = paint;
        this.fillStyles[id] = `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`;
      }
      ctx.fillStyle = this.fillStyles[id];
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, r.r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
