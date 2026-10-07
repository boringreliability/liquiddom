import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { IDLE_2S_FRAMES, VISUAL_ENABLED, VISUAL_SKIP_REASON, advance, cssAlpha, gotoScene, projectRenderer, restAlpha } from "./scene";

interface TextProbe {
  host: string;
  tag: string;
  text: string;
  color: string;
  liquidText: boolean;
  visible: boolean;
}

test.describe("acceptance scene – step 1 (canvas2d and webgpu)", () => {
  test("step 1 – given the acceptance scene at seed 1 when idle 2 s then every element has restAlpha 1 and DOM text is visible", async ({ page }, testInfo) => {
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, IDLE_2S_FRAMES);

    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.locator("[data-liquid]")).toHaveText(["Splash", "Split", "Merge", /Liquid at rest/]);

    const probes: TextProbe[] = await page.evaluate(() => {
      const out: TextProbe[] = [];
      for (const host of Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"))) {
        const nodes = [host, ...Array.from(host.querySelectorAll<HTMLElement>("h2, p"))];
        for (const el of nodes) {
          out.push({
            host: host.id,
            tag: el.tagName.toLowerCase(),
            text: (el.innerText ?? "").trim(),
            color: getComputedStyle(el).color,
            liquidText: el.classList.contains("liquid-text"),
            visible: el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          });
        }
      }
      return out;
    });
    expect(probes.length).toBe(7); // 3 buttons + card + h2 + 2 p
    for (const p of probes) {
      const where = `${p.host} <${p.tag}>`;
      expect(p.text.length, `${where} has text`).toBeGreaterThan(0);
      expect(cssAlpha(p.color), `${where} text colour ${p.color} is opaque`).toBeGreaterThan(0);
      expect(p.liquidText, `${where} has no liquid-text class`).toBe(false);
      expect(p.visible, `${where} is visible`).toBe(true);
    }

    // Vision inspection artefact for gold (w65-* is gitignored).
    await page.screenshot({ path: testInfo.outputPath("w65-step1.png") });
  });

  test("D65-11 – given the scene when loaded then restAlpha indices map to #splash, #split, #merge, #card and advance throws unless the clock is manual", async ({ page }) => {
    await gotoScene(page, { seed: 1, clock: "raf" });
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("[data-liquid]")).map((e) => e.id))).toEqual([
      "splash",
      "split",
      "merge",
      "card",
    ]);
    expect(await restAlpha(page)).toHaveLength(4);
    const err = await page.evaluate(() => {
      try {
        window.__liquidTest!.advance(1);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(err, "advance() must throw with ?clock=raf").not.toBeNull();
    await expect(page.locator("[data-liquid]")).toHaveCount(4);
  });

  test("step 1 – given rest when screenshotted then it matches the baseline (maxDiffPixelRatio 0.01)", async ({ page }) => {
    test.skip(!VISUAL_ENABLED, VISUAL_SKIP_REASON);
    await gotoScene(page, { seed: 1, clock: "manual" });
    await advance(page, IDLE_2S_FRAMES);
    expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);
    await expect(page).toHaveScreenshot("acceptance-step1.png", { maxDiffPixelRatio: 0.01 });
  });
});

// =============================================================================
// W67 (slice 2) – scene steps 3, 4 and 6: splash and shake, end to end.
// W71 (D71-2): runs in both projects; under renderer=webgpu steps 4 and 6 wait for W72.
// =============================================================================
/** W71: the scene in the running project's renderer. */
const w67Scene = (): string => `/scenes/acceptance.html?seed=1&renderer=${projectRenderer()}&clock=manual&test=1`;
const STEPS_4_6_IN_W72 = "W72 (D71-2): steps 4 and 6 run under renderer=webgpu from W72";
const W67_FPS = 60;
const W67_IDLE_FRAMES = 120;
/** D67-1 option 1: spec §6 step 3, amended in W67. */
const W67_SPLASH_REFORM_BUDGET_S = 3.0;
/** Spec §6 step 6. */
const W67_SHAKE_REFORM_BUDGET_S = 3.0;
const W67_VISION_DIR = "test-results/vision-w67";

type W67Hook = {
  ready: Promise<void>;
  restAlpha(): number[];
  advance(frames: number): void;
  instance: { splash(el: Element, opts?: unknown): void; shake(strength?: number): void };
};

