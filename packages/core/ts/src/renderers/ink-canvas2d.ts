/**
 * W89 (D89-2, D89-3, D89-5, D89-6, D89-9, D89-10; Review Focus 1, 2, 3): Canvas2D ink.
 *
 * Only while two or more elements move and one of them has atlas text, every moving unparked
 * particle splats into a dedicated `InkGrid` (Σw, Σw·rank, lo/hi rank, Σw·ink) with DensityGrid's
 * kernel; the density splat itself is untouched (D89-9: the spike's +21 ms came from widening it).
 * Per cell the grid resolves the fade (ink.ts `inkFade`) and the ink (`inkScale` × the liquid's edge
 * coverage × fade), feeds the `MixReport` per slot (resolution 3: a cell counts for its lo and hi
 * rank only) and fills two cell images: the ink and the fade mask. A slot the report held at the
 * start of the frame (resolution 1) is drawn: its atlas text at its DOM box, with the fade cut out
 * (`destination-out`), so `textMixing(id)` is what the last render drew. A particle feeds the ink
 * only while its slot is drawn or away (its DOM text hidden).
 *
 * Plan resolution A6: canvases from `document.createElement`, pixels from `createImageData`; the
 * atlas page is read with one `getImageData` per page version. Nothing allocates per frame once the
 * pools are sized.
 */
import { Dyn, El, ELEMENT_STRIDE, FLAG_PARKED, Interaction, St, STATE_STRIDE, Stat } from "../fluid-layout";
import type { RenderFrame, ElementPaint, TextAtlasFrame } from "./frame";
import { denseRanks, inkFade, inkScale, particleInk, type AtlasPixels } from "./ink";
import { DENSITY_THRESHOLD, EDGE_SOFTNESS, KERNEL_RADIUS_CAP_PX, kernelRadiusPx } from "./kernel-params";
import { MIX_ENTER_FADE, MIX_EXIT_FADE, MixReport } from "./mix-report";

/** D89-9 (resolution 10): ink cell = density cell × this; 2 is the perf fallback (4 px cells). */
export const INK_CELL_FACTOR = 1;

const RANK_EMPTY = 32767;
const EDGE_LO = DENSITY_THRESHOLD - EDGE_SOFTNESS;
const EDGE_SPAN = 2 * EDGE_SOFTNESS;

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * W89 (D89-2, D89-3, D89-8): the ink accumulator. Numbers only, one splat loop, typed arrays. The
 * kernel is DensityGrid's: `k = mass / (πR²/3)`, `R` capped at 16 px and floored at one cell.
 */
export class InkGrid {
  readonly cellPx: number;
  width = 0;
  height = 0;
  w = new Float32Array(0);
  wr = new Float32Array(0);
  lo = new Int16Array(0);
  hi = new Int16Array(0);
  ir = new Float32Array(0);
  ig = new Float32Array(0);
  ib = new Float32Array(0);
  ia = new Float32Array(0);
  /** Dirty bounds (inclusive); empty while x1 < x0. */
  x0 = 0;
  y0 = 0;
  x1 = -1;
  y1 = -1;

  constructor(cellPx: number) {
    if (!(Number.isFinite(cellPx) && cellPx > 0)) {
      throw new RangeError(`[liquiddom] InkGrid cell must be > 0, got ${cellPx}`);
    }
    this.cellPx = cellPx;
  }

  get isEmpty(): boolean {
    return this.x1 < this.x0 || this.y1 < this.y0;
  }

  /** Sizes the grid to a CSS extent (reallocates only on a size change) and clears it. */
  resize(cssW: number, cssH: number): void {
    const cells = (css: number): number => Math.max(1, Math.ceil((Number.isFinite(css) && css > 0 ? css : 1) / this.cellPx));
    const gw = cells(cssW);
    const gh = cells(cssH);
    if (gw === this.width && gh === this.height) {
      this.clear();
      return;
    }
    this.width = gw;
    this.height = gh;
    const n = gw * gh;
    this.w = new Float32Array(n);
    this.wr = new Float32Array(n);
    this.lo = new Int16Array(n).fill(RANK_EMPTY);
    this.hi = new Int16Array(n).fill(-1);
    this.ir = new Float32Array(n);
    this.ig = new Float32Array(n);
    this.ib = new Float32Array(n);
    this.ia = new Float32Array(n);
    this.resetBounds();
  }

