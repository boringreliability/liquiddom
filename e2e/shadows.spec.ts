/**
 * W88 "Shadows follow the liquid" (canvas2d, blocking; the default testMatch routes this file to
 * canvas2d only; the WebGPU twins of E2, E3 and E8 are the W88 block of webgpu-robust.spec.ts).
 * demo/scenes/shadows.html, manual clock, seed 1, 1280×800. D88-1: the browser draws the shadow at
 * rest, the renderer while the liquid is away (`liquid-shadow-away`); D88-7: the handoff is instant,
 * with no gap and no double frame (Review Focus: the non-monotonic restAlpha before rest); D88-2:
 * inset at rest only; D88-10: no shadow under the element's own liquid; reduced motion, print.
 */
import { test, expect } from "./fixtures";
import { VIEWPORT } from "./projects";
import { LIQUID_RGB, advanceShadows, canvasBoxes, gotoShadows, handoff, heldOf, maxLiquidAlpha, ringEnergy } from "./shadows";

test.use({ viewport: { ...VIEWPORT } });

/** A splash is in full motion after this many frames (restAlpha well below 1). */
const MID_SPLASH_FRAMES = 8;
/** D88-7: every frame's ring energy within this factor of the browser's at rest (no gap: never near 0; no double: never near 2). */
const HANDOFF_MIN = 0.6;
const HANDOFF_MAX = 1.4;
/** D88-10: the #glass liquid is 50 % opaque; a shadow under it would raise its alpha above this. */
const GLASS_ALPHA_MAX = 158;

