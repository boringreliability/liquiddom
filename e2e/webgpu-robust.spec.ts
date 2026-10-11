/**
 * W72 (D72-1 … D72-4, D72-6): WebGPU by default, robust — acceptance steps 4, 6 and 8 under
 * renderer=webgpu, the device.lost rebuild, the 'auto' probe, and (D72-6, webgpu-hw only)
 * container mode, two instances and DPR 2 on the hardware adapter.
 * - Routed to `webgpu-hw` (local hardware adapter) always, and to `webgpu` (SwiftShader,
 *   pinned image, CI soft) only when SWIFTSHADER_RUNS_LIQUID (the W71.0 spike said "yes";
 *   it said "no"). The D72-6 tests skip outside `webgpu-hw` in any case.
 * - Pixel reads go through frame-readback.ts (W71's __liquidTest.pixels() snapshot of the last advance()).
 * - The W65 guard fixture fails every test on console.error, pageerror or a panic.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { advanceAndCountOpaque, advanceAndCountOutside, advanceAndHash, advanceFrames } from "./frame-readback";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { presets } from "../packages/core/ts/src/material";
import {
  LANDING_DARK_RGB,
  W77_CARD_LACE_MAX_TEAR,
  W77_LACE_FRAMES,
  W77_LANDING_LACE_MAX_TEAR,
  W77_SPECK_FRAMES,
  W77_SPECK_MAX_PX,
  cardTearPixels,
  clientRectOf,
  regionTearPixels,
  specksInside,
} from "./lace";
import { NORTH_STAR_PATH, reformBudgetMs } from "./north-star";
import { SWIFTSHADER_RUNS_LIQUID, VIEWPORT } from "./projects";
import { VISUAL_ENABLED, VISUAL_SKIP_REASON, canvasPixelAt, cssAlpha } from "./scene";

const FPS = 60;
const IDLE_FRAMES = 2 * FPS;
/** NORTH-STAR steps 3/4 and 6: re-form within 3 s. */
const REFORM_BUDGET_FRAMES = 3 * FPS;
/** W67 metric: a real splash or shake throws thousands of px out; damage alone stays ~0. */
const OUTSIDE_MIN_PX = 500;
const FALLBACK_INFO_PREFIX = "[liquiddom] WebGPU is not available";
const LOST_WARNING_PREFIX = "[liquiddom] WebGPU device lost";

type SceneRenderer = "webgpu" | "auto" | "canvas2d";
/** D72-6: the local hardware-adapter project, the only one that runs the D72-6 tests. */
const HW_PROJECT = "webgpu-hw";
const HW_ONLY = "D72-6: hardware-adapter WebGPU; local webgpu-hw project only (fallback B)";
interface SceneInstance {
  activeRenderer: string;
  splash(el: Element, opts?: unknown): void;
  shake(strength?: number): void;
}

function sceneUrl(renderer: SceneRenderer, extra = ""): string {
  return `/scenes/acceptance.html?seed=1&renderer=${renderer}&clock=manual&test=1${extra}`;
}

async function open(page: Page, renderer: SceneRenderer, extra = ""): Promise<void> {
  await page.goto(sceneUrl(renderer, extra));
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function activeRenderer(page: Page): Promise<string> {
  return page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).activeRenderer);
}

async function restAlphas(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__liquidTest!.restAlpha());
}

async function openAtRest(page: Page): Promise<void> {
  await open(page, "webgpu");
  expect(await activeRenderer(page), "renderer=webgpu is active").toBe("webgpu");
  await advanceFrames(page, IDLE_FRAMES);
  const a = await restAlphas(page);
  expect(a.every((v) => v === 1), `at rest after 2 s idle: ${a}`).toBe(true);
}

async function framesUntilAllRest(page: Page, maxFrames: number): Promise<number> {
  return page.evaluate((max) => {
    const t = window.__liquidTest!;
    for (let f = 1; f <= max; f++) {
      t.advance(1);
      if (t.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, maxFrames);
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function focusRingVisible(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const s = getComputedStyle(el);
    return el.matches(":focus-visible") && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
  });
}

async function splashButton(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === name);
    if (!el) throw new Error(`W72: button ${name} not found`);
    (window.__liquidTest!.instance as SceneInstance).splash(el);
  }, label);
}

