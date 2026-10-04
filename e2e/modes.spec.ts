import { test, expect } from "./fixtures";
import { advance, gotoScene, restAlpha } from "./scene";

test.describe("step 8 – modes (slice 1)", () => {
  test("step 8 – given prefers-reduced-motion reduce when the scene loads then restAlpha is 1 on the first frame and two frames 1 s apart are identical", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, 1);
    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);

    const canvas = page.locator("canvas").first();
    const first = await canvas.screenshot();
    await advance(page, 60); // 1 s at 60 Hz
    const second = await canvas.screenshot();
    expect(first.equals(second), "canvas pixels changed between frame 1 and frame 61 under reduced motion").toBe(true);
    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);

    await page.screenshot({ path: testInfo.outputPath("w65-step8-reduced-motion.png") });
  });

  test("step 8 – given ?rm=1 (forceReducedMotion) when the scene loads then restAlpha is 1 on the first frame", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "manual", rm: true });
    await advance(page, 1);
    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);
  });

  // D65-4: the print rule ships with W66's injected stylesheet; W66 removes `.fixme`.
  test.fixme("step 8 – given print media when emulated then the liquid canvas is display none", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, 1);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("canvas.liquid-canvas")).toHaveCSS("display", "none");
    for (const el of await page.locator("[data-liquid]").all()) {
      await expect(el).not.toHaveClass(/liquid-text/);
    }
  });
});