async function w67Advance(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.advance(n), frames);
}

async function w67RestAlphas(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.restAlpha());
}

async function w67Open(page: Page): Promise<void> {
  await page.goto(w67Scene());
  await page.waitForFunction(() => "__liquidTest" in window);
  await page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.ready);
  await w67Advance(page, W67_IDLE_FRAMES);
  const alphas = await w67RestAlphas(page);
  expect(alphas).toHaveLength(4);
  expect(alphas.every((a) => a === 1), `at rest after 2 s idle: ${alphas}`).toBe(true);
}

async function w67FramesUntilAllRest(page: Page, maxFrames: number): Promise<number> {
  return page.evaluate((max) => {
    const t = (window as unknown as { __liquidTest: W67Hook }).__liquidTest;
    for (let f = 1; f <= max; f++) {
      t.advance(1);
      if (t.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, maxFrames);
}

/** FNV-1a over the liquid canvas pixels. */
async function w67CanvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    // W71: the hook's copy of the liquid canvas, taken in the task that drew it (a WebGPU
    // canvas cannot be read back later; W71 plan, Corrections 6).
    const data = window.__liquidTest!.pixels().data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  });
}

/** Opaque canvas pixels (alpha > 128) outside every `.liquid-element` rect inflated by 8 px. */
async function w67OpaquePixelsOutsideElements(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
    if (!canvas) throw new Error("W67: canvas.liquid-canvas not found");
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width;
    const sy = canvas.height / cr.height;
    const rects = Array.from(document.querySelectorAll(".liquid-element")).map((e) => e.getBoundingClientRect());
    if (rects.length === 0) throw new Error("W67: no .liquid-element found");
    const data = window.__liquidTest!.pixels().data;
    let n = 0;
    for (let py = 0; py < canvas.height; py++) {
      const y = py / sy + cr.top;
      for (let px = 0; px < canvas.width; px++) {
        if (data[(py * canvas.width + px) * 4 + 3] <= 128) continue;
        const x = px / sx + cr.left;
        let inside = false;
        for (const r of rects) {
          if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) {
            inside = true;
            break;
          }
        }
        if (!inside) n++;
      }
    }
    return n;
  });
}

async function w67TabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 8; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function w67FocusRingVisible(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const s = getComputedStyle(el);
    return el.matches(":focus-visible") && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
  });
}

async function w67ClickSplash(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const splash = page.getByRole("button", { name: "Splash", exact: true });
  const box = await splash.boundingBox();
  if (!box) throw new Error("W67: the Splash button has no box");
  await splash.click({ position: { x: 30, y: box.height / 2 } });
  await page.mouse.move(1279, 799); // park the pointer far from any liquid (W68's pointer field)
  return box;
}

