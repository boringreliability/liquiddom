import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import { gotoScene } from "./scene";
import { summarize } from "./stats";

const BASELINE = fileURLToPath(new URL("./perf-baseline.json", import.meta.url));
const RAF_P95_BUDGET_MS = 12; // spec §6
const TICK_BUDGET_FACTOR = 1.2; // spec §6: ≤ 1.2× recorded CI baseline

interface PerfBaseline {
  tickP95MsPerStep: number;
  rafP95Ms: number;
  recordedFrom: string;
}

test("perf – given 8000 particles in the acceptance scene when 5 s of RAF frames are sampled then p95 tick per fixed step and RAF p95 are recorded", async ({ page }, testInfo) => {
  // W72 red: approved-test change (Dennis approves at W72 red): skip guard, the file now also runs in webgpu-hw
  test.skip(testInfo.project.name !== "perf", "the canvas2d perf recording runs in the perf project");
  test.setTimeout(60_000);
  await gotoScene(page, { seed: 1, clock: "raf", perf: true });
  const params = await page.evaluate(() => window.__liquidTest!.params);
  expect(params.clock, "perf runs on the real RAF clock").toBe("raf");
  expect(params.renderer, "perf measures the canvas2d renderer").toBe("canvas2d");
  await page.waitForTimeout(1000); // warm-up: JIT, first redistribution, first renders
  await page.evaluate(() => window.__liquidTest!.perf!.start());
  await page.waitForTimeout(5000);
  const snap = await page.evaluate(() => window.__liquidTest!.perf!.stop());

  expect(snap.particleCapacity).toBe(8000);
  expect(snap.activeParticles).toBe(8000);
  expect(snap.tickMsPerStep.length, "tick probe recorded samples").toBeGreaterThan(100);
  expect(snap.rafMs.length, "RAF probe recorded samples").toBeGreaterThan(100);

  const report = {
    metric: "spec §6: p95 Rust tick per fixed step (8 substeps) and p95 RAF callback, canvas2d",
    tick: summarize(snap.tickMsPerStep),
    raf: summarize(snap.rafMs),
    steps: snap.steps,
    frames: snap.frames,
    particleCapacity: snap.particleCapacity,
    crossOriginIsolated: snap.crossOriginIsolated,
    userAgent: snap.userAgent,
    ci: !!process.env.CI,
    recordedAt: new Date().toISOString(),
  };
  const out = testInfo.outputPath("perf-canvas2d.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("perf-canvas2d.json", { path: out, contentType: "application/json" });
  console.log(
    `[perf] tick/step mean ${report.tick.mean.toFixed(3)} p95 ${report.tick.p95.toFixed(3)} ms; ` +
      `raf mean ${report.raf.mean.toFixed(3)} p95 ${report.raf.p95.toFixed(3)} ms; n=${report.tick.n}`,
  );

  expect.soft(report.raf.p95, `RAF p95 ≤ ${RAF_P95_BUDGET_MS} ms`).toBeLessThanOrEqual(RAF_P95_BUDGET_MS);
  if (existsSync(BASELINE)) {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as PerfBaseline;
    expect(
      Number.isFinite(baseline.tickP95MsPerStep) && baseline.tickP95MsPerStep > 0,
      "e2e/perf-baseline.json must have a positive numeric tickP95MsPerStep",
    ).toBe(true);
    expect
      .soft(report.tick.p95, `tick p95/step ≤ ${TICK_BUDGET_FACTOR}× baseline ${baseline.tickP95MsPerStep} ms`)
      .toBeLessThanOrEqual(TICK_BUDGET_FACTOR * baseline.tickP95MsPerStep);
  } else {
    testInfo.annotations.push({ type: "perf-baseline", description: "no e2e/perf-baseline.json yet (D65-8): recorded only" });
  }
});

test("perf – webgpu (local hardware adapter): RAF p95 and splat overdraw are logged, not gated (D72-4)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webgpu-hw", "hardware-adapter WebGPU perf runs only in the local webgpu-hw project");
  test.setTimeout(60_000);
  await page.goto("/scenes/acceptance.html?seed=1&renderer=webgpu&perf=1&test=1");
  await page.waitForFunction(() => window.__liquidTest !== undefined, undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__liquidTest!.ready);
  const active = await page.evaluate(() => (window.__liquidTest!.instance as { activeRenderer: string }).activeRenderer);
  expect(active, "perf measures the webgpu renderer").toBe("webgpu");
  const adapter = await page.evaluate(async () => {
    type Info = { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Info } | null> } }).gpu;
    const a = gpu ? await gpu.requestAdapter() : null;
    return a?.info ? { vendor: a.info.vendor ?? "", architecture: a.info.architecture ?? "", isFallbackAdapter: a.info.isFallbackAdapter ?? null } : null;
  });
  await page.waitForTimeout(1000); // warm-up
  await page.evaluate(() => window.__liquidTest!.perf!.start());
  const overdraw: number[] = [];
  const t0 = Date.now();
  let shaken = false;
  while (Date.now() - t0 < 5000) {
    if (!shaken && Date.now() - t0 > 2000) {
      await page.evaluate(() => (window.__liquidTest!.instance as { shake(): void }).shake());
      shaken = true;
    }
    overdraw.push(await page.evaluate(() => window.__liquidTest!.overdraw));
    await page.waitForTimeout(50);
  }
  const snap = await page.evaluate(() => window.__liquidTest!.perf!.stop());
  expect(snap.rafMs.length, "RAF probe recorded samples").toBeGreaterThan(100);
  expect(overdraw.length).toBeGreaterThan(20);

  const report = {
    metric: "D72-4: RAF p95 and the splat-overdraw estimate (fragments per frame), webgpu on the local hardware adapter; logged, not gated",
    raf: summarize(snap.rafMs),
    overdraw: summarize(overdraw),
    adapter,
    frames: snap.frames,
    particleCapacity: snap.particleCapacity,
    userAgent: snap.userAgent,
    recordedAt: new Date().toISOString(),
  };
  const out = testInfo.outputPath("perf-webgpu.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("perf-webgpu.json", { path: out, contentType: "application/json" });
  console.log(
    `[perf webgpu] raf mean ${report.raf.mean.toFixed(3)} p95 ${report.raf.p95.toFixed(3)} ms; ` +
      `overdraw mean ${Math.round(report.overdraw.mean)} p95 ${Math.round(report.overdraw.p95)} max ${report.overdraw.max} fragments/frame`,
  );
});
