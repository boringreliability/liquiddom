/**
 * W80 (D80-1, D80-3): container scroll (canvas2d, blocking). demo/scenes/scroll-container.html
 * puts a positioned `overflow: auto` container (#box) inside a page that scrolls as well; one
 * instance in container mode observes a pill (#c1) and a card (#c2). The container's own scroll
 * shifts its liquid and keeps the canvas on its visible window (a transform on the canvas only); a
 * page scroll around the container shifts nothing (W80 Review Focus 3). demo/scenes/scroll-fixed.html
 * (W80 ward review I1): a page scroll leaves a `position: fixed` element's liquid alone.
 */
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "./fixtures";
import { NORTH_STAR_PATH, reformBudgetMs } from "./north-star";
import { FILL_MIN, scrollPath, scrollPathFills, worstFrame, type FillFrame, type FillSpec } from "./scroll";

const FPS = 60;
const BUDGET_FRAMES = Math.round((reformBudgetMs(readFileSync(resolve(process.cwd(), NORTH_STAR_PATH), "utf8"), 7) / 1000) * FPS);
const CONTAINER_FILL: FillSpec = {
  hook: "__scrollContainer",
  canvas: "#box canvas.liquid-canvas",
  scroller: "#box",
  colours: { "#c1": [0x2f, 0x6f, 0xde], "#c2": [0x26, 0x32, 0x38] },
};
const PAGE_FILL: FillSpec = { ...CONTAINER_FILL, scroller: null };
/** W80 ward review I1: scroll-fixed.html, body mode; restAlpha() is [#fx, #st, #nm]. */
const FIXED_FILL: FillSpec = {
  hook: "__scrollContainer",
  canvas: "canvas.liquid-canvas",
  scroller: null,
  colours: { "#fx": [0x2f, 0x6f, 0xde], "#st": [0xca, 0x4b, 0x20], "#nm": [0x26, 0x32, 0x38] },
};

async function openScene(page: Page, scene = "scroll-container", elements = 2): Promise<void> {
  await page.goto(`/scenes/${scene}.html?renderer=canvas2d`);
  await page.waitForFunction(() => window.__scrollContainer !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__scrollContainer!.ready);
  await page.evaluate(() => window.__scrollContainer!.advance(120));
  expect(await page.evaluate(() => window.__scrollContainer!.restAlpha()), "at rest after 2 s").toEqual(Array<number>(elements).fill(1));
}

