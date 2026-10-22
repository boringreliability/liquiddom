/**
 * @vitest-environment jsdom
 * W85 (D85-4): the area hint without autoObserve. A core created with hint 0 gets
 * `set_area_hint(area, tallest)` once, in the first redistribute batch whose observed area is > 0,
 * before that batch's `redistribute()` (design resolution 4: the flag survives batches with area 0
 * and is cleared by the first batch with area > 0, whatever the call returns); a core created with
 * a hint never gets it. A throwing call stops the instance (design resolution 7).
 * `_fluid-test-backend.ts` mirrors Rust's rule (B5 cell, generation 0).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiquidDOM } from "../src/index";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock } from "../src/clock";
import { roundedRectArea } from "../src/fluid-layout";
import { addLiquid, instanceTracker, mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { createTestBackend, type TestBackend } from "./_fluid-test-backend";

const live: FluidRuntime[] = [];
const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  tracker.destroyAll();
  vi.restoreAllMocks();
});

/** The batched redistribute runs in a microtask. */
const flush = (): Promise<void> => Promise.resolve();
const hintAndRedistribute = (b: TestBackend): string[] =>
  b.calls.filter((c) => c.startsWith("set_area_hint") || c === "redistribute");
const hintCalls = (b: TestBackend): string[] => b.calls.filter((c) => c.startsWith("set_area_hint"));

function box(x: number, y: number, w: number, h: number, radius = ""): HTMLElement {
  const el = document.createElement("button");
  if (radius) el.style.borderRadius = radius;
  mockRect(el, x, y, w, h);
  document.body.appendChild(el);
  return el;
}

async function start(particles = 8000): Promise<{ rt: FluidRuntime; backend: TestBackend }> {
  const backend = createTestBackend();
  const rt = await createFluidRuntime({ particles, maxElements: 8, seed: 1, testBackend: backend, clock: createManualClock() });
  live.push(rt);
  return { rt, backend };
}

