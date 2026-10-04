import { test, expect } from "./fixtures";
import { IDLE_2S_FRAMES, advance, canvasPixelAt, gotoScene, restAlpha, rgbaDiffers, type Rgba } from "./scene";

/** W66 ward-fix I1: refresh(el) must read the author colour even under a CSS background transition. */
const TARGET: Rgba = { r: 200, g: 30, b: 30, a: 255 };
/** DEFAULT_LIQUID_COLOR (packages/core/ts/src/color.ts), the fallback for a transparent read. */
const DEFAULT_PURPLE: Rgba = { r: 83, g: 52, b: 131, a: 255 };

async function splashCentre(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const r = document.querySelector<HTMLElement>("#splash")!.getBoundingClientRect();
    // Left of the label: the liquid fill, not near the (DOM) text glyphs.
    return { x: r.left + 16, y: r.top + r.height / 2 };
  });
}

test.describe("W66 ward-fix I1 – colour refresh under a background transition (canvas2d)", () => {
  test("given #splash with transition background-color 2s when its author colour changes and refresh(el) runs then the liquid paints the new colour and no transition starts", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "manual" });
    await page.addStyleTag({ content: "#splash { transition: background-color 2s; }" });
    await advance(page, IDLE_2S_FRAMES);
    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);

    const at = await splashCentre(page);
    const before = await canvasPixelAt(page, at.x, at.y);
    // Sanity: at rest the liquid shows #2f6fde there.
    expect(rgbaDiffers(before, { r: 0x2f, g: 0x6f, b: 0xde, a: 255 }, 12), `rest pixel ${JSON.stringify(before)}`).toBe(false);

    const after = await page.evaluate(() => {
      const splash = document.querySelector<HTMLElement>("#splash")!;
      const style = document.createElement("style");
      style.textContent = "#splash.btn--splash { background: rgb(200, 30, 30); }";
      document.head.appendChild(style);
      void getComputedStyle(splash).backgroundColor; // flush: the class keeps it transparent
      const styleBefore = splash.getAttribute("style");
      (window.__liquidTest!.instance as { refresh(el: HTMLElement): void }).refresh(splash);
      return {
        styleBefore,
        styleAttr: splash.getAttribute("style"),
        running: splash.getAnimations().length,
        domBackground: getComputedStyle(splash).backgroundColor,
      };
    });
    await advance(page, 1);
    const pixel = await canvasPixelAt(page, at.x, at.y);

    expect(after.styleBefore, "the scene's #splash has no style attribute").toBeNull();
    expect(after.styleAttr, "no inline style persists (D66-3)").toBeNull();
    expect(after.running, "restoring the class must not start a background transition").toBe(0);
    expect(after.domBackground, "the DOM background stays transparent").toBe("rgba(0, 0, 0, 0)");
    expect(rgbaDiffers(pixel, DEFAULT_PURPLE, 12), `pixel ${JSON.stringify(pixel)} is not the default purple`).toBe(true);
    expect(rgbaDiffers(pixel, TARGET, 12), `pixel ${JSON.stringify(pixel)} ≈ rgb(200, 30, 30)`).toBe(false);
  });

  test("given #split with an author style attribute when refresh(el) runs then the attribute is byte-identical afterwards", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, 2);
    const result = await page.evaluate(() => {
      const split = document.querySelector<HTMLElement>("#split")!;
      const original = "--probe:  1 ;transition: background-color 2s";
      split.setAttribute("style", original);
      (window.__liquidTest!.instance as { refresh(el: HTMLElement): void }).refresh(split);
      return { original, now: split.getAttribute("style"), running: split.getAnimations().length };
    });
    await advance(page, 1);
    expect(result.now).toBe(result.original);
    expect(result.running).toBe(0);
  });
});
