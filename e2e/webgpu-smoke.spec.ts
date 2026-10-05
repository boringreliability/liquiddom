import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import type { WebGpuSmokeResult } from "../demo/test-hooks";

/** round(255 · (0.25, 0.5, 0.75, 1)); ±1 for unorm rounding differences. */
const EXPECTED_RGBA = [64, 128, 191, 255] as const;
const TOLERANCE = 1;

async function runSmoke(page: Page): Promise<{ result: WebGpuSmokeResult; logs: string[] }> {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/smoke/webgpu-smoke.html");
  await page.waitForFunction(() => window.__webgpuSmoke !== undefined, undefined, { timeout: 15_000 });
  const result = await page.evaluate(() => window.__webgpuSmoke!);
  return { result, logs };
}

function expectPixels(pixels: number[][] | null, label: string): void {
  expect(pixels, `${label} readback`).not.toBeNull();
  expect(pixels!.length).toBe(3);
  for (const px of pixels!) {
    px.forEach((v, c) => {
      expect(Math.abs(v - EXPECTED_RGBA[c]), `${label} channel ${c} = ${v}, expected ${EXPECTED_RGBA[c]}`).toBeLessThanOrEqual(TOLERANCE);
    });
  }
}

test.describe("webgpu smoke (soft until 10 green CI runs, D65-5)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("given SwiftShader WebGPU when requesting an adapter then adapter.info incl. isFallbackAdapter is logged", async ({ page }, testInfo) => {
    const { result, logs } = await runSmoke(page);
    expect(result.adapterInfo, `stage ${result.stage}: ${result.error}`).not.toBeNull();
    expect(result.adapterInfo).toHaveProperty("isFallbackAdapter");
    expect(logs.some((l) => l.startsWith("[webgpu-smoke] adapter.info "))).toBe(true);
    testInfo.annotations.push({ type: "adapter.info", description: JSON.stringify(result.adapterInfo) });
    console.log(`[webgpu-smoke] adapter.info ${JSON.stringify(result.adapterInfo)}`);
  });

  test("given a known clear colour when rendered and read back then the pixel matches", async ({ page }) => {
    const { result } = await runSmoke(page);
    expect(result.ok, `stage ${result.stage}: ${result.error}`).toBe(true);
    expectPixels(result.clearPixels, "clear");
  });

  test("given a WGSL pipeline drawing a full-screen triangle when rendered and read back then the pixel matches", async ({ page }, testInfo) => {
    const { result } = await runSmoke(page);
    expect(result.ok, `stage ${result.stage}: ${result.error}`).toBe(true);
    expectPixels(result.drawPixels, "draw");
    await page.locator("#smoke-canvas").screenshot({ path: testInfo.outputPath("w65-webgpu-smoke.png") });
  });
});
