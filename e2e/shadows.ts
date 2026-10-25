/**
 * W88 (D88-1 … D88-14): probes for e2e/shadows.spec.ts (canvas2d) and the webgpu-hw block of
 * e2e/webgpu-robust.spec.ts, on demo/scenes/shadows.html (manual clock, seed 1, 1280×800).
 *
 * - `ringEnergy` reads a page screenshot (the browser's shadow and the canvas's, whichever shows):
 *   Σ |rgb − page background|₁ over the ring between `inner` and `outer` px outside the element's rect.
 * - `canvasBoxes` reads the liquid canvas (`__shadows.pixels()`, the frame of the last advance): the
 *   bounding boxes, in CSS px, of the element's liquid pixels and of its shadow pixels near it.
 */
import type { Page } from "@playwright/test";
import type { ShadowsId } from "../demo/test-hooks";
import { VIEWPORT } from "./projects";

/** demo/scenes/shadows.html: the page background. */
export const SHADOWS_PAGE_RGB: readonly [number, number, number] = [0xf3, 0xef, 0xe6];
/** 2 s of idle frames before a probe. */
export const SHADOWS_IDLE_FRAMES = 120;
/** NORTH-STAR's 3 s re-form budget, in frames, with the splash's own frames on top. */
export const SHADOWS_REST_BUDGET_FRAMES = 300;
/** The liquid colours of the scene (demo/scenes/shadows.html). */
export const LIQUID_RGB: Readonly<Record<"drop" | "glow" | "glass", readonly [number, number, number]>> = {
  drop: [0x2f, 0x6f, 0xde],
  glow: [0x0b, 0x6e, 0x78],
  glass: [0x2f, 0x6f, 0xde],
};

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export async function gotoShadows(page: Page, renderer: "canvas2d" | "webgpu", extra = ""): Promise<void> {
  await page.goto(`/scenes/shadows.html?renderer=${renderer}&clock=manual${extra}`);
  await page.waitForFunction(() => window.__shadows !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__shadows!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate((n) => window.__shadows!.advance(n), SHADOWS_IDLE_FRAMES);
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
}

export async function advanceShadows(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => window.__shadows!.advance(n), frames);
}

/** `liquid-shadow-away` on #id now. */
export async function heldOf(page: Page, id: ShadowsId): Promise<boolean> {
  return page.evaluate((i) => window.__shadows!.held()[window.__shadows!.ids.indexOf(i)] ?? false, id);
}

export async function restAlphaOf(page: Page, id: ShadowsId): Promise<number> {
  return page.evaluate((i) => window.__shadows!.restAlpha()[window.__shadows!.ids.indexOf(i)] ?? Number.NaN, id);
}

/** Σ |rgb − background|₁ over the page pixels between `inner` and `outer` px outside #id's rect (a page screenshot). */
export async function ringEnergy(page: Page, id: ShadowsId, inner: number, outer: number): Promise<number> {
  const r = await page.evaluate((i) => window.__shadows!.rect(i), id);
  const x = Math.max(0, Math.floor(r.x - outer));
  const y = Math.max(0, Math.floor(r.y - outer));
  const clip = { x, y, width: Math.ceil(r.x + r.width + outer) - x, height: Math.ceil(r.y + r.height + outer) - y };
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ([b64, rect, ox, oy, lo, hi, bg]) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const off = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("W88: no 2d context for the ring probe");
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let energy = 0;
      for (let py = 0; py < bmp.height; py++) {
        for (let px = 0; px < bmp.width; px++) {
          const cx = ox + px + 0.5;
          const cy = oy + py + 0.5;
          const dx = Math.max(rect.x - cx, 0, cx - (rect.x + rect.width));
          const dy = Math.max(rect.y - cy, 0, cy - (rect.y + rect.height));
          const dist = Math.max(dx, dy);
          if (dist <= lo || dist > hi) continue;
          const o = (py * bmp.width + px) * 4;
          energy += Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
        }
      }
      return energy;
    },
    [shot.toString("base64"), r, x, y, inner, outer, SHADOWS_PAGE_RGB] as const,
  );
}

/**
 * The bounding boxes (CSS px) of #id's liquid pixels (alpha ≥ 200, |rgb − liquid|₁ < 90) and of its
 * shadow pixels (`dark`: rgb ≤ 60 each; `cyan`: r < 120, g and b > 150; alpha ≥ 12 either way) within
 * `grow` px of its rect, from the last snapshot of the liquid canvas. Null when there are none.
 */
