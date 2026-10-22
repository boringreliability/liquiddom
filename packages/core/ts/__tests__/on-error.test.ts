/**
 * @vitest-environment jsdom
 * W85 (D85-1): `onError(err)` reports a stopped instance — exactly once per instance, on every stop
 * path (a throwing frame, a throwing `resize_world`, a failed Canvas2D rebuild after a lost WebGPU
 * device), synchronously after the stop's cleanup and its `console.error`; a throwing handler is
 * caught with one `console.error`; never for a `create()` rejection, an 'auto' fallback, a device
 * rebuilt as Canvas2D or after `destroy()`. Design resolution 1: `destroy()` from inside the handler
 * is safe (the providers do it). Design resolution 11: a stop during `create()` is reported before
 * `create()` resolves.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { resolveOptions } from "../src/options";
import { createFluidRuntime, ON_ERROR_THREW, type FluidRuntime, type FluidRuntimeOptions } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend, ticksOf, type SpyBackend } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu } from "./_fake-gpu";

const FRAME_FAILED = "[liquiddom] frame failed; the instance stopped. Call destroy() and create a new instance.";
const WORLD_FAILED = "[liquiddom] growing the fluid world failed; the instance stopped. Call destroy() and create a new instance.";
const REBUILD_FAILED =
  "[liquiddom] the Canvas2D rebuild after a lost WebGPU device failed; the instance stopped. Call destroy() and create a new instance.";

let fake2d: FakeCanvasHandle;
let error: MockInstance<typeof console.error>;
const live: FluidRuntime[] = [];
const setWindow = (key: string, value: number): void => {
  Object.defineProperty(window, key, { value, configurable: true });
};

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  setWindow("innerWidth", 1280);
  setWindow("innerHeight", 800);
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  fake2d.restore();
  vi.restoreAllMocks();
  setWindow("innerWidth", 1024);
  setWindow("innerHeight", 768);
});

async function start(extra: Partial<FluidRuntimeOptions> = {}): Promise<{ rt: FluidRuntime; sb: SpyBackend; clock: ManualClock }> {
  const sb = spyBackend();
  const clock = createManualClock();
  const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock, ...extra });
  live.push(rt);
  return { rt, sb, clock };
}

/** The newest core's tick throws from now on (a poisoned core). */
function failTicks(sb: SpyBackend, err: Error): void {
  vi.spyOn(sb.cores.at(-1)!, "tick").mockImplementation(() => {
    throw err;
  });
}