test.describe("slice 2 – splash and shake (W67)", () => {
  test("step 3 – given a click on Splash when ticking then liquid leaves the rect and every restAlpha returns to 1 within the D67-1 budget", async ({ page }) => {
    await w67Open(page);
    const splash = page.getByRole("button", { name: "Splash", exact: true });
    const before = await w67OpaquePixelsOutsideElements(page);
    // Record the click's real client point for the pointer-position check below.
    await splash.evaluate((el) => {
      el.addEventListener(
        "click",
        (ev) => {
          const { clientX: x, clientY: y } = ev as MouseEvent;
          (window as unknown as { __w67Click: { x: number; y: number } }).__w67Click = { x, y };
        },
        { once: true },
      );
    });
    await w67ClickSplash(page);
    let peak = before;
    for (let f = 0; f < 30; f++) {
      await w67Advance(page, 1);
      peak = Math.max(peak, await w67OpaquePixelsOutsideElements(page));
    }
    // Ward-review fix: same metric as step 6. At rest the liquid is the exact roundRect, so
    // the count outside the 8 px-inflated rects is ~0, and damage alone (restAlpha < 1, no
    // particle motion) stays ~0 too. Measured 2026-10-05 (canvas2d, seed 1, macOS): before 0,
    // peak 1979 within 30 frames. 500 is a quarter of that and far above what damage gives.
    expect(peak - before, "the splash throws liquid outside the element rects").toBeGreaterThan(500);
    expect(Math.min(...(await w67RestAlphas(page)))).toBeLessThan(1);
    const clickHash = await w67CanvasHash(page);
    const frames = await w67FramesUntilAllRest(page, Math.round(W67_SPLASH_REFORM_BUDGET_S * W67_FPS) - 30);
    expect(frames, `every restAlpha back to 1 within ${W67_SPLASH_REFORM_BUDGET_S} s`).toBeGreaterThan(0);

    // Pointer position: the click at x = 30 splashes where the pointer was. Reference: same
    // seed, same frame count, API splash with `at` = the click's own client point.
    const at = await page.evaluate(() => (window as unknown as { __w67Click: { x: number; y: number } }).__w67Click);
    expect(at, "the click reached the Splash button").toBeTruthy();
    await w67Open(page);
    await page.getByRole("button", { name: "Splash", exact: true }).focus(); // the click focused it too
    await page.mouse.move(1279, 799);
    await page.evaluate((point) => {
      const t = (window as unknown as { __liquidTest: W67Hook }).__liquidTest;
      const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Splash");
      if (!el) throw new Error("W67: Splash button not found");
      t.instance.splash(el, { at: point });
    }, at);
    await w67Advance(page, 30);
    expect(await w67CanvasHash(page), "click splash == splash(el, { at }) at the click's client point").toBe(clickHash);

    // The hash discriminates: a splash at the rect centre (40 px right of the click) differs.
    await w67Open(page);
    await page.getByRole("button", { name: "Splash", exact: true }).focus();
    await page.mouse.move(1279, 799);
    await page.evaluate(() => {
      const t = (window as unknown as { __liquidTest: W67Hook }).__liquidTest;
      const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Splash");
      if (!el) throw new Error("W67: Splash button not found");
      t.instance.splash(el);
    });
    await w67Advance(page, 30);
    expect(await w67CanvasHash(page), "a centre splash is not the click splash").not.toBe(clickHash);
  });

  test("step 3 – given the splash 12 frames after a click when screenshotted then it matches the baseline", async ({ page }) => {
    test.skip(!VISUAL_ENABLED, "Linux baselines only (D65-2)");
    await w67Open(page);
    await w67ClickSplash(page);
    await w67Advance(page, 12);
    await expect(page).toHaveScreenshot("acceptance-step3-splash-f12.png", { maxDiffPixelRatio: 0.01 });
  });

  test("step 4 – given Tab focus on Split and Enter when ticking then the splash is at the centre and the focus ring is visible throughout", async ({ page }) => {
    test.skip(projectRenderer() === "webgpu", STEPS_4_6_IN_W72);
    await w67Open(page);
    const split = page.getByRole("button", { name: "Split", exact: true });
    await w67TabTo(page, split);
    await page.keyboard.press("Enter");
    for (let f = 0; f < 6; f++) {
      await w67Advance(page, 10);
      await expect(split).toBeFocused();
      expect(await w67FocusRingVisible(split), `focus ring at frame ${(f + 1) * 10}`).toBe(true);
    }
    expect(Math.min(...(await w67RestAlphas(page))), "the keyboard splash happened").toBeLessThan(1);
    const keyboardHash = await w67CanvasHash(page);

    // Reference: same seed, same frame count, API splash with the default `at` (rect centre).
    await w67Open(page);
    // Same interaction state as the keyboard run: Split is focused here too.
    const splitRef = page.getByRole("button", { name: "Split", exact: true });
    await w67TabTo(page, splitRef);
    await page.evaluate(() => {
      const t = (window as unknown as { __liquidTest: W67Hook }).__liquidTest;
      const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Split");
      if (!el) throw new Error("W67: Split button not found");
      t.instance.splash(el);
    });
    await w67Advance(page, 60);
    expect(await w67CanvasHash(page), "keyboard splash == splash at the rect centre").toBe(keyboardHash);
  });

  test("step 4 – given the keyboard splash on Split at frame 30 when screenshotted then the focus ring matches the baseline", async ({ page }) => {
    test.skip(projectRenderer() === "webgpu", STEPS_4_6_IN_W72);
    test.skip(!VISUAL_ENABLED, "Linux baselines only (D65-2)");
    await w67Open(page);
    const split = page.getByRole("button", { name: "Split", exact: true });
    await w67TabTo(page, split);
    await page.keyboard.press("Enter");
    await w67Advance(page, 30);
    const box = await split.boundingBox();
    if (!box) throw new Error("W67: the Split button has no box");
    await expect(page).toHaveScreenshot("acceptance-step4-split-focus-f30.png", {
      clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
      maxDiffPixelRatio: 0.01,
    });
  });

  test("step 6 – given shake when ticking then everything sloshes and every restAlpha returns to 1 within 3 s", async ({ page }) => {
    test.skip(projectRenderer() === "webgpu", STEPS_4_6_IN_W72);
    await w67Open(page);
    const before = await w67OpaquePixelsOutsideElements(page);
    await page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.instance.shake());
    let peak = before;
    for (let f = 0; f < 30; f++) {
      await w67Advance(page, 1);
      peak = Math.max(peak, await w67OpaquePixelsOutsideElements(page));
    }
    // N = 500 canvas px. At rest the liquid is the exact roundRect, so the count outside the
    // 8 px-inflated rects is ~0; damage alone (restAlpha < 1, no particle motion) stays ~0 too.
    // A real shake throws liquid out of four ~100x40 px rects: thousands of px. 500 leaves margin both ways.
    expect(peak - before, "shake visibly moves liquid outside the element rects").toBeGreaterThan(500);
    const soft = await w67RestAlphas(page);
    expect(soft.every((a) => a < 1), `every element sloshes: ${soft}`).toBe(true);
    const frames = await w67FramesUntilAllRest(page, Math.round(W67_SHAKE_REFORM_BUDGET_S * W67_FPS) - 30);
    expect(frames, `every restAlpha back to 1 within ${W67_SHAKE_REFORM_BUDGET_S} s`).toBeGreaterThan(0);
  });

  test("step 6 – given the shake at frame 20 when screenshotted then it matches the baseline", async ({ page }) => {
    test.skip(projectRenderer() === "webgpu", STEPS_4_6_IN_W72);
    test.skip(!VISUAL_ENABLED, "Linux baselines only (D65-2)");
    await w67Open(page);
    await page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.instance.shake());
    await w67Advance(page, 20);
    await expect(page).toHaveScreenshot("acceptance-step6-shake-f20.png", { maxDiffPixelRatio: 0.01 });
  });
});

