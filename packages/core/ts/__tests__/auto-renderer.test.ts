/**
 * @vitest-environment jsdom
 * W66 (D66-2), W71 (D71-2, D71-4): renderer selection through the public facade. 'auto' stays
 * Canvas2D without probing until W72; 'webgpu' draws the liquid, with no infra-only warning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, WebGPUUnavailableError } from "../src/index";
import { createManualClock } from "../src/clock";
import { freedOf, installNavigatorGpu, instanceTracker, resetDom, setupFacadeTestEnv, spyBackend } from "./_facade-helpers";
import { installFakeGpu, type FakeGpuOptions } from "./_fake-gpu";

const tracker = instanceTracker();
const restores: Array<() => void> = [];
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  tracker.destroyAll();
  for (const r of restores.splice(0).reverse()) r();
});

function withGpu(opts: FakeGpuOptions = {}) {
  const fake = installFakeGpu(opts);
  restores.push(() => fake.restore());
  return fake;
}
const base = { autoObserve: false, particles: 1024, maxElements: 4 } as const;

describe("W66/W71: renderer selection", () => {
  it("given_renderer_auto_when_create_then_activeRenderer_canvas2d_and_webgpu_never_probed", async () => {
    const fake = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "auto" }));
    expect(inst.activeRenderer).toBe("canvas2d");
    expect(fake.calls.requestAdapter).toBe(0);
  });

  it("given_renderer_omitted_or_canvas2d_when_create_then_activeRenderer_canvas2d", async () => {
    const fake = withGpu();
    const a = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    const b = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "canvas2d" }));
    expect(a.activeRenderer).toBe("canvas2d");
    expect(b.activeRenderer).toBe("canvas2d");
    expect(fake.calls.requestAdapter).toBe(0);
  });

  it("given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError_and_nothing_left_behind", async () => {
    restores.push(installNavigatorGpu(undefined));
    const sb = spyBackend();
    await expect(LiquidDOM.create({ ...base, testBackend: sb.backend, renderer: "webgpu" })).rejects.toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
  });

  it("given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_the_liquid_pipelines_exist_and_no_warning_D71_2", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fake = withGpu();
      const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu" }));
      expect(inst.activeRenderer).toBe("webgpu");
      expect(fake.calls.pipelines).toHaveLength(3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("given_two_webgpu_instances_when_frames_run_then_each_owns_a_device_draws_two_passes_per_frame_and_nothing_is_warned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fake = withGpu();
      const clock = createManualClock();
      tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
      clock.advance(5);
      expect(fake.calls.passes).toHaveLength(10);
      tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
      clock.advance(5);
      expect(fake.calls.passes).toHaveLength(30);
      expect(fake.calls.requestDevice).toBe(2);
      expect(fake.calls.errors).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("given_webgpu_init_bug_that_is_not_unavailable_when_create_then_rejects_with_that_error", async () => {
    withGpu({ configureError: new TypeError("bad canvas format") });
    const err = await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("given_silentFallback_true_or_false_when_create_with_auto_then_validated_and_no_console_info_B13", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      for (const silentFallback of [true, false]) {
        tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, silentFallback }));
      }
      expect(info).not.toHaveBeenCalled();
      await expect(
        LiquidDOM.create({ ...base, testBackend: spyBackend().backend, silentFallback: "no" as unknown as boolean }),
      ).rejects.toBeInstanceOf(TypeError);
    } finally {
      info.mockRestore();
    }
  });

  it("given_webgpuT0Scale_0_75_when_create_with_renderer_webgpu_then_T0_is_allocated_at_three_quarters_of_the_backing_size_D71_4", async () => {
    const fake = withGpu();
    tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu", webgpuT0Scale: 0.75 }));
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(window.innerWidth * dpr));
    const bh = Math.max(1, Math.round(window.innerHeight * dpr));
    const t0 = fake.calls.textures.filter((t) => t.format === "rgba16float").at(-1);
    expect(t0).toMatchObject({ width: Math.ceil(bw * 0.75), height: Math.ceil(bh * 0.75) });
  });
});
