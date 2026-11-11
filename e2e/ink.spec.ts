/**
 * W89 (Epic 16; D89-3, D89-5, D89-6, D89-10): text dissolves like ink where two liquids meet, under
 * Canvas2D (canvas2d project). The WebGPU twins are the W89 block of webgpu-robust.spec.ts.
 * While the card's liquid mixes with Merge's, the card's DOM text hides (`liquid-text`) and the
 * canvas draws its atlas text masked by 1 − fade plus the ink; at rest everything is as today.
 */
import { test, expect } from "./fixtures";
import { MIX_RELEASE_FRAMES } from "../packages/core/ts/src/renderers/mix-report";
import { projectRenderer } from "./scene";
import {
  INK_CARD_TEXT_PX_MIN,
  INK_HOLD_FRAMES,
  INK_LONG_HOLD_FRAMES,
  anyTextHidden,
  cardTextHidden,
  cardTextPx,
  closedRuns,
  inkAdvance,
  inkBlankMerge,
  inkCanvasHash,
  inkDragMergeIntoCard,
  inkOpen,
  inkReleaseAndRest,
  transitions,
} from "./ink";

test.describe("W89 – text dissolves like ink (canvas2d)", () => {
  test.beforeEach(() => {
    test.skip(projectRenderer() !== "canvas2d", "W89: canvas2d project (webgpu-hw: the webgpu-robust.spec.ts W89 block)");
  });

  test("W89 step 5 (canvas2d) – given Merge dragged into the card and held 90 frames then the card's DOM text hides exactly while the canvas draws it in its place, and after the release the rest is pixel-identical with no liquid-text", async ({ page }, testInfo) => {
    await inkOpen(page, "canvas2d");
    const rest = await inkCanvasHash(page);
    expect(await cardTextPx(page), "at rest the canvas draws no card text").toBe(0);
    await inkDragMergeIntoCard(page);
    const hold: Array<{ hidden: boolean; px: number }> = [];
    for (let f = 1; f <= INK_HOLD_FRAMES; f++) {
      await inkAdvance(page, 1);
      hold.push({ hidden: await cardTextHidden(page), px: await cardTextPx(page) });
      if (f === 45) await page.screenshot({ path: testInfo.outputPath("w89-canvas2d-merge-hold-f45.png") });
    }
    const hidden = hold.filter((h) => h.hidden);
    console.log(`W89 step 5 (canvas2d): card text hidden in ${hidden.length}/${INK_HOLD_FRAMES} hold frames; canvas card text px min ${Math.min(...hidden.map((h) => h.px))}`);
    expect(hidden.length, "the card's liquid mixes with Merge's for at least a quarter of the hold (D89-5)").toBeGreaterThanOrEqual(INK_HOLD_FRAMES / 4);
    for (const [i, h] of hold.entries()) {
      if (h.hidden) expect(h.px, `hold f${i + 1}: the DOM text is hidden only with the atlas text drawn in its place (Review Focus 1)`).toBeGreaterThan(INK_CARD_TEXT_PX_MIN);
      else expect(h.px, `hold f${i + 1}: the DOM text shows, so the canvas draws no card text (never both)`).toBe(0);
    }
    expect(await page.locator("#merge").evaluate((el) => el.classList.contains("liquid-away")), "Merge's own label stays hidden by W78").toBe(true);
    const frames = await inkReleaseAndRest(page);
    expect(frames, "both re-form within 3 s").toBeGreaterThan(0);
    expect(await anyTextHidden(page), "no liquid-text at rest").toBe(false);
    expect(await cardTextPx(page), "no canvas card text at rest").toBe(0);
    expect(await inkCanvasHash(page), "at rest the canvas is pixel-identical to before the merge (Review Focus 2)").toBe(rest);
  });

  test("W89 long hold (canvas2d) – given Merge held still in the card for 300 frames then the card's liquid-text never flickers", async ({ page }) => {
    await inkOpen(page, "canvas2d");
    await inkDragMergeIntoCard(page);
    const frames: boolean[] = [];
    for (let f = 1; f <= INK_LONG_HOLD_FRAMES; f++) {
      await inkAdvance(page, 1);
      frames.push(await cardTextHidden(page));
    }
    const on = frames.filter(Boolean).length;
    const runs = closedRuns(frames);
    console.log(`W89 long hold (canvas2d): hidden ${on}/${INK_LONG_HOLD_FRAMES}, ${transitions(frames)} transitions, closed runs ${JSON.stringify(runs)}`);
    expect(on, "the card mixes for at least a quarter of the hold").toBeGreaterThanOrEqual(INK_LONG_HOLD_FRAMES / 4);
    expect(transitions(frames), "on once (and at most off once): no flicker (D89-6)").toBeLessThanOrEqual(2);
    for (const n of runs) expect(n, "a hold that ends lasted at least the release").toBeGreaterThanOrEqual(MIX_RELEASE_FRAMES);
    await page.mouse.up();
  });

  test("W89 text-less blob (canvas2d) – given Merge without text dragged into the card then the card's text still hides while they mix (a text-less liquid counts, D89-3)", async ({ page }) => {
    await inkOpen(page, "canvas2d");
    await inkBlankMerge(page);
    await inkDragMergeIntoCard(page);
    let hidden = 0;
    for (let f = 1; f <= INK_HOLD_FRAMES; f++) {
      await inkAdvance(page, 1);
      if (await cardTextHidden(page)) hidden += 1;
    }
    console.log(`W89 text-less blob (canvas2d): card text hidden in ${hidden}/${INK_HOLD_FRAMES} hold frames`);
    expect(hidden).toBeGreaterThanOrEqual(INK_HOLD_FRAMES / 4);
    expect(await inkReleaseAndRest(page), "re-form within 3 s").toBeGreaterThan(0);
    expect(await anyTextHidden(page)).toBe(false);
  });

  test("W89 reduced motion (canvas2d) – given the card's text hidden by the mix and the instance paused when reduced motion switches on then the class goes at once and the canvas shows no card text (D89-10)", async ({ page }, testInfo) => {
    await inkOpen(page, "canvas2d");
    await inkDragMergeIntoCard(page);
    let f = 0;
    while (f < INK_HOLD_FRAMES && !(await cardTextHidden(page))) {
      await inkAdvance(page, 1);
      f += 1;
    }
    expect(await cardTextHidden(page), "precondition: the card's text is hidden by the mix").toBe(true);
    await page.evaluate(() => (window.__liquidTest!.instance as { pause(): void }).pause());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => anyTextHidden(page), { message: "the class goes at once" }).toBe(false);
    expect(await cardTextPx(page, true), "the paused canvas was repainted without atlas text (Review Focus 6)").toBe(0);
    await page.screenshot({ path: testInfo.outputPath("w89-canvas2d-rm-paused.png") });
    await page.mouse.up();
  });
});
