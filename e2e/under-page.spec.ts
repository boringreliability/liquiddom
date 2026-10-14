/**
 * W82 "Under the page" (canvas2d, blocking; the default testMatch routes this file to canvas2d only).
 * D82-1: the canvas sits under the page, so a splash or a shake never paints over unobserved text
 * (the landing page's hero paragraph, a strength-2 probe: W77 calmed the defaults so far that they
 * reach no text, W82.0 Q1a). D82-2: an opaque html + body or an opaque wrapper falls back to
 * z-index 0 with one console.warn. D82-1 container mode: `isolation: isolate` puts the liquid under
 * the container's content; a container that is no stacking context falls back. D82-4: the Canvas2D
 * density cell on the landing page. D82-5: the landing's dark card and "Sign in" stay inside the
 * viewport under the shake. Manual clock, seed 1, 1280×800.
 */
import type { ConsoleMessage, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { LANDING_DARK_RGB, clientRectOf } from "./lace";
import { VIEWPORT } from "./projects";
import { IDLE_2S_FRAMES, advance, restAlpha } from "./scene";
import { MAX_COVERED_INK_PX, edgePixels, inkCovered, pagePixelsOf, type InkProbe } from "./under-page";

test.use({ viewport: { ...VIEWPORT } });

type LandingInstance = { shake(strength?: number): void; splash(el: Element, opts?: unknown): void };

/** W82.0 Q1a frames: every 2nd frame up to f40 holds both peaks (splash f36, shake f26). */
const PROBE_FRAMES: readonly number[] = [4, 8, 12, 16, 20, 24, 26, 28, 32, 36, 40];
/** "Sign in" (`.btn--pill`, demo/scenes/landing.html): `--brand-tint`. */
const LANDING_TINT_RGB: readonly [number, number, number] = [0xe4, 0xe8, 0xff];
/** demo/scenes/under-page.html: #pill. */
const PILL_RGB: readonly [number, number, number] = [0x2f, 0x6f, 0xde];
/** #pill is 200 × 64 px, radius 32: its rounded rect holds ≈ 11,900 px; its label covers some. */
const PILL_VISIBLE_MIN_PX = 8000;
/** 1 s of idle frames on demo/scenes/under-page.html before a probe (one pill, at rest after its redistribute). */
const UNDER_PAGE_IDLE_FRAMES = 60;
/** D82-4: ceil(R)/6 for the landing's largest kernel (R ≤ 14 px): at most 14/6 px. */
const LANDING_CELL_MAX_PX = 14 / 6;

async function gotoLanding(page: Page): Promise<void> {
  await page.goto("/scenes/landing.html?seed=1&renderer=canvas2d&clock=manual&test=1");
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await advance(page, IDLE_2S_FRAMES);
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
}

/** Probes `selector` at every PROBE_FRAMES frame after `act` ran; returns the worst cover and the most changed pixels. */
async function probeAfter(page: Page, selector: string, act: () => Promise<void>, step: (n: number) => Promise<void>): Promise<{ worst: InkProbe; frame: number; reached: number }> {
  await act();
  let at = 0;
  let worst: InkProbe = { ink: 0, covered: -1, changed: 0 };
  let frame = 0;
  let reached = 0;
  for (const f of PROBE_FRAMES) {
    await step(f - at);
    at = f;
    const p = await inkCovered(page, selector);
    reached = Math.max(reached, p.changed);
    if (p.covered > worst.covered) {
      worst = p;
      frame = f;
    }
  }
  return { worst, frame, reached };
}

async function gotoUnderPage(page: Page, variant: string, warnings: string[]): Promise<void> {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.goto(`/scenes/under-page.html?page=${variant}&renderer=canvas2d&clock=manual`);
  await page.waitForFunction(() => window.__underPage !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__underPage!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate((n) => window.__underPage!.advance(n), UNDER_PAGE_IDLE_FRAMES);
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
}

const liquidWarnings = (warnings: readonly string[]): string[] => warnings.filter((w) => w.startsWith("[liquiddom]"));

test.describe("W82 – the canvas under the landing page (canvas2d)", () => {
  test("D82-1 – given the landing page when Start free splashes at strength 2 then no liquid covers a glyph of the hero paragraph (page-pixel probe)", async ({ page }) => {
    await gotoLanding(page);
    const { worst, frame, reached } = await probeAfter(
      page,
      ".lede",
      () => page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).splash(document.getElementById("start")!, { strength: 2 })),
      (n) => advance(page, n),
    );
    console.log(`W82 lede splash(2): worst covered ${worst.covered} of ${worst.ink} ink px at f${frame}; liquid behind the lede up to ${reached} px (W82.0 at z 0: 86)`);
    expect(reached, "the strength-2 splash reaches the lede (else the probe proves nothing)").toBeGreaterThan(100);
    expect(worst.covered, `covered ink px at f${frame}`).toBeLessThanOrEqual(MAX_COVERED_INK_PX);
  });

  test("D82-1 – given the landing page when the instance shakes at strength 2 then no liquid covers a glyph of the hero paragraph (page-pixel probe)", async ({ page }) => {
    await gotoLanding(page);
    const { worst, frame, reached } = await probeAfter(
      page,
      ".lede",
      () => page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).shake(2)),
      (n) => advance(page, n),
    );
    console.log(`W82 lede shake(2): worst covered ${worst.covered} of ${worst.ink} ink px at f${frame}; liquid behind the lede up to ${reached} px (W82.0 at z 0: 137)`);
    expect(reached, "the strength-2 shake reaches the lede").toBeGreaterThan(100);
    expect(worst.covered, `covered ink px at f${frame}`).toBeLessThanOrEqual(MAX_COVERED_INK_PX);
  });

  test("D82-5 – given the landing page when the instance shakes then the dark card's liquid never reaches the right viewport edge and Sign in's never reaches the top edge", async ({ page }) => {
    await gotoLanding(page);
    await page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).shake());
    let right = 0;
    let top = 0;
    let peakRight = 0;
    for (let f = 1; f <= 60; f++) {
      await advance(page, 1);
      const r = await edgePixels(page, LANDING_DARK_RGB, "right");
      right += r;
      peakRight = Math.max(peakRight, r);
      top += await edgePixels(page, LANDING_TINT_RGB, "top");
    }
    console.log(`W82 viewport edges under shake: dark px in the last column Σ ${right} (peak ${peakRight}; W82.0 HEAD peak 181), tint px in row 0 Σ ${top}`);
    expect(right, "no dark liquid on the right edge column (D82-5)").toBe(0);
    expect(top, "no Sign-in liquid on the top row (D82-5)").toBe(0);
    expect((await restAlpha(page)).some((a) => a < 1), "the elements still slosh").toBe(true);
  });

  test("D82-4 – given the landing page shaken when the Canvas2D renderer draws the moving liquid then its density cell is ceil(R)/6, at most 14/6 px (the 3.5 px stair-step cell is gone)", async ({ page }) => {
    await gotoLanding(page);
    await page.evaluate(() => (window.__liquidTest!.instance as LandingInstance).shake());
    await advance(page, 10);
    const cell = await page.evaluate(() => window.__liquidTest!.densityCellPx ?? null);
    console.log(`W82 landing Canvas2D density cell at shake f10: ${cell} px (W77: 3.25–3.5)`);
    expect(cell).not.toBeNull();
    expect(cell!, "D82-4: ceil(R)/6").toBeLessThanOrEqual(LANDING_CELL_MAX_PX + 1e-9);
    expect(cell!, "the 2 px floor").toBeGreaterThanOrEqual(2);
  });
});

