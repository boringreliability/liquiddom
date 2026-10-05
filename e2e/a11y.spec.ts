import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { advance, gotoScene, IDLE_2S_FRAMES, VISUAL_ENABLED } from "./scene";

/** W65 scene helpers: `?test=1&seed=1&clock=manual`, waits for `__liquidTest.ready`, then 2 s of idle frames. */
async function openAtRest(page: Page): Promise<void> {
  await gotoScene(page, { seed: 1, clock: "manual" });
  await advance(page, IDLE_2S_FRAMES);
}

test("step 8 – given the acceptance scene when axe runs then 0 violations and the canvas is aria-hidden", async ({ page }) => {
  await openAtRest(page);
  const canvas = page.locator("canvas.liquid-canvas");
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute("aria-hidden", "true");
  // The injected stylesheet (D66-15) carries the paint neutralisation, not scene CSS.
  await expect(page.locator("style#liquiddom-styles")).toHaveCount(1);
  // D66-15: axe cannot see canvas-painted backgrounds, so contrast is checked on the
  // restored author backgrounds (print neutralises the liquid classes).
  const screen = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(screen.violations).toEqual([]);
  await page.emulateMedia({ media: "print" });
  const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(contrast.violations).toEqual([]);
});

test("given focus on Split via Tab when screenshotted then the focus ring is drawn above the liquid", async ({ page }) => {
  await openAtRest(page);
  const split = page.getByRole("button", { name: "Split" });
  for (let i = 0; i < 10 && !(await split.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(split).toBeFocused();
  // D66-3: stacking comes from the injected data-liquid-stack attribute.
  expect(["relative", "z"]).toContain(await split.getAttribute("data-liquid-stack"));
  const stack = await split.evaluate((el) => {
    const cs = getComputedStyle(el);
    const canvas = document.querySelector("canvas.liquid-canvas") as HTMLCanvasElement;
    return {
      focusVisible: el.matches(":focus-visible"),
      outline: cs.outlineStyle,
      z: cs.zIndex,
      position: cs.position,
      canvasZ: getComputedStyle(canvas).zIndex,
    };
  });
  expect(stack.focusVisible).toBe(true);
  expect(stack.outline).not.toBe("none");
  expect(stack.position).not.toBe("static");
  expect(stack.z).toBe("1");
  expect(stack.canvasZ).toBe("0");
  await advance(page, 2);
  const box = (await split.boundingBox())!;
  const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 };
  // D65-2: pixel baselines exist for Linux (pinned image) only; the behavioural checks above run everywhere.
  if (VISUAL_ENABLED) {
    await expect(page).toHaveScreenshot("a11y-focus-split.png", { clip, maxDiffPixelRatio: 0.01 });
  }
});
