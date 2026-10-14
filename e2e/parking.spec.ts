/**
 * W81 (D81-1, D81-2): parking and resize (canvas2d, blocking). demo/scenes/long-page.html: body mode,
 * a page about 5000 px tall; #top and #hide (inside #wrap) on the first screen, #far1 at y 2256 and
 * #far2 at y 4416. The world is max(screen, inner) per axis (1280×800 in this harness; the resize test
 * reads it), so the parking bound reaches y = 1000 (world plus the 200 px grid margin): the far cards
 * start parked.
 */
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "./fixtures";
import { NORTH_STAR_PATH, reformBudgetMs } from "./north-star";
import { FILL_MIN, scrollPath, scrollPathFills, worstFrame, type FillSpec } from "./scroll";

const FPS = 60;
const BUDGET_FRAMES = Math.round((reformBudgetMs(readFileSync(resolve(process.cwd(), NORTH_STAR_PATH), "utf8"), 7) / 1000) * FPS);
/** demo/scenes/long-page.html colours; restAlpha() and parked() follow this order. */
const COLOURS: Readonly<Record<string, readonly [number, number, number]>> = {
  "#top": [0x2f, 0x6f, 0xde],
  "#hide": [0xd9, 0x30, 0x25],
  "#far1": [0x1a, 0x83, 0x61],
  "#far2": [0xe8, 0x71, 0x0a],
};
const LONG_FILL: FillSpec = { hook: "__longPage", canvas: "canvas.liquid-canvas", scroller: null, colours: COLOURS };

async function openLongPage(page: Page): Promise<void> {
  await page.goto("/scenes/long-page.html?renderer=canvas2d&clock=manual");
  await page.waitForFunction(() => window.__longPage !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__longPage!.ready);
  await page.evaluate(() => window.__longPage!.advance(120));
  expect(await page.evaluate(() => window.__longPage!.restAlpha()), "at rest after 2 s").toEqual([1, 1, 1, 1]);
}

/** Canvas pixels of the last snapshot with alpha > 128 and |rgb − colour|₁ < 60. */
async function colourPixels(page: Page, sel: string): Promise<number> {
  return page.evaluate((rgb) => {
    const d = window.__longPage!.pixels().data;
    let n = 0;
    for (let o = 0; o < d.length; o += 4) {
      if (d[o + 3] > 128 && Math.abs(d[o] - rgb[0]) + Math.abs(d[o + 1] - rgb[1]) + Math.abs(d[o + 2] - rgb[2]) < 60) n++;
    }
    return n;
  }, COLOURS[sel]!);
}

