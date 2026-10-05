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