async function framesUntilRest(page: Page, max: number): Promise<number> {
  return page.evaluate((n) => {
    const h = window.__scrollContainer!;
    for (let f = 1; f <= n; f++) {
      h.advance(1);
      if (h.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, max);
}

// Routed to the canvas2d project only (projects.ts: no other project matches this file).
test.describe("W80 – container scroll (canvas2d)", () => {
  for (const step of [10, 200]) {
    test(`step 7 (container) – given the container scrolled 200 px down and back at ${step} px per frame when ticking then the canvas sits on the container's visible window, the liquid fills each visible DOM shape in every frame and every restAlpha is 1 within the step-7 budget`, async ({ page }) => {
      await openScene(page);
      const jump = step === 200;
      // A one-frame jump is held past the restAlpha fade (120 ms), or Canvas2D's exact rect fills the shape wherever the liquid is.
      const down = jump ? [200, ...Array<null>(12).fill(null)] : scrollPath(200, step).slice(0, 200 / step);
      const framesDown = await scrollPathFills(page, CONTAINER_FILL, down);
      expect.soft(await page.evaluate(() => window.__scrollContainer!.canvasTransform()), "the canvas is translated onto the visible window").toBe("translate(0px, 200px)");
      const box = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>("#box")!;
        const c = document.querySelector<HTMLElement>("#box canvas.liquid-canvas")!;
        const br = b.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        return { dx: cr.left - (br.left + b.clientLeft), dy: cr.top - (br.top + b.clientTop), w: cr.width - b.clientWidth, h: cr.height - b.clientHeight, sh: b.scrollHeight };
      });
      expect.soft(box, "canvas rect = the container's padding box window").toEqual({ dx: 0, dy: 0, w: 0, h: 0, sh: 1200 });
      const framesBack = await scrollPathFills(page, CONTAINER_FILL, jump ? [0, ...Array<null>(12).fill(null)] : scrollPath(200, step).slice(200 / step));
      const worst = worstFrame([...framesDown, ...framesBack]);
      console.log(`W80 container scroll (canvas2d, ${step} px/frame): lowest fill ${worst.min.toFixed(3)} (${worst.worst} at scroll ${worst.scroll}), bound ${FILL_MIN}`);
      expect(framesBack.at(-1)?.scroll).toBe(0);
      expect(Math.min(...framesDown.filter((f) => f.scroll === 200).map((f) => f.judged)), "an element is judged at the extreme position").toBeGreaterThanOrEqual(1);
      expect(worst.min, `no snap inside the container (${worst.worst} at scroll ${worst.scroll})`).toBeGreaterThanOrEqual(FILL_MIN);
      expect(await page.evaluate(() => window.__scrollContainer!.canvasTransform()), "back at 0: no transform").toBe("");
      expect(await framesUntilRest(page, BUDGET_FRAMES), `re-form within ${BUDGET_FRAMES} frames`).toBeGreaterThan(0);
    });
  }

  test("step 7 (container) – given the page scrolled 300 px around the container when ticking then no element ever leaves rest and the liquid fills each visible DOM shape in every frame (W80 RF3)", async ({ page }) => {
    await openScene(page);
    const frames: Array<FillFrame & { rest: number[] }> = [];
    for (const y of scrollPath(300, 10)) {
      const [f] = await scrollPathFills(page, PAGE_FILL, [y]);
      frames.push({ ...f, rest: await page.evaluate(() => window.__scrollContainer!.restAlpha()) });
    }
    const worst = worstFrame(frames);
    console.log(`W80 page scroll around a container (canvas2d): lowest fill ${worst.min.toFixed(3)} (${worst.worst} at scroll ${worst.scroll})`);
    expect(Math.max(...frames.map((f) => f.scroll)), "the page scrolled 300 px").toBe(300);
    expect(frames.every((f) => f.rest.every((a) => a === 1)), "a page scroll never excites a container's liquid").toBe(true);
    expect(worst.min).toBeGreaterThanOrEqual(FILL_MIN);
    expect(await page.evaluate(() => window.__scrollContainer!.canvasTransform()), "the container did not scroll").toBe("");
  });

  test("step 7 (fixed) – given a position: fixed element when the page scrolls 300 px and back at 10 px per frame then its liquid never leaves rest, a sticky element switches without a snap and every visible DOM shape stays filled (W80 ward review I1)", async ({ page }) => {
    await openScene(page, "scroll-fixed", 3);
    const frames: Array<FillFrame & { rest: number[]; fx: number; st: number }> = [];
    for (const y of scrollPath(300, 10)) {
      const [f] = await scrollPathFills(page, FIXED_FILL, [y]);
      const more = await page.evaluate(() => ({
        rest: window.__scrollContainer!.restAlpha(),
        fx: document.querySelector("#fx")!.getBoundingClientRect().top,
        st: document.querySelector("#st")!.getBoundingClientRect().top,
      }));
      frames.push({ ...f, ...more });
    }
    const worst = worstFrame(frames);
    const fixedRest = Math.min(...frames.map((f) => f.rest[0]));
    console.log(`W80 I1 fixed/sticky (canvas2d): lowest fill ${worst.min.toFixed(3)} (${worst.worst} at scroll ${worst.scroll}), #fx restAlpha min ${fixedRest}`);
    expect(Math.max(...frames.map((f) => f.scroll)), "the page scrolled 300 px").toBe(300);
    expect(new Set(frames.map((f) => f.fx)), "precondition: #fx is fixed").toEqual(new Set([40]));
    expect(frames.find((f) => f.scroll === 300)?.st, "precondition: #st is stuck at 60 px at scroll 300").toBe(60);
    expect(frames.find((f) => f.scroll === 100)?.st, "precondition: #st follows the page at scroll 100").toBe(100);
    expect(Math.min(...frames.map((f) => f.judged)), "#fx is judged in every frame").toBeGreaterThanOrEqual(1);
    expect(fixedRest, "a page scroll never excites a fixed element's liquid").toBe(1);
    expect(worst.min, `no snap (${worst.worst} at scroll ${worst.scroll})`).toBeGreaterThanOrEqual(FILL_MIN);
    expect(await framesUntilRest(page, BUDGET_FRAMES), `re-form within ${BUDGET_FRAMES} frames`).toBeGreaterThan(0);
  });
});