describe("W85 – onError (D85-1)", () => {
  it("given_onError_when_create_options_are_resolved_then_a_function_passes_through_and_anything_else_is_a_TypeError_naming_onError", () => {
    const fn = (): void => {};
    expect(resolveOptions({ onError: fn }).onError).toBe(fn);
    expect(resolveOptions({}).onError).toBeUndefined();
    for (const bad of ["log", 1, null, {}, true]) {
      expect(() => resolveOptions({ onError: bad as never }), String(bad)).toThrow(TypeError);
      expect(() => resolveOptions({ onError: bad as never }), String(bad)).toThrow(/onError must be a function/);
    }
  });

  it("given_a_frame_that_throws_when_the_instance_stops_then_onError_runs_once_with_that_error_after_the_cleanup_and_the_console_error", async () => {
    const seen: Array<{ errors: number; held: number }> = [];
    const onError = vi.fn((_err: unknown) => {
      seen.push({ errors: error.mock.calls.length, held: document.querySelectorAll(".liquid-halo, .liquid-away, .liquid-text").length });
    });
    const { rt, sb, clock } = await start({ onError, renderer: "canvas2d" });
    const el = document.createElement("button");
    mockRect(el, 10, 20, 100, 40);
    document.body.appendChild(el);
    rt.observe(el);
    await Promise.resolve();
    (sb.cores[0] as unknown as { forceRestAlpha(id: number, alpha: number | null): void }).forceRestAlpha(0, 0.5);
    clock.advance(2);
    expect(el.classList.contains("liquid-halo"), "precondition: a moving element holds the Canvas2D halo").toBe(true);
    const boom = new Error("boom (a poisoned core)");
    failTicks(sb, boom);
    clock.advance(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(seen, "inside onError: the stop's console.error ran and its cleanup released every class").toEqual([{ errors: 1, held: 0 }]);
    expect(error.mock.calls[0]).toEqual([FRAME_FAILED, boom]);
    const ticks = ticksOf(sb).length;
    clock.advance(5);
    expect(ticksOf(sb), "stopped for good").toHaveLength(ticks);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("given_a_resize_world_that_throws_when_the_window_grows_twice_then_onError_runs_once_with_that_error_and_the_message_is_unchanged", async () => {
    const onError = vi.fn();
    const { sb } = await start({ onError });
    const oom = new Error("out of memory");
    vi.spyOn(sb.cores[0]!, "resize_world").mockImplementation(() => {
      throw oom;
    });
    setWindow("innerWidth", 3000);
    window.dispatchEvent(new Event("resize"));
    setWindow("innerWidth", 4000);
    window.dispatchEvent(new Event("resize"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(oom);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual([WORLD_FAILED, oom]);
  });

  describe("WebGPU (the fake device)", () => {
    let gpu: LifecycleGpu;
    beforeEach(() => {
      gpu = installFakeGpuLifecycle();
    });
    afterEach(() => {
      for (const rt of live.splice(0)) rt.destroy();
      gpu.restore();
    });

    it("given_a_canvas2d_rebuild_that_fails_after_a_lost_device_when_the_instance_stops_then_onError_runs_once_and_the_rebuild_message_is_kept", async () => {
      const onError = vi.fn();
      const { sb, clock } = await start({ onError, renderer: "webgpu" });
      const gone = new Error("2d gone");
      vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockRejectedValue(gone);
      gpu.lose("unknown", "gpu reset");
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(gone);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]).toEqual([REBUILD_FAILED, gone]);
      const ticks = ticksOf(sb).length;
      clock.advance(3);
      expect(ticksOf(sb)).toHaveLength(ticks);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("given_a_canvas2d_rebuild_that_fails_after_destroy_when_it_settles_then_onError_is_never_called_and_nothing_is_logged", async () => {
      const onError = vi.fn();
      const { rt } = await start({ onError, renderer: "webgpu" });
      let rejectInit: (err: Error) => void = () => {};
      const init = vi.spyOn(FluidCanvas2DRenderer.prototype, "init").mockImplementation(
        () => new Promise<void>((_resolve, reject) => {
          rejectInit = reject;
        }),
      );
      gpu.lose("unknown", "gpu reset");
      await vi.waitFor(() => expect(init).toHaveBeenCalled());
      rt.destroy();
      rejectInit(new Error("2d gone after destroy"));
      await new Promise((r) => setTimeout(r, 10));
      expect(onError).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it("given_a_lost_device_that_continues_in_canvas2d_when_frames_run_then_onError_is_never_called", async () => {
      const onError = vi.fn();
      const { rt, clock } = await start({ onError, renderer: "webgpu" });
      await expect(rt.simulateDeviceLoss()).resolves.toBe(true);
      clock.advance(3);
      expect(rt.activeRenderer).toBe("canvas2d");
      expect(onError).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });

  it("given_an_onError_that_throws_when_the_instance_stops_then_the_throw_is_caught_with_one_console_error_and_the_instance_stays_stopped", async () => {
    const bug = new Error("handler bug");
    const onError = vi.fn(() => {
      throw bug;
    });
    const { rt, sb, clock } = await start({ onError });
    failTicks(sb, new Error("boom"));
    expect(() => clock.advance(1), "nothing escapes the frame").not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[1]).toEqual([ON_ERROR_THREW, bug]);
    const ticks = ticksOf(sb).length;
    clock.advance(3);
    expect(ticksOf(sb)).toHaveLength(ticks);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(() => rt.destroy()).not.toThrow();
  });

  it("given_an_auto_fallback_a_destroy_or_a_create_rejection_when_they_happen_then_onError_is_never_called", async () => {
    const onError = vi.fn();
    // 'auto' without navigator.gpu falls back to Canvas2D (one console.info): not a stop.
    const { rt, sb, clock } = await start({ onError, renderer: "auto" });
    expect(rt.activeRenderer).toBe("canvas2d");
    clock.advance(2);
    // destroy(), then a core that would throw: no frame runs, nothing is reported.
    failTicks(sb, new Error("after destroy"));
    rt.destroy();
    clock.advance(2);
    // A create() rejection rejects the promise instead (runtime and facade).
    const loadFailed = new Error("no wasm");
    await expect(
      createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, clock, loader: () => Promise.reject(loadFailed), onError }),
    ).rejects.toBe(loadFailed);
    await expect(
      LiquidDOM.create({ autoObserve: false, particles: 1024, loader: () => Promise.reject(loadFailed), onError }),
    ).rejects.toBe(loadFailed);
    expect(onError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("given_a_resize_world_that_throws_while_create_awaits_the_renderer_when_create_resolves_then_onError_ran_once_before_it_and_the_instance_is_stopped", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const order: string[] = [];
    const onError = vi.fn(() => order.push("onError"));
    const pending = LiquidDOM.create({ autoObserve: false, particles: 1024, maxElements: 4, testBackend: sb.backend, clock, renderer: "canvas2d", onError });
    pending.catch(() => undefined); // awaited below; never an unhandled rejection
    // create() has built the core and awaits the renderer: the window grows and the grid cannot.
    expect(sb.cores).toHaveLength(1);
    vi.spyOn(sb.cores[0]!, "resize_world").mockImplementation(() => {
      throw new Error("oom at create");
    });
    setWindow("innerWidth", 3000);
    const inst = await pending.then((i) => {
      order.push("resolved");
      return i;
    });
    expect(order).toEqual(["onError", "resolved"]);
    expect(error.mock.calls[0]![0]).toBe(WORLD_FAILED);
    clock.advance(3);
    expect(ticksOf(sb), "the stopped instance never ticks").toHaveLength(0);
    expect(() => inst.destroy()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("given_an_onError_that_destroys_the_runtime_when_resize_world_fails_then_nothing_throws_the_canvas_is_gone_and_the_core_is_freed_once", async () => {
    const holder: { rt: FluidRuntime | null } = { rt: null };
    const onError = vi.fn(() => holder.rt!.destroy());
    const { rt, sb, clock } = await start({ onError });
    holder.rt = rt;
    vi.spyOn(sb.cores[0]!, "resize_world").mockImplementation(() => {
      throw new Error("oom");
    });
    setWindow("innerWidth", 3000);
    expect(() => window.dispatchEvent(new Event("resize"))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
    expect(sb.calls.filter((c) => c.method === "free")).toHaveLength(1);
    clock.advance(2);
    expect(error, "the stop's own console.error only").toHaveBeenCalledTimes(1);
  });

  it("given_an_onError_that_destroys_the_instance_when_a_frame_fails_then_destroy_is_safe_and_the_element_is_restored_exactly", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const el = document.createElement("button");
    el.className = "author";
    el.setAttribute("style", "color: red");
    mockRect(el, 10, 20, 100, 40);
    document.body.appendChild(el);
    const before = el.outerHTML;
    const holder: { inst: LiquidDOMInstance | null } = { inst: null };
    const onError = vi.fn(() => holder.inst!.destroy());
    const inst = await LiquidDOM.create({ autoObserve: false, particles: 1024, maxElements: 4, testBackend: sb.backend, clock, onError });
    holder.inst = inst;
    inst.observe(el);
    await Promise.resolve();
    clock.advance(1);
    expect(el.classList.contains("liquid-element")).toBe(true);
    failTicks(sb, new Error("boom"));
    expect(() => clock.advance(1)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).toBeNull();
    expect(el.outerHTML, "restored exactly").toBe(before);
    expect(error).toHaveBeenCalledTimes(1);
    expect(() => inst.destroy()).not.toThrow();
    expect(sb.calls.filter((c) => c.method === "free")).toHaveLength(1);
  });
});
