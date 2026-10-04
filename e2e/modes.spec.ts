import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  VISUAL_ENABLED,
  VISUAL_SKIP_REASON,
  advance,
  canvasHasContent,
  canvasPixelAt,
  gotoScene,
  moveCard,
  restAlpha,
  rgbaDiffers,
  type MoveResult,
} from "./scene";

const CARD_INDEX = 3; // DOM order: #splash, #split, #merge, #card

type RmMode = "media" | "option";

/** Loads the scene in reduced motion by the given route (D65-11: prefers-reduced-motion or ?rm=1). */
async function loadReduced(page: Page, mode: RmMode): Promise<void> {
  if (mode === "media") await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoScene(page, { seed: 1, clock: "manual", rm: mode === "option" });
}

/**
 * The idle scene is already static with or without reduced motion, so each spec moves #card first:
 * only a runtime that really skips the springs shows the liquid at the new rect on the first frame.
 */
async function moveAndAdvanceOneFrame(page: Page): Promise<MoveResult> {
  const moved = await moveCard(page);
  await advance(page, 1);
  return moved;
}

const VARIANTS: ReadonlyArray<{ mode: RmMode; name: string }> = [
  {
    mode: "media",
    name: "step 8 – given prefers-reduced-motion reduce when the scene loads then restAlpha is 1 on the first frame and two frames 1 s apart are identical",
  },
  {
    mode: "option",
    name: "step 8 – given ?rm=1 (forceReducedMotion) when the scene loads then restAlpha is 1 on the first frame",
  },
];

test.describe("step 8 – modes (slice 1)", () => {
  for (const { mode, name } of VARIANTS) {
    test(name, async ({ page }, testInfo) => {
      await loadReduced(page, mode);
      // (a) reduced motion is really in effect, not just an idle scene
      expect(await page.evaluate(() => window.__liquidTest!.params.reducedMotion)).toBe(true);

      const { oldRect, newRect } = await moveAndAdvanceOneFrame(page);
      expect(newRect.y, "moved card stays inside the 800 px viewport").toBeLessThan(800 - 20);
      expect(newRect.y - oldRect.y, "the card really moved").toBeGreaterThan(50);

      // (b) first frame after the move: at rest, and the liquid already sits at the new rect
      expect((await restAlpha(page))[CARD_INDEX]).toBe(1);
      const inside = await canvasPixelAt(page, newRect.x + newRect.width / 2, newRect.y + newRect.height / 2);
      const stale = await canvasPixelAt(page, newRect.x + newRect.width / 2, oldRect.y + 10);
      expect(inside.a, `canvas alpha at the new card centre (${JSON.stringify(inside)})`).toBeGreaterThan(200);
      expect(
        stale.a === 0 || rgbaDiffers(stale, inside),
        `old location ${JSON.stringify(stale)} must be background, not the element colour ${JSON.stringify(inside)}`,
      ).toBe(true);

      // (d) not a blank canvas
      expect(await canvasHasContent(page), "canvas is non-blank").toBe(true);

      // (c) two later frames are pixel-identical
      const canvas = page.locator("canvas").first();
      await advance(page, 1);
      const first = await canvas.screenshot();
      await advance(page, 60); // 1 s at 60 Hz
      const second = await canvas.screenshot();
      expect(first.equals(second), "canvas pixels changed between two later frames under reduced motion").toBe(true);
      expect((await restAlpha(page))[CARD_INDEX]).toBe(1);

      await page.screenshot({ path: testInfo.outputPath(`w65-step8-reduced-motion-${mode}.png`) });
    });

    // (e) Linux-only pixel baseline of the reduced-motion state
    test(`step 8 visual – given reduced motion (${mode}) and a moved card when screenshotted then it matches the baseline`, async ({ page }) => {
      test.skip(!VISUAL_ENABLED, VISUAL_SKIP_REASON);
      await loadReduced(page, mode);
      await moveAndAdvanceOneFrame(page);
      await advance(page, 2);
      expect(await page.evaluate(() => window.__liquidTest!.params.reducedMotion)).toBe(true);
      await expect(page).toHaveScreenshot(`step8-reduced-motion-${mode}.png`, { maxDiffPixelRatio: 0.01 });
    });
  }

  // D65-4: the print rule ships with W66's injected stylesheet; W66 removes `.fixme`.
  test.fixme("step 8 – given print media when emulated then the liquid canvas is display none", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, 1);
    const canvas = page.locator("canvas.liquid-canvas");
    await expect(canvas, "canvas is shown in screen media").toBeVisible();
    await expect(canvas).not.toHaveCSS("display", "none");
    await page.emulateMedia({ media: "print" });
    await expect(canvas).toHaveCSS("display", "none");
    for (const el of await page.locator("[data-liquid]").all()) {
      await expect(el).not.toHaveClass(/liquid-text/);
    }
  });
});
