/**
 * @vitest-environment jsdom
 * W71: the WebGPU liquid renderer (renderers/webgpu/webgpu-renderer.ts) against the fake GPU
 * (_fake-gpu.ts): init and its errors (kept from W66), three pipelines under one validation
 * error scope (D71-3), T0 sizing (D71-4, Review Focus 1), the empty scene (Review Focus 2),
 * uploads and passes, device loss, GPU errors and destroy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { T0_SCALE_DEFAULT, WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { WebGPUUnavailableError } from "../src/renderers/webgpu/errors";
import { WebGPUUnavailableError as BarrelError } from "../src/index";
import { COMPOSITE_WGSL, REST_WGSL, SPLAT_WGSL } from "../src/renderers/webgpu/shaders";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, St, STATE_STRIDE, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame, Renderer } from "../src/renderers/frame";
import { installNavigatorGpu } from "./_facade-helpers";
import { installFakeGpu, type FakeGpu, type FakeGpuOptions, type FakeWrite } from "./_fake-gpu";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
let fake: FakeGpu | null = null;
let restoreGpu: (() => void) | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
  restoreGpu?.();
  restoreGpu = null;
  vi.restoreAllMocks();
});

function gpu(opts: FakeGpuOptions = {}): FakeGpu {
  fake = installFakeGpu(opts);
  return fake;
}
async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => null, (e: unknown) => e);
}

const CAP = 6;
const BLUE = [47, 111, 222, 1] as const;
const paint = (id: number): ElementPaint => ({
  id, background: BLUE, text: [255, 255, 255, 1], radiusPx: 24, particleCount: CAP, areaPerParticle: 4, spacingPx: 2, atlasRect: null,
});
const PAINTS: ReadonlyArray<ElementPaint | undefined> = [paint(0), undefined];

function sceneFrame(
  o: { generation?: number; paints?: ReadonlyArray<ElementPaint | undefined>; active?: number; restAlpha?: number } = {},
): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  for (let i = 0; i < CAP; i++) {
    dynamicView[Dyn.X * CAP + i] = 110 + 4 * i;
    dynamicView[Dyn.Y * CAP + i] = 120;
  }
  const elementView = new Float32Array(2 * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, 0, 0, 0, Number.NaN, Number.NaN], 0);
  const stateView = new Float32Array(2 * STATE_STRIDE);
  stateView[St.REST_ALPHA] = o.restAlpha ?? 0;
  return {
    dynamicView,
    staticView: new Float32Array(CAP * STATIC_FIELDS), // every home = slot 0
    generation: o.generation ?? 1,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: o.active ?? CAP,
    paints: o.paints ?? PAINTS,
    viewport: { widthCss: 400, heightCss: 300, dpr: 2 },
    reducedMotion: false,
  };
}
const emptyFrame = (): RenderFrame => sceneFrame({ active: 0, paints: [undefined, undefined] });

async function ready(opts: { t0Scale?: number } = {}): Promise<WebGPURenderer> {
  const r = new WebGPURenderer(opts);
  await r.init(document.createElement("canvas"));
  r.resize(800, 600, 2);
  return r;
}
const writesTo = (label: string, writes: readonly FakeWrite[]): FakeWrite[] => writes.filter((w) => w.buffer.label === label);
const t0Textures = (f: FakeGpu) => f.calls.textures.filter((t) => t.format === "rgba16float");
const textureSizes = (f: FakeGpu) => f.calls.textures.map((t) => `${t.format} ${t.width}x${t.height}`);
const ADDITIVE = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };
const OVER = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

describe("W71: WebGPURenderer", () => {
  it("given_webgpu_renderer_when_typed_then_satisfies_Renderer_the_error_lives_in_webgpu_errors_and_the_old_module_is_gone", () => {
    const r: Renderer = new WebGPURenderer();
    for (const m of ["init", "render", "resize", "destroy"] as const) expect(typeof r[m]).toBe("function");
    const cause = new Error("inner");
    const err = new WebGPUUnavailableError("msg", { cause });
    expect(err.name).toBe("WebGPUUnavailableError");
    expect(err.cause).toBe(cause);
    expect(BarrelError).toBe(WebGPUUnavailableError);
    expect(T0_SCALE_DEFAULT).toBe(0.5);
    expect(existsSync(resolve(SRC, "renderers/webgpu-renderer.ts"))).toBe(false);
  });

  it("given_navigator_gpu_missing_when_init_then_WebGPUUnavailableError", async () => {
    restoreGpu = installNavigatorGpu(undefined);
    const err = await errorOf(new WebGPURenderer().init(document.createElement("canvas")));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/navigator\.gpu/);
  });

  it("given_requestAdapter_null_or_throwing_when_init_then_WebGPUUnavailableError_with_cause", async () => {
    gpu({ adapter: "null" });
    expect(await errorOf(new WebGPURenderer().init(document.createElement("canvas")))).toBeInstanceOf(WebGPUUnavailableError);
    fake!.restore();
    const thr = gpu({ adapter: "throws" });
    const err = await errorOf(new WebGPURenderer().init(document.createElement("canvas")));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).cause).toBe(thr.adapterError);
  });

  it("given_requestDevice_rejects_when_init_then_WebGPUUnavailableError_with_cause", async () => {
    const f = gpu({ device: "rejects" });
    const err = await errorOf(new WebGPURenderer().init(document.createElement("canvas")));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).cause).toBe(f.deviceError);
  });

  it("given_getContext_webgpu_null_when_init_then_WebGPUUnavailableError_and_device_destroyed", async () => {
    const f = gpu({ context: "null" });
    const err = await errorOf(new WebGPURenderer().init(document.createElement("canvas")));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/getContext/);
    expect(f.calls.deviceDestroyed).toBe(1);
  });

  it("given_successful_init_when_built_then_three_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3", async () => {
    const f = gpu();
    await new WebGPURenderer().init(document.createElement("canvas"));
    expect(f.calls.configure).toEqual([expect.objectContaining({ format: "bgra8unorm", alphaMode: "premultiplied" })]);
    const log = f.calls.log;
    expect(log[0]).toBe("pushErrorScope:validation");
    expect(log.filter((l) => l.startsWith("pushErrorScope")), "one scope, pushed once and popped once").toHaveLength(1);
    expect(log.lastIndexOf("createRenderPipeline")).toBeLessThan(log.indexOf("popErrorScope"));
    expect(log.filter((l) => l === "popErrorScope")).toHaveLength(1);
    expect(f.calls.shaderModules).toEqual([SPLAT_WGSL, COMPOSITE_WGSL, REST_WGSL]);
    expect(f.calls.pipelines).toHaveLength(3);
    const descs = f.calls.pipelines.map((p) => p.descriptor);
    for (const d of descs) {
      expect(d.layout, "explicit layout").not.toBe("auto");
      expect(d.primitive?.topology).toBe("triangle-list");
      expect(Array.from(d.vertex.buffers ?? [])).toEqual([]);
      for (const t of d.fragment!.targets) expect(String(t!.format)).not.toMatch(/32float/);
    }
    const [splat, composite, rest] = descs;
    expect(splat!.fragment!.targets).toEqual([
      { format: "rgba16float", blend: ADDITIVE },
      { format: "r16float", blend: ADDITIVE },
    ]);
    expect(composite!.fragment!.targets).toEqual([{ format: "bgra8unorm" }]);
    expect(rest!.fragment!.targets).toEqual([{ format: "bgra8unorm", blend: OVER }]);
    const buffers = f.calls.bindGroupLayouts.flatMap((l) => Array.from(l.entries)).filter((e) => e.buffer !== undefined);
    expect(buffers.filter((e) => e.buffer!.type === "uniform")).toHaveLength(3);
    expect(buffers.filter((e) => e.buffer!.type === "read-only-storage")).toHaveLength(4);
    expect(buffers).toHaveLength(7);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_a_validation_error_in_the_scope_when_init_then_rejects_with_a_plain_Error_naming_it_and_destroys_the_device", async () => {
    const f = gpu({ validationError: "bad WGSL at 12:3" });
    const err = await errorOf(new WebGPURenderer().init(document.createElement("canvas")));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/pipeline validation failed: bad WGSL at 12:3/);
    expect(f.calls.deviceDestroyed).toBe(1);
  });

  it("given_a_fallback_adapter_when_init_then_explicit_webgpu_accepts_it_and_isFallbackAdapter_reports_it", async () => {
    gpu({ isFallbackAdapter: true });
    const soft = new WebGPURenderer();
    await soft.init(document.createElement("canvas"));
    expect(soft.isFallbackAdapter).toBe(true);
    expect(soft.lastFragmentEstimate).toBe(0);
    fake!.restore();
    gpu();
    const hard = new WebGPURenderer();
    await hard.init(document.createElement("canvas"));
    expect(hard.isFallbackAdapter).toBe(false);
  });

  it("given_t0Scale_when_constructed_then_default_0_5_accepts_0_75_and_1_and_rejects_out_of_range_with_RangeError_D71_4", () => {
    expect(new WebGPURenderer().t0Scale).toBe(T0_SCALE_DEFAULT);
    expect(new WebGPURenderer({ t0Scale: 0.75 }).t0Scale).toBe(0.75);
    expect(new WebGPURenderer({ t0Scale: 1 }).t0Scale).toBe(1);
    for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new WebGPURenderer({ t0Scale: bad }), String(bad)).toThrow(RangeError);
    }
  });

  it("given_resize_when_the_backing_size_changes_then_T0_and_T0a_are_reallocated_at_ceil_px_times_scale_and_the_old_pair_destroyed", async () => {
    const f = gpu();
    const r = new WebGPURenderer();
    r.resize(640, 480, 1); // before init: remembered
    await r.init(document.createElement("canvas"));
    expect(textureSizes(f)).toEqual(["rgba16float 320x240", "r16float 320x240"]);
    r.render(sceneFrame());
    r.resize(1281, 801, 1);
    expect(textureSizes(f).slice(2)).toEqual(["rgba16float 641x401", "r16float 641x401"]);
    expect(f.calls.textures.slice(0, 2).every((t) => t.destroyed)).toBe(true);
    r.render(sceneFrame()); // the fake flags a pass or bind group that still uses the destroyed pair
    r.resize(1281, 801, 1); // same size: no reallocation
    expect(f.calls.textures).toHaveLength(4);
    // Backing px, not CSS px: 1600×1200 backing at dpr 2 (800×600 CSS) gives T0 800×600 at scale 0.5.
    r.resize(1600, 1200, 2);
    expect(textureSizes(f).slice(4)).toEqual(["rgba16float 800x600", "r16float 800x600"]);
    expect(f.calls.textures.slice(2, 4).every((t) => t.destroyed)).toBe(true);
    r.render(sceneFrame());
    const big = new WebGPURenderer({ t0Scale: 0.75 });
    await big.init(document.createElement("canvas"));
    big.resize(1280, 800, 1);
    expect(t0Textures(f).at(-1)).toMatchObject({ width: 960, height: 600 });
    big.render(sceneFrame());
    expect(f.calls.bindGroups.filter((b) => b.label === "liquiddom composite")).toHaveLength(5);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_a_zero_or_sub_pixel_canvas_when_resized_then_T0_is_clamped_to_1x1_and_no_validation_error_review_focus_1", async () => {
    const f = gpu();
    const r = await ready();
    for (const [w, h, dpr] of [[0, 0, 1], [0.4, 0.2, 1], [Number.NaN, 1, Number.NaN], [-5, 1, 2]] as const) {
      r.resize(w, h, dpr);
      expect(t0Textures(f).at(-1), `${w}x${h}@${dpr}`).toMatchObject({ width: 1, height: 1 });
      r.render(sceneFrame());
    }
    expect(f.calls.errors).toEqual([]);
  });

  it("given_an_empty_scene_when_rendering_then_no_zero_size_buffer_no_splat_or_rest_draw_one_composite_draw_and_no_validation_error_review_focus_2", async () => {
    const f = gpu();
    const r = await ready();
    r.render(emptyFrame());
    expect(f.calls.errors).toEqual([]);
    expect(f.calls.buffers.every((b) => b.size >= 16)).toBe(true);
    // One Element record (64 B) and one particle (8 B) at least: a smaller binding than one array stride is invalid.
    expect(f.calls.buffers.find((b) => b.label === "liquiddom elements")!.size).toBeGreaterThanOrEqual(64);
    expect(f.calls.buffers.find((b) => b.label === "liquiddom particles")!.size).toBeGreaterThanOrEqual(8);
    expect(f.calls.buffers.map((b) => b.label).sort()).toEqual([
      "liquiddom elements", "liquiddom homes", "liquiddom particles", "liquiddom view",
    ]);
    expect(f.calls.passes).toHaveLength(2);
    expect(f.calls.passes[0]!.draws).toEqual([]);
    expect(f.calls.passes[1]!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1]]);
    expect(writesTo("liquiddom particles", f.calls.writes)).toEqual([]);
    expect(writesTo("liquiddom elements", f.calls.writes)).toEqual([]);
    expect(f.calls.submits).toBe(1);
  });

  it("given_a_scene_when_rendering_frames_then_particles_and_elements_upload_every_frame_and_homes_only_on_a_generation_or_paints_change", async () => {
    const f = gpu();
    const r = await ready();
    const count = (label: string) => writesTo(label, f.calls.writes).length;
    const counts = () => [count("liquiddom particles"), count("liquiddom elements"), count("liquiddom homes")];
    r.render(sceneFrame({ generation: 1 }));
    expect(counts()).toEqual([1, 1, 1]);
    r.render(sceneFrame({ generation: 1 }));
    expect(counts()).toEqual([2, 2, 1]);
    r.render(sceneFrame({ generation: 2 }));
    expect(count("liquiddom homes")).toBe(2);
    r.render(sceneFrame({ generation: 2, paints: [paint(0), undefined] })); // refresh(el): new paints, same generation
    expect(count("liquiddom homes")).toBe(3);
    const [p] = writesTo("liquiddom particles", f.calls.writes);
    expect(p!.bytes).toBe(CAP * 8);
    expect(p!.values.slice(0, 4)).toEqual([110, 120, 114, 120]);
    expect(writesTo("liquiddom homes", f.calls.writes)[0]!.values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(writesTo("liquiddom elements", f.calls.writes)[0]!.bytes).toBe(64); // one drawable slot
    expect(f.calls.errors).toEqual([]);
  });

  it("given_the_particle_count_changes_without_a_generation_or_paints_change_when_rendering_then_the_homes_are_uploaded_again", async () => {
    const f = gpu();
    const r = await ready();
    const homes = () => writesTo("liquiddom homes", f.calls.writes);
    r.render(sceneFrame({ generation: 2, paints: PAINTS }));
    r.render(sceneFrame({ generation: 2, paints: PAINTS }));
    expect(homes()).toHaveLength(1);
    r.render(sceneFrame({ generation: 2, paints: PAINTS, active: 4 }));
    expect(homes()).toHaveLength(2);
    expect(homes()[1]!.values).toEqual([0, 0, 0, 0]);
    r.render(sceneFrame({ generation: 2, paints: PAINTS, active: 4 }));
    expect(homes()).toHaveLength(2);
    r.render(sceneFrame({ generation: 2, paints: PAINTS }));
    expect(homes()).toHaveLength(3);
    expect(homes()[2]!.values).toHaveLength(CAP);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_a_moving_scene_when_rendering_then_the_splat_pass_clears_T0_and_T0a_and_draws_6_vertices_per_particle_and_the_screen_pass_composites_then_draws_the_rest_quads", async () => {
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame());
    const [splat, screen] = f.calls.passes;
    expect(splat!.attachments.map((a) => [a.view.texture.format, a.loadOp, a.storeOp])).toEqual([
      ["rgba16float", "clear", "store"],
      ["r16float", "clear", "store"],
    ]);
    for (const a of [...splat!.attachments, ...screen!.attachments]) expect(a.clearValue).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(splat!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[6, CAP]]);
    expect(screen!.attachments.map((a) => [a.view.texture.format, a.loadOp])).toEqual([["bgra8unorm", "clear"]]);
    expect(screen!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1], [6, 1]]);
    const [splatPipe, compositePipe, restPipe] = f.calls.pipelines;
    expect(splat!.draws[0]!.pipeline).toBe(splatPipe);
    expect(screen!.draws[0]!.pipeline).toBe(compositePipe);
    expect(screen!.draws[1]!.pipeline).toBe(restPipe);
    expect(writesTo("liquiddom view", f.calls.writes).at(-1)!.values).toEqual([400, 300, 800, 600, 2, 0.5, 0, 0]);
    expect(splat!.ended && screen!.ended).toBe(true);
    expect(f.calls.submits).toBe(1);
  });

  it("given_device_lost_with_reason_unknown_when_rendering_then_one_console_warn_and_render_is_a_noop_and_our_own_destroy_is_silent_but_an_external_destroyed_loss_warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = gpu();
    const r = await ready();
    f.loseDevice("gpu reset");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]![0])).toMatch(/device lost.*gpu reset/);
    r.render(sceneFrame());
    r.render(sceneFrame());
    expect(f.calls.passes).toHaveLength(0);
    const other = await ready();
    other.destroy(); // resolves that device's `lost` with reason "destroyed"
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    // W71.0 finding: on the CI runner Chromium itself lost devices with reason "destroyed". Only our own
    // destroy() is silent (device identity, not the reason); an external "destroyed" loss is a real loss.
    const ext = await ready();
    f.loseDevice("external: Device was destroyed.", "destroyed");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(String(warn.mock.calls[1]![0])).toMatch(/device lost.*external: Device was destroyed\./);
    const passes = f.calls.passes.length;
    ext.render(sceneFrame());
    expect(f.calls.passes).toHaveLength(passes);
  });

  it("given_uncaptured_gpu_errors_when_they_fire_then_exactly_one_console_error_names_the_first", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = gpu();
    await ready();
    f.fireUncapturedError("binding 3 too small");
    f.fireUncapturedError("second");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toMatch(/WebGPU error: binding 3 too small/);
  });

  it("given_destroy_when_called_before_init_after_failure_and_twice_then_no_throw_and_every_gpu_object_is_released_once", async () => {
    expect(() => new WebGPURenderer().destroy()).not.toThrow();
    restoreGpu = installNavigatorGpu(undefined);
    const failed = new WebGPURenderer();
    await errorOf(failed.init(document.createElement("canvas")));
    expect(() => {
      failed.destroy();
      failed.destroy();
    }).not.toThrow();
    restoreGpu();
    restoreGpu = null;
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame());
    r.destroy();
    r.destroy();
    expect(f.calls.deviceDestroyed).toBe(1);
    expect(f.calls.buffers.every((b) => b.destroyed)).toBe(true);
    expect(f.calls.textures.every((t) => t.destroyed)).toBe(true);
    const passes = f.calls.passes.length;
    r.render(sceneFrame());
    expect(f.calls.passes).toHaveLength(passes);
  });
});