test.describe("W72 – WebGPU by default, robust", () => {
  test("D72-1 – given ?renderer=auto when the scene loads then activeRenderer is webgpu exactly when a non-fallback adapter exists, one liquid canvas, and at most one fallback console.info", async ({ page }) => {
    const infos: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "info" && m.text().startsWith(FALLBACK_INFO_PREFIX)) infos.push(m.text());
    });
    await open(page, "auto");
    const expected = await page.evaluate(async () => {
      type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
      const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      const fallback = adapter ? (adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false) : true;
      return adapter && !fallback ? "webgpu" : "canvas2d";
    });
    expect(await activeRenderer(page)).toBe(expected);
    await expect(page.locator("canvas.liquid-canvas")).toHaveCount(1);
    expect(infos, `fallback infos (expected renderer ${expected})`).toHaveLength(expected === "webgpu" ? 0 : 1);
  });

  test("step 4 (webgpu) – given Tab focus on Split and Enter when ticking then the splash equals the API centre splash, the focus ring stays visible and every restAlpha returns to 1 within 3 s", async ({ page }) => {
    await openAtRest(page);
    const split = page.getByRole("button", { name: "Split", exact: true });
    await tabTo(page, split);
    await page.keyboard.press("Enter");
    for (let f = 0; f < 6; f++) {
      await advanceFrames(page, 10);
      await expect(split).toBeFocused();
      expect(await focusRingVisible(split), `focus ring at frame ${(f + 1) * 10}`).toBe(true);
    }
    expect(Math.min(...(await restAlphas(page))), "the keyboard splash happened").toBeLessThan(1);
    const keyboardHash = await advanceAndHash(page, 1); // frame 61
    const reform = await framesUntilAllRest(page, REFORM_BUDGET_FRAMES - 61);
    expect(reform, "every restAlpha back to 1 within 3 s").toBeGreaterThan(0);

    // Reference: same seed and frame count, API splash at the rect centre, Split focused too.
    await openAtRest(page);
    await tabTo(page, page.getByRole("button", { name: "Split", exact: true }));
    await splashButton(page, "Split");
    await advanceFrames(page, 60);
    expect(await advanceAndHash(page, 1), "keyboard splash == splash at the rect centre").toBe(keyboardHash);
  });

  test("step 6 (webgpu) – given shake when ticking then liquid leaves the rects, every element un-rests, every restAlpha returns to 1 within 3 s, and the overdraw is logged", async ({ page }, testInfo) => {
    await openAtRest(page);
    const before = await advanceAndCountOutside(page, 1);
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
    let peak = before;
    const overdraw: number[] = [];
    for (let f = 0; f < 30; f++) {
      peak = Math.max(peak, await advanceAndCountOutside(page, 1));
      overdraw.push(await page.evaluate(() => window.__liquidTest!.overdraw));
    }
    expect(peak - before, "shake visibly moves liquid outside the element rects").toBeGreaterThan(OUTSIDE_MIN_PX);
    const soft = await restAlphas(page);
    expect(soft.every((a) => a < 1), `every element sloshes: ${soft}`).toBe(true);
    const frames = await framesUntilAllRest(page, REFORM_BUDGET_FRAMES - 30);
    expect(frames, "every restAlpha back to 1 within 3 s").toBeGreaterThan(0);
    // D72-4: logged, never gated; it must be live while liquid moves and 0 at rest.
    const maxOverdraw = Math.max(...overdraw);
    expect(maxOverdraw).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__liquidTest!.overdraw)).toBe(0);
    testInfo.annotations.push({
      type: "overdraw",
      description: `max ${maxOverdraw} splat fragments per frame during the shake (D72-4, estimate, logged only)`,
    });
  });

  test("step 8 (webgpu) – given ?rm=1 when Splash is clicked and shake() is called then every restAlpha stays 1 and frames 60 apart are identical and non-blank", async ({ page }) => {
    await open(page, "webgpu", "&rm=1");
    expect(await activeRenderer(page)).toBe("webgpu");
    expect(await page.evaluate(() => window.__liquidTest!.params.reducedMotion)).toBe(true);
    await advanceFrames(page, 2);
    await page.getByRole("button", { name: "Splash", exact: true }).click();
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
    await page.mouse.move(1279, 799);
    const first = await advanceAndHash(page, 1);
    expect(await restAlphas(page)).toEqual([1, 1, 1, 1]);
    expect(await advanceAndHash(page, 60), "no motion under reduced motion").toBe(first);
    expect(await restAlphas(page)).toEqual([1, 1, 1, 1]);
    expect(await advanceAndCountOpaque(page, 1), "the resting liquid is drawn").toBeGreaterThan(1000);
  });

  test("step 8 (webgpu) – given print and forced-colors media when emulated then the WebGPU liquid canvas is display none", async ({ page }) => {
    await open(page, "webgpu");
    expect(await activeRenderer(page)).toBe("webgpu");
    await advanceFrames(page, 1);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("canvas.liquid-canvas")).toHaveCSS("display", "none");
    await page.emulateMedia({ media: "screen", forcedColors: "active" });
    await expect(page.locator("canvas.liquid-canvas")).toHaveCSS("display", "none");
    await page.emulateMedia({ media: "screen", forcedColors: "none" });
    await expect(page.locator("canvas.liquid-canvas")).not.toHaveCSS("display", "none");
  });

  test("step 8 (device.lost) – given renderer webgpu when the device is lost then the same instance continues as canvas2d on one remounted canvas, splashes and re-forms, with one console.warn", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning" && m.text().startsWith(LOST_WARNING_PREFIX)) warnings.push(m.text());
    });
    await openAtRest(page);
    const place = (): Promise<{ parent: string; index: number; w: number; h: number }> =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
        const parent = c.parentElement!;
        return { parent: parent.tagName, index: Array.prototype.indexOf.call(parent.children, c), w: c.width, h: c.height };
      });
    const before = await place();
    await page.evaluate(() => {
      (window as unknown as { __w72Old: Element | null }).__w72Old = document.querySelector("canvas.liquid-canvas");
    });

    await page.evaluate(() => window.__liquidTest!.loseDevice());

    expect(await activeRenderer(page)).toBe("canvas2d");
    await expect(page.locator("canvas.liquid-canvas")).toHaveCount(1);
    expect(await place(), "same parent, same position, same backing size").toEqual(before);
    const swap = await page.evaluate(() => {
      const old = (window as unknown as { __w72Old: HTMLCanvasElement }).__w72Old;
      const now = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
      return { same: old === now, oldConnected: old.isConnected, has2d: now.getContext("2d") !== null };
    });
    expect(swap).toEqual({ same: false, oldConnected: false, has2d: true });

    // Canvas2D continues with the same particle state: still at rest, the card drawn.
    await advanceFrames(page, 2);
    expect(await restAlphas(page)).toEqual([1, 1, 1, 1]);
    const card = await page.locator("#card").boundingBox();
    if (!card) throw new Error("W72: #card has no box");
    const px = await canvasPixelAt(page, card.x + card.width / 2, card.y + card.height / 2);
    expect(px.a, "the card's liquid is drawn by Canvas2D after the rebuild").toBeGreaterThan(200);

    // ... and keeps simulating: a splash throws liquid out and re-forms within 3 s.
    await splashButton(page, "Splash");
    let peak = 0;
    for (let f = 0; f < 30; f++) peak = Math.max(peak, await advanceAndCountOutside(page, 1));
    expect(peak, "the rebuilt instance still splashes").toBeGreaterThan(OUTSIDE_MIN_PX);
    expect(await framesUntilAllRest(page, REFORM_BUDGET_FRAMES - 30), "re-form within 3 s").toBeGreaterThan(0);
    expect(warnings, "exactly one device-lost warning").toHaveLength(1);
  });

  test.describe("D72-6 – WebGPU on the hardware adapter: container mode, two instances, DPR 2", () => {
    /** demo/smoke/webgpu-modes.html: ?mode=container (one 'auto' instance in #box-a) or ?mode=multi (two 'webgpu' instances, body mode). */
    async function openModes(page: Page, mode: "container" | "multi"): Promise<void> {
      await page.goto(`/smoke/webgpu-modes.html?mode=${mode}`);
      await page.waitForFunction(() => window.__webgpuModes !== undefined, undefined, { timeout: 15_000 });
      await page.evaluate(() => window.__webgpuModes!.ready);
      await page.evaluate((n) => window.__webgpuModes!.advance(n), IDLE_FRAMES);
    }
    const modes = {
      active: (page: Page) => page.evaluate(() => window.__webgpuModes!.activeRenderers()),
      canvases: (page: Page) => page.evaluate(() => window.__webgpuModes!.canvases()),
      count: (page: Page) => page.evaluate(() => window.__webgpuModes!.liquidCanvasCount()),
      lose: (page: Page, i: number) => page.evaluate((k) => window.__webgpuModes!.loseDevice(k), i),
      advance: (page: Page, n: number) => page.evaluate((k) => window.__webgpuModes!.advance(k), n),
      rest: (page: Page, i: number) => page.evaluate((k) => window.__webgpuModes!.restAlpha(k), i),
      opaqueIn: (page: Page, i: number, id: string) => page.evaluate(([k, el]) => window.__webgpuModes!.opaqueIn(k, el), [i, id] as const),
    };
    const lostWarnings = (page: Page): string[] => {
      const out: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "warning" && m.text().startsWith(LOST_WARNING_PREFIX)) out.push(m.text());
      });
      return out;
    };
    /** A 200×80 element whose liquid is drawn: far more than 1000 opaque px (16 000 at DPR 1). */
    const DRAWN_MIN_PX = 1000;

    test("D72-6a – given a positioned container and renderer auto when the device is lost then the remounted canvas stays inside the container at the same place and the liquid keeps drawing there", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== HW_PROJECT, HW_ONLY);
      const warnings = lostWarnings(page);
      await openModes(page, "container");
      expect(await modes.active(page), "auto on a hardware adapter is webgpu").toEqual(["webgpu"]);
      const [before] = await modes.canvases(page);
      expect(before).toMatchObject({ parent: "box-a", connected: true, className: "liquid-canvas" });
      expect(await modes.opaqueIn(page, 0, "a1"), "the liquid is drawn inside the container").toBeGreaterThan(DRAWN_MIN_PX);

      expect(await modes.lose(page, 0), "simulateDeviceLoss resolved after the Canvas2D rebuild").toBe(true);

      expect(await modes.active(page)).toEqual(["canvas2d"]);
      const [after] = await modes.canvases(page);
      expect(after, "same parent (#box-a), same index, same backing size, same markup").toEqual(before);
      await expect(page.locator("#box-a canvas.liquid-canvas")).toHaveCount(1);
      expect(await modes.count(page), "no stray canvas outside the container").toBe(1);
      await modes.advance(page, 2);
      expect(await modes.rest(page, 0)).toEqual([1, 1]);
      expect(await modes.opaqueIn(page, 0, "a1"), "Canvas2D draws #a1 in the container").toBeGreaterThan(DRAWN_MIN_PX);
      expect(await modes.opaqueIn(page, 0, "a2"), "Canvas2D draws #a2 in the container").toBeGreaterThan(DRAWN_MIN_PX);
      expect(warnings, "exactly one device-lost warning").toHaveLength(1);
    });

    test("D72-6b – given two webgpu instances on one page when the first device is lost then only that instance rebuilds as canvas2d and the second keeps its canvas and its WebGPU liquid", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== HW_PROJECT, HW_ONLY);
      const warnings = lostWarnings(page);
      await openModes(page, "multi");
      expect(await modes.active(page)).toEqual(["webgpu", "webgpu"]);
      const before = await modes.canvases(page);
      expect(before.map((c) => c.parent)).toEqual(["body", "body"]);
      expect(before[0]!.index).toBeLessThan(before[1]!.index);
      // Keep B's canvas element to prove it is untouched (same object, still connected).
      await page.evaluate((index) => {
        (window as unknown as { __w72B: Element | undefined }).__w72B = document.body.children[index];
      }, before[1]!.index);
      expect(await modes.opaqueIn(page, 1, "b1")).toBeGreaterThan(DRAWN_MIN_PX);

      expect(await modes.lose(page, 0)).toBe(true);

      expect(await modes.active(page), "only A rebuilds").toEqual(["canvas2d", "webgpu"]);
      const after = await modes.canvases(page);
      expect(after[0], "A's remounted canvas takes A's place").toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
      const bSame = await page.evaluate((index) => {
        const kept = (window as unknown as { __w72B: Element | undefined }).__w72B;
        return kept !== undefined && kept.isConnected && document.body.children[index] === kept;
      }, before[1]!.index);
      expect(bSame, "B's canvas is the same element, still in place").toBe(true);
      expect(await modes.count(page)).toBe(2);
      await modes.advance(page, 2);
      expect(await modes.rest(page, 0)).toEqual([1, 1]);
      expect(await modes.rest(page, 1)).toEqual([1]);
      expect(await modes.opaqueIn(page, 0, "a1"), "A draws in Canvas2D").toBeGreaterThan(DRAWN_MIN_PX);
      expect(await modes.opaqueIn(page, 1, "b1"), "B still draws in WebGPU").toBeGreaterThan(DRAWN_MIN_PX);
      expect(warnings, "one warning, from A").toHaveLength(1);
    });

    test.describe("DPR 2", () => {
      test.use({ deviceScaleFactor: 2 });

      test("D72-6c – given deviceScaleFactor 2 when step 1 is at rest then webgpu matches canvas2d within ±3 per channel at the SDF corner, arc and centre probes of Split and T0 is 0.5 × the backing px", async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== HW_PROJECT, HW_ONLY);
        interface Dpr2Probes {
          dpr: number;
          backing: number[];
          t0: readonly number[] | null;
          radiusCss: number;
          corner: number[];
          arc: number[];
          centre: number[];
        }
        const probes: Partial<Record<"canvas2d" | "webgpu", Dpr2Probes>> = {};
        for (const renderer of ["canvas2d", "webgpu"] as const) {
          await open(page, renderer);
          expect(await activeRenderer(page)).toBe(renderer);
          await advanceFrames(page, IDLE_FRAMES);
          expect(await restAlphas(page), `${renderer} at rest`).toEqual([1, 1, 1, 1]);
          // The W71 RF4 probes (e2e/webgpu-liquid.spec.ts sdfProbes) on #split, read from __liquidTest.pixels().
          probes[renderer] = await page.evaluate(() => {
            const t = window.__liquidTest!;
            const img = t.pixels();
            const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!;
            const cr = canvas.getBoundingClientRect();
            const sx = canvas.width / cr.width;
            const sy = canvas.height / cr.height;
            const el = document.getElementById("split")!;
            const r = el.getBoundingClientRect();
            const radiusCss = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
            const at = (xCss: number, yCss: number): number[] => {
              const px = Math.floor((xCss - cr.left) * sx);
              const py = Math.floor((yCss - cr.top) * sy);
              const o = (py * img.width + px) * 4;
              return Array.from(img.data.subarray(o, o + 4));
            };
            const d = (radiusCss - 2) / Math.SQRT2;
            return {
              dpr: window.devicePixelRatio,
              backing: [canvas.width, canvas.height],
              t0: t.t0Size,
              radiusCss,
              corner: at(r.left + 1, r.top + 1),
              arc: at(r.left + radiusCss - d, r.top + radiusCss - d),
              centre: at(r.left + r.width / 2, r.top + r.height / 2),
            };
          });
          console.log(`[w72 D72-6c ${renderer}] ${JSON.stringify(probes[renderer])}`);
        }
        const c2 = probes.canvas2d!;
        const gpu = probes.webgpu!;
        for (const p of [c2, gpu]) {
          expect(p.dpr).toBe(2);
          expect(p.backing, "backing store = 1280×800 CSS px × DPR 2").toEqual([2560, 1600]);
          expect(p.radiusCss, "#split needs a corner radius large enough for the probes").toBeGreaterThanOrEqual(8);
          expect(p.corner[3], "the bounding-box corner is outside the rounded corner").toBeLessThanOrEqual(3);
          expect(p.arc[3], "the 45° point just inside the arc is opaque").toBeGreaterThanOrEqual(250);
          expect(p.centre[3]).toBe(255);
        }
        expect(c2.t0, "no T0 under canvas2d").toBeNull();
        expect(gpu.t0, "T0 at 0.5 × the backing px (D71-4 = 0.5)").toEqual([Math.ceil(2560 * 0.5), Math.ceil(1600 * 0.5)]);
        for (const key of ["corner", "arc", "centre"] as const) {
          for (let c = 0; c < 4; c++) {
            expect(Math.abs(gpu[key][c]! - c2[key][c]!), `RF4 ${key} channel ${c}`).toBeLessThanOrEqual(3);
          }
        }
      });
    });
  });

  test.describe("webgpu Linux baselines (D65-7; only when the W71.0 spike answered yes)", () => {
    test.skip(!VISUAL_ENABLED, VISUAL_SKIP_REASON);
    test.skip(!SWIFTSHADER_RUNS_LIQUID, "no SwiftShader liquid in the pinned image (W71.0 spike: no)");

    test("step 4 (webgpu) – given the keyboard splash on Split at frame 30 when screenshotted then the focus ring matches the baseline", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "webgpu", "baselines exist for the pinned-image webgpu project only");
      await openAtRest(page);
      const split = page.getByRole("button", { name: "Split", exact: true });
      await tabTo(page, split);
      await page.keyboard.press("Enter");
      await advanceFrames(page, 30);
      const box = await split.boundingBox();
      if (!box) throw new Error("W72: the Split button has no box");
      await expect(page).toHaveScreenshot("acceptance-step4-split-focus-f30.png", {
        clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
        maxDiffPixelRatio: 0.01,
      });
    });

    test("step 6 (webgpu) – given the shake at frame 20 when screenshotted then it matches the baseline", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "webgpu", "baselines exist for the pinned-image webgpu project only");
      await openAtRest(page);
      await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
      await advanceFrames(page, 20);
      await expect(page).toHaveScreenshot("acceptance-step6-shake-f20.png", { maxDiffPixelRatio: 0.01 });
    });
  });
});