describe("W85 – the area hint without autoObserve (D85-4)", () => {
  it("given_the_test_backend_when_set_area_hint_runs_then_it_mirrors_rust_b5_at_generation_0_and_returns_false_after_a_redistribute", () => {
    const backend = createTestBackend();
    const core = new backend.FluidCore(8000, 4, 1280, 800, 0, 0, 1);
    expect(core.cell_px()).toBe(8);
    expect(core.set_area_hint(76_057, 180)).toBe(true);
    expect(core.cell_px()).toBeCloseTo(Math.sqrt((4 * 76_057) / 8000), 6);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(core.set_area_hint(bad, 0)).toBe(true);
      expect(core.cell_px(), String(bad)).toBe(8);
    }
    expect(core.set_area_hint(1, 0)).toBe(true);
    expect(core.cell_px(), "the 4 px floor").toBe(4);
    core.redistribute();
    expect(core.set_area_hint(76_057, 180)).toBe(false);
    expect(core.cell_px()).toBe(4);
  });

  it("given_a_core_created_without_a_hint_when_the_first_batch_observes_area_then_set_area_hint_runs_once_with_the_area_and_the_tallest_height_before_redistribute", async () => {
    const { rt, backend } = await start();
    expect(backend.cores[0]!.ctorArgs[4], "hint 0 at create").toBe(0);
    const a = box(10, 10, 140, 48, "24px");
    const b = box(10, 100, 320, 180, "16px");
    rt.observe(a);
    rt.observe(b);
    await flush();
    const area = roundedRectArea(140, 48, 24) + roundedRectArea(320, 180, 16);
    expect(hintAndRedistribute(backend)).toEqual([`set_area_hint:${area}:180`, "redistribute"]);
    expect(backend.cores[0]!.cell_px(), "B5 from the observed area").toBeCloseTo(Math.sqrt((4 * area) / 8000), 6);
    rt.observe(box(400, 10, 100, 40));
    await flush();
    rt.unobserve(a);
    await flush();
    expect(hintCalls(backend), "once per instance").toHaveLength(1);
  });

  it("given_autoObserve_with_or_without_candidates_when_elements_are_observed_later_then_only_the_core_created_without_a_hint_calls_set_area_hint", async () => {
    const hinted = createTestBackend();
    addLiquid("button", [10, 10, 140, 48]);
    const a = tracker.track(await LiquidDOM.create({ particles: 8000, maxElements: 8, testBackend: hinted, clock: createManualClock() }));
    await flush();
    expect(hinted.cores[0]!.ctorArgs[4], "the candidates' hint").toBeGreaterThan(0);
    a.observe(box(10, 100, 320, 180));
    await flush();
    expect(hintCalls(hinted), "a hinted core: never (W84 bit-identical)").toEqual([]);
    for (const el of document.querySelectorAll("[data-liquid]")) el.remove();
    const plain = createTestBackend();
    const b = tracker.track(await LiquidDOM.create({ particles: 8000, maxElements: 8, testBackend: plain, clock: createManualClock() }));
    expect(plain.cores[0]!.ctorArgs[4], "autoObserve without candidates: hint 0").toBe(0);
    b.observe(box(10, 100, 320, 180));
    await flush();
    expect(hintCalls(plain)).toEqual([`set_area_hint:${320 * 180}:180`]);
  });

  it("given_first_batches_whose_observed_area_is_0_when_a_later_batch_observes_area_then_they_skip_redistribute_and_that_batch_calls_set_area_hint_once_and_gets_the_hinted_cell", async () => {
    const { rt, backend } = await start(1024);
    const hidden = box(0, 0, 0, 0); // e.g. observed while display: none
    rt.observe(hidden);
    await flush();
    expect(hintAndRedistribute(backend), "area 0: nothing to place, no redistribute").toEqual([]);
    expect(backend.cores[0]!.generation(), "the generation stays 0").toBe(0);
    rt.unobserve(hidden);
    await flush();
    expect(hintAndRedistribute(backend), "an unobserve-only batch: the same").toEqual([]);
    const setHint = vi.spyOn(backend.cores[0]!, "set_area_hint");
    rt.observe(box(10, 10, 140, 48));
    await flush();
    expect(setHint).toHaveBeenCalledTimes(1);
    expect(setHint, "still generation 0: the call rebuilds").toHaveReturnedWith(true);
    expect(backend.cores[0]!.cell_px(), "√(4·6720/1024) = 5.12 px, not 8").toBeCloseTo(Math.sqrt((4 * 6720) / 1024), 6);
    expect(hintAndRedistribute(backend).filter((c) => c === "redistribute")).toHaveLength(1);
    rt.observe(box(10, 100, 320, 180));
    await flush();
    expect(setHint, "once per instance").toHaveBeenCalledTimes(1);
  });

  it("given_a_core_created_without_a_hint_when_the_observed_area_outgrows_the_hinted_budget_then_the_over_budget_warning_reads_the_new_max_area", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Design resolution 12: the hinted budget is exactly 2 × the first batch's area (√(4·6720/1024) =
    // 5.12 px, above the 4 px floor); a second element of the same size reaches it exactly (13 440 px²),
    // and rounding must not warn.
    const exact = await start(1024);
    exact.rt.observe(box(10, 10, 140, 48));
    await flush();
    expect(exact.backend.cores[0]!.max_area_px2(), "the budget is 2 × 6720").toBeCloseTo(13_440, 6);
    exact.rt.observe(box(10, 100, 140, 48));
    await flush();
    expect(warn, "at the budget: no warning").not.toHaveBeenCalled();
    const { rt, backend } = await start(1024);
    rt.observe(box(10, 10, 100, 40));
    await flush();
    expect(backend.cores[0]!.cell_px(), "√(4·4000/1024) = 3.95 → the 4 px floor").toBe(4);
    expect(warn).not.toHaveBeenCalled();
    rt.observe(box(10, 100, 200, 100));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/observed area 24000 px² exceeds the particle budget 8192 px²/);
  });

  it("given_a_set_area_hint_that_throws_when_the_first_batch_runs_then_the_instance_stops_with_one_console_error_onError_once_and_no_redistribute", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const backend = createTestBackend();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 8000, maxElements: 8, seed: 1, testBackend: backend, clock, onError });
    live.push(rt);
    const oom = new Error("grid allocation failed");
    vi.spyOn(backend.cores[0]!, "set_area_hint").mockImplementation(() => {
      throw oom;
    });
    rt.observe(box(10, 10, 140, 48));
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual([
      "[liquiddom] rebuilding the grid for the area hint failed; the instance stopped. Call destroy() and create a new instance.",
      oom,
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(oom);
    expect(backend.calls, "no redistribute on a core that failed").not.toContain("redistribute");
    const ticks = backend.calls.filter((c) => c === "tick").length;
    clock.advance(3);
    expect(backend.calls.filter((c) => c === "tick")).toHaveLength(ticks);
  });

  it("given_a_stopped_instance_when_an_element_is_observed_or_unobserved_again_then_its_batch_calls_no_core_method", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const backend = createTestBackend();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 8000, maxElements: 8, seed: 1, testBackend: backend, clock });
    live.push(rt);
    const first = box(10, 10, 140, 48);
    rt.observe(first);
    await flush();
    clock.advance(1);
    vi.spyOn(backend.cores[0]!, "tick").mockImplementation(() => {
      throw new Error("boom (a poisoned core)");
    });
    clock.advance(1);
    const before = backend.calls.length;
    rt.observe(box(10, 100, 320, 180));
    rt.unobserve(first);
    await flush();
    expect(backend.calls.slice(before), "a stopped core is never called (review M7)").toEqual([]);
  });
});