test.describe("vision captures (W67 gold, VISION=1)", () => {
  test.skip(!process.env.VISION, "set VISION=1 to write the gold-phase screenshots");

  test("capture steps 3, 4 and 6 frame by frame", async ({ page }) => {
    test.skip(projectRenderer() === "webgpu", STEPS_4_6_IN_W72);
    const shot = (name: string) => page.screenshot({ path: `${W67_VISION_DIR}/${name}.png` });
    const pad = (n: number) => String(n).padStart(3, "0");

    await w67Open(page);
    await shot("step3-f000-rest");
    await w67ClickSplash(page);
    let done = 0;
    for (const f of [2, 6, 12, 30, 60, 120]) {
      await w67Advance(page, f - done);
      done = f;
      await shot(`step3-f${pad(f)}`);
    }
    const step3Rest = await w67FramesUntilAllRest(page, 180);
    await shot(`step3-rest-after-${done + step3Rest}`);

    await w67Open(page);
    const split = page.getByRole("button", { name: "Split", exact: true });
    await w67TabTo(page, split);
    await page.keyboard.press("Enter");
    done = 0;
    for (const f of [1, 10, 30, 90]) {
      await w67Advance(page, f - done);
      done = f;
      await shot(`step4-f${pad(f)}`);
    }

    await w67Open(page);
    await page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.instance.shake());
    done = 0;
    for (const f of [2, 10, 30, 60, 120]) {
      await w67Advance(page, f - done);
      done = f;
      await shot(`step6-f${pad(f)}`);
    }
    const step6Rest = await w67FramesUntilAllRest(page, 180);
    await shot(`step6-rest-after-${done + step6Rest}`);
  });
});

