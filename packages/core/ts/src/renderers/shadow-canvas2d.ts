/**
 * W88 (D88-4, D88-5, D88-10, D88-12, D88-14): Canvas2D shadows, drawn before all liquid.
 *
 * Per caster (shadow-plan.ts `ShadowCasters`): its particles splat into an alpha mask at the density
 * grid's cell (the same kernel and 0.5 smoothstep as DensityGrid), put into a reusable canvas. Each
 * outer layer (last first: CSS paints the first on top) then draws the mask once with
 * `shadowColor`/`shadowBlur`/`shadowOffset`, the mask itself pushed off the canvas and the offset
 * compensating, so only the shadow lands (D88-5). Canvas shadows ignore the transform, so the blur
 * and both offsets are multiplied by the DPR (D88-14). Spread dilates the mask by 8 shifted draws
 * (erodes with `destination-in` when negative); a spread layer with blur 0 gets a blur floor of one
 * cell (D88-12). Last, the knockout (D88-10): every caster's closed coverage (its own liquid, plus
 * holes narrower than about two closing distances) goes into one grid-sized image that is drawn once
 * with `destination-out`, so no shadow lies under the casters' own liquid or shows through its holes.
 * Plan resolution A6: canvases from `document.createElement`, pixels from `createImageData`.
 */
import { Dyn } from "../fluid-layout";
import type { ShadowLayer } from "../shadow";
import type { RenderFrame } from "./frame";
import { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX, kernelRadiusPx } from "./kernel-params";
import { KNOCKOUT_CLOSE_PER_KERNEL, ShadowCasters } from "./shadow-plan";

/** A mask never exceeds this many cells per side (a particle flung far would size it). */
export const MASK_MAX_CELLS = 2048;
const S = Math.SQRT1_2;
/** D88-5: the 8 dilation directions. */
export const DILATE_DIRS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1], [S, S], [S, -S], [-S, S], [-S, -S],
]);
const CLOSE_AXES: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
const TRANSPARENT = "rgba(0, 0, 0, 0)";

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function surface(): Surface | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

const colourCache = new WeakMap<ShadowLayer, string>();
function cssColour(l: ShadowLayer): string {
  let s = colourCache.get(l);
  if (s === undefined) {
    const [r, g, b, a] = l.color;
    s = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
    colourCache.set(l, s);
  }
  return s;
}

export class ShadowCanvas2D {
  private readonly casters = new ShadowCasters();
  private drawnIds = new Uint8Array(0);
  private mask: Surface | null = null;
  private spreadSurface: Surface | null = null;
  private knock: Surface | null = null;
  private maskImg: ImageData | null = null;
  private knockImg: ImageData | null = null;
  private rho = new Float32Array(0);
  private cov = new Float32Array(0);
  private closed = new Float32Array(0);
  private broken = false;

  /** True when the last draw() drew slot `id`'s shadow (the toggle reads it). */
  drawn(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.drawnIds.length && this.drawnIds[id] === 1;
  }

  /**
   * Draws every caster's shadow into `ctx` (DPR transform already set) and knocks out the casters'
   * own coverage. `cellPx` is the density grid's cell, `gridW × gridH` its size in cells.
   */
  draw(ctx: CanvasRenderingContext2D, frame: RenderFrame, cellPx: number, gridW: number, gridH: number): void {
    this.drawnIds.fill(0);
    if (this.broken) return;
    const n = this.casters.collect(frame);
    if (n === 0) return;
    if (!this.ensureSurfaces(gridW, gridH)) return;
    if (this.drawnIds.length < frame.paints.length) this.drawnIds = new Uint8Array(frame.paints.length);
    const dpr = Number.isFinite(frame.viewport.dpr) && frame.viewport.dpr > 0 ? frame.viewport.dpr : 1;
    let knocked = false;
    for (const id of this.casters.ids) {
      if (this.drawCaster(ctx, frame, id, cellPx, dpr, gridW, gridH)) {
        this.drawnIds[id] = 1;
        knocked = true;
      }
    }
    ctx.shadowColor = TRANSPARENT;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    if (!knocked) return;
    const knock = this.knock;
    const img = this.knockImg;
    if (!knock || !img) return;
    knock.ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(knock.canvas, 0, 0, gridW * cellPx, gridH * cellPx);
    ctx.globalCompositeOperation = "source-over";
    img.data.fill(0); // ready for the next frame
  }

  destroy(): void {
    this.mask = null;
    this.spreadSurface = null;
    this.knock = null;
    this.maskImg = null;
    this.knockImg = null;
    this.drawnIds = new Uint8Array(0);
  }

