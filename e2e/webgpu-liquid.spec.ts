/**
 * W71 (D71-2, D71-3, Review Focus 4): the WebGPU liquid on its own check page
 * (demo/smoke/webgpu-liquid.html). Runs in the webgpu project only (canvas2d ignores it).
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const IDLE_FRAMES = 120;
const REFORM_FRAMES = 180;
/** Unpremultiplied colour each element's liquid must show (#clear falls back to DEFAULT_LIQUID_COLOR). */
const EXPECTED: Record<string, readonly [number, number, number]> = {
  solid: [47, 111, 222],
  glass: [0, 128, 255],
  clear: [83, 52, 131],
};

interface ElementStats {
  id: string;
  /** Pixels with alpha ≥ 32 inside the element rect. */
  count: number;
  maxAlpha: number;
  /** Worst |rgb − expected| over those pixels (unpremultiplied, 0–255). */
  maxRgbError: number;
  centre: number[];
}

async function open(page: Page, renderer: "webgpu" | "canvas2d"): Promise<void> {
  await page.goto(`/smoke/webgpu-liquid.html?renderer=${renderer}`);
  await page.waitForFunction(() => window.__webgpuLiquid !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__webgpuLiquid!.ready);
  await page.evaluate((n) => window.__webgpuLiquid!.advance(n), IDLE_FRAMES);
}

async function stats(page: Page): Promise<ElementStats[]> {
  return page.evaluate((expected) => {
    const img = window.__webgpuLiquid!.pixels();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width;
    const sy = canvas.height / cr.height;
    return Object.keys(expected).map((id) => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      const want = expected[id]!;
      let count = 0;
      let maxAlpha = 0;
      let maxRgbError = 0;
      const x0 = Math.max(0, Math.floor((r.left - cr.left) * sx));
      const x1 = Math.min(img.width, Math.ceil((r.right - cr.left) * sx));
      const y0 = Math.max(0, Math.floor((r.top - cr.top) * sy));
      const y1 = Math.min(img.height, Math.ceil((r.bottom - cr.top) * sy));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * img.width + x) * 4;
          const a = img.data[p + 3]!;
          if (a < 32) continue;
          count++;
          maxAlpha = Math.max(maxAlpha, a);
          for (let c = 0; c < 3; c++) maxRgbError = Math.max(maxRgbError, Math.abs(img.data[p + c]! - want[c]!));
        }
      }
      const cx = Math.floor((r.left + r.width / 2 - cr.left) * sx);
      const cy = Math.floor((r.top + r.height / 2 - cr.top) * sy);
      const pc = (cy * img.width + cx) * 4;
      return { id, count, maxAlpha, maxRgbError, centre: Array.from(img.data.subarray(pc, pc + 4)) };
    });
  }, EXPECTED);
}

/**
 * Liquid pixels (alpha ≥ 32) outside all three element rects (inflated by 2 px): the flying
 * #glass liquid. Inside #glass the rest overlay (restAlpha × 0.5) is drawn over the liquid during
 * the cross-fade, exactly as Canvas2D draws its roundRect, so alpha may exceed 0.5 there.
 */
async function flyingGlass(page: Page): Promise<{ count: number; maxAlpha: number; maxRgbError: number }> {
  return page.evaluate((want) => {
    const img = window.__webgpuLiquid!.pixels();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width;
    const sy = canvas.height / cr.height;
    const others = ["solid", "glass", "clear"].map((id) => document.getElementById(id)!.getBoundingClientRect());
    let count = 0;
    let maxAlpha = 0;
    let maxRgbError = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const p = (y * img.width + x) * 4;
        const a = img.data[p + 3]!;
        if (a < 32) continue;
        const cx = x / sx + cr.left;
        const cy = y / sy + cr.top;
        if (others.some((r) => cx >= r.left - 2 && cx <= r.right + 2 && cy >= r.top - 2 && cy <= r.bottom + 2)) continue;
        count++;
        maxAlpha = Math.max(maxAlpha, a);
        for (let c = 0; c < 3; c++) maxRgbError = Math.max(maxRgbError, Math.abs(img.data[p + c]! - want[c]!));
      }
    }
    return { count, maxAlpha, maxRgbError };
  }, EXPECTED.glass!);
}

