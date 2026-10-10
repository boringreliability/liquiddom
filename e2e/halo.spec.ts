/**
 * W75 (D75-2, D75-3): Canvas2D keeps the DOM text readable while its liquid is away — the
 * `liquid-halo` class and a per-element rule with a text-shadow in the element's own background
 * colour, Canvas2D only, while restAlpha < 1 — and the liquid follows author colour changes
 * without refresh(). Runs in the blocking canvas2d project (default routing).
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { IDLE_2S_FRAMES, advance, canvasPixelAt, gotoScene, restAlpha, rgbaDiffers } from "./scene";

const REFORM_BUDGET_FRAMES = 180;

interface HaloState {
  cls: boolean;
  shadow: string;
  key: string | null;
  style: string | null;
}

async function haloOf(page: Page, selector: string): Promise<HaloState> {
  return page.locator(selector).evaluate((el) => ({
    cls: el.classList.contains("liquid-halo"),
    shadow: getComputedStyle(el).textShadow,
    key: el.getAttribute("data-liquid-id"),
    style: el.getAttribute("style"),
  }));
}

async function openAtRest(page: Page, rm = false): Promise<void> {
  await gotoScene(page, { seed: 1, clock: "manual", rm });
  await advance(page, IDLE_2S_FRAMES);
  expect(await restAlpha(page)).toEqual([1, 1, 1, 1]);
}

async function apiSplash(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`W75: ${sel} not found`);
    (window.__liquidTest!.instance as { splash(el: HTMLElement): void }).splash(el);
  }, selector);
}

async function framesUntilAllRest(page: Page, max: number): Promise<number> {
  return page.evaluate((m) => {
    const t = window.__liquidTest!;
    for (let f = 1; f <= m; f++) {
      t.advance(1);
      if (t.restAlpha().every((a) => a === 1)) return f;
    }
    return -1;
  }, max);
}

test.describe("W75 – the Canvas2D halo and colour auto-refresh", () => {
  test("D75-3 – given a splash on Splash when it moves then #splash carries liquid-halo with a text-shadow in its own background colour and no inline style, and at rest neither", async ({ page }, testInfo) => {
    await openAtRest(page);
    const rest = await haloOf(page, "#splash");
    expect(rest.cls).toBe(false);
    expect(rest.shadow).toBe("none");
    expect(rest.key).toMatch(/^h\d+$/);
    expect(rest.style).toBeNull();

    await apiSplash(page, "#splash");
    await advance(page, 3);
    expect((await restAlpha(page))[0]).toBeLessThan(1);
    const moving = await haloOf(page, "#splash");
    expect(moving.cls).toBe(true);
    expect(moving.shadow).toContain("rgb(47, 111, 222)");
    expect(moving.style, "D66-3: no inline style").toBeNull();
    await page.screenshot({ path: testInfo.outputPath("w75-halo-splash-f3.png") });

    expect(await framesUntilAllRest(page, REFORM_BUDGET_FRAMES), "re-form within 3 s").toBeGreaterThan(0);
    const back = await haloOf(page, "#splash");
    expect(back.cls).toBe(false);
    expect(back.shadow).toBe("none");
  });

  test("D75-3 – given a shake when every element moves then each one carries the halo in its own background colour and the card's paragraph inherits it", async ({ page }, testInfo) => {
    await openAtRest(page);
    await page.evaluate(() => (window.__liquidTest!.instance as { shake(s?: number): void }).shake());
    await advance(page, 5);
    const expected: Record<string, string> = {
      "#splash": "rgb(47, 111, 222)",
      "#split": "rgb(202, 75, 32)",
      "#merge": "rgb(26, 131, 97)",
      "#card": "rgb(38, 50, 56)",
    };
    for (const [selector, colour] of Object.entries(expected)) {
      const h = await haloOf(page, selector);
      expect(h.cls, `${selector} carries the halo while moving`).toBe(true);
      expect(h.shadow, `${selector} halo colour`).toContain(colour);
    }
    // The card has two paragraphs; each inherits the halo (W75.5: strict-mode fix, intent unchanged).
    const paragraphShadows = await page.locator("#card p").evaluateAll((els) => els.map((el) => getComputedStyle(el).textShadow));
    expect(paragraphShadows).toHaveLength(2);
    for (const shadow of paragraphShadows) expect(shadow).toContain("rgb(38, 50, 56)");
    await page.screenshot({ path: testInfo.outputPath("w75-halo-shake-f5.png") });
  });

  test("D75-3 – given print or forced colours while the halo class is on then the computed text-shadow is none, and back on screen it returns", async ({ page }) => {
    await openAtRest(page);
    await apiSplash(page, "#splash");
    await advance(page, 3);
    expect((await haloOf(page, "#splash")).cls).toBe(true);
    await page.emulateMedia({ media: "print" });
    expect((await haloOf(page, "#splash")).shadow).toBe("none");
    await page.emulateMedia({ media: "screen", forcedColors: "active" });
    expect((await haloOf(page, "#splash")).shadow).toBe("none");
    await page.emulateMedia({ media: "screen", forcedColors: "none" });
    expect((await haloOf(page, "#splash")).shadow).toContain("rgb(47, 111, 222)");
  });

  test("D75-3 – given reduced motion (?rm=1) when Splash is clicked then no element ever carries liquid-halo", async ({ page }) => {
    await openAtRest(page, true);
    await page.getByRole("button", { name: "Splash", exact: true }).click();
    const seen = await page.evaluate(() => {
      let any = false;
      for (let f = 0; f < 30; f++) {
        window.__liquidTest!.advance(1);
        if (document.querySelector(".liquid-halo")) any = true;
      }
      return any;
    });
    expect(seen).toBe(false);
  });

  test("D75-2 – given an author class change on #split at rest when the next frame runs then the liquid paints the new colour without refresh() and the halo follows", async ({ page }) => {
    await openAtRest(page);
    await page.addStyleTag({ content: ".btn--split.alt { background: rgb(200, 30, 30); }" });
    await page.locator("#split").evaluate((el) => el.classList.add("alt"));
    await advance(page, 1);
    const box = await page.locator("#split").boundingBox();
    if (!box) throw new Error("W75: #split has no box");
    const px = await canvasPixelAt(page, box.x + 16, box.y + box.height / 2);
    expect(rgbaDiffers(px, { r: 200, g: 30, b: 30, a: 255 }, 12), `pixel ${JSON.stringify(px)} ≈ rgb(200, 30, 30)`).toBe(false);
    await apiSplash(page, "#split");
    await advance(page, 3);
    const h = await haloOf(page, "#split");
    expect(h.cls).toBe(true);
    expect(h.shadow).toContain("rgb(200, 30, 30)");
    expect(h.style).toBeNull();
  });

  test("D75-2 – given an ancestor theme change with a colour transition on #split when the transition ends then the liquid follows without refresh()", async ({ page }) => {
    await openAtRest(page);
    await page.addStyleTag({
      content: "#split { transition: color 150ms linear; } body.dark #split { color: rgb(255, 230, 0); background: rgb(10, 10, 10); }",
    });
    await page.evaluate(() => {
      const split = document.querySelector("#split")!;
      (window as unknown as { __w75Ended: Promise<string> }).__w75Ended = new Promise<string>((resolve) => {
        split.addEventListener("transitionend", (e) => resolve((e as TransitionEvent).propertyName), { once: true });
      });
      document.body.classList.add("dark"); // an ancestor: no mutation on any observed element
    });
    expect(await page.evaluate(() => (window as unknown as { __w75Ended: Promise<string> }).__w75Ended)).toBe("color");
    await advance(page, 1);
    const box = await page.locator("#split").boundingBox();
    if (!box) throw new Error("W75: #split has no box");
    const px = await canvasPixelAt(page, box.x + 16, box.y + box.height / 2);
    expect(rgbaDiffers(px, { r: 10, g: 10, b: 10, a: 255 }, 12), `pixel ${JSON.stringify(px)} ≈ rgb(10, 10, 10)`).toBe(false);
  });
});

test.describe("W75 amendment B – author transitions survive the colour re-read", () => {
  test("D75-2 B1 – given a 3 s transform transition started by an own class change on #split when a runtime frame runs then the transition keeps running, and after it ends the liquid paints the new colour", async ({ page }) => {
    await openAtRest(page);
    await page.addStyleTag({
      content:
        "#split { transition: transform 3000ms linear !important; } #split.pressed { transform: scale(0.5); background: rgb(10, 120, 200); }",
    });
    // One task: the class change, a style flush (the transition starts), then one runtime frame,
    // whose colour re-read used to write `transition: none !important` and cancel it.
    await page.evaluate(() => {
      const split = document.querySelector<HTMLElement>("#split")!;
      split.classList.add("pressed");
      void getComputedStyle(split).transform;
      window.__liquidTest!.advance(1);
    });
    await page.waitForTimeout(150); // 3 s leaves a slow CI runner ample margin before the end
    const mid = await page.locator("#split").evaluate((el) => ({
      scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
      running: el.getAnimations().length,
      style: el.getAttribute("style"),
    }));
    expect(mid.scale, `scale ${mid.scale}: mid-transition, not jumped to its end`).toBeGreaterThan(0.5);
    expect(mid.scale).toBeLessThan(1);
    expect(mid.running, "the transform transition is still running").toBeGreaterThan(0);
    expect(mid.style, "D66-3: no inline style").toBeNull();

    await expect
      .poll(() => page.locator("#split").evaluate((el) => el.getAnimations().length), { timeout: 8000 })
      .toBe(0);
    expect(await page.locator("#split").evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(0.5);
    // The frame after the transition ends re-reads the colours; the liquid then re-forms at the smaller rect.
    await advance(page, IDLE_2S_FRAMES);
    const box = await page.locator("#split").boundingBox();
    if (!box) throw new Error("W75: #split has no box");
    const px = await canvasPixelAt(page, box.x + box.width / 2, box.y + box.height / 2);
    expect(rgbaDiffers(px, { r: 10, g: 120, b: 200, a: 255 }, 12), `pixel ${JSON.stringify(px)} ≈ rgb(10, 120, 200)`).toBe(false);
  });
});
