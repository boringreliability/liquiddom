/**
 * @vitest-environment jsdom
 * W72 (D72-3, README Review Focus 5): the runtime rebuilds as Canvas2D on a lost WebGPU
 * device — renderer swapped, canvas remounted in place, resize re-applied, the next frame
 * drawn by Canvas2D, one console.warn — and the lifecycle races around it.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { LiquidDOM } from "../src/index";
import { createFluidRuntime, DEVICE_LOST_WARNING, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { resetDom, setupFacadeTestEnv, spyBackend, ticksOf, type SpyBackend } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu, type LifecycleGpuOptions } from "./_fake-gpu";

let fake2d: FakeCanvasHandle;
let gpu: LifecycleGpu;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
const live: FluidRuntime[] = [];

function installGpu(o: LifecycleGpuOptions = {}): LifecycleGpu {
  gpu?.restore();
  gpu = installFakeGpuLifecycle(o);
  return gpu;
}

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D(); // first, so the gpu fake wraps it
  setupFacadeTestEnv(); // ResizeObserver stub; the fake 2d is already present
  gpu = installFakeGpuLifecycle();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  gpu.restore();
  fake2d.restore();
  vi.restoreAllMocks();
});

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

async function runtime(renderer: "webgpu" | "canvas2d" = "webgpu"): Promise<{ rt: FluidRuntime; sb: SpyBackend; clock: ManualClock }> {
  const sb = spyBackend();
  const clock = createManualClock();
  const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer });
  live.push(rt);
  return { rt, sb, clock };
}

describe("W72: device.lost → Canvas2D rebuild (D72-3)", () => {
  it("given_webgpu_when_the_device_is_lost_then_canvas2d_on_a_remounted_canvas_resized_rendering_next_frame_one_warn_no_error", async () => {
    const { rt, sb, clock } = await runtime();
    expect(rt.activeRenderer).toBe("webgpu");
    const old = rt.canvas;
    const marker = document.body.appendChild(document.createElement("div"));
    document.body.insertBefore(old, marker); // the canvas has a following sibling
    const size = [old.width, old.height];
    clock.advance(2);

    gpu.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    await flush(); // the Canvas2D init settles

    const fresh = rt.canvas;
    expect(fresh).not.toBe(old);
    expect(old.isConnected).toBe(false);
    expect(fresh.nextSibling).toBe(marker);
    expect(fresh.className).toBe("liquid-canvas");
    expect(fresh.getAttribute("aria-hidden")).toBe("true");
    expect([fresh.width, fresh.height]).toEqual(size);
    expect(document.querySelectorAll("canvas.liquid-canvas")).toHaveLength(1);
    expect(gpu.devices[0]!.destroyed).toBe(1);

    const ticks = ticksOf(sb).length;
    clock.advance(1);
    expect(ticksOf(sb)).toHaveLength(ticks + 1); // the same core keeps ticking
    const ctx = fake2d.ctxFor(fresh);
    expect(ctx, "Canvas2D context on the remounted canvas").toBeDefined();
    expect(ctx!.ops("clearRect").length).toBeGreaterThan(0); // the next frame is drawn by Canvas2D
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe(
      `${DEVICE_LOST_WARNING} (unknown: gpu reset); continuing with the Canvas2D renderer.`,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("given_webgpu_when_the_device_is_lost_externally_with_reason_destroyed_then_it_rebuilds_as_canvas2d_with_one_warn", async () => {
    // W71.0 spike: SwiftShader's crashed GPU process reports reason "destroyed"; it must rebuild.
    const { rt } = await runtime();
    const canvas = rt.canvas;
    gpu.lose("destroyed", "destroyed elsewhere");
    await flush();
    expect(rt.activeRenderer).toBe("canvas2d");
    expect(rt.canvas).not.toBe(canvas);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe(
      `${DEVICE_LOST_WARNING} (destroyed: destroyed elsewhere); continuing with the Canvas2D renderer.`,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("given_a_loss_that_resolves_after_destroy_when_flushed_then_no_rebuild_no_warn_and_no_canvas", async () => {
    const { rt } = await runtime();
    gpu.lose("unknown", "late reset");
    rt.destroy();
    await flush();
    expect(document.querySelector("canvas")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(gpu.devices[0]!.destroyed).toBe(1);
  });

  it("given_destroy_during_the_canvas2d_rebuild_when_it_completes_then_the_new_renderer_is_destroyed_and_no_canvas_remains", async () => {
    const { rt } = await runtime();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const realInit = FluidCanvas2DRenderer.prototype.init;
    vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockImplementation(async function (this: FluidCanvas2DRenderer, c: HTMLCanvasElement) {
      await gate;
      return realInit.call(this, c);
    });
    const destroyC2d = vi.spyOn(FluidCanvas2DRenderer.prototype, "destroy");
    gpu.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    rt.destroy();
    release();
    await flush();
    expect(destroyC2d).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("given_two_webgpu_instances_when_one_device_is_lost_then_only_that_instance_rebuilds", async () => {
    const a = await runtime();
    const b = await runtime();
    expect(gpu.devices).toHaveLength(2);
    const bCanvas = b.rt.canvas;
    gpu.devices[0]!.lose("unknown", "reset of A");
    await vi.waitFor(() => expect(a.rt.activeRenderer).toBe("canvas2d"));
    await flush();
    expect(b.rt.activeRenderer).toBe("webgpu");
    expect(b.rt.canvas).toBe(bCanvas);
    expect(bCanvas.isConnected).toBe(true);
    expect(gpu.devices[1]!.destroyed).toBe(0);
    expect(document.querySelectorAll("canvas.liquid-canvas")).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("given_a_loss_right_after_init_before_the_runtime_exists_when_built_then_it_rebuilds_once", async () => {
    const realInit = WebGPURenderer.prototype.init;
    vi.spyOn(WebGPURenderer.prototype, "init").mockImplementation(async function (this: WebGPURenderer, c: HTMLCanvasElement) {
      await realInit.call(this, c);
      this.loseDeviceForTest(); // resolves before createFluidRuntime has built the runtime
    });
    const { rt } = await runtime();
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    await flush();
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(rt.canvas.isConnected).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("given_a_failing_canvas2d_rebuild_when_the_device_is_lost_then_one_console_error_and_the_instance_stops", async () => {
    const { rt, sb, clock } = await runtime();
    vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockRejectedValue(new Error("2d gone"));
    gpu.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(String(error.mock.calls[0]![0])).toMatch(/Canvas2D rebuild after a lost WebGPU device failed/);
    const ticks = ticksOf(sb).length;
    clock.advance(3);
    expect(ticksOf(sb)).toHaveLength(ticks); // stopped for good, like a failed frame
    expect(() => rt.destroy()).not.toThrow();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("given_create_pending_on_webgpu_init_when_the_caller_destroys_as_soon_as_it_resolves_then_no_canvas_device_destroyed_and_no_warn", async () => {
    const g = installGpu({ holdInit: true });
    const pending = LiquidDOM.create({ autoObserve: false, particles: 1024, maxElements: 4, testBackend: spyBackend().backend, renderer: "webgpu" });
    await vi.waitFor(() => expect(g.devices).toHaveLength(1));
    expect(document.querySelectorAll("canvas")).toHaveLength(1); // mounted while init is pending
    g.releaseInit();
    const inst = await pending;
    inst.destroy(); // the adapters' cancel path: destroy right after create resolves
    await flush();
    expect(document.querySelector("canvas")).toBeNull();
    expect(g.devices[0]!.destroyed).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("given_the_test_seams_when_used_then_simulateDeviceLoss_rebuilds_and_fragmentEstimate_is_0_under_canvas2d", async () => {
    const c2 = await runtime("canvas2d");
    expect(c2.rt.fragmentEstimate).toBe(0);
    expect(c2.rt.t0Size).toBeNull(); // D72-6 seam: no T0 under Canvas2D
    await expect(c2.rt.simulateDeviceLoss()).resolves.toBe(false);
    const { rt, clock } = await runtime("webgpu");
    clock.advance(2);
    expect(Number.isFinite(rt.fragmentEstimate) && rt.fragmentEstimate >= 0).toBe(true);
    // D72-6 seam: T0 = ceil(backing px × 0.5); the backing store is the canvas' width/height after resize.
    expect(rt.t0Size).toEqual([Math.ceil(rt.canvas.width * 0.5), Math.ceil(rt.canvas.height * 0.5)]);
    await expect(rt.simulateDeviceLoss()).resolves.toBe(true);
    expect(rt.activeRenderer).toBe("canvas2d");
    expect(rt.fragmentEstimate).toBe(0);
    expect(rt.t0Size).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("simulated device loss");
  });
});