  /** Zeroes the dirty region only (lo back to 32767, hi to −1). */
  clear(): void {
    if (this.isEmpty) return;
    for (let y = this.y0; y <= this.y1; y++) {
      const a = y * this.width + this.x0;
      const b = y * this.width + this.x1 + 1;
      this.w.fill(0, a, b);
      this.wr.fill(0, a, b);
      this.lo.fill(RANK_EMPTY, a, b);
      this.hi.fill(-1, a, b);
      this.ir.fill(0, a, b);
      this.ig.fill(0, a, b);
      this.ib.fill(0, a, b);
      this.ia.fill(0, a, b);
    }
    this.resetBounds();
  }

  /** Adds one particle: Σw, Σw·rank, lo/hi rank and Σw·ink (premultiplied ink, 0–1). */
  splat(x: number, y: number, massPx2: number, radiusPx: number, rank: number, inkR: number, inkG: number, inkB: number, inkA: number): void {
    if (!(massPx2 > 0) || !Number.isFinite(x) || !Number.isFinite(y) || this.width === 0) return;
    const s = this.cellPx;
    const requested = Number.isFinite(radiusPx) ? radiusPx : s;
    const R = Math.min(Math.max(requested, s), KERNEL_RADIUS_CAP_PX);
    const R2 = R * R;
    const k = massPx2 / ((Math.PI * R2) / 3);
    const ix0 = Math.max(0, Math.floor((x - R) / s - 0.5));
    const ix1 = Math.min(this.width - 1, Math.ceil((x + R) / s - 0.5));
    const iy0 = Math.max(0, Math.floor((y - R) / s - 0.5));
    const iy1 = Math.min(this.height - 1, Math.ceil((y + R) / s - 0.5));
    if (ix1 < ix0 || iy1 < iy0) return;
    const hasInk = inkA > 0;
    const { w, wr, lo, hi, ir, ig, ib, ia } = this;
    let touched = false;
    for (let iy = iy0; iy <= iy1; iy++) {
      const dy = (iy + 0.5) * s - y;
      const dy2 = dy * dy;
      const row = iy * this.width;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix + 0.5) * s - x;
        const q = 1 - (dx * dx + dy2) / R2;
        if (q <= 0) continue;
        const c = k * q * q;
        const i = row + ix;
        w[i] += c;
        wr[i] += c * rank;
        if (rank < lo[i]!) lo[i] = rank;
        if (rank > hi[i]!) hi[i] = rank;
        if (hasInk) {
          ir[i] += c * inkR;
          ig[i] += c * inkG;
          ib[i] += c * inkB;
          ia[i] += c * inkA;
        }
        touched = true;
      }
    }
    if (!touched) return;
    if (ix0 < this.x0) this.x0 = ix0;
    if (iy0 < this.y0) this.y0 = iy0;
    if (ix1 > this.x1) this.x1 = ix1;
    if (iy1 > this.y1) this.y1 = iy1;
  }

  private resetBounds(): void {
    this.x0 = this.width;
    this.y0 = this.height;
    this.x1 = -1;
    this.y1 = -1;
  }
}

/**
 * A grid-sized image on a detached canvas. `buf` tracks the non-zero cells of the ImageData, `shown`
 * those on the canvas, so a put covers both and no stale cell survives (empty while x1 < x0).
 */