test.describe("W82 – opaque pages and containers (demo/scenes/under-page.html, canvas2d)", () => {
  test("D82-1 – given a page whose only background is body's when created then no warning, the canvas sits at z-index -1, the pill carries no data-liquid-stack and its liquid shows on the page", async ({ page }) => {
    const warnings: string[] = [];
    await gotoUnderPage(page, "body", warnings);
    expect(liquidWarnings(warnings)).toEqual([]);
    expect(await page.evaluate(() => window.__underPage!.canvasZ())).toBe("-1");
    expect(await page.evaluate(() => window.__underPage!.stack())).toBeNull();
    const visible = await pagePixelsOf(page, await clientRectOf(page, "#pill"), PILL_RGB);
    expect(visible, "the liquid under the page is visible through the transparent pill").toBeGreaterThan(PILL_VISIBLE_MIN_PX);
  });

  test("D82-2 – given opaque html and body backgrounds when created then one console.warn names <body>, the canvas falls back to z-index 0, the pill is stacked and its liquid shows", async ({ page }) => {
    const warnings: string[] = [];
    await gotoUnderPage(page, "opaque", warnings);
    const mine = liquidWarnings(warnings);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("an opaque background would hide the liquid under the page: <body>");
    expect(await page.evaluate(() => window.__underPage!.canvasZ())).toBe("0");
    expect(await page.evaluate(() => window.__underPage!.stack())).toBe("z");
    const visible = await pagePixelsOf(page, await clientRectOf(page, "#pill"), PILL_RGB);
    expect(visible, "without the fallback the liquid would be 0 px visible (W82.0 Q1b)").toBeGreaterThan(PILL_VISIBLE_MIN_PX);
  });

  test("D82-2 – given an opaque wrapper around the observed pill when observed then one console.warn names <div.wrap>, the canvas falls back to z-index 0 and the liquid shows", async ({ page }) => {
    const warnings: string[] = [];
    await gotoUnderPage(page, "wrapper", warnings);
    const mine = liquidWarnings(warnings);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("<div.wrap>");
    expect(await page.evaluate(() => window.__underPage!.canvasZ())).toBe("0");
    const visible = await pagePixelsOf(page, await clientRectOf(page, "#pill"), PILL_RGB);
    expect(visible).toBeGreaterThan(PILL_VISIBLE_MIN_PX);
  });

  test("D82-1 – given a container with isolation: isolate when the pill splashes at strength 2 then no warning, the canvas is at z-index -1 inside it, the liquid shows above the container's background and no glyph of its paragraph is covered", async ({ page }) => {
    const warnings: string[] = [];
    await gotoUnderPage(page, "isolate", warnings);
    expect(liquidWarnings(warnings)).toEqual([]);
    expect(await page.evaluate(() => window.__underPage!.canvasZ())).toBe("-1");
    expect(await pagePixelsOf(page, await clientRectOf(page, "#pill"), PILL_RGB)).toBeGreaterThan(PILL_VISIBLE_MIN_PX);
    const { worst, frame, reached } = await probeAfter(
      page,
      "#note",
      () => page.evaluate(() => window.__underPage!.splash(2)),
      (n) => page.evaluate((k) => window.__underPage!.advance(k), n),
    );
    console.log(`W82 container (isolate) splash(2): worst covered ${worst.covered} of ${worst.ink} ink px at f${frame}; liquid behind #note up to ${reached} px`);
    expect(reached, "the splash reaches the paragraph").toBeGreaterThan(100);
    expect(worst.covered, `covered ink px at f${frame}`).toBeLessThanOrEqual(MAX_COVERED_INK_PX);
  });

  test("D82-1 – given a positioned container that is not a stacking context when created then one console.warn names the fix, the canvas falls back to z-index 0 and the liquid shows", async ({ page }) => {
    const warnings: string[] = [];
    await gotoUnderPage(page, "relative", warnings);
    const mine = liquidWarnings(warnings);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("isolation: isolate");
    expect(await page.evaluate(() => window.__underPage!.canvasZ())).toBe("0");
    expect(await page.evaluate(() => window.__underPage!.stack())).toBe("z");
    expect(await pagePixelsOf(page, await clientRectOf(page, "#pill"), PILL_RGB)).toBeGreaterThan(PILL_VISIBLE_MIN_PX);
  });
});
