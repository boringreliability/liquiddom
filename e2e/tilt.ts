/**
 * W83 (D83-1, D83-4, D83-5): helpers for the tilt scene (demo/scenes/tilt.html, `window.__tilt`),
 * shared by e2e/tilt.spec.ts (canvas2d) and the W83 block of e2e/webgpu-robust.spec.ts (webgpu-hw).
 * Pixel reads go through the hook's snapshot of the last advance() (W71: a WebGPU canvas is readable
 * only in the task that rendered it).
 */
import type { Page } from "@playwright/test";
import { VIEWPORT } from "./projects";

/** 2 s idle before a tilt (scene step 1). */
export const TILT_IDLE_FRAMES = 120;
/** NORTH-STAR's re-form budget: every restAlpha back to 1 within 3 s. */
export const TILT_BUDGET_FRAMES = 180;
/** W67's outside metric grows each rect by 8 px, above the acceptance layout's 7.09 px kernel (W83.0 Q1). */
export const TILT_MARGIN_PX = 8;
/** The snap engages ≈ 8τ after a 90° step (W83.0 Q4: step 239); the settled frame is read after it. */
export const TILT_SETTLE_FRAMES = 300;

export async function gotoTilt(page: Page, renderer: "canvas2d" | "webgpu", query = ""): Promise<void> {
  await page.goto(`/scenes/tilt.html?renderer=${renderer}&clock=manual${query}`);
  await page.waitForFunction(() => window.__tilt !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__tilt!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
}

export interface TiltRun {
  /** The smallest restAlpha seen after the tilt (< 1: the liquid leaned). */
  minAlpha: number;
  /** Opaque pixels outside the rects + TILT_MARGIN_PX in the frame before the tilt, and the most during it. */
  outsideBefore: number;
  outsidePeak: number;
  /** Frames from the tilt until every restAlpha is 1 again (-1: never within TILT_SETTLE_FRAMES). */
  restFrame: number;
  /** The frame before the tilt and the frame TILT_SETTLE_FRAMES after it. */
  hashBefore: string;
  hashAfter: string;
}

/** Idles, turns gravity to `deg` (from straight down) and runs TILT_SETTLE_FRAMES frames, one at a time. */
export async function tiltAndSettle(page: Page, deg: number): Promise<TiltRun> {
  await page.evaluate((n) => window.__tilt!.advance(n), TILT_IDLE_FRAMES);
  return page.evaluate(
    ([angle, margin, budget, settle]) => {
      const h = window.__tilt!;
      const hashBefore = h.hash();
      const outsideBefore = h.outside(margin);
      h.setAngle(angle);
      let minAlpha = 1;
      let outsidePeak = outsideBefore;
      let restFrame = -1;
      for (let f = 1; f <= settle; f++) {
        h.advance(1);
        const a = h.restAlpha();
        minAlpha = Math.min(minAlpha, ...a);
        if (f <= budget) outsidePeak = Math.max(outsidePeak, h.outside(margin));
        if (restFrame < 0 && minAlpha < 1 && a.every((x) => x === 1)) restFrame = f;
      }
      return { minAlpha, outsideBefore, outsidePeak, restFrame, hashBefore, hashAfter: h.hash() };
    },
    [deg, TILT_MARGIN_PX, TILT_BUDGET_FRAMES, TILT_SETTLE_FRAMES] as const,
  );
}