class CellImage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  img: ImageData | null = null;
  bx0 = 0;
  by0 = 0;
  bx1 = -1;
  by1 = -1;
  sx0 = 0;
  sy0 = 0;
  sx1 = -1;
  sy1 = -1;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Sizes canvas and ImageData to the grid (only on a size change). */
  size(gw: number, gh: number): ImageData {
    if (this.img === null || this.img.width !== gw || this.img.height !== gh) {
      this.canvas.width = gw;
      this.canvas.height = gh;
      this.img = this.ctx.createImageData(gw, gh);
      this.bx1 = this.sx1 = -1;
      this.bx0 = this.sx0 = 0;
    }
    return this.img;
  }

  /** Zeroes the buffer's non-zero region, then records `[x0, x1] × [y0, y1]` as the new one. */
  reset(x0: number, y0: number, x1: number, y1: number): void {
    const img = this.img;
    if (img !== null && this.bx1 >= this.bx0) {
      for (let y = this.by0; y <= this.by1; y++) img.data.fill(0, (y * img.width + this.bx0) * 4, (y * img.width + this.bx1 + 1) * 4);
    }
    this.bx0 = x0;
    this.by0 = y0;
    this.bx1 = x1;
    this.by1 = y1;
  }

  /** Puts the buffer over the union of what the canvas shows and what the buffer holds. */
  put(): void {
    const img = this.img;
    if (img === null) return;
    let x0 = this.bx0;
    let y0 = this.by0;
    let x1 = this.bx1;
    let y1 = this.by1;
    if (this.sx1 >= this.sx0) {
      if (x1 < x0) [x0, y0, x1, y1] = [this.sx0, this.sy0, this.sx1, this.sy1];
      else {
        x0 = Math.min(x0, this.sx0);
        y0 = Math.min(y0, this.sy0);
        x1 = Math.max(x1, this.sx1);
        y1 = Math.max(y1, this.sy1);
      }
    }
    if (x1 < x0) return;
    this.ctx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.sx0 = this.bx0;
    this.sy0 = this.by0;
    this.sx1 = this.bx1;
    this.sy1 = this.by1;
  }

  /** Draws the buffer's region onto `ctx` (CSS px under its DPR transform), `cell` CSS px per cell. */
  drawOnto(ctx: CanvasRenderingContext2D, cell: number): void {
    if (this.bx1 < this.bx0) return;
    const w = this.bx1 - this.bx0 + 1;
    const h = this.by1 - this.by0 + 1;
    ctx.drawImage(this.canvas, this.bx0, this.by0, w, h, this.bx0 * cell, this.by0 * cell, w * cell, h * cell);
  }
}

function cellImage(): CellImage | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  return ctx ? new CellImage(canvas, ctx) : null;
}

export class InkCanvas2D {
  private grid: InkGrid | null = null;
  private readonly report = new MixReport();
  private seenTwo = false;
  // Per slot (sized to the paints, grown only when they grow).
  private drawnIds = new Uint8Array(0);
  private moving = new Uint8Array(0);
  private eligible = new Uint8Array(0);
  private inkOn = new Uint8Array(0);
  private ranks = new Int16Array(0);
  private rankToId = new Int16Array(0);
  private enter = new Int32Array(0);
  private exit = new Int32Array(0);
  private radius = new Float32Array(0);
  // The atlas page's pixels, read once per version; `badVersion` remembers a page that could not be read.
  private page: AtlasPixels | null = null;
  private pageCanvas: OffscreenCanvas | null = null;
  private pageVersion = -1;
  private badCanvas: OffscreenCanvas | null = null;
  private badVersion = -1;
  // D89-2: per-particle ink (premultiplied, 4 floats), cached per generation, paints and page.
  private pInk = new Float32Array(0);
  private pInkGeneration = -1;
  private pInkPage: AtlasPixels | null = null;
  private readonly pInkPaints: Array<ElementPaint | undefined> = [];
  // Canvases: the ink image and the fade mask (grid cells), then the text layer (device px).
  private inkImg: CellImage | null = null;
  private maskImg: CellImage | null = null;
  private text: HTMLCanvasElement | null = null;
  private textCtx: CanvasRenderingContext2D | null = null;
  private broken = false;
  /** The mask holds fade this frame (false when the grid did not run: a held slot is drawn crisp). */
  private maskHasFade = false;

  /** True when the last render() drew slot `id`'s atlas text in place of its DOM text. */
  drawn(id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < this.drawnIds.length && this.drawnIds[id] === 1;
  }

  /** D89-5: true once a render saw two or more elements move (sticky). */
  wantsAtlas(): boolean {
    return this.seenTwo;
  }

  destroy(): void {
    this.grid = null;
    this.report.reset();
    this.drawnIds = new Uint8Array(0);
    this.page = null;
    this.pageCanvas = null;
    this.pageVersion = -1;
    this.pInk = new Float32Array(0);
    this.pInkGeneration = -1;
    this.pInkPage = null;
    this.pInkPaints.length = 0;
    this.inkImg = null;
    this.maskImg = null;
    this.text = null;
    this.textCtx = null;
  }

