/**
 * Low-resolution density and colour accumulator for the Canvas2D fallback
 * (spec §3 "Canvas2D fallback", decision D64-11): per-element density
 * normalisation, blended colour, kernel radius capped at 8 px, threshold 0.5
 * at the rect edge. Pure: no DOM, no canvas.
 */
import type { RGBA } from "../color";
import { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX } from "./kernel-params";

// W71 (D71-5): the kernel constants live in kernel-params.ts, shared with the WebGPU splat pass.
export { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX, KERNEL_RADIUS_PER_SPACING } from "./kernel-params";
/** CSS px per density cell. */
export const DEFAULT_SCALE_PX = 2;

const TRANSPARENT: RGBA = Object.freeze([0, 0, 0, 0] as const);

export class DensityGrid {
  readonly scalePx: number;
  private w = 0;
  private h = 0;
  private rho = new Float32Array(0);
  private sr = new Float32Array(0);
  private sg = new Float32Array(0);
  private sb = new Float32Array(0);
  private sa = new Float32Array(0);
  // Dirty bounds (inclusive); empty while x1 < x0.
  private x0 = 0;
  private y0 = 0;
  private x1 = -1;
  private y1 = -1;

  constructor(scalePx: number = DEFAULT_SCALE_PX) {
    if (!(Number.isFinite(scalePx) && scalePx > 0)) {
      throw new RangeError(`[liquiddom] DensityGrid scale must be > 0, got ${scalePx}`);
    }
    this.scalePx = scalePx;
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  get isEmpty(): boolean {
    return this.x1 < this.x0 || this.y1 < this.y0;
  }

  resize(widthCss: number, heightCss: number): void {
    const cells = (css: number) =>
      Math.max(1, Math.ceil((Number.isFinite(css) && css > 0 ? css : 1) / this.scalePx));
    const w = cells(widthCss);
    const h = cells(heightCss);
    if (w === this.w && h === this.h) {
      this.clear();
      return;
    }
    this.w = w;
    this.h = h;
    const n = w * h;
    this.rho = new Float32Array(n);
    this.sr = new Float32Array(n);
    this.sg = new Float32Array(n);
    this.sb = new Float32Array(n);
    this.sa = new Float32Array(n);
    this.resetBounds();
  }

  /** Zeroes the dirty region only. */
  clear(): void {
    if (this.isEmpty) return;
    for (let y = this.y0; y <= this.y1; y++) {
      const a = y * this.w + this.x0;
      const b = y * this.w + this.x1 + 1;
      this.rho.fill(0, a, b);
      this.sr.fill(0, a, b);
      this.sg.fill(0, a, b);
      this.sb.fill(0, a, b);
      this.sa.fill(0, a, b);
    }
    this.resetBounds();
  }

  /**
   * Adds `massPx2 · weight · (1 − r²/R²)² / (πR²/3)` around `(xPx, yPx)`, so a
   * uniformly filled interior reads 1. `R` is capped at 8 px (and at least one
   * cell). `weight` scales the mass; the Canvas2D renderer passes 1 while `restAlpha < 1` (D70-4).
   */
  splat(xPx: number, yPx: number, massPx2: number, radiusPx: number, rgb: RGBA, weight = 1): void {
    if (!(weight > 0) || !(massPx2 > 0) || !Number.isFinite(xPx) || !Number.isFinite(yPx)) return;
    if (this.w === 0) return;
    const s = this.scalePx;
    const requested = Number.isFinite(radiusPx) ? radiusPx : s;
    const R = Math.min(Math.max(requested, s), KERNEL_RADIUS_CAP_PX);
    const R2 = R * R;
    const k = (massPx2 * Math.min(weight, 1)) / ((Math.PI * R2) / 3);
    const ix0 = Math.max(0, Math.floor((xPx - R) / s - 0.5));
    const ix1 = Math.min(this.w - 1, Math.ceil((xPx + R) / s - 0.5));
    const iy0 = Math.max(0, Math.floor((yPx - R) / s - 0.5));
    const iy1 = Math.min(this.h - 1, Math.ceil((yPx + R) / s - 0.5));
    if (ix1 < ix0 || iy1 < iy0) return;
    const [r, g, b, a] = rgb;
    let touched = false;
    for (let iy = iy0; iy <= iy1; iy++) {
      const dy = (iy + 0.5) * s - yPx;
      const dy2 = dy * dy;
      const row = iy * this.w;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix + 0.5) * s - xPx;
        const q = 1 - (dx * dx + dy2) / R2;
        if (q <= 0) continue;
        const c = k * q * q;
        const i = row + ix;
        this.rho[i] += c;
        this.sr[i] += c * r;
        this.sg[i] += c * g;
        this.sb[i] += c * b;
        this.sa[i] += c * a;
        touched = true;
      }
    }
    if (!touched) return;
    if (ix0 < this.x0) this.x0 = ix0;
    if (iy0 < this.y0) this.y0 = iy0;
    if (ix1 > this.x1) this.x1 = ix1;
    if (iy1 > this.y1) this.y1 = iy1;
  }

  density(ix: number, iy: number): number {
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.rho[iy * this.w + ix];
  }

  /** Density-weighted blend `Σw·rgba / Σw` (no dominant-id speckle). */
  color(ix: number, iy: number): RGBA {
    const d = this.density(ix, iy);
    if (!(d > 0)) return TRANSPARENT;
    const i = iy * this.w + ix;
    return [this.sr[i] / d, this.sg[i] / d, this.sb[i] / d, this.sa[i] / d];
  }

  /**
   * Thresholds the dirty region into `data` (RGBA8, non-premultiplied, the
   * ImageData layout, width = `this.width`): alpha = smoothstep around 0.5.
   */
  writeImage(data: Uint8ClampedArray): void {
    if (this.isEmpty) return;
    const lo = DENSITY_THRESHOLD - EDGE_SOFTNESS;
    const span = 2 * EDGE_SOFTNESS;
    for (let iy = this.y0; iy <= this.y1; iy++) {
      const row = iy * this.w;
      for (let ix = this.x0; ix <= this.x1; ix++) {
        const i = row + ix;
        const d = this.rho[i];
        if (d <= lo) continue;
        const t = Math.min(1, (d - lo) / span);
        const edge = t * t * (3 - 2 * t);
        const inv = 1 / d;
        const p = i * 4;
        data[p] = this.sr[i] * inv;
        data[p + 1] = this.sg[i] * inv;
        data[p + 2] = this.sb[i] * inv;
        data[p + 3] = edge * this.sa[i] * inv * 255;
      }
    }
  }

  private resetBounds(): void {
    this.x0 = this.w;
    this.y0 = this.h;
    this.x1 = -1;
    this.y1 = -1;
  }
}