test.describe("webgpu liquid (W71)", () => {
  test("D71-3 – given the three liquid shaders when every pipeline is built under a validation error scope then there is no validation error and no compilation error", async ({ page }) => {
    await page.goto("/smoke/webgpu-liquid.html?renderer=webgpu");
    await page.waitForFunction(() => window.__webgpuLiquid !== undefined, undefined, { timeout: 15_000 });
    const check = await page.evaluate(() => window.__webgpuLiquid!.pipelineCheck());
    console.log(`[w71 pipelines] ${JSON.stringify(check)}`);
    expect(check.error).toBeNull();
    expect(check.messages.filter((m) => m.startsWith("error"))).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test("D71-2 – given renderer webgpu when the page idles, splashes and re-forms then activeRenderer is webgpu, the liquid is drawn and no GPU error is reported", async ({ page }) => {
    await open(page, "webgpu");
    expect(await page.evaluate(() => window.__webgpuLiquid!.activeRenderer)).toBe("webgpu");
    expect(await page.evaluate(() => window.__webgpuLiquid!.restAlpha())).toEqual([1, 1, 1]);
    const [solid] = await stats(page);
    expect(solid!.centre[3], "solid liquid at rest").toBe(255);
    expect(solid!.count).toBeGreaterThan(1000);
    await page.evaluate(() => window.__webgpuLiquid!.splash("solid"));
    await page.evaluate(() => window.__webgpuLiquid!.advance(10));
    expect(Math.min(...(await page.evaluate(() => window.__webgpuLiquid!.restAlpha())))).toBeLessThan(1);
    const frames = await page.evaluate((max) => {
      const h = window.__webgpuLiquid!;
      for (let f = 1; f <= max; f++) {
        h.advance(1);
        if (h.restAlpha().every((a) => a === 1)) return f;
      }
      return -1;
    }, REFORM_FRAMES);
    expect(frames, "re-form within 3 s").toBeGreaterThan(0);
    // fixtures.ts fails this test on the renderer's console.error for an uncaptured GPU error.
  });

  test("Review Focus 4 – given a translucent and a transparent element when at rest and mid-splash then the translucent liquid keeps its colour at half alpha with no dark fringe, the transparent one uses the default liquid colour, and webgpu matches canvas2d", async ({ page }) => {
    const rest: Record<"canvas2d" | "webgpu", ElementStats[]> = { canvas2d: [], webgpu: [] };
    for (const renderer of ["canvas2d", "webgpu"] as const) {
      await open(page, renderer);
      expect(await page.evaluate(() => window.__webgpuLiquid!.activeRenderer)).toBe(renderer);
      expect(await page.evaluate(() => window.__webgpuLiquid!.restAlpha())).toEqual([1, 1, 1]);
      rest[renderer] = await stats(page);
      console.log(`[w71 RF4 ${renderer}] ${JSON.stringify(rest[renderer])}`);
    }
    for (const renderer of ["canvas2d", "webgpu"] as const) {
      const [solid, glass, clear] = rest[renderer];
      expect(solid!.centre[3], `${renderer} solid`).toBe(255);
      expect(solid!.maxRgbError, `${renderer} solid colour`).toBeLessThanOrEqual(6);
      expect(glass!.centre[3], `${renderer} glass alpha`).toBeGreaterThanOrEqual(125);
      expect(glass!.maxAlpha, `${renderer} glass never above half alpha`).toBeLessThanOrEqual(131);
      expect(glass!.maxRgbError, `${renderer} glass colour (no dark fringe)`).toBeLessThanOrEqual(12);
      expect(clear!.centre[3], `${renderer} clear`).toBe(255);
      expect(clear!.maxRgbError, `${renderer} clear = default liquid colour`).toBeLessThanOrEqual(6);
    }
    for (let i = 0; i < 3; i++) {
      for (let c = 0; c < 4; c++) {
        expect(Math.abs(rest.webgpu[i]!.centre[c]! - rest.canvas2d[i]!.centre[c]!), `${rest.webgpu[i]!.id} channel ${c}`).toBeLessThanOrEqual(3);
      }
    }
    // Mid-splash under webgpu: the flying translucent liquid keeps its colour and never exceeds half alpha.
    await open(page, "webgpu");
    await page.evaluate(() => window.__webgpuLiquid!.splash("glass"));
    let seen = 0;
    for (const step of [4, 4, 4]) {
      await page.evaluate((n) => window.__webgpuLiquid!.advance(n), step);
      const g = await flyingGlass(page);
      seen = Math.max(seen, g.count);
      expect(g.maxAlpha, "flying glass alpha").toBeLessThanOrEqual(131);
      expect(g.maxRgbError, "flying glass colour (no dark fringe)").toBeLessThanOrEqual(24);
    }
    expect(seen, "the splash shows translucent liquid").toBeGreaterThan(100);
  });
});