  /**
   * Draws the ink and the reported slots' atlas text into `ctx` (DPR transform set), after the
   * resting rects. `cellPx` is the density cell; `cssW`/`cssH` the canvas's CSS size.
   */
  render(ctx: CanvasRenderingContext2D, frame: RenderFrame, cellPx: number, cssW: number, cssH: number): void {
    this.drawnIds.fill(0);
    // D89-10: no ink, no atlas text; reduced motion also drops the report, suppressText keeps it.
    if (frame.reducedMotion) {
      this.report.reset();
      return;
    }
    if (frame.suppressText === true) return;
    const { paints, stateView, elementView: ev } = frame;
    const n = paints.length;
    this.ensureSlots(n);
    const atlas = frame.textAtlas ?? null;
    const pageBad = atlas !== null && atlas.canvas === this.badCanvas && atlas.version === this.badVersion;
    const textOff = frame.textOff ?? -1;
    const away = frame.awaySlots;
    let movingCount = 0;
    let movingText = false;
    let anyDrawn = false;
    for (let id = 0; id < n; id++) {
      const paint = paints[id];
      const o = id * ELEMENT_STRIDE;
      const mv =
        paint !== undefined &&
        paint.particleCount > 0 &&
        (ev[o + El.W] as number) > 0 &&
        clamp01(stateView[id * STATE_STRIDE + St.REST_ALPHA] as number) < 1;
      this.moving[id] = mv ? 1 : 0;
      this.eligible[id] = 0;
      this.inkOn[id] = 0;
      if (!mv) continue;
      movingCount += 1;
      this.radius[id] = kernelRadiusPx(paint.spacingPx);
      const isAway = Math.abs((ev[o + El.INTERACTION] as number) - Interaction.DRAGGED) < 0.5 || (away !== undefined && away[id] === 1);
      const text = atlas !== null && !pageBad && paint.atlasRect !== null;
      if (!text) continue;
      movingText = true;
      const eligible = !isAway;
      this.eligible[id] = eligible ? 1 : 0;
      // Resolution 14: a textOff slot is neither drawn nor inked in this render.
      if (id === textOff) continue;
      const drawn = eligible && this.report.on(id); // resolution 1: decided last frame
      if (drawn) {
        this.drawnIds[id] = 1;
        anyDrawn = true;
      }
      this.inkOn[id] = isAway || drawn ? 1 : 0; // resolution 3
    }
    if (movingCount >= 2) this.seenTwo = true;
    this.enter.fill(0);
    this.exit.fill(0);
    let ran = false;
    if (movingCount >= 2 && movingText && atlas !== null && !this.broken) {
      ran = this.runGrid(ctx, frame, atlas, cellPx, cssW, cssH, anyDrawn);
    }
    if (!ran) this.maskHasFade = false;
    for (let id = 0; id < n; id++) {
      if (paints[id] === undefined && !this.report.on(id)) continue;
      this.report.step(id, this.eligible[id] === 1, this.enter[id]!, this.exit[id]!);
    }
    if (anyDrawn && atlas !== null) this.drawText(ctx, frame, atlas, this.grid?.cellPx ?? cellPx);
  }

  /** Splats, resolves and draws the ink; false when it could not run (no page, no canvases). */
  private runGrid(
    ctx: CanvasRenderingContext2D,
    frame: RenderFrame,
    atlas: TextAtlasFrame,
    cellPx: number,
    cssW: number,
    cssH: number,
    anyDrawn: boolean,
  ): boolean {
    const page = this.readPage(atlas);
    if (page === null) return false;
    this.inkImg ??= cellImage();
    this.maskImg ??= cellImage();
    const inkImg = this.inkImg;
    const maskImg = this.maskImg;
    if (inkImg === null || maskImg === null) {
      this.broken = true;
      return false;
    }
    this.cacheParticleInk(frame, atlas, page);
    const n = frame.paints.length;
    denseRanks(this.moving, this.ranks); // slots ≥ n stay 0 (not moving)
    for (let id = 0; id < n; id++) {
      const r = this.ranks[id]!;
      if (r >= 0) this.rankToId[r] = id;
    }
    const cell = cellPx * INK_CELL_FACTOR;
    if (this.grid === null || this.grid.cellPx !== cell) this.grid = new InkGrid(cell);
    const grid = this.grid;
    grid.resize(cssW, cssH);
    this.splatAll(frame, grid);
    const inkData = inkImg.size(grid.width, grid.height).data;
    const maskData = maskImg.size(grid.width, grid.height).data;
    const any = this.resolve(grid, inkData, maskData, inkImg, maskImg);
    if (any) {
      inkImg.put();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      inkImg.drawOnto(ctx, grid.cellPx);
    }
    if (anyDrawn && this.maskHasFade) maskImg.put();
    return true;
  }

