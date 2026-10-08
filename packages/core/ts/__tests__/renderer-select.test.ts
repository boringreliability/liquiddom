/**
 * @vitest-environment jsdom
 * W72 (D72-1, D72-2, D72-3 wiring): selectRenderer(choice, canvas, opts). 'auto' probes
 * WebGPU and falls back to Canvas2D on a remounted canvas with one console.info (none with
 * silentFallback); explicit 'webgpu' accepts a fallback adapter and has no fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fallbackInfo, FALLBACK_INFO_PREFIX, selectRenderer, type SelectRendererOptions } from "../src/renderers/select";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { WebGPUUnavailableError } from "../src/renderers/webgpu/errors";
import { mountLiquidCanvas, remountLiquidCanvas } from "../src/stylesheet";
import { resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu, type LifecycleGpuOptions } from "./_fake-gpu";

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
  gpu?.restore();
  gpu = null;
  vi.restoreAllMocks();
});

function withGpu(o: LifecycleGpuOptions = {}): LifecycleGpu {
  gpu?.restore();
  gpu = installFakeGpuLifecycle(o);
  return gpu;
}

interface Harness {
  readonly first: HTMLCanvasElement;
  current: HTMLCanvasElement;
  readonly remounts: HTMLCanvasElement[];
  readonly lost: GPUDeviceLostInfo[];
  readonly opts: SelectRendererOptions;
}

/** A mounted canvas (last in body, a marker after it) and options that remount like the runtime does. */
function harness(silentFallback = false): Harness {
  const first = mountLiquidCanvas();
  const h = { first, current: first, remounts: [] as HTMLCanvasElement[], lost: [] as GPUDeviceLostInfo[] } as Harness;
  (h as { opts: SelectRendererOptions }).opts = {
    silentFallback,
    remountCanvas: () => {
      h.current = remountLiquidCanvas(h.current);
      h.remounts.push(h.current);
      return h.current;
    },
    onDeviceLost: (lostInfo) => {
      h.lost.push(lostInfo);
    },
  };
  return h;
}