// =============================================================================
// W74 (D74-4, D74-6, Review Focus 1): text that flows — webgpu-hw (Metal) only, like the rest of
// this file under W71.0 fallback B. Canvas pixels via __liquidTest.pixels() (W71 rule); the
// no-blink check compares page screenshots (DOM text + canvas) decoded in the page.
// =============================================================================
/** The buttons' text is #ffffff and the card's #f5f5f5: canvas text pixels are ≥ 200 in every channel. */
const CANVAS_TEXT_MIN = 200;
/**
 * Text energy of a screenshot: Σ max(0, min(r, g, b) − 150) over the pill's inset (only its fill
 * and its text; the blue fill's min channel is 47). A blink (text gone for a frame) drops it to ~0.
 */
const TEXT_ENERGY_FLOOR = 150;
/** At f2 of a 0.3 splash the white "Splash" covers far more canvas px than this (ink ≈ 240 px at DPR 1). */
const TEXT_MIN_PX = 40;
const SOFT_SPLASH = 0.3;
const W74_VISION_DIR = "test-results/vision-w74";

/** Canvas text pixels (every channel and alpha ≥ CANVAS_TEXT_MIN) inside `selector`'s client rect, shifted by `offset` (W78: a dragged home). */
async function canvasTextPixelsIn(page: Page, selector: string, offset: { dx: number; dy: number } = { dx: 0, dy: 0 }): Promise<number> {
  return page.evaluate(
    ([sel, min, dx, dy]) => {
      const img = window.__liquidTest!.pixels();
      const c = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      const el = document.querySelector(sel);
      if (!c || !el) throw new Error(`W74: canvas or ${sel} missing`);
      const cr = c.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const b = { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy };
      const sx = img.width / cr.width;
      const sy = img.height / cr.height;
      let n = 0;
      for (let py = Math.floor((b.top - cr.top) * sy); py < Math.ceil((b.bottom - cr.top) * sy); py++) {
        for (let px = Math.floor((b.left - cr.left) * sx); px < Math.ceil((b.right - cr.left) * sx); px++) {
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          const o = (py * img.width + px) * 4;
          if (img.data[o + 3] >= min && img.data[o] >= min && img.data[o + 1] >= min && img.data[o + 2] >= min) n++;
        }
      }
      return n;
    },
    [selector, CANVAS_TEXT_MIN, offset.dx, offset.dy] as const,
  );
}

