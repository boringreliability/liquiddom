/**
 * W76 (D76-2): the landing page, an ordinary one-screen SaaS page at 1280×800 with liquid on
 * its nav pill, its two hero CTAs and its three feature cards. Blocking canvas2d smoke (the
 * default testMatch routes it to canvas2d; the WebGPU view of the page is the recording's
 * landing segment and the report's ## Landing page). The fixture fails on console.error,
 * pageerror and panics. Re-form budgets come from .wdd/NORTH-STAR.md, never constants.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { NORTH_STAR_PATH, reformBudgetMs } from "./north-star";
import { VIEWPORT } from "./projects";
import { IDLE_2S_FRAMES, advance, projectRenderer, restAlpha } from "./scene";

const NORTH_STAR_MD = readFileSync(resolve(process.cwd(), NORTH_STAR_PATH), "utf8");
const FPS = 60;
const SPLASH_BUDGET_FRAMES = Math.round((reformBudgetMs(NORTH_STAR_MD, 3) / 1000) * FPS);
const SHAKE_BUDGET_FRAMES = Math.round((reformBudgetMs(NORTH_STAR_MD, 6) / 1000) * FPS);

/** The observed elements in DOM order: nav pill, the two hero CTAs, the three feature cards. */
const LIQUID_COUNT = 6;

type LandingInstance = { activeRenderer: string; shake(strength?: number): void };

test.use({ viewport: { ...VIEWPORT } });

async function gotoLanding(page: Page): Promise<void> {
  const url = `/scenes/landing.html?seed=1&renderer=${projectRenderer()}&clock=manual&test=1`;
  await page.goto(url);
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Frames until every restAlpha is 1, at most `budget` frames; -1 if the budget runs out. */
async function framesUntilAllRest(page: Page, budget: number): Promise<number> {
  for (let f = 1; f <= budget; f++) {
    await advance(page, 1);
    if ((await restAlpha(page)).every((a) => a === 1)) return f;
  }
  return -1;
}

test.describe("landing page (W76, D76-2) – canvas2d smoke", () => {
  test("given the landing page at rest when observed then every [data-liquid] element is observed with restAlpha 1 and its text visible", async ({ page }) => {
    await gotoLanding(page);
    await advance(page, IDLE_2S_FRAMES);

    const liquid = page.locator("[data-liquid]");
    await expect(liquid).toHaveCount(LIQUID_COUNT);
    for (const name of ["Sign in", "Start free", "Book a demo"]) {
      await expect(liquid.filter({ hasText: name }), `"${name}" carries the liquid`).toHaveCount(1);
    }
    const observed = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]")).map((el) => ({
        text: (el.innerText ?? "").trim(),
        liquid: el.classList.contains("liquid-element"),
        visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      })),
    );
    for (const o of observed) {
      expect(o.text.length, "every observed element has text").toBeGreaterThan(0);
      expect(o.liquid, `"${o.text.slice(0, 20)}" is observed (liquid-element)`).toBe(true);
      expect(o.visible, `"${o.text.slice(0, 20)}" is visible`).toBe(true);
    }
    await expect(page.locator("canvas.liquid-canvas")).toHaveCount(1);
    expect(await restAlpha(page)).toEqual(new Array<number>(LIQUID_COUNT).fill(1));
    const active = await page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).activeRenderer);
    expect(active).toBe(projectRenderer());
  });

  test("given the landing page when Start free is clicked and the instance shakes then every element re-forms to restAlpha 1 within the NORTH-STAR budgets", async ({ page }) => {
    await gotoLanding(page);
    await advance(page, IDLE_2S_FRAMES);

    await page.locator("[data-liquid]", { hasText: "Start free" }).click();
    // Park the pointer away from every element (pointer field and hover swell, as acceptance.spec).
    await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
    await advance(page, 2);
    expect(Math.min(...(await restAlpha(page))), "the click splashed Start free").toBeLessThan(1);
    const splashFrames = await framesUntilAllRest(page, SPLASH_BUDGET_FRAMES);
    expect(splashFrames, `every restAlpha back to 1 within ${SPLASH_BUDGET_FRAMES} frames after the splash`).toBeGreaterThan(0);

    await page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).shake());
    await advance(page, 2);
    const soft = await restAlpha(page);
    expect(soft.every((a) => a < 1), `every element sloshes: ${soft}`).toBe(true);
    const shakeFrames = await framesUntilAllRest(page, SHAKE_BUDGET_FRAMES);
    expect(shakeFrames, `every restAlpha back to 1 within ${SHAKE_BUDGET_FRAMES} frames after the shake`).toBeGreaterThan(0);
  });

  test("given the landing page at 1280×800 when laid out then it fits one screen without scrolling", async ({ page }) => {
    await gotoLanding(page);
    const size = await page.evaluate(() => {
      const root = document.documentElement;
      const body = getComputedStyle(document.body);
      const html = getComputedStyle(root);
      return {
        scrollHeight: root.scrollHeight,
        scrollWidth: root.scrollWidth,
        overflow: [html.overflowX, html.overflowY, body.overflowX, body.overflowY],
      };
    });
    expect(size.scrollHeight, "no vertical scroll at 1280×800").toBeLessThanOrEqual(VIEWPORT.height);
    expect(size.scrollWidth, "no horizontal scroll at 1280×800").toBeLessThanOrEqual(VIEWPORT.width);
    // The layout fits; it does not hide its overflow (D76-2).
    expect(size.overflow, "html/body do not clip with overflow: hidden").not.toContain("hidden");
  });
});
