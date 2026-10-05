/**
 * @vitest-environment jsdom
 * W66 (D66-2): renderer selection through the public facade.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, WebGPUUnavailableError } from "../src/index";
import { createManualClock } from "../src/clock";
import {
  freedOf, installNavigatorGpu, installWebGpuCanvasContext, instanceTracker, makeGpuMock,
  resetDom, setupFacadeTestEnv, spyBackend,
} from "./_facade-helpers";

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

function withGpu(opts: Parameters<typeof makeGpuMock>[0] = {}) {
  const mock = makeGpuMock(opts);
  restores.push(installNavigatorGpu(mock.gpu));
  restores.push(installWebGpuCanvasContext(mock.canvasContext));
  return mock;
}
const base = { autoObserve: false, particles: 1024, maxElements: 4 } as const;

describe("W66: renderer selection (D66-2)", () => {
  it("given_renderer_auto_when_create_then_activeRenderer_canvas2d_and_webgpu_never_probed", async () => {
    const mock = withGpu();
    const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "auto" }));
    expect(inst.activeRenderer).toBe("canvas2d");
    expect(mock.calls.requestAdapter).toBe(0);
  });

  it("given_renderer_omitted_or_canvas2d_when_create_then_activeRenderer_canvas2d", async () => {
    const mock = withGpu();
    const a = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend }));
    const b = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "canvas2d" }));
    expect(a.activeRenderer).toBe("canvas2d");
    expect(b.activeRenderer).toBe("canvas2d");
    expect(mock.calls.requestAdapter).toBe(0);
  });

  it("given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError_and_nothing_left_behind", async () => {
    restores.push(installNavigatorGpu(undefined));
    const sb = spyBackend();
    await expect(LiquidDOM.create({ ...base, testBackend: sb.backend, renderer: "webgpu" })).rejects.toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
  });

  it("given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_and_one_console_warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withGpu();
      const inst = tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, renderer: "webgpu" }));
      expect(inst.activeRenderer).toBe("webgpu");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/infrastructure-only/);
    } finally {
      warn.mockRestore();
    }
  });

  it("given_webgpu_renderer_when_frames_run_then_still_one_warn_per_instance_and_second_instance_adds_one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withGpu();
      const clock = createManualClock();
      tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
      clock.advance(5);
      expect(warn).toHaveBeenCalledTimes(1);
      tracker.track(await LiquidDOM.create({ ...base, testBackend: spyBackend().backend, clock, renderer: "webgpu" }));
      clock.advance(5);
      expect(warn).toHaveBeenCalledTimes(2);
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
});