test.describe("step 2 – pointer sweep (W68)", () => {
  const STEP_PX = 10; // per frame at the manual clock's 60 Hz → 600 px/s
  const LEAD_PX = 26;
  const INSET_PX = 8;
  const LATTICE_PX = 4;
  const FILL_ALPHA_MIN = 128; // 0.5 coverage = the density threshold
  const REFORM_MAX_FRAMES = 180; // 3 s

  type Box = { x: number; y: number; width: number; height: number };
  type Pt = [number, number];

  // `advance`, `restAlpha`, `IDLE_2S_FRAMES` come from W65's e2e/scene.ts; `window.__liquidTest`
  // is typed by W65's e2e/global.d.ts.
  async function open(page: Page): Promise<void> {
    await page.goto(`/scenes/acceptance.html?seed=1&renderer=${projectRenderer()}&clock=manual&test=1`);
    await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
    await page.evaluate(() => window.__liquidTest!.ready);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await advance(page, IDLE_2S_FRAMES); // idle 2 s → at rest (step 1)
  }
  async function settle(page: Page): Promise<number | null> {
    for (let f = 6; f <= REFORM_MAX_FRAMES; f += 6) {
      await advance(page, 6);
      if ((await restAlpha(page)).every((a) => a === 1)) return f;
    }
    return null;
  }
  async function buttons(page: Page): Promise<Box[]> {
    const out: Box[] = [];
    for (const name of ["Splash", "Split", "Merge"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      if (!box) throw new Error(`button "${name}" has no bounding box`);
      out.push(box);
    }
    return out;
  }
  // The scene's pills use `border-radius: 24px` (= h/2). "No holes" is about the interior: keep
  // only lattice points at least HOLE_MARGIN_PX inside the rounded contour. W70 (D70-3 amended,
  // A3): at drag 12 the bulge lets the trailing edge recede up to ~8 px at the corners (measured
  // pre-plan, worst alpha at a 6 / 8 / 10 px margin: 0 / 39 / 142, the 142 being the old
  // cross-fade floor; no interior hole by vision, 0 empty Rust bins). A radial push would still
  // punch a hole around the pointer, deep inside.
  const PILL_RADIUS_PX = 24;
  const HOLE_MARGIN_PX = 10;
  function insideRounded(b: Box, x: number, y: number): number {
    const r = Math.min(PILL_RADIUS_PX, b.height / 2, b.width / 2);
    const cx = Math.min(Math.max(x, b.x + r), b.x + b.width - r);
    const cy = Math.min(Math.max(y, b.y + r), b.y + b.height - r);
    return r - Math.hypot(x - cx, y - cy);
  }
  function lattice(b: Box): Pt[] {
    const pts: Pt[] = [];
    for (let y = b.y + INSET_PX; y <= b.y + b.height - INSET_PX; y += LATTICE_PX) {
      for (let x = b.x + INSET_PX; x <= b.x + b.width - INSET_PX; x += LATTICE_PX) {
        if (insideRounded(b, x, y) >= HOLE_MARGIN_PX) pts.push([x, y]);
      }
    }
    return pts;
  }
  async function alphaAt(page: Page, pts: Pt[]): Promise<number[]> {
    return page.evaluate((points) => {
      const c = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!c) throw new Error("liquid canvas missing");
      const r = c.getBoundingClientRect();
      const sx = c.width / r.width;
      const sy = c.height / r.height;
      const img = window.__liquidTest!.pixels();
      return points.map(([x, y]) => {
        const px = Math.floor((x - r.left) * sx);
        const py = Math.floor((y - r.top) * sy);
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return 0;
        return img.data[(py * c.width + px) * 4 + 3];
      });
    }, pts);
  }
  async function sweep(page: Page, row: Box[], onFrame?: (k: number) => Promise<void>): Promise<void> {
    const first = row[0];
    const last = row[row.length - 1];
    const y = first.y + first.height / 2;
    const x0 = first.x - LEAD_PX;
    const frames = Math.ceil((last.x + last.width + LEAD_PX - x0) / STEP_PX);
    for (let k = 0; k <= frames; k++) {
      await page.mouse.move(x0 + k * STEP_PX, y);
      await advance(page, 1);
      if (onFrame) await onFrame(k);
    }
  }

  test("step 2 – given a pointer sweep across the buttons when sampled then canvas alpha inside each button never drops below the fill threshold (no holes)", async ({ page }, testInfo) => {
    await open(page);
    const row = await buttons(page);
    const pts = row.flatMap(lattice);
    expect(Math.min(...(await alphaAt(page, pts))), "precondition: buttons filled at rest").toBeGreaterThanOrEqual(FILL_ALPHA_MIN);
    let worst = 255;
    let worstFrame = -1;
    await sweep(page, row, async (k) => {
      if (k === 24) await page.screenshot({ path: testInfo.outputPath("step2-mid-sweep.png") });
      if (k % 4 !== 0) return;
      const m = Math.min(...(await alphaAt(page, pts)));
      if (m < worst) {
        worst = m;
        worstFrame = k;
      }
    });
    console.log(`[W70 no-hole] worst interior alpha ${worst} (sweep frame ${worstFrame}), margin over ${FILL_ALPHA_MIN}: ${worst - FILL_ALPHA_MIN}`);
    testInfo.annotations.push({ type: "worst-alpha", description: String(worst) });
    expect(worst, `worst interior alpha (sweep frame ${worstFrame})`).toBeGreaterThanOrEqual(FILL_ALPHA_MIN);
  });

  test("step 2 – given the sweep when ticking then the liquid reacts and every restAlpha returns to 1 within 3 s after the pointer leaves", async ({ page }, testInfo) => {
    await open(page);
    expect((await restAlpha(page)).every((a) => a === 1), "precondition: at rest").toBe(true);
    let minDuring = 1;
    await sweep(page, await buttons(page), async () => {
      minDuring = Math.min(minDuring, ...(await restAlpha(page)));
    });
    expect(minDuring, "the pointer field must disturb the liquid").toBeLessThan(1);
    await page.mouse.move(1200, 60); // away from every element, still in the document
    const reformedAt = await settle(page);
    expect(reformedAt, "re-form frame count").not.toBeNull();
    await page.screenshot({ path: testInfo.outputPath("step2-reformed.png") });
  });

  // Ward review: the sweep above crosses the buttons, so the hover swell alone un-rests them.
  // This sweep runs parallel to the row BELOW_PX under the pills' bottom edge: inside the 70 px
  // field, never inside an element. A symmetric swell cannot shift a pill's horizontal centroid;
  // only the pointer field's drag in the sweep direction can.
  const BELOW_PX = 30;
  async function centroidX(page: Page, boxes: Box[]): Promise<number[]> {
    return page.evaluate((rects) => {
      const c = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
      if (!c) throw new Error("liquid canvas missing");
      const r = c.getBoundingClientRect();
      const sx = c.width / r.width;
      const sy = c.height / r.height;
      const img = window.__liquidTest!.pixels();
      return rects.map((b) => {
        const px0 = Math.max(0, Math.floor((b.x - r.left) * sx));
        const px1 = Math.min(c.width, Math.ceil((b.x + b.width - r.left) * sx));
        const py0 = Math.max(0, Math.floor((b.y - r.top) * sy));
        const py1 = Math.min(c.height, Math.ceil((b.y + b.height - r.top) * sy));
        let m = 0;
        let mx = 0;
        for (let y = py0; y < py1; y++) {
          for (let x = px0; x < px1; x++) {
            const a = img.data[(y * c.width + x) * 4 + 3];
            m += a;
            mx += a * (x + 0.5);
          }
        }
        return m > 0 ? mx / m / sx + r.left : NaN;
      });
    }, boxes);
  }
  async function hoveredObserved(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"))
        .filter((e) => e.matches(":hover"))
        .map((e) => e.id),
    );
  }
  // Measured 2026-10-06 (macOS Chromium, canvas2d, seed 1, 600 px/s at y = bottom + 30 px):
  // drag 6 → max +x shift per pill [0.703, 0.821, 0.807] px; drag 12 (W70) → [1.088, 0.827, 1.195] px;
  // pointer path forced off: [0, 0, 0] px. This sweep never enters a pill, so it stays the
  // "pointer field alone moves the liquid" guard; the readable bulge is the W70 test below (A2).
  const CENTROID_SHIFT_MIN_PX = 0.35;

  test("step 2 – given a sweep parallel to the row 30 px below the pills when ticking then no element is hovered, the liquid un-rests and a pill's centroid shifts in the sweep direction (pointer field alone)", async ({ page }, testInfo) => {
    await open(page);
    const row = await buttons(page);
    expect((await restAlpha(page)).every((a) => a === 1), "precondition: at rest").toBe(true);
    const rest = await centroidX(page, row);
    for (const c of rest) expect(Number.isFinite(c), "precondition: each pill has liquid").toBe(true);

    const first = row[0];
    const last = row[row.length - 1];
    const y = Math.max(...row.map((b) => b.y + b.height)) + BELOW_PX;
    const x0 = first.x - LEAD_PX;
    const frames = Math.ceil((last.x + last.width + LEAD_PX - x0) / STEP_PX);
    let minAlpha = 1;
    const maxShift = row.map(() => -Infinity);
    const hovered = new Set<string>();
    for (let k = 0; k <= frames; k++) {
      await page.mouse.move(x0 + k * STEP_PX, y);
      for (const id of await hoveredObserved(page)) hovered.add(id);
      await advance(page, 1);
      minAlpha = Math.min(minAlpha, ...(await restAlpha(page)));
      const now = await centroidX(page, row);
      now.forEach((c, i) => {
        maxShift[i] = Math.max(maxShift[i], c - rest[i]);
      });
    }
    const best = Math.max(...maxShift);
    const report = `sweep y ${y} px; max centroid shift (+x) per pill [${maxShift.map((v) => v.toFixed(3)).join(", ")}] px; min restAlpha ${minAlpha}`;
    console.log(`[W68 pointer-only] ${report}`);
    testInfo.annotations.push({ type: "pointer-only sweep", description: report });
    await page.screenshot({ path: testInfo.outputPath("step2-pointer-only-sweep.png") });

    expect([...hovered], "no observed element is :hover during the sweep").toEqual([]);
    expect(minAlpha, "the pointer field alone must un-rest the liquid").toBeLessThan(1);
    expect(best, `a pill's liquid follows the pointer (+x); ${report}`).toBeGreaterThanOrEqual(CENTROID_SHIFT_MIN_PX);
  });

  // W70 (D70-3/D70-5 amended, A2): the readable bulge. The scene step's own sweep through the
  // pills (600 px/s) must drag each pill's liquid ≥ BULGE_MIN_PX in the sweep direction. The
  // centroid is taken over the pill box padded by BULGE_PAD_PX, so liquid pushed past the DOM
  // edge still counts (pills are 24 px apart, the card starts 32 px below). The symmetric 2 %
  // hover swell cannot shift a centroid. Measured pre-plan: drag 6 → [3.78, 3.26, 3.90] px,
  // drag 12 → [7.58, 7.40, 7.72] px.
  const BULGE_PAD_PX = 10;
  const BULGE_MIN_PX = 5;

  test("step 2 – given a 600 px/s sweep through the pills when ticking then each pill's liquid centroid shifts at least 5 px in the sweep direction (readable bulge)", async ({ page }, testInfo) => {
    await open(page);
    const row = await buttons(page);
    expect((await restAlpha(page)).every((a) => a === 1), "precondition: at rest").toBe(true);
    const padded: Box[] = row.map((b) => ({
      x: b.x - BULGE_PAD_PX,
      y: b.y - BULGE_PAD_PX,
      width: b.width + 2 * BULGE_PAD_PX,
      height: b.height + 2 * BULGE_PAD_PX,
    }));
    const rest = await centroidX(page, padded);
    for (const c of rest) expect(Number.isFinite(c), "precondition: each pill has liquid").toBe(true);
    const maxShift = row.map(() => -Infinity);
    await sweep(page, row, async (k) => {
      const now = await centroidX(page, padded);
      now.forEach((c, i) => {
        maxShift[i] = Math.max(maxShift[i], c - rest[i]);
      });
      if (k === 12) {
        const s = row[0];
        await page.screenshot({
          path: testInfo.outputPath("step2-bulge-splash.png"),
          clip: { x: s.x - 30, y: s.y - 30, width: s.width + 60, height: s.height + 60 },
        });
      }
    });
    const report = `max padded centroid shift (+x) per pill [${maxShift.map((v) => v.toFixed(2)).join(", ")}] px`;
    console.log(`[W70 bulge] ${report}`);
    testInfo.annotations.push({ type: "bulge", description: report });
    maxShift.forEach((s, i) => {
      expect(s, `pill ${i}: ${report}`).toBeGreaterThanOrEqual(BULGE_MIN_PX);
    });
  });

  test("step 2 – given the pointer resting on Split when settled then the rest contour is swelled 2 % and un-swells when the pointer leaves", async ({ page }, testInfo) => {
    await open(page);
    const split = (await buttons(page))[1];
    expect(split.width, "swell probe needs ≥ 1.4 px of swell").toBeGreaterThanOrEqual(140);
    const midY = split.y + split.height / 2;
    const [full] = await alphaAt(page, [[split.x + split.width / 2, midY]]);
    expect(full, "precondition: opaque fill").toBeGreaterThan(200);
    const probes: Pt[] = [
      [split.x - 0.75, midY],
      [split.x + split.width + 0.75, midY],
    ];
    expect(Math.max(...(await alphaAt(page, probes))), "no swell before hover").toBeLessThanOrEqual(0.3 * full);

    await page.mouse.move(split.x + split.width / 2, midY);
    expect(await settle(page), "settled while hovered").not.toBeNull();
    expect(Math.min(...(await alphaAt(page, probes))), "swelled contour covers 1 px outside the DOM edge").toBeGreaterThanOrEqual(0.6 * full);
    await page.screenshot({
      path: testInfo.outputPath("step2-hover-swell.png"),
      clip: { x: split.x - 20, y: split.y - 20, width: split.width + 40, height: split.height + 40 },
    });

    await page.mouse.move(1200, 60);
    expect(await settle(page), "settled after leave").not.toBeNull();
    expect(Math.max(...(await alphaAt(page, probes))), "swell gone after leave").toBeLessThanOrEqual(0.3 * full);
  });

  test("step 2 – given the end of the pointer sweep when screenshotted then it matches the baseline (maxDiffPixelRatio 0.01)", async ({ page }) => {
    test.skip(!VISUAL_ENABLED, VISUAL_SKIP_REASON); // W65 D65-2: Linux-only baselines
    await open(page);
    await sweep(page, await buttons(page));
    await expect(page).toHaveScreenshot("acceptance-step2.png", { maxDiffPixelRatio: 0.01 });
  });
});