interface TextState {
  id: string;
  liquidText: boolean;
  fill: string;
}

/** Every observed element and its descendants: the class and the computed -webkit-text-fill-color. */
async function textState(page: Page): Promise<TextState[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-liquid], [data-liquid] *")).map((el) => ({
      id: el.id || el.tagName.toLowerCase(),
      liquidText: el.classList.contains("liquid-text"),
      fill: getComputedStyle(el).getPropertyValue("-webkit-text-fill-color"),
    })),
  );
}

async function softSplash(page: Page): Promise<void> {
  await page.mouse.move(1279, 799);
  await page.evaluate((strength) => {
    const el = document.getElementById("splash");
    if (!el) throw new Error("W74: #splash not found");
    (window.__liquidTest!.instance as SceneInstance).splash(el, { strength });
  }, SOFT_SPLASH);
}

/** Decodes two PNG screenshots in the page: mean |Δrgb| / 255 and the text energy of each. */
async function screenshotDiff(page: Page, a: Buffer, b: Buffer): Promise<{ mae: number; textA: number; textB: number }> {
  return page.evaluate(
    async ([pa, pb, floor]) => {
      const load = async (b64: string): Promise<ImageData> => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("W74: no 2d context for the screenshot diff");
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const A = await load(pa);
      const B = await load(pb);
      const n = Math.min(A.data.length, B.data.length);
      let sum = 0;
      let textA = 0;
      let textB = 0;
      for (let i = 0; i < n; i += 4) {
        for (let k = 0; k < 3; k++) sum += Math.abs(A.data[i + k] - B.data[i + k]);
        textA += Math.max(0, Math.min(A.data[i], A.data[i + 1], A.data[i + 2]) - floor);
        textB += Math.max(0, Math.min(B.data[i], B.data[i + 1], B.data[i + 2]) - floor);
      }
      return { mae: sum / ((n / 4) * 3 * 255), textA, textB };
    },
    [a.toString("base64"), b.toString("base64"), TEXT_ENERGY_FLOOR] as const,
  );
}

test.describe("W74 – text that flows (D74-4, D74-6)", () => {
  test("W74 step 3 (webgpu) – given a soft splash on Splash when mid-splash then it carries liquid-text, its DOM text fill is transparent and the canvas shows its white text inside the rect", async ({ page }) => {
    await openAtRest(page);
    expect(await canvasTextPixelsIn(page, "#splash"), "at rest the canvas holds no text (the DOM draws it)").toBe(0);
    await softSplash(page);
    await advanceFrames(page, 2);
    const splash = (await textState(page)).find((s) => s.id === "splash");
    expect(splash).toEqual({ id: "splash", liquidText: true, fill: "rgba(0, 0, 0, 0)" });
    const white = await canvasTextPixelsIn(page, "#splash");
    console.log(`W74 canvas text px in #splash at f2: ${white}`);
    expect(white, "the atlas text is drawn in its own colour on its liquid").toBeGreaterThan(TEXT_MIN_PX);
  });

  test("W74 step 3 (webgpu) – given the splash re-formed when every restAlpha is 1 then no element carries liquid-text, the DOM text is opaque and the canvas holds no white text pixels", async ({ page }) => {
    await openAtRest(page);
    await softSplash(page);
    await advanceFrames(page, 2);
    expect((await textState(page)).some((s) => s.liquidText), "precondition: the text is liquid mid-splash").toBe(true);
    expect(await framesUntilAllRest(page, REFORM_BUDGET_FRAMES), "re-form within 3 s").toBeGreaterThan(0);
    for (const s of await textState(page)) {
      expect(s.liquidText, `${s.id} has no liquid-text at rest`).toBe(false);
      expect(cssAlpha(s.fill), `${s.id} text fill ${s.fill} is opaque`).toBeGreaterThan(0);
    }
    await advanceFrames(page, 1);
    expect(await canvasTextPixelsIn(page, "#splash")).toBe(0);
    expect(await canvasTextPixelsIn(page, "#card")).toBe(0);
  });

  test("W74 no blink – given a soft splash when Splash comes to rest then the composited text region changes by less than 2 % MAE across the liquid-text toggle", async ({ page }) => {
    await openAtRest(page);
    await softSplash(page);
    const box = await page.locator("#splash").boundingBox();
    if (!box) throw new Error("W74: #splash has no box");
    // Inset past the rounded ends and the edge band, so the clip holds only the pill's fill and its text.
    const clip = { x: box.x + 16, y: box.y + 8, width: box.width - 32, height: box.height - 16 };
    const hasClass = (): Promise<boolean> => page.locator("#splash").evaluate((el) => el.classList.contains("liquid-text"));
    await advanceFrames(page, 1);
    let prevShot = await page.screenshot({ clip });
    let prevClass = await hasClass();
    expect(prevClass, "liquid-text is on in the first frame of the splash").toBe(true);
    let compared = false;
    for (let f = 2; f <= REFORM_BUDGET_FRAMES && !compared; f++) {
      await advanceFrames(page, 1);
      const shot = await page.screenshot({ clip });
      const cls = await hasClass();
      if (prevClass && !cls) {
        const d = await screenshotDiff(page, prevShot, shot);
        console.log(`W74 no-blink at f${f}: MAE ${d.mae.toFixed(4)}, text energy ${d.textA} → ${d.textB}`);
        // Plan validation 2026-10-10 (Metal): MAE 0.0046, energy 25474 → 27940 (+10 %). A frame without
        // text would give MAE ≈ 4 % and an energy near 0 in this inset.
        expect(d.mae, "composited MAE across the toggle (spike: 0.6 % for the pill)").toBeLessThan(0.02);
        expect(Math.abs(d.textB - d.textA) / Math.max(d.textA, 1), "text energy change across the toggle").toBeLessThan(0.25);
        compared = true;
      }
      prevShot = shot;
      prevClass = cls;
    }
    expect(compared, "Splash lost liquid-text within 3 s").toBe(true);
  });

  test("W74 device.lost – given liquid-text on mid-splash when the device is lost then every element loses the class and its DOM text is opaque again", async ({ page }) => {
    await openAtRest(page);
    await softSplash(page);
    await advanceFrames(page, 2);
    expect((await textState(page)).find((s) => s.id === "splash")?.liquidText).toBe(true);
    await page.evaluate(() => window.__liquidTest!.loseDevice());
    expect(await activeRenderer(page)).toBe("canvas2d");
    for (const s of await textState(page)) {
      expect(s.liquidText, `${s.id} after the loss`).toBe(false);
      expect(cssAlpha(s.fill), `${s.id} text fill ${s.fill}`).toBeGreaterThan(0);
    }
    await advanceFrames(page, 5);
    expect((await textState(page)).some((s) => s.liquidText), "Canvas2D never sets it").toBe(false);
  });

  test("W74 reduced motion – given liquid-text on mid-splash when prefers-reduced-motion turns on then the class is gone without advancing a frame", async ({ page }) => {
    await openAtRest(page);
    await softSplash(page);
    await advanceFrames(page, 2);
    await expect(page.locator("#splash")).toHaveClass(/liquid-text/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".liquid-text"), "removed by the media listener, no frame advanced").toHaveCount(0);
    await advanceFrames(page, 1);
    expect(await restAlphas(page)).toEqual([1, 1, 1, 1]);
    await expect(page.locator(".liquid-text")).toHaveCount(0);
  });
});

