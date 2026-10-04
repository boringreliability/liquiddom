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
  test.setTimeout(60_000);
  await gotoScene(page, { seed: 1, clock: "raf", perf: true });
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
    expect
      .soft(report.tick.p95, `tick p95/step ≤ ${TICK_BUDGET_FACTOR}× baseline ${baseline.tickP95MsPerStep} ms`)
      .toBeLessThanOrEqual(TICK_BUDGET_FACTOR * baseline.tickP95MsPerStep);
  } else {
    testInfo.annotations.push({ type: "perf-baseline", description: "no e2e/perf-baseline.json yet (D65-8): recorded only" });
  }
});
