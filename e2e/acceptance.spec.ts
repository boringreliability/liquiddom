import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { IDLE_2S_FRAMES, VISUAL_ENABLED, VISUAL_SKIP_REASON, advance, cssAlpha, gotoScene, restAlpha } from "./scene";

interface TextProbe {
  host: string;
  tag: string;
  text: string;
  color: string;
  liquidText: boolean;
  visible: boolean;
}

test.describe("acceptance scene – slice 1 (canvas2d)", () => {
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
// Runs in the canvas2d project (the webgpu project's testMatch is the smoke spec, C8).
// =============================================================================
const W67_SCENE = "/scenes/acceptance.html?seed=1&renderer=canvas2d&clock=manual&test=1";
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
  await page.goto(W67_SCENE);
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
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) throw new Error("W67: liquid canvas missing");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("W67: the liquid canvas has no 2d context");
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width;
    const sy = canvas.height / cr.height;
    const rects = Array.from(document.querySelectorAll(".liquid-element")).map((e) => e.getBoundingClientRect());
    if (rects.length === 0) throw new Error("W67: no .liquid-element found");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
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