  private ensureSurfaces(gridW: number, gridH: number): boolean {
    this.mask ??= surface();
    this.spreadSurface ??= surface();
    this.knock ??= surface();
    if (!this.mask || !this.spreadSurface || !this.knock) {
      this.broken = true; // no 2d context for a scratch canvas: no renderer shadows (the toggle keeps the browser's)
      return false;
    }
    if (!this.knockImg || this.knockImg.width !== gridW || this.knockImg.height !== gridH) {
      this.knock.canvas.width = gridW;
      this.knock.canvas.height = gridH;
      this.knockImg = this.knock.ctx.createImageData(gridW, gridH);
    }
    return true;
  }

  /** One caster: its mask, its layers, its knockout cells. False when it has nothing to draw. */
  private drawCaster(ctx: CanvasRenderingContext2D, frame: RenderFrame, id: number, s: number, dpr: number, gridW: number, gridH: number): boolean {
    const paint = frame.paints[id];
    const layers = paint?.shadows;
    const mask = this.mask;
    if (!paint || !layers || layers.length === 0 || !mask) return false;
    const R = Math.min(Math.max(kernelRadiusPx(paint.spacingPx), s), KERNEL_RADIUS_CAP_PX);
    const b = this.casters.bounds;
    const x0 = (b[4 * id] ?? 0) - R;
    const y0 = (b[4 * id + 1] ?? 0) - R;
    const x1 = (b[4 * id + 2] ?? 0) + R;
    const y1 = (b[4 * id + 3] ?? 0) + R;
    const ox = Math.floor(x0 / s);
    const oy = Math.floor(y0 / s);
    const mw = Math.min(MASK_MAX_CELLS, Math.max(1, Math.ceil(x1 / s) - ox + 1));
    const mh = Math.min(MASK_MAX_CELLS, Math.max(1, Math.ceil(y1 / s) - oy + 1));
    this.splatMask(frame, id, R, s, ox, oy, mw, mh);
    this.putMask(mw, mh);
    for (let li = layers.length - 1; li >= 0; li--) {
      const l = layers[li];
      if (l) this.drawLayer(ctx, l, s, dpr, ox, oy, mw, mh);
    }
    this.knockOut(R, s, ox, oy, mw, mh, gridW, gridH);
    return true;
  }

  private splatMask(frame: RenderFrame, id: number, R: number, s: number, ox: number, oy: number, mw: number, mh: number): void {
    const size = mw * mh;
    if (this.rho.length < size) {
      this.rho = new Float32Array(size);
      this.cov = new Float32Array(size);
      this.closed = new Float32Array(size);
    }
    const rho = this.rho;
    rho.fill(0, 0, size);
    const paint = frame.paints[id];
    const mass = paint && Number.isFinite(paint.areaPerParticle) && paint.areaPerParticle > 0 ? paint.areaPerParticle : 0;
    const R2 = R * R;
    const k = mass / ((Math.PI * R2) / 3);
    const cap = frame.particleCapacity;
    const dyn = frame.dynamicView;
    const { order, start, count } = this.casters;
    const end = (start[id] ?? 0) + (count[id] ?? 0);
    for (let j = start[id] ?? 0; j < end; j++) {
      const i = order[j] ?? 0;
      const px = (dyn[Dyn.X * cap + i] as number) - ox * s;
      const py = (dyn[Dyn.Y * cap + i] as number) - oy * s;
      const ix0 = Math.max(0, Math.floor((px - R) / s - 0.5));
      const ix1 = Math.min(mw - 1, Math.ceil((px + R) / s - 0.5));
      const iy0 = Math.max(0, Math.floor((py - R) / s - 0.5));
      const iy1 = Math.min(mh - 1, Math.ceil((py + R) / s - 0.5));
      for (let iy = iy0; iy <= iy1; iy++) {
        const dy = (iy + 0.5) * s - py;
        const row = iy * mw;
        for (let ix = ix0; ix <= ix1; ix++) {
          const dx = (ix + 0.5) * s - px;
          const q = 1 - (dx * dx + dy * dy) / R2;
          if (q > 0) rho[row + ix] += k * q * q;
        }
      }
    }
    const lo = DENSITY_THRESHOLD - EDGE_SOFTNESS;
    const span = 2 * EDGE_SOFTNESS;
    const cov = this.cov;
    for (let i = 0; i < size; i++) {
      const t = Math.min(1, Math.max(0, ((rho[i] ?? 0) - lo) / span));
      cov[i] = t * t * (3 - 2 * t);
    }
  }