async function framesUntilRest(page: Page, max: number): Promise<number> {
  return page.evaluate((n) => {
    const h = window.__longPage!;
    for (let f = 1; f <= n; f++) {
      h.advance(1);
      if (h.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, max);
}

test.describe("W81 – parking and resize (canvas2d)", () => {
  test("D81-1 – given the long page at the top when read then #far1 and #far2 are parked, #top and #hide are not, every restAlpha is 1 and no green or orange liquid is drawn", async ({ page }) => {
    await openLongPage(page);
    expect(await page.evaluate(() => window.__longPage!.parked())).toEqual([false, false, true, true]);
    expect(await colourPixels(page, "#top"), "the top pill is drawn").toBeGreaterThan(1000);
    expect(await colourPixels(page, "#far1"), "nothing of #far1 on the canvas").toBe(0);
    expect(await colourPixels(page, "#far2"), "nothing of #far2 on the canvas").toBe(0);
  });

  test("step 7 (long page) – given the page scrolled to #far1 at 30 px per frame and back when each frame runs then every visible DOM shape is filled (no snap: #far1 re-enters at rest), the first screen parks far above, and every restAlpha is 1 within the step-7 budget", async ({ page }) => {
    await openLongPage(page);
    const path = scrollPath(2100, 30);
    const down = await scrollPathFills(page, LONG_FILL, path.slice(0, path.length / 2));
    expect(await page.evaluate(() => window.__longPage!.parked()), "at 2100 px: #top, #hide and #far2 parked, #far1 not").toEqual([true, true, false, true]);
    const back = await scrollPathFills(page, LONG_FILL, path.slice(path.length / 2));
    const frames = [...down, ...back];
    const worst = worstFrame(frames);
    console.log(`[W81 long page 30 px/f] worst fill ${worst.min.toFixed(3)} (${worst.worst} at ${worst.scroll} px); judged frames ${frames.filter((f) => f.judged > 0).length}`);
    expect(frames.filter((f) => f.judged > 0).length, "the fill is judged while elements are visible").toBeGreaterThan(50);
    expect(worst.min, `no snap: the fill stays ≥ FILL_MIN (${worst.worst} at ${worst.scroll} px)`).toBeGreaterThanOrEqual(FILL_MIN);
    expect(await page.evaluate(() => window.__longPage!.parked()), "back at the top").toEqual([false, false, true, true]);
    expect(await framesUntilRest(page, BUDGET_FRAMES), "at rest within the step-7 budget").toBeGreaterThan(0);
  });

  test("D81-1 – given a jump straight to #far2 when the frame runs then #far2 is unparked and at rest in that very frame with its DOM shape filled, and the jump back parks it again", async ({ page }) => {
    await openLongPage(page);
    // scrollPathFills scrolls, advances exactly one frame and measures that frame: the re-entry frame itself.
    const fill = await scrollPathFills(page, LONG_FILL, [4100]);
    const enter = await page.evaluate(() => ({ parked: window.__longPage!.parked(), rest: window.__longPage!.restAlpha() }));
    expect(enter.parked, "#far2 unparked, the first screen parked").toEqual([true, true, true, false]);
    expect(enter.rest[3], "#far2 re-enters at rest (D81-1)").toBe(1);
    expect(fill[0]!.judged, "#far2 is visible").toBeGreaterThan(0);
    expect(fill[0]!.min, `${fill[0]!.worst} filled in the re-entry frame`).toBeGreaterThanOrEqual(FILL_MIN);
    const leave = await page.evaluate(() => {
      const h = window.__longPage!;
      window.scrollTo({ top: 0, behavior: "instant" });
      h.advance(1);
      return h.parked();
    });
    expect(leave).toEqual([false, false, true, true]);
    expect(await framesUntilRest(page, BUDGET_FRAMES), "at rest within the step-7 budget").toBeGreaterThan(0);
  });

  test("D81-1 (W76 w == 0) – given #hide moving after a shake when its wrapper is hidden (w == 0, no redistribute) then within 3 frames no red liquid is left on the Canvas2D canvas", async ({ page }) => {
    await openLongPage(page);
    await page.mouse.move(1279, 799);
    await page.evaluate(() => {
      window.__longPage!.shake();
      window.__longPage!.advance(5);
    });
    expect(await colourPixels(page, "#hide"), "the moving red pill is drawn").toBeGreaterThan(500);
    await page.evaluate(() => {
      document.getElementById("wrap")!.style.display = "none";
      window.__longPage!.advance(3);
    });
    expect(await colourPixels(page, "#hide"), "an inactive slot's liquid is not drawn (colour-keyed guard)").toBe(0);
    expect(await colourPixels(page, "#top"), "the other pill still is").toBeGreaterThan(500);
  });

  test("D81-2 – given the window grown beyond the world when resized then exactly one console.info reports the grown world, the core's world grows, nothing re-forms, and a smaller window logs nothing", async ({ page }) => {
    const infos: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "info" && m.text().includes("outgrew the liquid's world")) infos.push(m.text());
    });
    await openLongPage(page);
    const before = await page.evaluate(() => ({
      world: window.__longPage!.world(),
      need: { w: Math.max(screen.width, innerWidth), h: Math.max(screen.height, innerHeight) },
    }));
    expect(before.world, "the world is max(screen, inner) per axis (B2)").toEqual(before.need);
    await page.setViewportSize({ width: before.world.w + 480, height: before.world.h + 120 });
    // The browser fires the resize event at its next rendering update; the manual clock does not wait for it.
    await page.waitForFunction((w) => window.__longPage!.world().w > w, before.world.w, { timeout: 5_000 });
    await page.evaluate(() => window.__longPage!.advance(2));
    const grown = await page.evaluate(() => window.__longPage!.world());
    expect(grown.w, "at least the new width, at least 1.25 × the old").toBeGreaterThanOrEqual(Math.max(before.world.w + 480, Math.ceil(before.world.w * 1.25)));
    expect(grown.h).toBeGreaterThanOrEqual(Math.max(before.world.h + 120, Math.ceil(before.world.h * 1.25)));
    expect(infos, "one logged reallocation (D81-2)").toEqual([`[liquiddom] the viewport outgrew the liquid's world; the grid grew to ${grown.w}×${grown.h} px.`]);
    expect(await page.evaluate(() => window.__longPage!.restAlpha()), "the reallocation does not excite the liquid").toEqual([1, 1, 1, 1]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 800);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))); // the resize event has run
    await page.evaluate(() => window.__longPage!.advance(2));
    expect(await page.evaluate(() => window.__longPage!.world()), "never shrinks").toEqual(grown);
    expect(infos, "a smaller window logs nothing").toHaveLength(1);
    const fill = await scrollPathFills(page, LONG_FILL, [null]);
    expect(fill[0]!.min, "the first screen is still drawn").toBeGreaterThanOrEqual(FILL_MIN);
  });
});