test.describe("W74 gold – vision captures (VISION=1)", () => {
  test.skip(!process.env.VISION, "set VISION=1 to write the gold-phase screenshots");

  test("W74 gold – capture the splash, the rest transition and the shake in webgpu and canvas2d", async ({ page }) => {
    const pad = (n: number): string => String(n).padStart(3, "0");
    for (const renderer of ["webgpu", "canvas2d"] as const) {
      const shot = (name: string) => page.screenshot({ path: `${W74_VISION_DIR}/${renderer}/${name}.png` });
      await open(page, renderer);
      await advanceFrames(page, IDLE_FRAMES);
      await shot("rest");
      await page.mouse.move(1279, 799);
      await splashButton(page, "Splash");
      let done = 0;
      for (const f of [1, 2, 6, 12, 30, 60]) {
        await advanceFrames(page, f - done);
        done = f;
        await shot(`splash-f${pad(f)}`);
      }
      const rested = await framesUntilAllRest(page, REFORM_BUDGET_FRAMES);
      await shot(`splash-rest-after-${done + rested}`);

      await open(page, renderer);
      await advanceFrames(page, IDLE_FRAMES);
      await softSplash(page);
      for (let f = 1; f <= REFORM_BUDGET_FRAMES; f++) {
        await advanceFrames(page, 1);
        const ra = (await restAlphas(page))[0]!;
        if (ra > 0.8 || f <= 3) await shot(`soft-f${pad(f)}-ra${ra.toFixed(2)}`);
        if (ra >= 1) break;
      }

      await open(page, renderer);
      await advanceFrames(page, IDLE_FRAMES);
      await page.mouse.move(1279, 799);
      await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
      done = 0;
      for (const f of [2, 10, 20, 40, 80]) {
        await advanceFrames(page, f - done);
        done = f;
        await shot(`shake-f${pad(f)}`);
      }
    }
  });
});

/** W75: hardware-adapter WebGPU with W74's liquid text; local webgpu-hw project only (fallback B). */
const W75_HW_ONLY = "W75: liquid text needs WebGPU on the hardware adapter; local webgpu-hw project only";

async function framesUntilTextClass(page: Page, selector: string, maxFrames = 12): Promise<number> {
  return page.evaluate(
    ([sel, max]) => {
      const el = document.querySelector(sel as string);
      if (!el) throw new Error(`W75: ${String(sel)} not found`);
      const t = window.__liquidTest!;
      for (let f = 1; f <= (max as number); f++) {
        t.advance(1);
        if (el.classList.contains("liquid-text")) return f;
      }
      return -1;
    },
    [selector, maxFrames] as const,
  );
}

/**
 * D75-1 A: like framesUntilTextClass, but one task per frame, so a staged atlas page's error scope
 * can resolve between frames (a synchronous loop never lets it confirm).
 */
async function framesUntilTextClassAcrossTasks(page: Page, selector: string, maxFrames = 30): Promise<number> {
  for (let f = 1; f <= maxFrames; f++) {
    const on = await page.evaluate((sel) => {
      window.__liquidTest!.advance(1);
      return document.querySelector(sel)?.classList.contains("liquid-text") === true;
    }, selector);
    if (on) return f;
  }
  return -1;
}

async function textInvalidations(page: Page): Promise<number> {
  return page.evaluate(() => window.__liquidTest!.textInvalidations);
}

/** Opaque canvas pixels near `selector` (padded) in the last advance()'s snapshot, by colour class. */
async function colourCountsNear(page: Page, selector: string, padPx: number): Promise<{ red: number; yellow: number }> {
  return page.evaluate(
    ([sel, pad]) => {
      const img = window.__liquidTest!.pixels();
      const r = document.querySelector(sel as string)!.getBoundingClientRect();
      const sx = img.width / window.innerWidth;
      const sy = img.height / window.innerHeight;
      const p = pad as number;
      const x0 = Math.max(0, Math.floor((r.left - p) * sx));
      const x1 = Math.min(img.width, Math.ceil((r.right + p) * sx));
      const y0 = Math.max(0, Math.floor((r.top - p) * sy));
      const y1 = Math.min(img.height, Math.ceil((r.bottom + p) * sy));
      let red = 0;
      let yellow = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const [R, G, B, A] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
          if (A < 200) continue;
          if (R > 170 && G < 80 && B < 80) red++;
          else if (R > 200 && G > 180 && B < 90) yellow++;
        }
      }
      return { red, yellow };
    },
    [selector, padPx] as const,
  );
}

