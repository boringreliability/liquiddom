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

/** Canvas pixels with alpha > 128 in the 60 px band above an element's rect. */
async function w67OpaquePixelsAbove(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<number> {
  return page.evaluate((b) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
    if (!canvas) throw new Error("W67: canvas.liquid-canvas not found");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("W67: the liquid canvas has no 2d context");
    const sx = canvas.width / canvas.clientWidth;
    const sy = canvas.height / canvas.clientHeight;
    const x0 = Math.max(0, Math.floor((b.x - 20) * sx));
    const y0 = Math.max(0, Math.floor((b.y - 64) * sy));
    const w = Math.max(1, Math.floor((b.width + 40) * sx));
    const h = Math.max(1, Math.floor(60 * sy));
    const data = ctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
    return n;
  }, box);
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
    const box = await splash.boundingBox();
    if (!box) throw new Error("W67: the Splash button has no box");
    const before = await w67OpaquePixelsAbove(page, box);
    await w67ClickSplash(page);
    let peak = before;
    for (let f = 0; f < 30; f++) {
      await w67Advance(page, 1);
      peak = Math.max(peak, await w67OpaquePixelsAbove(page, box));
    }
    expect(peak - before, "jets leave the rect").toBeGreaterThan(20);
    expect(Math.min(...(await w67RestAlphas(page)))).toBeLessThan(1);
    const frames = await w67FramesUntilAllRest(page, Math.round(W67_SPLASH_REFORM_BUDGET_S * W67_FPS) - 30);
    expect(frames, `every restAlpha back to 1 within ${W67_SPLASH_REFORM_BUDGET_S} s`).toBeGreaterThan(0);
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
    await page.evaluate(() => (window as unknown as { __liquidTest: W67Hook }).__liquidTest.instance.shake());
    await w67Advance(page, 10);
    const soft = await w67RestAlphas(page);
    expect(soft.every((a) => a < 1), `every element sloshes: ${soft}`).toBe(true);
    const frames = await w67FramesUntilAllRest(page, Math.round(W67_SHAKE_REFORM_BUDGET_S * W67_FPS) - 10);
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
