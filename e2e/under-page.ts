/**
 * W82 (D82-1, D82-2, D82-5): page-pixel probes for "under the page". The canvas probes of e2e/lace.ts
 * read the liquid canvas only; whether the liquid paints over or under page text shows only in a
 * screenshot of the page. A WebGPU canvas is composited into page screenshots like any other.
 *
 * Ink probe (W82.0 Q1a): a screenshot of a text box with the liquid, and a reference screenshot of
 * the same frame with every liquid canvas hidden (`visibility: hidden`, restored at once; no frame
 * runs in between under the manual clock). Ink pixels are the reference pixels whose |Δrgb|₁ from
 * the box's background (its top-left pixel) is at least INK_FRACTION of the box's largest; an ink
 * pixel is covered when the liquid changed it by more than COVER_L1. With the canvas under the page
 * the glyphs are drawn over the liquid and no fully inked pixel changes; at z-index 0 the liquid
 * hides whole letters (W82.0: 86 covered on the landing lede under a strength-2 splash, 137 under a
 * strength-2 shake).
 */
import type { Page } from "@playwright/test";
import type { ClientRect } from "./lace";

/** A pixel is ink when its distance from the background is at least this share of the box's largest (antialiased edges excluded). */
export const INK_FRACTION = 0.95;
/** |Δrgb|₁ above which the liquid changed a pixel (W82.0 Q1a). */
export const COVER_L1 = 60;
/** Covered ink pixels allowed: the canvas under the page covers none. */
export const MAX_COVERED_INK_PX = 0;
/** W83 red (approved by Dennis 2026-10-14, saga dec_6f6924ff): a probed text box must hold more glyph-ink pixels than this, so a box without ink cannot pass vacuously. */
export const MIN_INK_PX = 200;

export interface InkProbe {
  /** Ink pixels of the box in the reference. */
  ink: number;
  /** Ink pixels the liquid changed. */
  covered: number;
  /** Pixels of the box the liquid changed (ink or not): > 0 means the liquid reached the box. */
  changed: number;
}

async function decodeAndCompare(page: Page, live: Buffer, ref: Buffer, inkFraction: number, coverL1: number): Promise<InkProbe> {
  return page.evaluate(
    async ([a, b, frac, cover]) => {
      const load = async (b64: string): Promise<ImageData> => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("W82: no 2d context for the ink probe");
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const L = await load(a);
      const R = await load(b);
      const n = Math.min(L.data.length, R.data.length);
      const bg = [R.data[0], R.data[1], R.data[2]];
      const dist = (d: Uint8ClampedArray, o: number, c: number[]): number =>
        Math.abs(d[o] - c[0]) + Math.abs(d[o + 1] - c[1]) + Math.abs(d[o + 2] - c[2]);
      let max = 0;
      for (let o = 0; o < n; o += 4) max = Math.max(max, dist(R.data, o, bg));
      let ink = 0;
      let covered = 0;
      let changed = 0;
      for (let o = 0; o < n; o += 4) {
        const moved = dist(L.data, o, [R.data[o], R.data[o + 1], R.data[o + 2]]) > cover;
        if (moved) changed += 1;
        if (max === 0 || dist(R.data, o, bg) < frac * max) continue;
        ink += 1;
        if (moved) covered += 1;
      }
      return { ink, covered, changed };
    },
    [live.toString("base64"), ref.toString("base64"), inkFraction, coverL1] as const,
  );
}

/** W82.0 Q1a ink probe over `selector`'s bounding box at the current frame (see the module doc). */
export async function inkCovered(page: Page, selector: string, inkFraction: number = INK_FRACTION, coverL1: number = COVER_L1): Promise<InkProbe> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`W82: ${selector} has no box`);
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  const live = await page.screenshot({ clip });
  await page.evaluate(() => {
    for (const c of document.querySelectorAll<HTMLCanvasElement>("canvas.liquid-canvas")) c.style.visibility = "hidden";
  });
  const ref = await page.screenshot({ clip });
  await page.evaluate(() => {
    for (const c of document.querySelectorAll<HTMLCanvasElement>("canvas.liquid-canvas")) c.style.visibility = "";
  });
  return decodeAndCompare(page, live, ref, inkFraction, coverL1);
}

/** Page-screenshot pixels inside `rect` within |Δrgb|₁ < 60 of `rgb` (the liquid seen on the page, whatever paints over it). */
export async function pagePixelsOf(page: Page, rect: ClientRect, rgb: readonly [number, number, number]): Promise<number> {
  const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ([b64, c]) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const off = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("W82: no 2d context for the page pixels");
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let n = 0;
      for (let o = 0; o < d.length; o += 4) if (Math.abs(d[o] - c[0]) + Math.abs(d[o + 1] - c[1]) + Math.abs(d[o + 2] - c[2]) < 60) n++;
      return n;
    },
    [shot.toString("base64"), rgb] as const,
  );
}

/**
 * W82 (D82-5): liquid canvas pixels of colour `rgb` (alpha > 128, |Δrgb|₁ < 60) on the canvas's
 * outermost column or row on `edge`, from `__liquidTest.pixels()` (the frame of the last advance()).
 */
export async function edgePixels(page: Page, rgb: readonly [number, number, number], edge: "right" | "top"): Promise<number> {
  return page.evaluate(
    ([c, e]) => {
      const { width: W, height: H, data } = window.__liquidTest!.pixels();
      const at = (x: number, y: number): boolean => {
        const o = (y * W + x) * 4;
        return data[o + 3] > 128 && Math.abs(data[o] - c[0]) + Math.abs(data[o + 1] - c[1]) + Math.abs(data[o + 2] - c[2]) < 60;
      };
      let n = 0;
      if (e === "right") for (let y = 0; y < H; y++) n += at(W - 1, y) ? 1 : 0;
      else for (let x = 0; x < W; x++) n += at(x, 0) ? 1 : 0;
      return n;
    },
    [rgb, edge] as const,
  );
}
