/**
 * W83 "Gravity and tilt" (canvas2d, blocking; the default testMatch routes this file to canvas2d only).
 * D83-1: a 90° tilt leans the liquid inside its elements (no pixel beyond the rects + 8 px, above the
 * 7.09 px kernel), every restAlpha is 1 again within 3 s, and the settled frame equals the frame
 * before the tilt. D83-4: a fixed vector given at create() starts at rest, pixel-identical to
 * gravity none. D83-5: the first deviceorientation reading seeds; a 30° tilt leans and rests.
 * Manual clock, seed 1, 1280×800 (demo/scenes/tilt.html).
 */
import { test, expect } from "./fixtures";
import { VIEWPORT } from "./projects";
import { TILT_BUDGET_FRAMES, gotoTilt, tiltAndSettle } from "./tilt";

test.use({ viewport: { ...VIEWPORT } });

test.describe("W83 – gravity and tilt (canvas2d)", () => {
  test("D83-1 – given the tilt scene at rest when gravity turns 90° then the liquid leans, none leaves its rect + 8 px, every restAlpha is 1 within 3 s and the settled frame equals the frame before the tilt", async ({ page }) => {
    await gotoTilt(page, "canvas2d");
    const run = await tiltAndSettle(page, 90);
    console.log(`W83 tilt 90° (canvas2d): min restAlpha ${run.minAlpha}, outside ${run.outsideBefore} → peak ${run.outsidePeak} px, rest after ${run.restFrame} frames`);
    expect(run.outsideBefore, "no liquid outside the rects before the tilt").toBe(0);
    expect(run.minAlpha, "the tilt leans the liquid (restAlpha < 1)").toBeLessThan(1);
    expect(run.outsidePeak, "no liquid beyond the rects + 8 px").toBe(run.outsideBefore);
    expect(run.restFrame, "every restAlpha back to 1").toBeGreaterThan(0);
    expect(run.restFrame, "within 3 s").toBeLessThanOrEqual(TILT_BUDGET_FRAMES);
    expect(run.hashAfter, "the settled frame equals the frame before the tilt").toBe(run.hashBefore);
  });

  test("D83-4 – given a fixed vector at create() when the scene loads then every restAlpha is 1 from the first frame and the canvas equals the same scene with gravity none", async ({ page }) => {
    const firstSecond = async (query: string): Promise<{ min: number; hash: string }> => {
      await gotoTilt(page, "canvas2d", query);
      return page.evaluate(() => {
        const h = window.__tilt!;
        let min = 1;
        for (let f = 0; f < 60; f++) {
          h.advance(1);
          min = Math.min(min, ...h.restAlpha());
        }
        return { min, hash: h.hash() };
      });
    };
    const fixed = await firstSecond("&angle=90");
    const none = await firstSecond("&gravity=none");
    expect(fixed.min, "a fixed vector at create() starts at rest (no slosh at load)").toBe(1);
    expect(fixed.hash, "pixel-identical to gravity none").toBe(none.hash);
  });

  test("D83-5 – given gravity orientation when the first deviceorientation reading arrives then nothing moves, and a 30° tilt leans the liquid and every restAlpha is 1 within 3 s", async ({ page }) => {
    await gotoTilt(page, "canvas2d", "&gravity=orientation");
    const run = await page.evaluate((budget) => {
      const h = window.__tilt!;
      h.advance(60);
      h.orient(45, 0); // the first reading: (0, 693) px/s², seeded
      let afterFirst = 1;
      for (let f = 0; f < 60; f++) {
        h.advance(1);
        afterFirst = Math.min(afterFirst, ...h.restAlpha());
      }
      h.orient(45, 30); // the phone turns 30° about its long axis
      let leaned = 1;
      let restFrame = -1;
      for (let f = 1; f <= budget; f++) {
        h.advance(1);
        const a = h.restAlpha();
        leaned = Math.min(leaned, ...a);
        if (leaned < 1 && a.every((x) => x === 1)) {
          restFrame = f;
          break;
        }
      }
      return { afterFirst, leaned, restFrame };
    }, TILT_BUDGET_FRAMES);
    console.log(`W83 orientation (canvas2d): first reading min restAlpha ${run.afterFirst}; 30° tilt min ${run.leaned}, rest after ${run.restFrame} frames`);
    expect(run.afterFirst, "the first reading seeds: nothing moves").toBe(1);
    expect(run.leaned, "the 30° tilt leans the liquid").toBeLessThan(1);
    expect(run.restFrame, "every restAlpha back to 1 within 3 s").toBeGreaterThan(0);
  });
});