test.describe("W75 – text that stays true (webgpu)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== HW_PROJECT, W75_HW_ONLY);
  });

  test("W75 D75-3 – given renderer webgpu and a splash when it moves then no element ever carries liquid-halo", async ({ page }) => {
    await openAtRest(page);
    await splashButton(page, "Splash");
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
    const seen = await page.evaluate(() => {
      let halo = false;
      let text = false;
      for (let f = 0; f < 60; f++) {
        window.__liquidTest!.advance(1);
        if (document.querySelector(".liquid-halo")) halo = true;
        if (document.querySelector(".liquid-text")) text = true;
      }
      return { halo, text };
    });
    expect(seen).toEqual({ halo: false, text: true });
    expect(await page.locator("#splash").evaluate((el) => getComputedStyle(el).textShadow)).toBe("none");
  });

  test("W75 step 8 – given liquid-text on mid-splash when forced colours switch on live then the DOM text is visible at once and the canvas hidden, and switching back restores liquid-text while moving", async ({ page }) => {
    await openAtRest(page);
    await splashButton(page, "Splash");
    expect(await framesUntilTextClass(page, "#splash"), "W74 sets liquid-text while moving").toBeGreaterThan(0);
    const splash = page.locator("#splash");
    // W74 (D74-6) hides the glyphs with -webkit-text-fill-color; `color` itself stays the author's.
    const fill = (): Promise<string> => splash.evaluate((el) => getComputedStyle(el).webkitTextFillColor);
    expect(await fill()).toBe("rgba(0, 0, 0, 0)");
    await page.emulateMedia({ forcedColors: "active" });
    // No frame advanced: the CSS media scope alone shows the DOM text.
    expect(await fill()).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator("canvas.liquid-canvas")).toHaveCSS("display", "none");
    await page.emulateMedia({ forcedColors: "none" });
    await advanceFrames(page, 1);
    const moving = (await restAlphas(page))[0]! < 1;
    expect(await splash.evaluate((el) => el.classList.contains("liquid-text"))).toBe(moving);
    await expect(page.locator("canvas.liquid-canvas")).not.toHaveCSS("display", "none");
  });

  test("W75 step 8 – given liquid-text on mid-splash when print is emulated live then the DOM text has its author colour at once and the canvas is hidden", async ({ page }) => {
    await openAtRest(page);
    await splashButton(page, "Splash");
    expect(await framesUntilTextClass(page, "#splash")).toBeGreaterThan(0);
    await page.emulateMedia({ media: "print" });
    // W74's text rule sets -webkit-text-fill-color only (screen); in print the fill falls back to `color`.
    expect(await page.locator("#splash").evaluate((el) => getComputedStyle(el).webkitTextFillColor)).toBe("rgb(255, 255, 255)");
    await expect(page.locator("canvas.liquid-canvas")).toHaveCSS("display", "none");
    await page.emulateMedia({ media: "screen" });
  });

  test("W75 – given refresh() mid-motion after an author colour change when the next frame renders then the liquid and the liquid text show the new colours", async ({ page }, testInfo) => {
    await openAtRest(page);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#splash")!;
      (window.__liquidTest!.instance as { splash(el: HTMLElement, o?: { strength?: number }): void }).splash(el, { strength: 0.3 });
    });
    expect(await framesUntilTextClass(page, "#splash")).toBeGreaterThan(0);
    await page.addStyleTag({ content: "#splash.btn--splash { background: rgb(200, 30, 30); color: rgb(255, 230, 0); }" });
    await page.evaluate(() => (window.__liquidTest!.instance as { refresh(el: Element): void }).refresh(document.querySelector("#splash")!));
    expect(
      await framesUntilTextClassAcrossTasks(page, "#splash"),
      "D75-1 A: masked while the recoloured page is staged, liquid text back once it is confirmed",
    ).toBeGreaterThan(0);
    const counts = await colourCountsNear(page, "#splash", 40);
    testInfo.annotations.push({ type: "W75 refresh mid-motion", description: JSON.stringify(counts) });
    expect(counts.red, "the liquid in the new background colour").toBeGreaterThan(500);
    expect(counts.yellow, "the liquid text in the new text colour").toBeGreaterThan(20);
    await page.screenshot({ path: testInfo.outputPath("w75-webgpu-refresh-mid-motion.png") });
  });

  test("W75 RF3 – given a text change mid-splash when the next frame runs then exactly one atlas re-render, own class toggles never re-render, and the new text is DOM-visible at rest", async ({ page }, testInfo) => {
    await openAtRest(page);
    const before = await textInvalidations(page);
    await splashButton(page, "Splash");
    expect(await framesUntilTextClass(page, "#splash")).toBeGreaterThan(0);
    await advanceFrames(page, 10);
    expect(await textInvalidations(page), "W74's own class toggles never re-render the atlas (RF2)").toBe(before);
    await page.locator("#splash").evaluate((el) => {
      (el.firstChild as Text).data = "Splo";
      el.append("sh!");
      el.append(document.createElement("b"));
    });
    await advanceFrames(page, 1);
    expect(await textInvalidations(page), "three mutations, one frame, one re-render").toBe(before + 1);
    await page.screenshot({ path: testInfo.outputPath("w75-webgpu-text-change-mid-splash.png") });
    expect(await framesUntilAllRest(page, REFORM_BUDGET_FRAMES), "re-form within 3 s").toBeGreaterThan(0);
    const s = await page.locator("#splash").evaluate((el) => ({
      text: el.textContent,
      cls: el.classList.contains("liquid-text"),
      color: getComputedStyle(el).color,
      fill: getComputedStyle(el).webkitTextFillColor,
    }));
    expect(s).toEqual({ text: "Splosh!", cls: false, color: "rgb(255, 255, 255)", fill: "rgb(255, 255, 255)" });
  });

  test("W75 RF5 – given a web font that finishes loading after observe when the next frame runs then every observed element's atlas entry is re-rendered once", async ({ page }) => {
    await openAtRest(page);
    const before = await textInvalidations(page);
    const loaded = await page.evaluate(async () => {
      const done = new Promise<void>((resolve) => document.fonts.addEventListener("loadingdone", () => resolve(), { once: true }));
      const face = new FontFace("W75Probe", "local('Arial'), local('Helvetica')");
      document.fonts.add(face);
      try {
        await face.load();
      } catch {
        return false;
      }
      await done;
      return true;
    });
    expect(loaded, "a local font face loads on this machine").toBe(true);
    expect(await textInvalidations(page), "deferred to the next frame").toBe(before);
    await advanceFrames(page, 1);
    expect(await textInvalidations(page) - before, "one per observed element (#splash, #split, #merge, #card)").toBe(4);
  });

  test("W75 RF5 – given a DPR change from 1 to 2 when the next frame runs then the canvas backing doubles and every atlas entry is re-rendered once", async ({ page }) => {
    await openAtRest(page);
    const before = await textInvalidations(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
    // W75.5 (approved by Dennis 2026-10-10): the CDP override changes devicePixelRatio but fires neither the
    // resolution query's change nor resize (measured); a real zoom fires resize, so the test does too.
    // The matchMedia re-arm is covered in jsdom (runtime-text-true test 23).
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas")!.width === 2560);
    await advanceFrames(page, 1);
    expect(await textInvalidations(page) - before).toBe(4);
    await advanceFrames(page, 1);
    expect(await textInvalidations(page) - before, "once, not every frame").toBe(4);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  });

  test("W75 a11y – given renderer webgpu at rest and mid-splash with liquid-text on when axe runs then 0 violations, and contrast in print 0", async ({ page }) => {
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    await openAtRest(page);
    expect((await new AxeBuilder({ page }).withTags(tags).disableRules(["color-contrast"]).analyze()).violations).toEqual([]);
    await splashButton(page, "Splash");
    expect(await framesUntilTextClass(page, "#splash")).toBeGreaterThan(0);
    expect((await new AxeBuilder({ page }).withTags(tags).disableRules(["color-contrast"]).analyze()).violations).toEqual([]);
    await page.emulateMedia({ media: "print" });
    expect((await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze()).violations).toEqual([]);
    await page.emulateMedia({ media: "screen" });
  });

  test("W75 a11y – given Tab and Enter on Split under webgpu when ticking then the focus ring stays visible above the liquid at every 10th frame", async ({ page }, testInfo) => {
    await openAtRest(page);
    const split = page.getByRole("button", { name: "Split", exact: true });
    await tabTo(page, split);
    await page.keyboard.press("Enter");
    for (let f = 0; f < 6; f++) {
      await advanceFrames(page, 10);
      await expect(split).toBeFocused();
      expect(await focusRingVisible(split), `focus ring at frame ${(f + 1) * 10}`).toBe(true);
      const stack = await split.evaluate((el) => {
        const cs = getComputedStyle(el);
        const canvas = document.querySelector("canvas.liquid-canvas")!;
        return { z: cs.zIndex, position: cs.position, canvasZ: getComputedStyle(canvas).zIndex, halo: el.classList.contains("liquid-halo") };
      });
      expect(stack.z).toBe("1");
      expect(stack.position).not.toBe("static");
      expect(stack.canvasZ).toBe("0");
      expect(stack.halo).toBe(false);
      if (f === 2) {
        const box = (await split.boundingBox())!;
        await page.screenshot({
          path: testInfo.outputPath("w75-webgpu-focus-split-f30.png"),
          clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
        });
      }
    }
  });
});