  /** The page's pixels, read once per version (one getImageData); null when it cannot be read. */
  private readPage(atlas: TextAtlasFrame): AtlasPixels | null {
    if (this.page !== null && this.pageCanvas === atlas.canvas && this.pageVersion === atlas.version) return this.page;
    this.page = null;
    try {
      const c = atlas.canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
      const img = c?.getImageData(0, 0, atlas.width, atlas.height) ?? null;
      if (img !== null) {
        this.page = { width: img.width, height: img.height, data: img.data };
        this.pageCanvas = atlas.canvas;
        this.pageVersion = atlas.version;
      }
    } catch {
      /* the page cannot be read: below, as without one */
    }
    if (this.page === null) {
      // No atlas text for this version: its slots are never drawn, so their DOM text stays.
      this.badCanvas = atlas.canvas;
      this.badVersion = atlas.version;
    }
    return this.page;
  }

  /** D89-2: per-particle ink over its rest cell, recomputed when the generation, a paint or the page changes. */
  private cacheParticleInk(frame: RenderFrame, atlas: TextAtlasFrame, page: AtlasPixels): void {
    const cap = frame.particleCapacity;
    const { paints } = frame;
    let fresh = this.pInkGeneration === frame.generation && this.pInkPage === page && this.pInk.length === cap * 4;
    if (fresh) {
      if (this.pInkPaints.length !== paints.length) fresh = false;
      else for (let id = 0; id < paints.length; id++) if (this.pInkPaints[id] !== paints[id]) fresh = false;
    }
    if (fresh) return;
    if (this.pInk.length !== cap * 4) this.pInk = new Float32Array(cap * 4);
    else this.pInk.fill(0);
    this.pInkGeneration = frame.generation;
    this.pInkPage = page;
    this.pInkPaints.length = paints.length;
    for (let id = 0; id < paints.length; id++) this.pInkPaints[id] = paints[id];
    const st = frame.staticView;
    const dpr = atlas.dpr;
    for (let i = 0; i < cap; i++) {
      const home = st[Stat.HOME * cap + i] as number;
      if (!(home >= 0)) continue;
      const paint = paints[home | 0];
      const rect = paint?.atlasRect;
      if (!paint || !rect) continue;
      particleInk(page, rect, st[Stat.REST_U * cap + i] as number, st[Stat.REST_V * cap + i] as number, paint.spacingPx * dpr, this.pInk, i * 4);
    }
  }

  /** Every moving unparked particle: Σw and rank always, ink only while its slot is inkOn. */
  private splatAll(frame: RenderFrame, grid: InkGrid): void {
    if (frame.activeParticles === 0) return;
    const cap = frame.particleCapacity;
    const { dynamicView: dyn, staticView: st, paints } = frame;
    const pInk = this.pInk;
    for (let i = 0; i < cap; i++) {
      const home = st[Stat.HOME * cap + i] as number;
      if (!(home >= 0)) continue;
      const id = home | 0;
      if (this.moving[id] !== 1) continue;
      if (((dyn[Dyn.FLAGS * cap + i] as number) & FLAG_PARKED) !== 0) continue;
      const mass = paints[id]!.areaPerParticle;
      const x = dyn[Dyn.X * cap + i] as number;
      const y = dyn[Dyn.Y * cap + i] as number;
      const rank = this.ranks[id]!;
      if (this.inkOn[id] === 1) {
        const p = i * 4;
        grid.splat(x, y, mass, this.radius[id]!, rank, pInk[p]!, pInk[p + 1]!, pInk[p + 2]!, pInk[p + 3]!);
      } else {
        grid.splat(x, y, mass, this.radius[id]!, rank, 0, 0, 0, 0);
      }
    }
  }