  /** The coverage as white with alpha into the mask canvas (top-left mw × mh). */
  private putMask(mw: number, mh: number): void {
    const mask = this.mask;
    if (!mask) return;
    if (!this.maskImg || this.maskImg.width < mw || this.maskImg.height < mh) {
      const w = Math.max(mw, this.maskImg?.width ?? 0);
      const h = Math.max(mh, this.maskImg?.height ?? 0);
      mask.canvas.width = w;
      mask.canvas.height = h;
      this.maskImg = mask.ctx.createImageData(w, h);
    }
    const img = this.maskImg;
    const W = img.width;
    const d = img.data;
    for (let iy = 0; iy < mh; iy++) {
      for (let ix = 0; ix < mw; ix++) {
        const p = (iy * W + ix) * 4;
        d[p] = 255;
        d[p + 1] = 255;
        d[p + 2] = 255;
        d[p + 3] = (this.cov[iy * mw + ix] ?? 0) * 255;
      }
    }
    mask.ctx.putImageData(img, 0, 0, 0, 0, mw, mh);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, l: ShadowLayer, s: number, dpr: number, ox: number, oy: number, mw: number, mh: number): void {
    const mask = this.mask;
    if (!mask) return;
    let src: HTMLCanvasElement = mask.canvas;
    let sw = mw;
    let sh = mh;
    let pad = 0;
    if (l.spread !== 0 && this.spreadSurface) {
      pad = Math.ceil(Math.abs(l.spread) / s) + 1;
      sw = mw + 2 * pad;
      sh = mh + 2 * pad;
      const sp = this.spreadSurface;
      if (sp.canvas.width < sw || sp.canvas.height < sh) {
        sp.canvas.width = Math.max(sw, sp.canvas.width);
        sp.canvas.height = Math.max(sh, sp.canvas.height);
      }
      const r = Math.abs(l.spread) / s;
      sp.ctx.clearRect(0, 0, sp.canvas.width, sp.canvas.height);
      sp.ctx.globalCompositeOperation = "source-over";
      sp.ctx.drawImage(mask.canvas, 0, 0, mw, mh, pad, pad, mw, mh);
      // D88-5: dilate (union of 8 shifted copies) or, for a negative spread, erode (their intersection).
      sp.ctx.globalCompositeOperation = l.spread > 0 ? "source-over" : "destination-in";
      for (const [ux, uy] of DILATE_DIRS) sp.ctx.drawImage(mask.canvas, 0, 0, mw, mh, pad + ux * r, pad + uy * r, mw, mh);
      sp.ctx.globalCompositeOperation = "source-over";
      src = sp.canvas;
    }
    const dx = (ox - pad) * s;
    const dy = (oy - pad) * s;
    const dw = sw * s;
    const dh = sh * s;
    // D88-5: the source lands off the canvas (its right edge at x = −1); the offset brings only the shadow back.
    const far = dx + dw + 1;
    const blur = l.blur > 0 ? l.blur : l.spread !== 0 ? s : 0; // D88-12: one cell for a hard spread edge
    ctx.shadowColor = cssColour(l);
    ctx.shadowBlur = blur * dpr; // D88-14: canvas shadows ignore setTransform
    ctx.shadowOffsetX = (far + l.dx) * dpr;
    ctx.shadowOffsetY = l.dy * dpr;
    ctx.drawImage(src, 0, 0, sw, sh, dx - far, dy, dw, dh);
  }

  /** D88-10: max(coverage, closed coverage) into the knockout image at the caster's cells. */
  private knockOut(R: number, s: number, ox: number, oy: number, mw: number, mh: number, gridW: number, gridH: number): void {
    const img = this.knockImg;
    if (!img) return;
    const cov = this.cov;
    const closed = this.closed;
    const full = Math.max(1, Math.round((KNOCKOUT_CLOSE_PER_KERNEL * R) / s));
    const half = Math.max(1, Math.round(full / 2));
    const at = (ix: number, iy: number): number => (ix < 0 || iy < 0 || ix >= mw || iy >= mh ? 0 : (cov[iy * mw + ix] ?? 0));
    for (let iy = 0; iy < mh; iy++) {
      for (let ix = 0; ix < mw; ix++) {
        let k = cov[iy * mw + ix] ?? 0;
        // A cell between two covered cells (± the closing distance or half of it, on four axes) is covered.
        for (let pass = 0; k < 1 && pass < 2; pass++) {
          const d = pass === 0 ? full : half;
          for (const [ax, ay] of CLOSE_AXES) {
            const bridge = Math.min(at(ix + ax * d, iy + ay * d), at(ix - ax * d, iy - ay * d));
            if (bridge > k) k = bridge;
          }
        }
        closed[iy * mw + ix] = k;
      }
    }
    const d = img.data;
    for (let iy = 0; iy < mh; iy++) {
      const gy = oy + iy;
      if (gy < 0 || gy >= gridH) continue;
      for (let ix = 0; ix < mw; ix++) {
        const gx = ox + ix;
        if (gx < 0 || gx >= gridW) continue;
        const a = (closed[iy * mw + ix] ?? 0) * 255;
        const p = (gy * gridW + gx) * 4 + 3;
        if (a > (d[p] ?? 0)) d[p] = a;
      }
    }
  }
}