// =============================================================================
// W77 (D77-1 … D77-3): closed liquid under shake and splash in WebGPU on the hardware adapter.
// The same guards as acceptance.spec.ts / landing.spec.ts (canvas2d, blocking); bounds in e2e/lace.ts.
// =============================================================================
const W77_HW_ONLY = "W77: hardware-adapter WebGPU; local webgpu-hw project only (fallback B)";
const W77_NORTH_STAR = readFileSync(resolve(process.cwd(), NORTH_STAR_PATH), "utf8");
const W77_SPLASH_BUDGET_FRAMES = Math.round((reformBudgetMs(W77_NORTH_STAR, 3) / 1000) * FPS);
const W77_SHAKE_BUDGET_FRAMES = Math.round((reformBudgetMs(W77_NORTH_STAR, 6) / 1000) * FPS);
type W77Instance = SceneInstance & { setMaterial(m: unknown): void };
/** Landing DOM order of the observed elements: #sign-in, #start, #demo, #card-sources, #card-sql, #card-ops (landing.spec.ts). */
const W77_LANDING_START_INDEX = 1;

/** Opens the acceptance scene at rest, applies `preset` and lets it settle 30 frames (the canvas2d protocol). */
async function w77OpenWithPreset(page: Page, preset: keyof typeof presets): Promise<void> {
  await openAtRest(page);
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
  await page.evaluate((m) => (window.__liquidTest!.instance as W77Instance).setMaterial(m), { ...presets[preset] });
  await advanceFrames(page, 30);
}

async function w77OpenLanding(page: Page): Promise<void> {
  await page.goto("/scenes/landing.html?seed=1&renderer=webgpu&clock=manual&test=1");
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await activeRenderer(page), "renderer=webgpu is active").toBe("webgpu");
  await advanceFrames(page, IDLE_FRAMES);
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
}

test.describe("W77 – closed liquid under shake and splash (webgpu)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== HW_PROJECT, W77_HW_ONLY);
  });

  test("W77 D77-2 step 6 – given renderer webgpu and a shake when ticking then the acceptance card shows no lace: tear pixels at f10 and f20 within the W77 bound", async ({ page }) => {
    await openAtRest(page);
    await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
    const [fa, fb] = W77_LACE_FRAMES;
    await advanceFrames(page, fa);
    const a = await cardTearPixels(page);
    await advanceFrames(page, fb - fa);
    const b = await cardTearPixels(page);
    console.log(`W77 webgpu lace: card tear px f${fa} ${a}, f${fb} ${b} (bound ${W77_CARD_LACE_MAX_TEAR}; W77.0 webgpu 972 / 573)`);
    expect.soft(a, `card tear px at f${fa} (D77-2)`).toBeLessThanOrEqual(W77_CARD_LACE_MAX_TEAR);
    expect(b, `card tear px at f${fb} (D77-2)`).toBeLessThanOrEqual(W77_CARD_LACE_MAX_TEAR);
  });

  test("W77 D77-2 – given renderer webgpu on the landing page and a shake when ticking then the dark card shows no lace: region tear pixels at f10 and f20 within the W77 bound", async ({ page }) => {
    await w77OpenLanding(page);
    const card = await clientRectOf(page, "#card-ops");
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
    const [fa, fb] = W77_LACE_FRAMES;
    await advanceFrames(page, fa);
    const a = await regionTearPixels(page, LANDING_DARK_RGB, card);
    await advanceFrames(page, fb - fa);
    const b = await regionTearPixels(page, LANDING_DARK_RGB, card);
    console.log(`W77 webgpu landing lace: dark card tear px f${fa} ${a}, f${fb} ${b} (bound ${W77_LANDING_LACE_MAX_TEAR}; W77.0 webgpu 3938 / 1316)`);
    expect.soft(a, `dark card tear px at f${fa} (D77-2)`).toBeLessThanOrEqual(W77_LANDING_LACE_MAX_TEAR);
    expect(b, `dark card tear px at f${fb} (D77-2)`).toBeLessThanOrEqual(W77_LANDING_LACE_MAX_TEAR);
  });

  test("W77 D77-1 – given renderer webgpu and a splash on Start free when ticking then Book a demo shows no specks", async ({ page }) => {
    await w77OpenLanding(page);
    const demo = await clientRectOf(page, "#demo");
    expect(await specksInside(page, demo), "no speck at rest").toBe(0);
    await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).splash(document.getElementById("start")!));
    const series: number[] = [];
    for (let f = 1; f <= W77_SPECK_FRAMES; f++) {
      await advanceFrames(page, 1);
      // W77 red review (finding 10): as in landing.spec.ts, the splash must have softened Start free,
      // or the guard would pass vacuously.
      if (f === 2) expect((await restAlphas(page))[W77_LANDING_START_INDEX], "the splash softened Start free").toBeLessThan(1);
      series.push(await specksInside(page, demo));
    }
    const peak = Math.max(...series);
    console.log(`W77 webgpu specks: Book a demo peak ${peak} px at f${series.indexOf(peak) + 1} (bound ${W77_SPECK_MAX_PX}; W77.0 webgpu 238)`);
    expect(peak, `peak speck px inside Book a demo over ${W77_SPECK_FRAMES} frames (D77-1)`).toBeLessThanOrEqual(W77_SPECK_MAX_PX);
  });

  for (const preset of ["water", "honey", "jelly"] as const) {
    test(`W77 D77-3 – given renderer webgpu and the ${preset} preset when Splash is splashed, and from rest the instance shakes, then each re-forms within the NORTH-STAR budgets`, async ({ page }) => {
      await w77OpenWithPreset(page, preset);
      await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).splash(document.getElementById("splash")!));
      const splash = await framesUntilAllRest(page, W77_SPLASH_BUDGET_FRAMES);
      // W77 red review (finding 11): the shake starts from rest on a fresh scene, so a failed splash
      // re-form cannot confound it (the canvas2d protocol in acceptance.spec.ts).
      await w77OpenWithPreset(page, preset);
      expect((await restAlphas(page)).every((v) => v === 1), "at rest before the shake").toBe(true);
      await page.evaluate(() => (window.__liquidTest!.instance as SceneInstance).shake());
      const shake = await framesUntilAllRest(page, W77_SHAKE_BUDGET_FRAMES);
      console.log(`W77 webgpu re-form: ${preset} splash ${splash}, shake ${shake} frames (budgets ${W77_SPLASH_BUDGET_FRAMES} / ${W77_SHAKE_BUDGET_FRAMES})`);
      expect.soft(splash, `${preset}: re-formed within ${W77_SPLASH_BUDGET_FRAMES} frames after the splash`).toBeGreaterThan(0);
      expect(shake, `${preset}: re-formed within ${W77_SHAKE_BUDGET_FRAMES} frames after the shake`).toBeGreaterThan(0);
    });
  }
});