  /**
   * Per dirty cell with lo < hi: the fade (mask alpha) and the report counts, and the ink
   * (`A = ia × inkScale × smoothstep(edge) × fade`, straight rgb = Σw·ink.rgb / ia). Returns
   * whether any ink alpha is > 0; sets `maskHasFade`.
   */
  private resolve(grid: InkGrid, ink: Uint8ClampedArray, mask: Uint8ClampedArray, inkImg: CellImage, maskImg: CellImage): boolean {
    const empty = grid.isEmpty;
    const x0 = empty ? 0 : grid.x0;
    const y0 = empty ? 0 : grid.y0;
    const x1 = empty ? -1 : grid.x1;
    const y1 = empty ? -1 : grid.y1;
    inkImg.reset(x0, y0, x1, y1);
    maskImg.reset(x0, y0, x1, y1);
    let anyInk = false;
    let anyFade = false;
    const { w, wr, lo, hi, ir, ig, ib, ia } = grid;
    const gw = grid.width;
    const { enter, exit, rankToId } = this;
    for (let y = y0; y <= y1; y++) {
      const row = y * gw;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const l = lo[i]!;
        const h = hi[i]!;
        if (!(l < h)) continue;
        const sw = w[i]!;
        const fade = inkFade(sw, wr[i]!, l, h);
        if (!(fade > 0)) continue;
        const a = rankToId[l]!;
        const b = rankToId[h]!;
        if (fade > MIX_ENTER_FADE) {
          enter[a]! += 1;
          enter[b]! += 1;
        }
        if (fade > MIX_EXIT_FADE) {
          exit[a]! += 1;
          exit[b]! += 1;
        }
        const p = i * 4;
        mask[p + 3] = fade * 255;
        anyFade = true;
        const sa = ia[i]!;
        if (!(sa > 0)) continue;
        const t = clamp01((sw - EDGE_LO) / EDGE_SPAN);
        const alpha = sa * inkScale(sa, sw) * t * t * (3 - 2 * t) * fade;
        if (!(alpha > 0)) continue;
        const inv = 255 / sa;
        ink[p] = ir[i]! * inv;
        ink[p + 1] = ig[i]! * inv;
        ink[p + 2] = ib[i]! * inv;
        ink[p + 3] = alpha * 255;
        anyInk = true;
      }
    }
    this.maskHasFade = anyFade;
    return anyInk;
  }

  /** The drawn slots' atlas text at their DOM boxes, the fade cut out, onto `ctx` at identity. */
  private drawText(ctx: CanvasRenderingContext2D, frame: RenderFrame, atlas: TextAtlasFrame, cell: number): void {
    const { widthCss, heightCss, dpr } = frame.viewport;
    const pw = Math.max(1, Math.round(widthCss * dpr));
    const ph = Math.max(1, Math.round(heightCss * dpr));
    if (this.text === null) {
      const canvas = document.createElement("canvas");
      const tctx = canvas.getContext("2d");
      if (tctx === null) {
        // No text layer: nothing was drawn, so the DOM text must stay.
        this.drawnIds.fill(0);
        return;
      }
      this.text = canvas;
      this.textCtx = tctx;
    }
    const layer = this.text;
    const tctx = this.textCtx!;
    if (layer.width !== pw || layer.height !== ph) {
      layer.width = pw;
      layer.height = ph;
    }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = "source-over";
    tctx.clearRect(0, 0, pw, ph);
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    const { paints, elementView: ev } = frame;
    for (let id = 0; id < this.drawnIds.length; id++) {
      if (this.drawnIds[id] !== 1) continue;
      const rect = paints[id]?.atlasRect;
      if (!rect) continue;
      const o = id * ELEMENT_STRIDE;
      tctx.drawImage(atlas.canvas, rect.x, rect.y, rect.w, rect.h, ev[o + El.X] as number, ev[o + El.Y] as number, ev[o + El.W] as number, ev[o + El.H] as number);
    }
    if (this.maskHasFade && this.maskImg !== null) {
      tctx.globalCompositeOperation = "destination-out";
      this.maskImg.drawOnto(tctx, cell);
      tctx.globalCompositeOperation = "source-over";
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Sizes the per-slot arrays to the paints (only when they grow; the frame zeroes what it uses). */
  private ensureSlots(n: number): void {
    if (this.drawnIds.length >= n) return;
    this.drawnIds = new Uint8Array(n);
    this.moving = new Uint8Array(n);
    this.eligible = new Uint8Array(n);
    this.inkOn = new Uint8Array(n);
    this.ranks = new Int16Array(n);
    this.rankToId = new Int16Array(n);
    this.enter = new Int32Array(n);
    this.exit = new Int32Array(n);
    this.radius = new Float32Array(n);
  }
}
