/**
 * @vitest-environment jsdom
 * W72 (D72-1, D72-2, D72-3, D72-4, D72-6, M2): WebGPURenderer lifecycle on the lifecycle fake —
 * the fallback-adapter gate, the presentation-surface scope, onDeviceLost (only our own
 * destroy() is silent), a loss during init, the test seam, the overdraw estimate, the T0 size
 * seam and the t0Scale floor.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { SIMULATED_LOSS_MESSAGE, T0_SCALE_DEFAULT, T0_SCALE_MIN, WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { WebGPUUnavailableError } from "../src/renderers/webgpu/errors";
import { estimateSplatFragments } from "../src/renderers/webgpu/overdraw";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import {
  DYNAMIC_FIELDS, Dyn, ELEMENT_STRIDE, Interaction, St, STATE_STRIDE, STATIC_FIELDS, Stat,
} from "../src/fluid-layout";
import { installFakeGpuLifecycle, type LifecycleGpu, type LifecycleGpuOptions } from "./_fake-gpu";

const CAP = 700; // 70 × 10 particles on a 2 px lattice inside (100, 100, 140, 48)

let gpu: LifecycleGpu | null = null;
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  gpu?.restore();
  gpu = null;
  vi.restoreAllMocks();
});

function withGpu(o: LifecycleGpuOptions = {}): LifecycleGpu {
  gpu = installFakeGpuLifecycle(o);
  return gpu;
}
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

function paint(): ElementPaint {
  return {
    id: 0,
    background: [47, 111, 222, 1],
    text: [255, 255, 255, 1],
    radiusPx: 24,
    particleCount: CAP,
    areaPerParticle: 4,
    spacingPx: 2,
    atlasRect: null,
  };
}

function makeFrame(restAlpha: number): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  const staticView = new Float32Array(CAP * STATIC_FIELDS);
  const stateView = new Float32Array(4 * STATE_STRIDE);
  const elementView = new Float32Array(4 * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, Interaction.IDLE, 0, 0, NaN, NaN], 0);
  for (let i = 0; i < CAP; i++) {
    dynamicView[Dyn.X * CAP + i] = 101 + 2 * (i % 70);
    dynamicView[Dyn.Y * CAP + i] = 101 + 2 * Math.floor(i / 70);
    dynamicView[Dyn.F00 * CAP + i] = 1;
    dynamicView[Dyn.F11 * CAP + i] = 1;
    staticView[Stat.HOME * CAP + i] = 0;
  }
  stateView[St.S] = 1;
  stateView[St.REST_ALPHA] = restAlpha;
  return {
    dynamicView,
    staticView,
    generation: 1,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: CAP,
    paints: [paint()],
    viewport: { widthCss: 400, heightCss: 300, dpr: 1 },
    reducedMotion: false,
  };
}

async function ready(opts: ConstructorParameters<typeof WebGPURenderer>[0] = {}): Promise<{ r: WebGPURenderer; canvas: HTMLCanvasElement }> {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 300;
  const r = new WebGPURenderer(opts);
  await r.init(canvas);
  r.resize(400, 300, 1);
  return { r, canvas };
}

describe("W72: WebGPURenderer lifecycle (D72-2, D72-3, D72-4)", () => {
  it("given_acceptFallbackAdapter_false_and_a_fallback_adapter_when_init_then_WebGPUUnavailableError_before_requestDevice", async () => {
    const g = withGpu({ isFallbackAdapter: true });
    const r = new WebGPURenderer({ acceptFallbackAdapter: false });
    const err = await r.init(document.createElement("canvas")).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(String((err as Error).message)).toMatch(/fallback/);
    expect(r.isFallbackAdapter).toBe(true);
    expect(g.calls.requestDevice).toBe(0);
    expect(g.calls.getContextWebgpu).toBe(0);
    r.destroy();
  });

  it("given_the_default_options_and_a_fallback_adapter_when_init_then_it_succeeds_and_isFallbackAdapter_is_true", async () => {
    withGpu({ isFallbackAdapter: true });
    const { r } = await ready();
    expect(r.isFallbackAdapter).toBe(true);
    r.destroy();
  });

  it("given_an_initialised_renderer_when_the_device_is_lost_with_reason_unknown_then_onDeviceLost_once_no_warn_and_render_is_a_noop", async () => {
    const g = withGpu();
    const onDeviceLost = vi.fn();
    const { r } = await ready({ onDeviceLost });
    r.render(makeFrame(0.5));
    const submits = g.devices[0]!.submits;
    expect(submits).toBeGreaterThan(0);
    g.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(onDeviceLost).toHaveBeenCalledTimes(1));
    expect(onDeviceLost.mock.calls[0]![0]).toMatchObject({ reason: "unknown", message: "gpu reset" });
    r.render(makeFrame(0.5));
    r.render(makeFrame(0.5));
    expect(g.devices[0]!.submits).toBe(submits);
    expect(r.lastFragmentEstimate).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    r.destroy();
  });

  it("given_an_initialised_renderer_when_the_device_is_lost_externally_with_reason_destroyed_then_onDeviceLost_is_called_once", async () => {
    // W71.0 spike: a crashed GPU process reports reason "destroyed"; only our own destroy() is silent.
    const g = withGpu();
    const onDeviceLost = vi.fn();
    const { r } = await ready({ onDeviceLost });
    g.lose("destroyed", "destroyed elsewhere");
    await flush();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
    expect(onDeviceLost.mock.calls[0]![0]).toMatchObject({ reason: "destroyed" });
    r.destroy();
  });

  it("given_destroy_when_the_loss_resolves_afterwards_then_onDeviceLost_is_not_called_and_destroy_is_idempotent", async () => {
    const g = withGpu();
    const onDeviceLost = vi.fn();
    const { r } = await ready({ onDeviceLost });
    g.lose("unknown", "late reset"); // resolved now, delivered in a microtask
    r.destroy();
    r.destroy();
    await flush();
    expect(onDeviceLost).not.toHaveBeenCalled();
    expect(g.devices[0]!.destroyed).toBe(1);
  });

  it("given_a_device_lost_while_init_is_pending_when_init_resumes_then_WebGPUUnavailableError_and_no_callback", async () => {
    const g = withGpu({ holdInit: true });
    const onDeviceLost = vi.fn();
    const r = new WebGPURenderer({ onDeviceLost });
    const pending = r.init(document.createElement("canvas")).then(() => null, (e: unknown) => e);
    await vi.waitFor(() => expect(g.devices).toHaveLength(1));
    g.lose("unknown", "reset during init");
    g.releaseInit();
    const err = await pending;
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(String((err as Error).message)).toMatch(/lost during init \(unknown: reset during init\)/);
    r.destroy();
    await flush();
    expect(onDeviceLost).not.toHaveBeenCalled();
    expect(g.devices[0]!.destroyed).toBeGreaterThanOrEqual(1);
  });

  it("given_loseDeviceForTest_when_called_then_onDeviceLost_receives_reason_unknown_with_the_simulated_message", async () => {
    const g = withGpu();
    const onDeviceLost = vi.fn();
    const { r } = await ready({ onDeviceLost });
    r.loseDeviceForTest();
    await vi.waitFor(() => expect(onDeviceLost).toHaveBeenCalledTimes(1));
    expect(onDeviceLost.mock.calls[0]![0]).toMatchObject({ reason: "unknown", message: SIMULATED_LOSS_MESSAGE });
    expect(g.devices[0]!.destroyed).toBe(1);
    r.loseDeviceForTest(); // a second call is a no-op
    r.destroy();
    await flush();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("given_a_rendered_frame_when_read_then_lastFragmentEstimate_equals_estimateSplatFragments_at_the_T0_scale", async () => {
    withGpu();
    const { r } = await ready();
    expect(r.lastFragmentEstimate).toBe(0);
    expect(r.t0Size).toEqual([200, 150]); // D72-6 seam: ceil(400 × 0.5) × ceil(300 × 0.5)
    const moving = makeFrame(0.5);
    r.render(moving);
    expect(r.lastFragmentEstimate).toBe(estimateSplatFragments(moving, T0_SCALE_DEFAULT));
    expect(r.lastFragmentEstimate).toBeGreaterThan(0);
    r.render(makeFrame(1));
    expect(r.lastFragmentEstimate).toBe(0);
    const scaled = new WebGPURenderer({ t0Scale: 0.75 });
    expect(scaled.t0Size).toBeNull(); // before init
    await scaled.init(document.createElement("canvas"));
    scaled.resize(400, 300, 1);
    expect(scaled.t0Size).toEqual([300, 225]);
    scaled.render(moving);
    expect(scaled.lastFragmentEstimate).toBe(estimateSplatFragments(moving, 0.75));
    r.destroy();
    scaled.destroy();
    expect(r.t0Size).toBeNull(); // after destroy
  });

  it("given_the_lifecycle_fake_when_the_W71_renderer_inits_resizes_and_renders_then_nothing_throws_and_it_submits", async () => {
    const g = withGpu();
    const { r } = await ready();
    expect(() => {
      r.render(makeFrame(0.5));
      r.resize(800, 600, 2);
      r.render(makeFrame(0.5));
      r.render(makeFrame(1));
    }).not.toThrow();
    expect(g.devices[0]!.submits).toBeGreaterThanOrEqual(3);
    r.destroy();
  });

  // ---- D72-1 / D72-2 as amended at the gate (W71.5 review, Part B) ----

  it("given_a_working_surface_when_init_then_exactly_two_balanced_validation_scopes_the_surface_scope_first_and_no_error", async () => {
    // One extra push/pop pair around configure() + getCurrentTexture().createView(), before W71's pipeline scope.
    const g = withGpu();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { r } = await ready();
    expect(g.calls.log).toEqual([
      "pushErrorScope:validation",
      "popErrorScope",
      "pushErrorScope:validation",
      "createShaderModule",
      "createShaderModule",
      "createShaderModule",
      "createRenderPipeline",
      "createRenderPipeline",
      "createRenderPipeline",
      "popErrorScope",
    ]);
    expect(g.calls.configure).toHaveLength(1);
    expect(g.calls.errors).toEqual([]);
    r.render(makeFrame(0.5));
    expect(g.devices[0]!.submits).toBe(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    r.destroy();
  });

  it("given_an_unusable_presentation_surface_when_init_then_WebGPUUnavailableError_naming_it_before_any_pipeline_and_the_device_is_destroyed", async () => {
    const g = withGpu({ context: "invalid-texture" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDeviceLost = vi.fn();
    const r = new WebGPURenderer({ onDeviceLost });
    const err = await r.init(document.createElement("canvas")).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect(String((err as Error).message)).toMatch(/presentation surface.*Invalid Texture/);
    expect(g.calls.log).toEqual(["pushErrorScope:validation", "popErrorScope"]);
    expect(g.calls.configure).toHaveLength(1);
    expect(g.calls.pipelines).toHaveLength(0);
    expect(g.devices[0]!.destroyed).toBe(1);
    r.destroy();
    await flush();
    expect(onDeviceLost).not.toHaveBeenCalled(); // the 'destroyed' of init's own cleanup is never a loss
    expect(error).not.toHaveBeenCalled();
    expect(g.calls.errors).toEqual([]);
  });

  // ---- W71 ward-review M2: the t0Scale floor ----

  it("given_t0Scale_0_24_when_constructed_then_RangeError_naming_the_range_and_0_25_is_the_smallest_accepted_scale_M2", () => {
    expect(T0_SCALE_MIN).toBe(0.25);
    expect(() => new WebGPURenderer({ t0Scale: 0.24 })).toThrow(RangeError);
    expect(() => new WebGPURenderer({ t0Scale: 0.24 })).toThrow(/\[0\.25, 1\]/);
    expect(new WebGPURenderer({ t0Scale: 0.25 }).t0Scale).toBe(0.25);
    expect(new WebGPURenderer({ t0Scale: 1 }).t0Scale).toBe(1);
  });
});