test.describe("W88 – shadows follow the liquid (canvas2d)", () => {
  test("E1 D88-1 – given the scene at rest when screenshotted then each element's own box-shadow shows around it, no element holds liquid-shadow-away and the canvas draws no shadow", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    expect(await page.evaluate(() => window.__shadows!.held()), "nothing is away at rest").toEqual([false, false, false, false, false, false, false, false]);
    const drop = await ringEnergy(page, "drop", 2, 40);
    const glow = await ringEnergy(page, "glow", 2, 40);
    const plain = await ringEnergy(page, "plain", 2, 40);
    console.log(`W88 E1 ring energy at rest: drop ${drop}, glow ${glow}, plain ${plain}`);
    expect(drop, "the drop shadow is drawn by the browser").toBeGreaterThan(10 * Math.max(plain, 1000));
    expect(glow).toBeGreaterThan(10 * Math.max(plain, 1000));
    const outside = await page.evaluate(() => {
      const h = window.__shadows!;
      const img = h.pixels();
      const rects = h.ids.map((i) => h.rect(i));
      let n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (img.data[(y * img.width + x) * 4 + 3]! <= 8) continue;
          if (!rects.some((r) => x >= r.x - 2 && x <= r.x + r.width + 2 && y >= r.y - 2 && y <= r.y + r.height + 2)) n++;
        }
      }
      return n;
    });
    expect(outside, "at rest the canvas holds only the liquid in the rects").toBe(0);
  });

  test("E2 D88-1, D88-5 – given a splash on Drop and Glow when mid-splash then both hold the class, the browser's shadow is off and the canvas's shadow follows the deformed liquid", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    await page.evaluate(() => {
      window.__shadows!.splash("drop", 1);
      window.__shadows!.splash("glow", 1);
    });
    await advanceShadows(page, MID_SPLASH_FRAMES);
    expect([await heldOf(page, "drop"), await heldOf(page, "glow")]).toEqual([true, true]);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("drop")!).boxShadow)).toBe("none");
    const drop = await canvasBoxes(page, "drop", 80, LIQUID_RGB.drop, "dark");
    const glow = await canvasBoxes(page, "glow", 100, LIQUID_RGB.glow, "cyan");
    console.log(`W88 E2 drop ${JSON.stringify(drop)}; glow ${JSON.stringify(glow)}`);
    expect(drop.liquid && drop.shadow && glow.liquid && glow.shadow, "liquid and shadow pixels on the canvas").toBeTruthy();
    const dropRect = await page.evaluate(() => window.__shadows!.rect("drop"));
    const deformed = Math.abs(drop.liquid!.x1 - drop.liquid!.x0 - dropRect.width) > 4 || Math.abs(drop.liquid!.y1 - drop.liquid!.y0 - dropRect.height) > 4;
    expect(deformed, "the splash deformed the liquid (else nothing follows)").toBe(true);
    expect(drop.shadow!.y1, "the drop shadow lies under the liquid's lowest point, 8 px down").toBeGreaterThan(drop.liquid!.y1 + 6);
    for (const side of ["x0", "y0"] as const) expect(glow.shadow![side], `the glow surrounds the liquid (${side})`).toBeLessThan(glow.liquid![side] - 6);
    for (const side of ["x1", "y1"] as const) expect(glow.shadow![side], `the glow surrounds the liquid (${side})`).toBeGreaterThan(glow.liquid![side] + 6);
  });

  test("E3 D88-7 – given a soft splash on Drop and on Glow when they come to rest then the class follows restAlpha frame by frame and the ring never shows a gap or a double shadow", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    for (const id of ["drop", "glow"] as const) {
      const run = await handoff(page, id, 0.5, 8, 40);
      const ratios = run.frames.map((f) => f.ratio);
      console.log(`W88 E3 ${id}: rest at f${run.rest}, ${run.frames.length} frames recorded, ${run.toggles} class changes, ratio ${Math.min(...ratios).toFixed(3)}…${Math.max(...ratios).toFixed(3)}`);
      expect(run.rest, `${id} rests within the budget`).toBeGreaterThan(0);
      for (const f of run.frames) {
        expect(f.held, `${id} f${f.f}: the class is on exactly while restAlpha < 1 (restAlpha ${f.restAlpha})`).toBe(f.restAlpha < 1);
        expect(f.ratio, `${id} f${f.f}: no gap`).toBeGreaterThan(HANDOFF_MIN);
        expect(f.ratio, `${id} f${f.f}: no double shadow`).toBeLessThan(HANDOFF_MAX);
      }
    }
  });

  test("E4 D88-2 – given a splash on the inset card when mid-splash then its inset shadow hides with the class and returns at rest", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    const inset = (): Promise<string> => page.evaluate(() => getComputedStyle(document.getElementById("inset")!).boxShadow);
    expect(await inset()).toContain("inset");
    await page.evaluate(() => window.__shadows!.splash("inset", 1));
    await advanceShadows(page, MID_SPLASH_FRAMES);
    expect(await heldOf(page, "inset")).toBe(true);
    expect(await inset()).toBe("none");
    await advanceShadows(page, 300);
    expect(await heldOf(page, "inset")).toBe(false);
    expect(await inset()).toContain("inset");
  });

  test("E5 D88-3 – given a currentColor glow when the scene loads then the snapshot holds the element's text colour (Review Focus 5)", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    const layers = await page.evaluate(() => window.__shadows!.layers("current"));
    expect(layers).toEqual([{ color: [200, 40, 120, 1], dx: 0, dy: 0, blur: 16, spread: 0, inset: false }]);
    expect(await page.evaluate(() => window.__shadows!.layers("plain"))).toEqual([]);
  });

  test("E6 reduced motion – given ?rm=1 when every element is splashed then nothing holds the class and the browser's drop shadow stays as it was", async ({ page }) => {
    await gotoShadows(page, "canvas2d", "&rm=1");
    const before = await ringEnergy(page, "drop", 2, 40);
    await page.evaluate(() => {
      for (const id of window.__shadows!.ids) window.__shadows!.splash(id, 1);
    });
    for (let f = 0; f < 30; f++) {
      await advanceShadows(page, 1);
      expect((await page.evaluate(() => window.__shadows!.held())).some(Boolean), `f${f}`).toBe(false);
    }
    const after = await ringEnergy(page, "drop", 2, 40);
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });

  test("E7 print – given Drop mid-splash when print is emulated then its own box-shadow is back (the class rule is screen-only) and the canvas is hidden", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    await page.evaluate(() => window.__shadows!.splash("drop", 1));
    await advanceShadows(page, MID_SPLASH_FRAMES);
    expect(await heldOf(page, "drop")).toBe(true);
    await page.emulateMedia({ media: "print" });
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("drop")!).boxShadow)).toContain("20px");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("canvas.liquid-canvas")!).display)).toBe("none");
    await page.emulateMedia({ media: "screen" });
  });

  test("E8 D88-10 – given the translucent Glass pill with a black glow mid-splash when its liquid is read then no shadow lies under its own liquid (the knockout)", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    await page.evaluate(() => window.__shadows!.splash("glass", 1));
    await advanceShadows(page, MID_SPLASH_FRAMES);
    expect(await heldOf(page, "glass")).toBe(true);
    const alpha = await maxLiquidAlpha(page, "glass", 60);
    console.log(`W88 E8 glass: max liquid alpha ${alpha}`);
    expect(alpha, "the liquid's own 50 % alpha, no shadow under it").toBeLessThanOrEqual(GLASS_ALPHA_MAX);
    expect(alpha, "the liquid is there").toBeGreaterThan(80);
  });

  test("E9 resolution 12 – given Fade with an author transition: box-shadow 0.3s when it splashes and comes to rest then its browser shadow goes and comes back at once (no fade: no double shadow, no gap) and no transitionend loop", async ({ page }) => {
    await gotoShadows(page, "canvas2d");
    const full = "rgba(0, 0, 0, 0.45) 0px 6px 18px 0px";
    const boxShadow = (): Promise<string> => page.evaluate(() => getComputedStyle(document.getElementById("fade")!).boxShadow);
    expect(await boxShadow()).toBe(full);
    await page.evaluate(() => {
      const el = document.getElementById("fade")!;
      (window as unknown as { __fadeEnds: number }).__fadeEnds = 0;
      el.addEventListener("transitionend", () => (window as unknown as { __fadeEnds: number }).__fadeEnds++);
      window.__shadows!.splash("fade", 0.5);
    });
    await advanceShadows(page, 1);
    expect(await heldOf(page, "fade")).toBe(true);
    expect(await boxShadow(), "the class takes the browser's shadow away at once").toBe("none");
    let rested = false;
    for (let f = 0; f < 400 && !rested; f++) {
      await advanceShadows(page, 1);
      if (!(await heldOf(page, "fade"))) {
        rested = true;
        expect(await boxShadow(), "the handoff gives the browser's shadow back at once").toBe(full);
      }
    }
    expect(rested).toBe(true);
    await page.waitForTimeout(400); // longer than the author's 0.3 s: any transition would have ended
    expect(await page.evaluate(() => (window as unknown as { __fadeEnds: number }).__fadeEnds), "no box-shadow transition ran").toBe(0);
  });
});