describe("W72: selectRenderer (D72-1, D72-2)", () => {
  it("given_auto_without_navigator_gpu_when_selected_then_canvas2d_on_a_remounted_canvas_and_one_fallback_info", async () => {
    expect((navigator as { gpu?: unknown }).gpu).toBeUndefined();
    const h = harness();
    const marker = document.body.appendChild(document.createElement("div")); // right after the canvas
    const sel = await selectRenderer("auto", h.first, h.opts);
    expect(sel.active).toBe("canvas2d");
    expect(sel.renderer).toBeInstanceOf(FluidCanvas2DRenderer);
    expect(h.remounts).toHaveLength(1);
    expect(sel.canvas).toBe(h.remounts[0]);
    expect(sel.canvas).not.toBe(h.first);
    expect(h.first.isConnected).toBe(false);
    expect(sel.canvas.nextSibling).toBe(marker);
    expect(info).toHaveBeenCalledTimes(1);
    const msg = String(info.mock.calls[0]![0]);
    expect(msg.startsWith(FALLBACK_INFO_PREFIX)).toBe(true);
    expect(msg).toMatch(/navigator\.gpu/);
    expect(warn).not.toHaveBeenCalled();
    sel.renderer.destroy();
  });

  it("given_auto_and_a_null_adapter_or_a_rejected_device_when_selected_then_canvas2d_and_one_info_each", async () => {
    for (const o of [{ adapter: "null" }, { adapter: "throws" }, { device: "rejects" }] as const) {
      const g = withGpu(o);
      const h = harness();
      const sel = await selectRenderer("auto", h.first, h.opts);
      expect(sel.active, JSON.stringify(o)).toBe("canvas2d");
      expect(h.remounts).toHaveLength(1);
      expect(g.calls.requestAdapter).toBe(1);
      sel.renderer.destroy();
    }
    expect(info).toHaveBeenCalledTimes(3);
  });

  it("given_auto_and_a_fallback_adapter_when_selected_then_canvas2d_without_a_device_or_webgpu_context_and_the_info_names_the_fallback_adapter", async () => {
    const g = withGpu({ isFallbackAdapter: true });
    const h = harness();
    const sel = await selectRenderer("auto", h.first, h.opts);
    expect(sel.active).toBe("canvas2d");
    expect(g.calls.requestDevice).toBe(0);
    expect(g.calls.getContextWebgpu).toBe(0);
    expect(h.remounts).toHaveLength(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/fallback/);
    sel.renderer.destroy();
  });

  it("given_auto_with_silentFallback_when_it_falls_back_then_canvas2d_on_a_remounted_canvas_and_no_info", async () => {
    const h = harness(true);
    const sel = await selectRenderer("auto", h.first, h.opts);
    expect(sel.active).toBe("canvas2d");
    expect(h.remounts).toHaveLength(1);
    expect(info).not.toHaveBeenCalled();
    sel.renderer.destroy();
  });

  it("given_auto_and_a_hardware_adapter_when_selected_then_webgpu_on_the_same_canvas_without_remount_info_or_warn", async () => {
    const g = withGpu();
    const h = harness();
    const sel = await selectRenderer("auto", h.first, h.opts);
    expect(sel.active).toBe("webgpu");
    expect(sel.renderer).toBeInstanceOf(WebGPURenderer);
    expect((sel.renderer as WebGPURenderer).isFallbackAdapter).toBe(false);
    expect(sel.canvas).toBe(h.first);
    expect(h.remounts).toHaveLength(0);
    expect(g.devices).toHaveLength(1);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    sel.renderer.destroy();
    expect(g.devices[0]!.destroyed).toBe(1);
  });

  it("given_auto_and_an_init_bug_when_selected_then_rejects_with_that_error_without_remount_or_info_and_the_device_is_destroyed", async () => {
    const bug = new TypeError("bad canvas format");
    const g = withGpu({ configureError: bug });
    const h = harness();
    const err = await selectRenderer("auto", h.first, h.opts).then(() => null, (e: unknown) => e);
    expect(err).toBe(bug);
    expect(err).not.toBeInstanceOf(WebGPUUnavailableError);
    expect(h.remounts).toHaveLength(0);
    expect(info).not.toHaveBeenCalled();
    expect(g.devices[0]!.destroyed).toBeGreaterThanOrEqual(1); // W71's init cleanup may destroy it too
  });

  it("given_a_device_lost_during_init_when_auto_then_canvas2d_on_a_fresh_canvas_and_when_webgpu_then_WebGPUUnavailableError", async () => {
    // auto: the loss arrives while init is parked at popErrorScope.
    let g = withGpu({ holdInit: true });
    const h = harness();
    const pending = selectRenderer("auto", h.first, h.opts);
    await vi.waitFor(() => expect(g.devices).toHaveLength(1));
    g.lose("unknown", "reset during init");
    g.releaseInit();
    const sel = await pending;
    expect(sel.active).toBe("canvas2d");
    expect(sel.canvas).not.toBe(h.first);
    // The old canvas handed out a webgpu context (init parks at the surface pop, after configure()):
    // Canvas2D works only because of the remount.
    expect(g.calls.getContextWebgpu).toBeGreaterThan(0);
    expect(h.first.getContext("2d")).toBeNull();
    expect(h.lost).toHaveLength(0); // a loss during init is "unavailable", never a rebuild
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/lost during init/);
    expect(g.devices[0]!.destroyed).toBeGreaterThanOrEqual(1);
    sel.renderer.destroy();

    // explicit webgpu: the same loss rejects create().
    g = withGpu({ holdInit: true });
    const h2 = harness();
    const pending2 = selectRenderer("webgpu", h2.first, h2.opts).then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(g.devices).toHaveLength(1));
    g.lose("unknown", "reset during init");
    g.releaseInit();
    const err = await pending2;
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(String((err as Error).message)).toMatch(/lost during init/);
    expect(h2.remounts).toHaveLength(0);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("given_webgpu_and_a_fallback_adapter_when_selected_then_webgpu_with_isFallbackAdapter_and_no_info", async () => {
    const g = withGpu({ isFallbackAdapter: true });
    const h = harness();
    const sel = await selectRenderer("webgpu", h.first, h.opts);
    expect(sel.active).toBe("webgpu");
    expect((sel.renderer as WebGPURenderer).isFallbackAdapter).toBe(true);
    expect(g.calls.requestDevice).toBe(1);
    expect(sel.canvas).toBe(h.first);
    expect(info).not.toHaveBeenCalled();
    sel.renderer.destroy();
  });

  it("given_webgpu_without_navigator_gpu_when_selected_then_WebGPUUnavailableError_without_remount_or_info", async () => {
    const h = harness();
    await expect(selectRenderer("webgpu", h.first, h.opts)).rejects.toBeInstanceOf(WebGPUUnavailableError);
    expect(h.remounts).toHaveLength(0);
    expect(h.first.isConnected).toBe(true); // removing it is the runtime's job
    expect(info).not.toHaveBeenCalled();
  });

  it("given_canvas2d_when_selected_then_navigator_gpu_is_never_probed_and_the_canvas_is_kept", async () => {
    const g = withGpu();
    const h = harness();
    const sel = await selectRenderer("canvas2d", h.first, h.opts);
    expect(sel.active).toBe("canvas2d");
    expect(sel.canvas).toBe(h.first);
    expect(g.calls.requestAdapter).toBe(0);
    expect(h.remounts).toHaveLength(0);
    expect(info).not.toHaveBeenCalled();
    sel.renderer.destroy();
  });

  it("given_webgpu_selected_when_its_device_is_lost_with_reason_unknown_then_onDeviceLost_receives_it_once", async () => {
    const g = withGpu();
    const h = harness();
    const sel = await selectRenderer("webgpu", h.first, h.opts);
    g.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(h.lost).toHaveLength(1));
    expect(h.lost[0]!.reason).toBe("unknown");
    expect(h.lost[0]!.message).toBe("gpu reset");
    expect(warn).not.toHaveBeenCalled(); // the runtime owns the warning, not the renderer
    sel.renderer.destroy();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(h.lost).toHaveLength(1);
  });

  it("given_a_reason_when_fallbackInfo_is_built_then_it_is_the_exact_documented_message", () => {
    expect(FALLBACK_INFO_PREFIX).toBe("[liquiddom] WebGPU is not available");
    expect(fallbackInfo("navigator.gpu is undefined")).toBe(
      "[liquiddom] WebGPU is not available (navigator.gpu is undefined); using the Canvas2D renderer. Pass silentFallback: true to hide this message.",
    );
  });

  // ---- D72-1 / D72-2 as amended at the gate: the presentation-surface check (W71.5 review, Part B) ----

  it("given_auto_and_an_unusable_presentation_surface_when_selected_then_canvas2d_on_a_remounted_canvas_and_one_info_naming_the_surface", async () => {
    // Chromium's headless shell: an adapter, a device and a context, but createView() on the swapchain texture raises.
    const g = withGpu({ context: "invalid-texture" });
    const h = harness();
    const sel = await selectRenderer("auto", h.first, h.opts);
    expect(sel.active).toBe("canvas2d");
    expect(sel.renderer).toBeInstanceOf(FluidCanvas2DRenderer);
    expect(h.remounts).toHaveLength(1);
    expect(sel.canvas).toBe(h.remounts[0]);
    expect(h.first.isConnected).toBe(false);
    expect(h.first.getContext("2d")).toBeNull(); // it handed out a webgpu context: only the remount makes Canvas2D possible
    expect(g.calls.pipelines).toHaveLength(0); // the surface is checked before any pipeline is built
    expect(g.devices[0]!.destroyed).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/presentation surface/);
    expect(warn).not.toHaveBeenCalled();
    expect(h.lost).toHaveLength(0);
    expect(g.calls.errors).toEqual([]);
    sel.renderer.destroy();
  });

  it("given_webgpu_and_an_unusable_presentation_surface_when_selected_then_WebGPUUnavailableError_without_remount_or_info", async () => {
    // D72-2: the same SwiftShader fallback adapter that explicit 'webgpu' accepts; the dead surface still rejects create().
    const g = withGpu({ isFallbackAdapter: true, context: "invalid-texture" });
    const h = harness();
    const err = await selectRenderer("webgpu", h.first, h.opts).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(String((err as Error).message)).toMatch(/presentation surface/);
    expect(g.calls.requestDevice).toBe(1);
    expect(g.calls.pipelines).toHaveLength(0);
    expect(g.devices[0]!.destroyed).toBe(1);
    expect(h.remounts).toHaveLength(0);
    expect(h.first.isConnected).toBe(true); // removing it is the runtime's job
    expect(info).not.toHaveBeenCalled();
    expect(g.calls.errors).toEqual([]);
  });
});
