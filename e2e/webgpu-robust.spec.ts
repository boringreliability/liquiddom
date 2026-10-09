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
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { advanceAndCountOpaque, advanceAndCountOutside, advanceAndHash, advanceFrames } from "./frame-readback";
import { SWIFTSHADER_RUNS_LIQUID } from "./projects";
import { VISUAL_ENABLED, VISUAL_SKIP_REASON, canvasPixelAt } from "./scene";

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