// =============================================================================
// W71 gold (D71-4): Metal screenshots of steps 1–3 in this project's renderer; under webgpu
// also T0 at 0.5× and 0.75× for the side-by-side crops. Local only: VISION=1.
// =============================================================================
test.describe("vision captures (W71 gold, VISION=1)", () => {
  test("W71 gold – capture steps 1, 2 and 3 in this project's renderer (and T0 0.5 vs 0.75 under webgpu)", async ({ page }) => {
    test.skip(!process.env.VISION, "set VISION=1 to write the W71 gold screenshots");
    const renderer = projectRenderer();
    const scales: ReadonlyArray<string | null> = renderer === "webgpu" ? ["0.5", "0.75"] : [null];
    const crop = (b: { x: number; y: number; width: number; height: number }) => ({
      x: b.x - 30,
      y: b.y - 30,
      width: b.width + 60,
      height: b.height + 60,
    });
    for (const t0 of scales) {
      const dir = `test-results/vision-w71/${renderer}${t0 ? `-t0-${t0}` : ""}`;
      await page.goto(`/scenes/acceptance.html?seed=1&renderer=${renderer}&clock=manual&test=1${t0 ? `&t0=${t0}` : ""}`);
      await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
      await page.evaluate(() => window.__liquidTest!.ready);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.mouse.move(1279, 799);
      await advance(page, IDLE_2S_FRAMES);
      const splash = page.getByRole("button", { name: "Splash", exact: true });
      const box = (await splash.boundingBox())!;
      const card = (await page.locator("#card").boundingBox())!;
      await page.screenshot({ path: `${dir}/step1-rest.png` });
      await page.screenshot({ path: `${dir}/step1-splash-crop.png`, clip: crop(box) });
      await page.screenshot({ path: `${dir}/step1-card-crop.png`, clip: crop(card) });
      // Step 2: the e2e sweep (10 px per frame through the pills); frame 12 has the pointer on Splash.
      const y = box.y + box.height / 2;
      for (let k = 0; k <= 24; k++) {
        await page.mouse.move(box.x - 26 + k * 10, y);
        await advance(page, 1);
        if (k === 12) await page.screenshot({ path: `${dir}/step2-bulge-crop.png`, clip: crop(box) });
      }
      await page.screenshot({ path: `${dir}/step2-mid-sweep.png` });
      await page.mouse.move(1200, 60);
      await advance(page, IDLE_2S_FRAMES);
      // Step 3: click Splash at x = 30 (as the e2e step-3 test), shots at frames 6, 12 and 30.
      await splash.click({ position: { x: 30, y: box.height / 2 } });
      await page.mouse.move(1279, 799);
      let done = 0;
      for (const f of [6, 12, 30]) {
        await advance(page, f - done);
        done = f;
        await page.screenshot({ path: `${dir}/step3-f${String(f).padStart(3, "0")}.png` });
      }
      await page.screenshot({ path: `${dir}/step3-f030-card-crop.png`, clip: crop(card) });
    }
  });
});
