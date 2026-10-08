/**
 * @vitest-environment jsdom
 * W72 (D72-1, D72-2): renderer selection through the public facade. Replaces W66's
 * "'auto' never probes" (D66-2) and B13's "silentFallback is validated only": 'auto'
 * (the default) probes WebGPU and falls back to Canvas2D with one console.info unless
 * silentFallback (also on an unusable presentation surface, the gate amendment); explicit
 * 'webgpu' accepts a fallback adapter and never warns. W71's D71-2, two-instance and D71-4
 * tests are kept at the end with their assertions.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { LiquidDOM, WebGPUUnavailableError } from "../src/index";
import { createManualClock } from "../src/clock";
import { freedOf, instanceTracker, resetDom, setupFacadeTestEnv, spyBackend } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu, type LifecycleGpuOptions } from "./_fake-gpu";

const tracker = instanceTracker();
let gpu: LifecycleGpu | null = null;
let info: MockInstance<typeof console.info>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  tracker.destroyAll();
  gpu?.restore();
  gpu = null;
  vi.restoreAllMocks();
});

function withGpu(o: LifecycleGpuOptions = {}): LifecycleGpu {
  gpu?.restore();
  gpu = installFakeGpuLifecycle(o);
  return gpu;
}
const base = { autoObserve: false, particles: 1024, maxElements: 4 } as const;
const FALLBACK_INFO =
  /^\[liquiddom\] WebGPU is not available \(.+\); using the Canvas2D renderer\. Pass silentFallback: true to hide this message\.$/;

// W72 red: approved-test change (Dennis approves at W72 red). W71's five tests below are superseded by this rewrite:
// - given_renderer_auto_when_create_then_activeRenderer_canvas2d_and_webgpu_never_probed (D66-2; D72-1 changes it, re-pinned by 36–39)
// - given_renderer_omitted_or_canvas2d_when_create_then_activeRenderer_canvas2d (D72-1 changes it, re-pinned by 36–39)
// - given_silentFallback_true_or_false_when_create_with_auto_then_validated_and_no_console_info_B13 (D72-1 changes it, re-pinned by 43)
// - given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError_and_nothing_left_behind (covered by 41)
// - given_webgpu_init_bug_that_is_not_unavailable_when_create_then_rejects_with_that_error (covered by 42)
describe("W72: renderer selection through the facade (D72-1, D72-2)", () => {
  it("given_renderer_auto_and_a_hardware_adapter_when_create_then_activeRenderer_webgpu_no_console_info_and_no_warn", async () => {
    const g = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "auto" }));
    expect(inst.activeRenderer).toBe("webgpu");
    expect(g.calls.requestAdapter).toBe(1);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("given_renderer_omitted_when_create_then_it_is_auto_and_probes_webgpu_once", async () => {
    const g = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    expect(inst.activeRenderer).toBe("webgpu");
    expect(g.calls.requestAdapter).toBe(1);
  });

  it("given_renderer_canvas2d_when_create_then_webgpu_is_never_probed", async () => {
    const g = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "canvas2d" }));
    expect(inst.activeRenderer).toBe("canvas2d");
    expect(g.calls.requestAdapter).toBe(0);
    expect(info).not.toHaveBeenCalled();
  });

  it("given_renderer_auto_without_navigator_gpu_when_create_then_canvas2d_one_liquid_canvas_and_one_console_info", async () => {
    expect((navigator as { gpu?: unknown }).gpu).toBeUndefined();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    expect(inst.activeRenderer).toBe("canvas2d");
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(document.querySelector("canvas")!.classList.contains("liquid-canvas")).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    const msg = String(info.mock.calls[0]![0]);
    expect(msg).toMatch(FALLBACK_INFO);
    expect(msg).toMatch(/navigator\.gpu/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("given_a_fallback_adapter_when_create_with_auto_then_canvas2d_and_with_explicit_webgpu_then_webgpu_D72_2", async () => {
    const g = withGpu({ isFallbackAdapter: true });
    const auto = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    expect(auto.activeRenderer).toBe("canvas2d");
    expect(g.calls.requestDevice).toBe(0);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/fallback/);
    const explicit = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu" }));
    expect(explicit.activeRenderer).toBe("webgpu");
    expect(g.calls.requestDevice).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("canvas.liquid-canvas")).toHaveLength(2);
  });

  it("given_renderer_webgpu_without_navigator_gpu_when_create_then_WebGPUUnavailableError_no_info_and_nothing_left_behind", async () => {
    const sb = spyBackend();
    await expect(LiquidDOM.create({ ...base, testBackend: sb.backend, renderer: "webgpu" })).rejects.toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
    expect(info).not.toHaveBeenCalled();
  });

  it("given_a_webgpu_init_bug_when_create_with_auto_or_webgpu_then_rejects_with_that_error_and_nothing_left_behind", async () => {
    for (const renderer of ["auto", "webgpu"] as const) {
      const g = withGpu({ configureError: new TypeError("bad canvas format") });
      const sb = spyBackend();
      const err = await LiquidDOM.create({ ...base, testBackend: sb.backend, renderer }).then(() => null, (e: unknown) => e);
      expect(err, renderer).toBeInstanceOf(TypeError);
      expect(err).not.toBeInstanceOf(WebGPUUnavailableError);
      expect(document.querySelector("canvas")).toBeNull();
      expect(freedOf(sb)).toHaveLength(sb.cores.length);
      expect(g.devices.every((d) => d.destroyed >= 1)).toBe(true);
    }
    expect(info).not.toHaveBeenCalled();
  });

  it("given_silentFallback_when_auto_falls_back_then_true_logs_nothing_false_logs_one_info_per_instance_and_a_non_boolean_is_a_TypeError", async () => {
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, silentFallback: true }));
    expect(info).not.toHaveBeenCalled();
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, silentFallback: false }));
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    expect(info).toHaveBeenCalledTimes(2);
    await expect(
      LiquidDOM.create({ ...base, testBackend: spyBackend().backend, silentFallback: "no" as unknown as boolean }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("given_renderer_webgpu_when_frames_run_then_no_console_warn_and_the_device_submits", async () => {
    const g = withGpu();
    const clock = createManualClock();
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
    const before = g.devices[0]!.submits;
    clock.advance(5);
    expect(g.devices[0]!.submits).toBeGreaterThan(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("given_an_unusable_presentation_surface_when_create_with_auto_then_canvas2d_one_liquid_canvas_and_one_info_and_with_webgpu_then_WebGPUUnavailableError_and_nothing_left_behind", async () => {
    // D72-1/D72-2 as amended at the gate: the headless-shell surface (createView raises) through the facade.
    const g = withGpu({ context: "invalid-texture" });
    const auto = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    expect(auto.activeRenderer).toBe("canvas2d");
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(document.querySelector("canvas")!.classList.contains("liquid-canvas")).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(FALLBACK_INFO);
    expect(String(info.mock.calls[0]![0])).toMatch(/presentation surface/);
    const sb = spyBackend();
    const err = await LiquidDOM.create({ ...base, testBackend: sb.backend, renderer: "webgpu" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelectorAll("canvas")).toHaveLength(1); // only the auto instance's canvas
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
    expect(g.devices.every((d) => d.destroyed >= 1)).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(g.calls.errors).toEqual([]);
  });

  // W71 (D71-2), kept: same assertions; only the fake and the file-level console.warn spy are this file's.
  it("given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_the_liquid_pipelines_exist_and_no_warning_D71_2", async () => {
    const g = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu" }));
    expect(inst.activeRenderer).toBe("webgpu");
    expect(g.calls.pipelines).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
  });

  // W71, kept: same assertions; only the fake and the file-level console.warn spy are this file's.
  it("given_two_webgpu_instances_when_frames_run_then_each_owns_a_device_draws_two_passes_per_frame_and_nothing_is_warned", async () => {
    const g = withGpu();
    const clock = createManualClock();
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
    clock.advance(5);
    expect(g.calls.passes).toHaveLength(10);
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
    clock.advance(5);
    expect(g.calls.passes).toHaveLength(30);
    expect(g.calls.requestDevice).toBe(2);
    expect(g.calls.errors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  // W71 (D71-4), kept verbatim apart from the fake: the facade → runtime → selectRenderer wiring of webgpuT0Scale.
  it("given_webgpuT0Scale_0_75_when_create_with_renderer_webgpu_then_T0_is_allocated_at_three_quarters_of_the_backing_size_D71_4", async () => {
    const g = withGpu();
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu", webgpuT0Scale: 0.75 }));
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(window.innerWidth * dpr));
    const bh = Math.max(1, Math.round(window.innerHeight * dpr));
    const t0 = g.calls.textures.filter((t) => t.format === "rgba16float").at(-1);
    expect(t0).toMatchObject({ width: Math.ceil(bw * 0.75), height: Math.ceil(bh * 0.75) });
  });
});
