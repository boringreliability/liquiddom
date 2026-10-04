import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import type { StressReport } from "../demo/test-hooks";

async function waitForReport(page: Page, ms: number): Promise<StressReport> {
  await page.waitForFunction(() => window.__stress?.done === true, undefined, { timeout: 20_000 + ms });
  return page.evaluate(() => window.__stress!);
}

function expectHealthy(report: StressReport, n: number, minFrames: number): void {
  expect(report.error, report.error ?? "").toBeNull();
  expect(report.ok).toBe(true);
  expect(report.n).toBe(n);
  expect(report.instantiations, "WebAssembly instantiations on this load (W61: exactly 1)").toBe(1);
  expect(report.distinctMemories, "distinct WebAssembly.Memory objects across instances").toBe(1);
  expect(report.loaderCalls).toBe(n);
  expect(report.frames).toHaveLength(n);
  for (const f of report.frames) expect(f).toBeGreaterThanOrEqual(minFrames);
  expect(report.states).toHaveLength(n);
  for (const s of report.states) {
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.s) && Number.isFinite(s!.maxDev) && Number.isFinite(s!.restAlpha)).toBe(true);
    expect(s!.restAlpha).toBeGreaterThanOrEqual(0);
    expect(s!.restAlpha).toBeLessThanOrEqual(1);
  }
}

test.describe("multi-instance stress (spec §6, based on W61 race3.mjs)", () => {
  test("given 2, 3 and 4 instances created in the same task when the page runs 3 s then no console error, pageerror or panic", async ({ page, guard }, testInfo) => {
    test.setTimeout(120_000);
    for (const n of [2, 3, 4]) {
      await page.goto(`/scenes/stress.html?n=${n}&ms=3000`);
      const report = await waitForReport(page, 3000);
      expectHealthy(report, n, 10);
      expect(guard, `page problems after n=${n}`).toEqual([]);
    }
    await page.screenshot({ path: testInfo.outputPath("w65-stress-n4.png") });
  });

  test("given the stress page when reloaded 50 times then no console error, pageerror or panic", async ({ page, guard }) => {
    test.setTimeout(300_000);
    await page.goto("/scenes/stress.html?n=4&ms=250");
    expectHealthy(await waitForReport(page, 250), 4, 1);
    for (let reload = 1; reload <= 50; reload++) {
      await page.reload();
      const report = await waitForReport(page, 250);
      expectHealthy(report, 4, 1);
      expect(guard, `page problems after reload #${reload}`).toEqual([]);
    }
  });
});