// =============================================================================
// W78 (slice 5): the label follows the dragged liquid in WebGPU (D78-1). Local webgpu-hw only
// (fallback B). Test 53 drags into free space so the displaced rect holds only Merge's text;
// attributing text pixels inside the card needs W79's per-element coverage (D79-1).
// =============================================================================
const W78_HW_ONLY = "W78: liquid text needs WebGPU on the hardware adapter; local webgpu-hw project only";
const W78_HOLD_FRAMES = 30;

async function w78Centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`W78: ${selector} has no box`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Mouse press at `from`, 10 moves to `to` (one frame each), then `hold` frames; the button stays down. */
async function w78Drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = W78_HOLD_FRAMES): Promise<{ dx: number; dy: number }> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    await advanceFrames(page, 1);
  }
  await advanceFrames(page, hold);
  return { dx: to.x - from.x, dy: to.y - from.y };
}

test.describe("W78 – the label follows the dragged liquid (webgpu)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== HW_PROJECT, W78_HW_ONLY);
  });

  test("W78 step 5 – given Merge dragged 150 px up into free space and held then it carries liquid-text, never liquid-away, and the canvas shows its white text inside the displaced rect", async ({ page }, testInfo) => {
    await openAtRest(page);
    const from = await w78Centre(page, "#merge");
    const offset = await w78Drag(page, from, { x: from.x, y: from.y - 150 });
    const merge = (await textState(page)).find((s) => s.id === "merge");
    expect(merge, "the atlas text stands in for the DOM text").toEqual({ id: "merge", liquidText: true, fill: "rgba(0, 0, 0, 0)" });
    expect(await page.locator(".liquid-away").count(), "WebGPU never sets liquid-away (D78-1)").toBe(0);
    const white = await canvasTextPixelsIn(page, "#merge", offset);
    console.log(`W78 canvas text px in Merge's displaced rect at hold f30: ${white}`);
    expect(white, "the atlas text rides the dragged liquid").toBeGreaterThan(TEXT_MIN_PX);
    await page.screenshot({ path: testInfo.outputPath("w78-webgpu-drag-up-hold-f30.png") });
    await page.mouse.up();
  });

  test("W78 step 5 – given Merge dragged into the card and released then it carries liquid-text while away and, once every restAlpha is 1, no element carries liquid-text and Merge's DOM text is opaque", async ({ page }, testInfo) => {
    await openAtRest(page);
    await w78Drag(page, await w78Centre(page, "#merge"), await w78Centre(page, "#card"));
    expect((await textState(page)).find((s) => s.id === "merge")?.liquidText, "liquid text while away").toBe(true);
    expect(await page.locator(".liquid-away").count()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("w78-webgpu-drag-card-hold-f30.png") });
    await page.mouse.up();
    const frames = await framesUntilAllRest(page, REFORM_BUDGET_FRAMES);
    console.log(`W78 step 5 (webgpu): every restAlpha 1 after ${frames} frames`);
    expect(frames, "re-form within 3 s").toBeGreaterThan(0);
    for (const s of await textState(page)) {
      expect(s.liquidText, `${s.id} has no liquid-text at rest`).toBe(false);
      expect(cssAlpha(s.fill), `${s.id} text fill ${s.fill} is opaque`).toBeGreaterThan(0);
    }
    await page.screenshot({ path: testInfo.outputPath("w78-webgpu-reformed.png") });
  });
});

// =============================================================================
// W79 (slice 5): labels never overlap in WebGPU (D79-1). Local webgpu-hw only (fallback B).
// Every frame of the merge is read through __liquidTest.textIds(): that frame's text id target
// (which elements' text splats reached each texel) against the same frame's canvas pixels.
// =============================================================================
const W79_HW_ONLY = "W79: liquid text needs WebGPU on the hardware adapter; local webgpu-hw project only";
/** D79-4: the merge is held 90 frames. */
const W79_HOLD_FRAMES = 90;
/** Spike W78.0: the softened card leaves torn glyph fragments ≈ 30 frames after the release; read 60. */
const W79_AFTER_RELEASE_FRAMES = 60;
const W79_MERGE_INDEX = 2;
const W79_CARD_INDEX = 3;

type W79TextIds = { textPass: boolean; mixed: number; mixedTextPx: number; textPx: number; ids: number[]; elements: number[] };

/** One manual frame with the text id capture armed (the hook advances it). */
async function w79TextIds(page: Page): Promise<W79TextIds> {
  return page.evaluate(async () => {
    const hook = window.__liquidTest!;
    if (!hook.textIds) throw new Error("W79: __liquidTest.textIds is missing");
    return hook.textIds();
  });
}

test.describe("W79 – labels never overlap (webgpu)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== HW_PROJECT, W79_HW_ONLY);
  });

  test("W79 step 5 – given Merge dragged into the card, held 90 frames and released then no frame has a text pixel where two elements' text splats meet, they do meet, text still shows in the card and every restAlpha is 1 within 180 frames", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openAtRest(page);
    const from = await w78Centre(page, "#merge");
    const to = await w78Centre(page, "#card");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const frames: W79TextIds[] = [];
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
      frames.push(await w79TextIds(page));
    }
    for (let f = 0; f < W79_HOLD_FRAMES; f++) frames.push(await w79TextIds(page));
    const cardText = await canvasTextPixelsIn(page, "#card"); // the hold's last frame
    await page.screenshot({ path: testInfo.outputPath("w79-webgpu-merge-hold-f90.png") });
    await page.mouse.up();
    for (let f = 1; f <= W79_AFTER_RELEASE_FRAMES; f++) {
      frames.push(await w79TextIds(page));
      if (f === 30) await page.screenshot({ path: testInfo.outputPath("w79-webgpu-merge-rel-f30.png") });
    }
    const worst = frames.reduce((m, r) => Math.max(m, r.mixedTextPx), 0);
    const mixedMax = frames.reduce((m, r) => Math.max(m, r.mixed), 0);
    const met = frames.some((r) => r.mixed > 0 && r.elements.includes(W79_MERGE_INDEX) && r.elements.includes(W79_CARD_INDEX));
    console.log(
      `W79 text ids (webgpu): ${frames.length} frames, max mixed texels ${mixedMax}, max text px on mixed texels ${worst}, card-rect text px at hold f90 ${cardText}`,
    );
    expect(frames.every((r) => r.textPass), "every frame of the flow draws liquid text").toBe(true);
    expect(met, "Merge's and the card's text splats do meet (the check is not vacuous)").toBe(true);
    expect(worst, "no pixel carries text where two elements' text splats meet (D79-1)").toBe(0);
    expect(cardText, "text still shows in the card where the liquids do not mix").toBeGreaterThan(TEXT_MIN_PX);
    const rest = await framesUntilAllRest(page, REFORM_BUDGET_FRAMES - W79_AFTER_RELEASE_FRAMES);
    const total = rest > 0 ? rest + W79_AFTER_RELEASE_FRAMES : -1;
    console.log(`W79 step 5 (webgpu): every restAlpha 1 after ${total} frames`);
    expect(total, "re-form within 3 s").toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("w79-webgpu-merge-reformed.png") });
  });
});