export async function canvasBoxes(page: Page, id: ShadowsId, grow: number, liquid: readonly [number, number, number], kind: "dark" | "cyan"): Promise<{ liquid: Box | null; shadow: Box | null }> {
  return page.evaluate(
    ([i, g, rgb, k]) => {
      const h = window.__shadows!;
      const img = h.pixels();
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
      const cr = canvas.getBoundingClientRect();
      const sx = img.width / cr.width;
      const sy = img.height / cr.height;
      const r = h.rect(i);
      const x0 = Math.max(0, Math.floor((r.x - g - cr.left) * sx));
      const y0 = Math.max(0, Math.floor((r.y - g - cr.top) * sy));
      const x1 = Math.min(img.width, Math.ceil((r.x + r.width + g - cr.left) * sx));
      const y1 = Math.min(img.height, Math.ceil((r.y + r.height + g - cr.top) * sy));
      const grow = (b: Box | null, x: number, y: number): Box => (b === null ? { x0: x, y0: y, x1: x, y1: y } : { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) });
      type Box = { x0: number; y0: number; x1: number; y1: number };
      let liq: Box | null = null;
      let sh: Box | null = null;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const o = (py * img.width + px) * 4;
          const [cr0, cg, cb, ca] = [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
          const cx = cr.left + (px + 0.5) / sx;
          const cy = cr.top + (py + 0.5) / sy;
          const isLiquid = ca >= 200 && Math.abs(cr0 - rgb[0]) + Math.abs(cg - rgb[1]) + Math.abs(cb - rgb[2]) < 90;
          if (isLiquid) {
            liq = grow(liq, cx, cy);
            continue;
          }
          const isShadow = ca >= 12 && (k === "dark" ? cr0 <= 60 && cg <= 60 && cb <= 60 : cr0 < 120 && cg > 150 && cb > 150);
          if (isShadow) sh = grow(sh, cx, cy);
        }
      }
      return { liquid: liq, shadow: sh };
    },
    [id, grow, liquid, kind] as const,
  );
}

/**
 * The largest alpha of a liquid-hued canvas pixel no lighter than the liquid (blue − red > 60, red
 * and green at most the liquid's + 20) within #id's rect grown by `grow` (the knockout probe,
 * D88-10). A black shadow under 50 % liquid would darken it and raise its alpha; WebGPU's white
 * liquid text (W74) lightens it and is left out.
 */
export async function maxLiquidAlpha(page: Page, id: ShadowsId, grow: number, liquid: readonly [number, number, number] = LIQUID_RGB.glass): Promise<number> {
  return page.evaluate(
    ([i, g, rgb]) => {
      const h = window.__shadows!;
      const img = h.pixels();
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
      const cr = canvas.getBoundingClientRect();
      const sx = img.width / cr.width;
      const sy = img.height / cr.height;
      const r = h.rect(i);
      let max = 0;
      for (let py = Math.max(0, Math.floor((r.y - g - cr.top) * sy)); py < Math.min(img.height, Math.ceil((r.y + r.height + g - cr.top) * sy)); py++) {
        for (let px = Math.max(0, Math.floor((r.x - g - cr.left) * sx)); px < Math.min(img.width, Math.ceil((r.x + r.width + g - cr.left) * sx)); px++) {
          const o = (py * img.width + px) * 4;
          const hued = img.data[o + 2] - img.data[o] > 60 && img.data[o] <= rgb[0] + 20 && img.data[o + 1] <= rgb[1] + 20;
          if (hued && img.data[o + 3] > max) max = img.data[o + 3];
        }
      }
      return max;
    },
    [id, grow, liquid] as const,
  );
}

export interface HandoffRun {
  /** The frame (from the splash) at which restAlpha reached 1 and stayed. */
  rest: number;
  /** Per recorded frame: restAlpha, the class, the ring energy over the browser's at rest. */
  frames: Array<{ f: number; restAlpha: number; held: boolean; ratio: number }>;
  /** Class changes in the recorded window (restAlpha bounces before rest, spike W88.0). */
  toggles: number;
}

/**
 * D88-7 (Review Focus: the handoff with exact radii, the non-monotonic restAlpha window): splash #id
 * at `strength`, run frames until its restAlpha is 1 for 3 frames, and record from the first frame
 * with restAlpha ≥ `from` on the ring energy of every frame (page screenshots), relative to the
 * browser's at rest 3 frames after the end.
 */
export async function handoff(page: Page, id: ShadowsId, strength: number, inner: number, outer: number, from = 0.8): Promise<HandoffRun> {
  await page.evaluate(([i, s]) => window.__shadows!.splash(i, s), [id, strength] as const);
  const raw: Array<{ f: number; restAlpha: number; held: boolean; energy: number }> = [];
  let rest = -1;
  let calm = 0;
  let recording = false;
  for (let f = 1; f <= SHADOWS_REST_BUDGET_FRAMES; f++) {
    await advanceShadows(page, 1);
    const a = await restAlphaOf(page, id);
    if (!recording && a >= from && f > 4) recording = true;
    if (recording) raw.push({ f, restAlpha: a, held: await heldOf(page, id), energy: await ringEnergy(page, id, inner, outer) });
    calm = a === 1 ? calm + 1 : 0;
    if (calm === 1) rest = f;
    if (calm === 4) break;
  }
  const atRest = raw.at(-1)?.energy ?? 0;
  let toggles = 0;
  for (let k = 1; k < raw.length; k++) if (raw[k]!.held !== raw[k - 1]!.held) toggles += 1;
  return { rest, toggles, frames: raw.map((r) => ({ f: r.f, restAlpha: r.restAlpha, held: r.held, ratio: atRest > 0 ? r.energy / atRest : Number.NaN })) };
}
