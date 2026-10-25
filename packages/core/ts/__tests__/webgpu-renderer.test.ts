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
import { T0_SCALE_DEFAULT, WebGPURenderer, type WebGPURendererOptions } from "../src/renderers/webgpu/webgpu-renderer";
import { WebGPUUnavailableError } from "../src/renderers/webgpu/errors";
import { WebGPUUnavailableError as BarrelError } from "../src/index";
import { COMPOSITE_WGSL, REST_WGSL, SPLAT_WGSL, TEXT_COMPOSITE_WGSL, TEXT_WGSL } from "../src/renderers/webgpu/shaders";
import {
  SHADOW_BLUR_WGSL, SHADOW_COMPOSITE_WGSL, SHADOW_DENSITY_WGSL, SHADOW_KNOCKOUT_WGSL, SHADOW_RESOLVE_WGSL,
} from "../src/renderers/webgpu/shaders";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, St, STATE_STRIDE, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame, Renderer, TextAtlasFrame } from "../src/renderers/frame";
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
/** W74: a 320 × 136 atlas at dpr 2 holding slot 0's 140 × 48 box at (20, 20). */
const ATLAS: TextAtlasFrame = {
  canvas: { width: 320, height: 136 } as unknown as OffscreenCanvas,
  width: 320,
  height: 136,
  dpr: 2,
  version: 1,
};
const textPaint = (id: number): ElementPaint => ({ ...paint(id), atlasRect: { x: 20, y: 20, w: 280, h: 96 } });
const TEXT_PAINTS: ReadonlyArray<ElementPaint | undefined> = [textPaint(0), undefined];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const expectClose = (actual: number[], expected: number[]): void =>
  expected.forEach((v, i) => expect(actual[i], `float ${i}`).toBeCloseTo(v, 5));
const t1Textures = (f: FakeGpu) => f.calls.textures.filter((t) => t.label === "liquiddom T1" || t.label === "liquiddom T1w");

function sceneFrame(
  o: {
    generation?: number;
    paints?: ReadonlyArray<ElementPaint | undefined>;
    active?: number;
    restAlpha?: number;
    textAtlas?: TextAtlasFrame | null;
    restU?: number;
  } = {},
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
  const staticView = new Float32Array(CAP * STATIC_FIELDS); // every home = slot 0
  if (o.restU !== undefined) staticView.fill(o.restU, Stat.REST_U * CAP, (Stat.REST_U + 1) * CAP);
  return {
    dynamicView,
    staticView,
    generation: o.generation ?? 1,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: o.active ?? CAP,
    paints: o.paints ?? PAINTS,
    viewport: { widthCss: 400, heightCss: 300, dpr: 2 },
    reducedMotion: false,
    textAtlas: o.textAtlas ?? null,
  };
}
const emptyFrame = (): RenderFrame => sceneFrame({ active: 0, paints: [undefined, undefined] });

async function ready(opts: WebGPURendererOptions = {}): Promise<WebGPURenderer> {
  const r = new WebGPURenderer(opts);
  await r.init(document.createElement("canvas"));
  r.resize(800, 600, 2);
  return r;
}
const writesTo = (label: string, writes: readonly FakeWrite[]): FakeWrite[] => writes.filter((w) => w.buffer.label === label);
const t0Textures = (f: FakeGpu) => f.calls.textures.filter((t) => t.format === "rgba16float");
const textureSizes = (f: FakeGpu) => f.calls.textures.map((t) => `${t.format} ${t.width}x${t.height}`);
const ADDITIVE = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };
/** W79 (D79-1): min blending, both factors "one" (WebGPU requires them for min/max). */
const MIN = { color: { srcFactor: "one", dstFactor: "one", operation: "min" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "min" } };
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

  // W74 red: approved-test change (D74-4: the text and text-composite pipelines are built at init)
  it("given_successful_init_when_built_then_eleven_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3_D74_4_D88_11", async () => {
    const f = gpu();
    await new WebGPURenderer().init(document.createElement("canvas"));
    expect(f.calls.configure).toEqual([expect.objectContaining({ format: "bgra8unorm", alphaMode: "premultiplied" })]);
    const log = f.calls.log;
    expect(log[0]).toBe("pushErrorScope:validation");
    // W72 red: approved-test change (Dennis approves at W72 red)
    // W72 (D72-1/D72-2, approved-test change): the surface scope comes first, then the pipeline scope.
    expect(log.filter((l) => l.startsWith("pushErrorScope")), "two scopes: surface, then pipelines").toHaveLength(2);
    expect(log.lastIndexOf("createRenderPipeline")).toBeLessThan(log.lastIndexOf("popErrorScope"));
    expect(log.filter((l) => l === "popErrorScope")).toHaveLength(2);
    // W88 red: approved-test change (D88-11, saga dec_0dba6795): the five shadow shaders and six shadow
    // pipelines are built at init in the same validation scope, after the liquid's.
    expect(f.calls.shaderModules).toEqual([
      SPLAT_WGSL, COMPOSITE_WGSL, REST_WGSL, TEXT_WGSL, TEXT_COMPOSITE_WGSL,
      SHADOW_DENSITY_WGSL, SHADOW_RESOLVE_WGSL, SHADOW_BLUR_WGSL, SHADOW_KNOCKOUT_WGSL, SHADOW_COMPOSITE_WGSL,
    ]);
    expect(f.calls.pipelines).toHaveLength(11);
    const descs = f.calls.pipelines.map((p) => p.descriptor);
    for (const d of descs) {
      expect(d.layout, "explicit layout").not.toBe("auto");
      expect(d.primitive?.topology).toBe("triangle-list");
      expect(Array.from(d.vertex.buffers ?? [])).toEqual([]);
      for (const t of d.fragment!.targets) expect(String(t!.format)).not.toMatch(/32float/);
    }
    const [splat, composite, rest, text, textComposite] = descs;
    expect(splat!.fragment!.targets).toEqual([
      { format: "rgba16float", blend: ADDITIVE },
      { format: "r16float", blend: ADDITIVE },
    ]);
    // W88 red: approved-test change (D88-13, saga dec_793867f6): the liquid composite blends over, so the
    // shadows drawn first in the screen pass survive (it had no blend and replaced the target).
    expect(composite!.fragment!.targets).toEqual([{ format: "bgra8unorm", blend: OVER }]);
    expect(rest!.fragment!.targets).toEqual([{ format: "bgra8unorm", blend: OVER }]);
    // W79 red: approved-test change (D79-1, see ward-079.md): the text pass gains the rg16float id target with min blending.
    expect(text!.fragment!.targets).toEqual([
      { format: "rgba16float", blend: ADDITIVE },
      { format: "r16float", blend: ADDITIVE },
      { format: "rg16float", blend: MIN },
    ]);
    expect(textComposite!.fragment!.targets).toEqual([{ format: "bgra8unorm", blend: OVER }]);
    const buffers = f.calls.bindGroupLayouts.flatMap((l) => Array.from(l.entries)).filter((e) => e.buffer !== undefined);
    // W88 red: approved-test change (D88-11): the shadow layouts add 7 uniform (4 with a dynamic offset) and 3 storage bindings.
    expect(buffers.filter((e) => e.buffer!.type === "uniform")).toHaveLength(12);
    expect(buffers.filter((e) => e.buffer!.hasDynamicOffset === true)).toHaveLength(4);
    expect(buffers.filter((e) => e.buffer!.type === "read-only-storage")).toHaveLength(12);
    expect(buffers).toHaveLength(24);
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

  // W74 red: approved-test change (D74-4: rest-UV and text-info buffers; a particle is 32 B)
  it("given_an_empty_scene_when_rendering_then_no_zero_size_buffer_no_splat_or_rest_draw_one_composite_draw_and_no_validation_error_review_focus_2", async () => {
    const f = gpu();
    const r = await ready();
    r.render(emptyFrame());
    expect(f.calls.errors).toEqual([]);
    expect(f.calls.buffers.every((b) => b.size >= 16)).toBe(true);
    // One Element record (64 B), one particle (32 B) and one text record (32 B) at least: a smaller
    // binding than one array stride is invalid.
    expect(f.calls.buffers.find((b) => b.label === "liquiddom elements")!.size).toBeGreaterThanOrEqual(64);
    expect(f.calls.buffers.find((b) => b.label === "liquiddom particles")!.size).toBeGreaterThanOrEqual(32);
    expect(f.calls.buffers.find((b) => b.label === "liquiddom text info")!.size).toBeGreaterThanOrEqual(32);
    expect(f.calls.buffers.map((b) => b.label).sort()).toEqual([
      "liquiddom elements", "liquiddom homes", "liquiddom particles", "liquiddom rest uv", "liquiddom text info", "liquiddom view",
    ]);
    expect(f.calls.passes).toHaveLength(2);
    expect(f.calls.passes[0]!.draws).toEqual([]);
    expect(f.calls.passes[1]!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1]]);
    expect(writesTo("liquiddom particles", f.calls.writes)).toEqual([]);
    expect(writesTo("liquiddom elements", f.calls.writes)).toEqual([]);
    expect(f.calls.submits).toBe(1);
  });

  // W74 red: approved-test change (D74-4: 8 floats per particle)
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
    expect(p!.bytes).toBe(CAP * 32);
    expect(p!.values.slice(0, 10)).toEqual([110, 120, 0, 0, 0, 0, 0, 0, 114, 120]);
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

  // W72 red: approved-test change (Dennis approves at W72 red)
  it("given_device_lost_with_reason_unknown_when_rendering_then_onDeviceLost_once_render_is_a_noop_our_own_destroy_is_silent_an_external_destroyed_loss_is_reported_and_nothing_is_warned_W72", async () => {
    // W72 (D72-3, approved-test change): the renderer reports a loss through onDeviceLost; the runtime owns the one console.warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = gpu();
    const lost = vi.fn();
    const r = await ready({ onDeviceLost: lost });
    f.loseDevice("gpu reset");
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    expect(lost.mock.calls[0]![0]).toMatchObject({ reason: "unknown", message: "gpu reset" });
    r.render(sceneFrame());
    r.render(sceneFrame());
    expect(f.calls.passes).toHaveLength(0);
    const otherLost = vi.fn();
    const other = await ready({ onDeviceLost: otherLost });
    other.destroy(); // resolves that device's `lost` with reason "destroyed": our own, never reported
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(otherLost).not.toHaveBeenCalled();
    // W71.0 finding: on the CI runner Chromium itself lost devices with reason "destroyed". Only our own
    // destroy() is silent (device identity, not the reason); an external "destroyed" loss is a real loss.
    const extLost = vi.fn();
    const ext = await ready({ onDeviceLost: extLost });
    f.loseDevice("external: Device was destroyed.", "destroyed");
    await vi.waitFor(() => expect(extLost).toHaveBeenCalledTimes(1));
    expect(extLost.mock.calls[0]![0]).toMatchObject({ reason: "destroyed", message: "external: Device was destroyed." });
    const passes = f.calls.passes.length;
    ext.render(sceneFrame());
    expect(f.calls.passes).toHaveLength(passes);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
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

  // W71.4 review fix (Minor 1): a record that stops being drawable is cleared on the GPU, whatever its slot.
  it("given_the_highest_drawable_slot_becomes_inactive_or_unpainted_without_a_generation_bump_when_rendering_then_its_record_is_uploaded_with_flags_0", async () => {
    const f = gpu();
    const r = await ready();
    const two: ReadonlyArray<ElementPaint | undefined> = [paint(0), paint(1)];
    const withSlot1 = (o: { w?: number; paints?: ReadonlyArray<ElementPaint | undefined> } = {}): RenderFrame => {
      const fr = sceneFrame({ generation: 3, paints: o.paints ?? two });
      fr.elementView.set([300, 100, 60, 40, 8, 0, 0, 0, Number.NaN, Number.NaN], ELEMENT_STRIDE);
      fr.elementView[ELEMENT_STRIDE + 2] = o.w ?? 60;
      for (let i = 3; i < CAP; i++) fr.staticView[i] = 1; // particles 3.. live in slot 1
      return fr;
    };
    const lastElements = () => writesTo("liquiddom elements", f.calls.writes).at(-1)!;
    const flagsOf = (w: FakeWrite, slot: number) => w.values[slot * 16 + 12];
    r.render(withSlot1());
    expect(lastElements().bytes).toBe(128);
    expect(flagsOf(lastElements(), 1)).toBe(1);
    // display:none: w = 0, same generation and paints, so the homes on the GPU still point at slot 1.
    r.render(withSlot1({ w: 0 }));
    expect(writesTo("liquiddom homes", f.calls.writes)).toHaveLength(1);
    expect(lastElements().bytes).toBe(128);
    expect(lastElements().values.slice(16)).toEqual(new Array(16).fill(0));
    // Drawn again, then its paint removed (a shorter paints array) without a generation bump.
    r.render(withSlot1());
    expect(flagsOf(lastElements(), 1)).toBe(1);
    r.render(withSlot1({ paints: [paint(0)] }));
    expect(lastElements().bytes).toBe(128);
    expect(lastElements().values.slice(16)).toEqual(new Array(16).fill(0));
    expect(f.calls.passes.at(-1)!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1], [6, 1]]);
    // Once cleared, the record is not uploaded again.
    r.render(withSlot1({ paints: [paint(0)] }));
    expect(lastElements().bytes).toBe(64);
    expect(f.calls.errors).toEqual([]);
  });

  // W71 ward-review I1: a homes upload while a slot is hidden (w = 0) must keep that slot's home, so the
  // liquid splats again when it reappears mid re-form; the hidden slot is kept out of the draw by flags 0.
  it("given_a_homes_upload_while_slot_1_is_hidden_when_it_reappears_with_rest_alpha_below_1_then_its_particles_carry_home_1_and_its_record_is_drawable", async () => {
    const f = gpu();
    const r = await ready();
    const withSlot1 = (o: { w: number; paints: ReadonlyArray<ElementPaint | undefined> }): RenderFrame => {
      const fr = sceneFrame({ generation: 3, paints: o.paints, restAlpha: 0.4 });
      fr.elementView.set([300, 100, 60, 40, 8, 0, 0, 0, Number.NaN, Number.NaN], ELEMENT_STRIDE);
      fr.elementView[ELEMENT_STRIDE + 2] = o.w;
      fr.stateView[STATE_STRIDE + St.REST_ALPHA] = 0.4;
      for (let i = 3; i < CAP; i++) fr.staticView[i] = 1; // particles 3.. live in slot 1
      return fr;
    };
    const homes = () => writesTo("liquiddom homes", f.calls.writes);
    const lastElements = () => writesTo("liquiddom elements", f.calls.writes).at(-1)!;
    const flagsOf = (w: FakeWrite, slot: number) => w.values[slot * 16 + 12];
    const before: ReadonlyArray<ElementPaint | undefined> = [paint(0), paint(1)];
    const refreshed: ReadonlyArray<ElementPaint | undefined> = [paint(0), paint(1)]; // refresh(A): new identity
    r.render(withSlot1({ w: 60, paints: before }));
    expect(homes()).toHaveLength(1);
    expect(homes().at(-1)!.values).toEqual([0, 0, 0, 1, 1, 1]);
    // Slot 1 hidden (display:none), then a refresh() elsewhere: the new paints identity forces a homes upload.
    r.render(withSlot1({ w: 0, paints: refreshed }));
    expect(homes()).toHaveLength(2);
    expect(homes().at(-1)!.values).toEqual([0, 0, 0, 1, 1, 1]);
    // While hidden, its record has flags 0, so the splat VS drops its particles.
    expect(lastElements().values.slice(16)).toEqual(new Array(16).fill(0));
    // Shown again: same generation, paints identity and count, so no new homes upload; the GPU homes name slot 1.
    r.render(withSlot1({ w: 60, paints: refreshed }));
    expect(homes()).toHaveLength(2);
    expect(homes().at(-1)!.values).toEqual([0, 0, 0, 1, 1, 1]);
    expect(flagsOf(lastElements(), 1)).toBe(1);
    expect(lastElements().values[16 + 5]).toBeCloseTo(0.4, 5); // restAlpha < 1: the splat carries the liquid
    expect(f.calls.errors).toEqual([]);
  });

  // W71.4 review fix (Minor 4): the device gets the adapter's texture limit and T0 never exceeds it.
  it("given_an_adapter_texture_limit_of_4096_when_resized_beyond_it_then_the_device_requests_the_limit_and_T0_is_clamped_without_error", async () => {
    const f = gpu({ maxTextureDimension2D: 4096 });
    const r = new WebGPURenderer({ t0Scale: 1 });
    await r.init(document.createElement("canvas"));
    r.resize(10000, 3000, 1);
    expect(f.calls.deviceDescriptors.at(-1)?.requiredLimits).toEqual({ maxTextureDimension2D: 4096 });
    for (const t of f.calls.textures) {
      expect(t.width).toBeLessThanOrEqual(4096);
      expect(t.height).toBeLessThanOrEqual(4096);
    }
    expect(t0Textures(f).at(-1)!.width).toBe(4096);
    expect(t0Textures(f).at(-1)!.height).toBe(3000);
    expect(f.calls.errors).toEqual([]);
  });

  // W71.4 review fix (Minor 5): after a loss, uncaptured errors are not reported.
  it("given_an_external_device_loss_when_an_uncaptured_error_fires_afterwards_then_no_console_error", async () => {
    // W72 red: approved-test change (Dennis approves at W72 red)
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = gpu();
    const lost = vi.fn();
    await ready({ onDeviceLost: lost });
    f.loseDevice("gpu reset");
    // W72 (D72-3, approved-test change): the loss is reported through onDeviceLost, not warned.
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    f.fireUncapturedError("after the loss");
    expect(error).not.toHaveBeenCalled();
  });

  it("given_a_text_atlas_and_a_moving_element_with_an_atlas_rect_when_rendering_then_the_atlas_is_uploaded_once_per_version_the_1x_text_pass_writes_T1_and_T1w_and_the_text_composite_follows_the_rest_quads_d74_4", async () => {
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.passes, "W74 review: no text pass until the upload's error scope resolves").toHaveLength(2);
    await flush();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.errors).toEqual([]);
    expect(f.calls.externalCopies).toHaveLength(1);
    const copy = f.calls.externalCopies[0]!;
    expect(copy.source).toBe(ATLAS.canvas);
    expect([copy.texture.label, copy.texture.format, copy.texture.width, copy.texture.height]).toEqual(["liquiddom atlas", "rgba8unorm", 320, 136]);
    expect([copy.width, copy.height, copy.premultipliedAlpha]).toEqual([320, 136, true]);
    expect(f.calls.passes).toHaveLength(5);
    const [splat, text, screen] = f.calls.passes.slice(2);
    expect(splat!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[6, CAP]]);
    // W79 red: approved-test change (D79-1, see ward-079.md): the text pass also clears the id target to the empty id 4096.
    expect(text!.attachments.map((a) => [a.view.texture.label, a.view.texture.format, a.view.texture.width, a.view.texture.height, a.loadOp])).toEqual([
      ["liquiddom T1", "rgba16float", 800, 600, "clear"],
      ["liquiddom T1w", "r16float", 800, 600, "clear"],
      ["liquiddom T1id", "rg16float", 800, 600, "clear"],
    ]);
    expect(text!.attachments[2]!.clearValue).toEqual({ r: 4096, g: 4096, b: 0, a: 0 });
    const [, , , textPipe, textCompositePipe] = f.calls.pipelines;
    expect(text!.draws.map((d) => [d.pipeline, d.vertexCount, d.instanceCount])).toEqual([[textPipe, 6, CAP]]);
    expect(screen!.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1], [6, 1], [3, 1]]);
    expect(screen!.draws[2]!.pipeline, "text composite after the rest SDF").toBe(textCompositePipe);
    const info = writesTo("liquiddom text info", f.calls.writes);
    expect(info).toHaveLength(1);
    expectClose(info[0]!.values.slice(0, 8), [20 / 320, 20 / 136, 280 / 320, 96 / 136, 140, 48, 1, 0]);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.externalCopies, "same version: no re-upload").toHaveLength(1);
    expect(writesTo("liquiddom text info", f.calls.writes)).toHaveLength(1);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: { ...ATLAS, version: 2 }, restAlpha: 0.5 }));
    expect(f.calls.externalCopies).toHaveLength(2);
    expect(f.calls.textures.filter((t) => t.label === "liquiddom atlas"), "same size: the texture is reused").toHaveLength(1);
    expect(writesTo("liquiddom text info", f.calls.writes)).toHaveLength(2);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_every_text_element_at_rest_or_no_atlas_rect_when_rendering_then_no_text_pass_and_no_text_composite", async () => {
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 1 })); // at rest: the DOM text shows
    r.render(sceneFrame({ paints: PAINTS, textAtlas: ATLAS, restAlpha: 0.5 })); // moving, but no atlas rect
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: null, restAlpha: 0.5 })); // no atlas at all
    expect(f.calls.passes).toHaveLength(6);
    expect(t1Textures(f)).toHaveLength(0);
    for (const screen of f.calls.passes.filter((_, i) => i % 2 === 1)) {
      expect(screen.draws.map((d) => [d.vertexCount, d.instanceCount])).toEqual([[3, 1], [6, 1]]);
    }
    expect(f.calls.textures.find((t) => t.label === "liquiddom atlas")!.destroyed, "a dropped atlas frees its texture").toBe(true);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_textReady_when_queried_then_true_only_for_slots_with_a_valid_uploaded_atlas_rect_and_false_after_a_device_loss_or_destroy", async () => {
    const f = gpu();
    const r = await ready();
    expect(r.textReady(0), "before the first frame").toBe(false);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush(); // W74 review: ready once the upload's error scope resolves
    expect([r.textReady(0), r.textReady(1), r.textReady(99), r.textReady(-1), r.textReady(0.5)]).toEqual([true, false, false, false, false]);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 1 }));
    expect(r.textReady(0), "readiness does not depend on restAlpha (the toggle checks that)").toBe(true);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: null, restAlpha: 0.5 }));
    expect(r.textReady(0), "no atlas").toBe(false);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: { ...ATLAS, version: 5 }, restAlpha: 0.5 }));
    expect(r.textReady(0), "a new version is pending").toBe(false);
    await flush();
    expect(r.textReady(0)).toBe(true);
    f.loseDevice("gone");
    await flush();
    expect(r.textReady(0), "after a device loss").toBe(false);
    const r2 = await ready();
    r2.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush();
    expect(r2.textReady(0)).toBe(true);
    r2.destroy();
    expect(r2.textReady(0), "after destroy").toBe(false);
  });

  it("given_an_atlas_beyond_maxTextureDimension2D_or_a_failing_copy_when_rendering_then_no_text_textReady_false_and_no_validation_error_review_focus_4", async () => {
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: { ...ATLAS, width: 9000, version: 3 }, restAlpha: 0.5 }));
    expect(f.calls.externalCopies).toHaveLength(0);
    expect(f.calls.textures.filter((t) => t.label === "liquiddom atlas")).toHaveLength(0);
    expect(f.calls.passes).toHaveLength(2);
    expect(r.textReady(0)).toBe(false);
    expect(f.calls.errors).toEqual([]);
    fake!.restore();
    const g = gpu({ copyExternalError: new Error("detached source") });
    const r2 = await ready();
    r2.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(g.calls.passes).toHaveLength(2);
    expect(r2.textReady(0)).toBe(false);
    expect(g.calls.errors).toEqual([]);
  });

  it("given_version_n_uploaded_when_the_copy_for_version_n_plus_1_fails_then_textReady_drops_and_the_stale_atlas_is_not_drawn_review_focus_4", async () => {
    const opts: FakeGpuOptions = {};
    const f = gpu(opts); // the fake reads opts.copyExternalError at call time
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush(); // W74 review: confirmed by the error scope
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.externalCopies).toHaveLength(1);
    expect(r.textReady(0), "version 1 uploaded").toBe(true);
    expect(f.calls.passes).toHaveLength(5);
    opts.copyExternalError = new Error("detached source");
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: { ...ATLAS, version: 2 }, restAlpha: 0.5 }));
    expect(r.textReady(0), "the texture still holds version 1: not ready for version 2").toBe(false);
    expect(f.calls.passes, "no text pass with the stale atlas").toHaveLength(7);
    expect(f.calls.passes[6]!.draws.map((d) => [d.vertexCount, d.instanceCount]), "no text composite").toEqual([[3, 1], [6, 1]]);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 review
  it("given_an_atlas_copy_that_raises_a_device_timeline_validation_error_when_rendering_then_textReady_stays_false_and_one_warn_review_focus_1", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const f = gpu({ copyExternalValidationError: "copyExternalImageToTexture: source is unusable (fake)" });
      const r = await ready();
      r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
      expect(f.calls.externalCopies).toHaveLength(1);
      expect(r.textReady(0), "not ready before the error scope resolves").toBe(false);
      await flush();
      expect(r.textReady(0), "the scope reported an error: the version stays not ready").toBe(false);
      r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
      expect(f.calls.externalCopies, "the same version is not retried").toHaveLength(1);
      expect(r.textReady(0)).toBe(false);
      expect(f.calls.passes.slice(-1)[0]!.draws.map((d) => [d.vertexCount, d.instanceCount]), "no text composite").toEqual([[3, 1], [6, 1]]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(f.calls.errors).toEqual([]);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // W74 review
  it("given_an_atlas_copy_without_a_validation_error_when_the_error_scope_resolves_then_textReady_turns_true_review_focus_1", async () => {
    const f = gpu();
    const r = await ready();
    const before = f.calls.log.length;
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.log.slice(before), "the copy runs inside its own validation scope").toEqual(["pushErrorScope:validation", "popErrorScope"]);
    expect(r.textReady(0), "pending until popErrorScope resolves").toBe(false);
    await flush();
    expect(r.textReady(0)).toBe(true);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.passes.slice(-1)[0]!.draws.length, "text composite drawn once confirmed").toBe(3);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 review
  it("given_version_1_pending_when_version_2_arrives_before_the_scope_resolves_then_only_version_2_becomes_ready_review_focus_1", async () => {
    const f = gpu();
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: { ...ATLAS, version: 2 }, restAlpha: 0.5 }));
    expect(f.calls.externalCopies).toHaveLength(2);
    await flush();
    expect(r.textReady(0)).toBe(true);
    r.destroy();
    expect(r.textReady(0)).toBe(false);
  });

  it("given_text_drawn_when_resized_then_T1_and_T1w_follow_the_backing_size_at_1x_clamped_to_the_device_limit", async () => {
    const f = gpu({ maxTextureDimension2D: 4096 });
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush(); // W74 review: the atlas is confirmed by its error scope
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(t1Textures(f).map((t) => `${t.label} ${t.width}x${t.height}`)).toEqual(["liquiddom T1 800x600", "liquiddom T1w 800x600"]);
    r.resize(1001, 703, 2);
    expect(t1Textures(f)).toHaveLength(4);
    expect(t1Textures(f).slice(0, 2).every((t) => t.destroyed)).toBe(true);
    expect(t1Textures(f).slice(2).map((t) => `${t.width}x${t.height}`)).toEqual(["1001x703", "1001x703"]);
    r.resize(5000, 300, 2);
    expect(t1Textures(f).slice(4).map((t) => `${t.width}x${t.height}`)).toEqual(["4096x300", "4096x300"]);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.errors).toEqual([]);
  });

  it("given_rest_uv_when_rendering_then_it_is_uploaded_with_the_homes_only_on_a_generation_paints_or_count_change", async () => {
    const f = gpu();
    const r = await ready();
    const uv = () => writesTo("liquiddom rest uv", f.calls.writes);
    r.render(sceneFrame({ generation: 1, restU: 0.25 }));
    r.render(sceneFrame({ generation: 1, restU: 0.25 }));
    expect(uv()).toHaveLength(1);
    expect(uv()[0]!.bytes).toBe(CAP * 8);
    expect(uv()[0]!.values.slice(0, 4)).toEqual([0.25, 0, 0.25, 0]);
    r.render(sceneFrame({ generation: 2, restU: 0.25 }));
    expect(uv()).toHaveLength(2);
    r.render(sceneFrame({ generation: 2, restU: 0.25, active: 4 }));
    expect(uv()).toHaveLength(3);
    expect(uv()[2]!.bytes).toBe(4 * 8);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 review: the runtime caps the atlas page at min(ATLAS_MAX_SIZE_PX, maxTextureDimension), so it reads the device limit.
  it("given_a_device_limit_when_initialised_then_maxTextureDimension_reports_it_and_falls_back_to_8192_after_destroy", async () => {
    gpu({ maxTextureDimension2D: 2048 });
    const r = new WebGPURenderer();
    expect(r.maxTextureDimension, "before init: the WebGPU default").toBe(8192);
    await r.init(document.createElement("canvas"));
    expect(r.maxTextureDimension).toBe(2048);
    r.destroy();
    expect(r.maxTextureDimension).toBe(8192);
  });
});

// W74 ward-review (I1): a new atlas version is uploaded into a staging texture while the confirmed
// page keeps drawing; the swap (texture copy + text records) happens once its error scope resolves.
describe("W74 ward-review: double-buffered atlas swap (I1)", () => {
  const MOVED_PAINTS: ReadonlyArray<ElementPaint | undefined> = [{ ...paint(0), atlasRect: { x: 20, y: 30, w: 280, h: 96 } }, undefined];
  const V2: TextAtlasFrame = { ...ATLAS, canvas: { width: 320, height: 136 } as unknown as OffscreenCanvas, version: 2 };
  const textPassesOf = (f: FakeGpu) => f.calls.passes.filter((p) => p.attachments.some((a) => a.view.texture.label === "liquiddom T1"));
  /** The text info buffer (binding 5) and the atlas texture (binding 6) the last text pass sampled. */
  const lastTextBindings = (f: FakeGpu) => {
    const group = textPassesOf(f).at(-1)!.draws[0]!.bindGroup as { descriptor: GPUBindGroupDescriptor };
    const entries = Array.from(group.descriptor.entries as Iterable<GPUBindGroupEntry>);
    const info = (entries.find((e) => e.binding === 5)!.resource as { buffer: unknown }).buffer;
    const atlas = (entries.find((e) => e.binding === 6)!.resource as unknown as { texture: { label?: string } }).texture;
    return { info, atlas };
  };
  const lastWriteTo = (f: FakeGpu, buffer: unknown) => f.calls.writes.filter((w) => w.buffer === buffer).at(-1)!;
  const atlasTextures = (f: FakeGpu) => f.calls.textures.filter((t) => t.label === "liquiddom atlas" || t.label === "liquiddom atlas staging");

  async function confirmedV1(f: FakeGpu): Promise<WebGPURenderer> {
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(r.textReady(0), "precondition: version 1 confirmed").toBe(true);
    return r;
  }

  // W74 ward-review
  it("given_a_confirmed_page_and_a_moving_element_when_a_new_version_arrives_then_textReady_stays_true_and_the_text_pass_draws_the_old_page_until_the_scope_resolves_then_the_new_page", async () => {
    const f = gpu();
    const r = await confirmedV1(f);
    expect(textPassesOf(f)).toHaveLength(1);
    const before = lastTextBindings(f);
    expect(before.atlas.label).toBe("liquiddom atlas");
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    expect(r.textReady(0), "the confirmed page keeps drawing: no blink").toBe(true);
    const copy = f.calls.externalCopies.at(-1)!;
    expect(copy.source).toBe(V2.canvas);
    expect(copy.texture.label, "the new page goes into the staging texture").toBe("liquiddom atlas staging");
    expect(textPassesOf(f), "the text pass runs in the rebuild frame").toHaveLength(2);
    const pending = lastTextBindings(f);
    expect(pending.atlas, "the old page is sampled").toBe(before.atlas);
    expect(pending.info, "with the old records").toBe(before.info);
    expect(lastWriteTo(f, before.info).values[1], "the old records are not overwritten").toBeCloseTo(20 / 136, 5);
    const newInfo = f.calls.writes.filter((w) => w.buffer.label === "liquiddom text info").at(-1)!;
    expect(newInfo.buffer, "the new records go into the other text info buffer").not.toBe(before.info);
    expect(newInfo.values[1]).toBeCloseTo(30 / 136, 5);
    expect(f.calls.textureCopies, "no swap before the scope resolves").toHaveLength(0);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    expect(r.textReady(0)).toBe(true);
    expect(lastTextBindings(f).info, "still the old records while pending").toBe(before.info);
    await flush();
    expect(r.textReady(0)).toBe(true);
    expect(f.calls.textureCopies).toHaveLength(1);
    const swap = f.calls.textureCopies[0]!;
    expect([swap.source.label, swap.destination, swap.width, swap.height]).toEqual(["liquiddom atlas staging", before.atlas, 320, 136]);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    const after = lastTextBindings(f);
    expect(after.atlas, "the drawn texture now holds version 2").toBe(before.atlas);
    expect(after.info, "the new records are drawn").toBe(newInfo.buffer);
    expect(textPassesOf(f), "a text pass in every frame").toHaveLength(4);
    expect(atlasTextures(f), "two pages at most, reused").toHaveLength(2);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 ward-review
  it("given_a_confirmed_page_for_owner_1_in_slot_0_when_a_pending_version_gives_slot_0_to_owner_2_then_slot_0_is_masked_and_its_drawn_record_zeroed_until_the_swap", async () => {
    const f = gpu();
    const r = await ready();
    const A: ReadonlyArray<ElementPaint | undefined> = [{ ...textPaint(0), owner: 1 }, { ...textPaint(1), owner: 7 }];
    const B: ReadonlyArray<ElementPaint | undefined> = [{ ...textPaint(0), owner: 2, atlasRect: { x: 20, y: 30, w: 280, h: 96 } }, { ...textPaint(1), owner: 7 }];
    r.render(sceneFrame({ paints: A, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush();
    r.render(sceneFrame({ paints: A, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect([r.textReady(0), r.textReady(1)]).toEqual([true, true]);
    const before = lastTextBindings(f);
    r.render(sceneFrame({ paints: B, textAtlas: V2, restAlpha: 0.5 }));
    expect(r.textReady(0), "slot 0 now holds another element: the old page is not its text").toBe(false);
    expect(r.textReady(1), "slot 1 keeps its owner: the old page still draws it").toBe(true);
    const drawn = lastWriteTo(f, before.info).values;
    expect(drawn.slice(0, 8), "slot 0's drawn record is zeroed (no text)").toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(drawn[8 + 6], "slot 1's drawn record stays valid").toBe(1);
    await flush();
    expect([r.textReady(0), r.textReady(1)], "after the swap: the new page's records").toEqual([true, true]);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 ward-review
  it("given_a_confirmed_page_when_the_new_version_has_another_size_then_the_swap_reallocates_the_drawn_texture_at_that_size", async () => {
    const f = gpu();
    const r = await confirmedV1(f);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: { ...V2, width: 400, height: 200 }, restAlpha: 0.5 }));
    expect(r.textReady(0)).toBe(true);
    await flush();
    const swap = f.calls.textureCopies.at(-1)!;
    expect([swap.destination.label, swap.destination.width, swap.destination.height, swap.width, swap.height]).toEqual(["liquiddom atlas", 400, 200, 400, 200]);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: { ...V2, width: 400, height: 200 }, restAlpha: 0.5 }));
    expect(lastTextBindings(f).atlas).toBe(swap.destination);
    expect(f.calls.textures.filter((t) => t.label === "liquiddom atlas" && !t.destroyed)).toHaveLength(1);
    expect(f.calls.errors).toEqual([]);
  });

  // W74 ward-review
  it("given_a_confirmed_page_when_the_new_version_raises_a_validation_error_then_textReady_drops_one_warn_no_console_error_and_both_pages_are_released", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const opts: FakeGpuOptions = {};
    const f = gpu(opts); // the fake reads opts.copyExternalValidationError at call time
    const r = await confirmedV1(f);
    opts.copyExternalValidationError = "copyExternalImageToTexture: source is unusable (fake)";
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    expect(r.textReady(0), "pending: the old page still draws").toBe(true);
    await flush();
    expect(r.textReady(0), "the new version failed: no atlas text").toBe(false);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    expect(f.calls.passes.at(-1)!.draws.map((d) => [d.vertexCount, d.instanceCount]), "no text composite").toEqual([[3, 1], [6, 1]]);
    expect(f.calls.externalCopies, "the failed version is not retried").toHaveLength(2);
    expect(f.calls.textureCopies, "never swapped").toHaveLength(0);
    expect(atlasTextures(f).every((t) => t.destroyed), "both pages released").toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(f.calls.errors).toEqual([]);
  });

  // W74 ward-review
  it("given_a_pending_swap_when_destroyed_or_the_device_is_lost_then_no_swap_runs_and_both_pages_are_released", async () => {
    const f = gpu();
    const r = await confirmedV1(f);
    r.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    expect(atlasTextures(f)).toHaveLength(2);
    r.destroy();
    expect(atlasTextures(f).every((t) => t.destroyed), "destroy releases the drawn page and the staging page").toBe(true);
    await flush();
    expect(f.calls.textureCopies).toHaveLength(0);
    expect(r.textReady(0)).toBe(false);

    const pages = atlasTextures(f).length;
    const r2 = await confirmedV1(f);
    r2.render(sceneFrame({ paints: MOVED_PAINTS, textAtlas: V2, restAlpha: 0.5 }));
    const mine = atlasTextures(f).slice(pages);
    expect(mine.map((t) => t.label)).toEqual(["liquiddom atlas", "liquiddom atlas staging"]);
    f.loseDevice("gpu reset");
    await flush();
    expect(r2.textReady(0), "after the loss").toBe(false);
    expect(f.calls.textureCopies, "no swap on a lost device").toHaveLength(0);
    r2.destroy();
    expect(mine.every((t) => t.destroyed)).toBe(true);
    expect(f.calls.errors).toEqual([]);
  });
});

// W74 ward-review (M1): F and flags are packed only while some element's text moves.
describe("W74 ward-review: particle F only while text moves (M1)", () => {
  // W74 ward-review
  it("given_no_moving_text_when_rendering_then_the_particle_upload_carries_positions_but_no_F_and_with_moving_text_it_carries_F", async () => {
    const f = gpu();
    const r = await ready();
    const particles = () => writesTo("liquiddom particles", f.calls.writes);
    const withF = (o: Parameters<typeof sceneFrame>[0]): RenderFrame => {
      const fr = sceneFrame(o);
      fr.dynamicView.fill(2, Dyn.F00 * CAP, (Dyn.F00 + 1) * CAP);
      fr.dynamicView.fill(0.5, Dyn.F11 * CAP, (Dyn.F11 + 1) * CAP);
      return fr;
    };
    r.render(withF({ paints: PAINTS, restAlpha: 0.5 })); // moving, but no text
    expect(particles().at(-1)!.bytes).toBe(CAP * 32);
    expect(particles().at(-1)!.values.slice(0, 8), "no text pass: F is not packed").toEqual([110, 120, 0, 0, 0, 0, 0, 0]);
    r.render(withF({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush();
    r.render(withF({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(particles().at(-1)!.values.slice(0, 8), "the text pass reads this frame's F").toEqual([110, 120, 2, 0, 0, 0.5, 0, 0]);
    expect(f.calls.errors).toEqual([]);
  });
});

// =============================================================================
// W79 (D79-1): the text id target. The text pass writes, per texel, the smallest element id (r)
// and minus the largest (g) of every text splat that reaches it (rg16float, min blending, cleared
// to 4096); the text composite drops the text where they differ; captureTextIds() reads it back
// for the acceptance hook only.
// =============================================================================
describe("W79: the text id target (D79-1)", () => {
  const t1IdTextures = (f: FakeGpu) => f.calls.textures.filter((t) => t.label === "liquiddom T1id");
  /** One text frame whose atlas upload is confirmed, so the next render draws the text pass. */
  async function textReadyRenderer(): Promise<WebGPURenderer> {
    const r = await ready();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    await flush();
    return r;
  }

  it("given_text_drawn_when_resized_or_destroyed_then_the_T1id_target_follows_T1_is_copyable_is_bound_to_the_text_composite_and_is_released", async () => {
    const f = gpu({ maxTextureDimension2D: 4096 });
    const r = await textReadyRenderer();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    const [first] = t1IdTextures(f);
    expect([first!.format, first!.width, first!.height]).toEqual(["rg16float", 800, 600]);
    expect(first!.usage & 0x1, "COPY_SRC, for captureTextIds()").toBe(0x1);
    expect(first!.usage & 0x14, "RENDER_ATTACHMENT | TEXTURE_BINDING").toBe(0x14);
    const layout = f.calls.bindGroupLayouts.find((l) => l.label === "liquiddom text composite")!;
    expect(Array.from(layout.entries).find((e) => e.binding === 4)).toEqual({ binding: 4, visibility: 0x2, texture: { sampleType: "float" } });
    const group = f.calls.bindGroups.filter((g) => g.label === "liquiddom text composite").at(-1)!;
    const entry = Array.from(group.entries as Iterable<GPUBindGroupEntry>).find((e) => e.binding === 4)!;
    expect((entry.resource as unknown as { texture: unknown }).texture, "the composite reads the id target").toBe(first);
    r.resize(5000, 300, 2);
    expect(first!.destroyed).toBe(true);
    expect(t1IdTextures(f).slice(1).map((t) => `${t.width}x${t.height}`), "clamped like T1").toEqual(["4096x300"]);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    r.destroy();
    expect(t1IdTextures(f).every((t) => t.destroyed)).toBe(true);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_captureTextIds_when_the_next_frame_draws_text_then_the_T1id_texture_is_copied_after_that_frames_passes_into_a_map_read_buffer_and_resolves_with_256_aligned_rows", async () => {
    const f = gpu();
    const r = await textReadyRenderer();
    const pending = r.captureTextIds();
    expect(f.calls.bufferCopies, "nothing is copied before a frame renders").toHaveLength(0);
    const submits = f.calls.submits;
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.submits, "the copy rides in the frame's own submit").toBe(submits + 1);
    expect(f.calls.bufferCopies).toHaveLength(1);
    const copy = f.calls.bufferCopies[0]!;
    expect(copy.texture.label).toBe("liquiddom T1id");
    expect(copy.passIndex, "encoded after the frame's splat, text and screen passes").toBe(f.calls.passes.length);
    expect([copy.width, copy.height, copy.bytesPerRow, copy.rowsPerImage]).toEqual([800, 600, 3328, 600]);
    expect(copy.buffer.usage, "MAP_READ | COPY_DST").toBe(0x1 | 0x8);
    const c = await pending;
    expect(c).not.toBeNull();
    expect([c!.textPass, c!.width, c!.height, c!.bytesPerRow, c!.empty, c!.data.length]).toEqual([true, 800, 600, 3328, 4096, (3328 / 2) * 600]);
    expect(copy.buffer.destroyed, "the readback buffer is released once read").toBe(true);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect(f.calls.bufferCopies, "one capture, one copy: a normal frame copies nothing").toHaveLength(1);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_captureTextIds_when_the_next_frame_has_no_text_pass_then_it_resolves_textPass_false_without_a_copy_and_on_destroy_or_a_loss_it_resolves_null", async () => {
    const f = gpu();
    const r = await ready();
    const idle = r.captureTextIds();
    r.render(sceneFrame({ paints: PAINTS, restAlpha: 0.5 })); // moving, but no atlas text
    expect(await idle).toEqual({ textPass: false, width: 0, height: 0, bytesPerRow: 0, empty: 4096, data: new Uint16Array(0) });
    expect(f.calls.bufferCopies).toHaveLength(0);
    const beforeDestroy = r.captureTextIds();
    r.destroy();
    expect(await beforeDestroy, "destroy() settles a pending capture").toBeNull();
    expect(await r.captureTextIds(), "no device").toBeNull();
    const r2 = await ready();
    const beforeLoss = r2.captureTextIds();
    f.loseDevice("gone");
    await flush();
    expect(await beforeLoss, "a loss settles a pending capture").toBeNull();
    expect(await r2.captureTextIds(), "after a loss").toBeNull();
    expect(f.calls.errors).toEqual([]);
  });

  // W79 red review (M3). Decision: a second captureTextIds() while one is armed rejects at once with
  // "already armed"; the first is untouched. No hang, one copy, one buffer, and a later capture works.
  it("given_a_capture_already_armed_when_captureTextIds_is_called_again_before_a_frame_then_the_second_rejects_clearly_the_first_resolves_with_one_copy_and_a_later_capture_works", async () => {
    const f = gpu();
    const r = await textReadyRenderer();
    const first = r.captureTextIds();
    await expect(r.captureTextIds()).rejects.toThrow(/already armed/);
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    const c = await first;
    expect(c?.textPass).toBe(true);
    expect(f.calls.bufferCopies, "one copy for the one armed capture").toHaveLength(1);
    expect(f.calls.bufferCopies[0]!.buffer.destroyed, "its buffer is released").toBe(true);
    const later = r.captureTextIds();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect((await later)?.textPass, "a capture after the first resolved works again").toBe(true);
    expect(f.calls.bufferCopies).toHaveLength(2);
    expect(f.calls.errors).toEqual([]);
  });

  // W79.3 review M2: finish() or submit() throwing must not leave an armed capture hanging.
  it("given_an_armed_capture_when_queue_submit_throws_then_the_capture_resolves_null_and_the_readback_buffer_is_destroyed", async () => {
    const f = gpu();
    let failing = false;
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    vi.spyOn(navigator.gpu, "requestAdapter").mockImplementation(async (o) => {
      const adapter = (await requestAdapter(o))!;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async (d) => {
        const device = await requestDevice(d);
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (list) => {
          if (failing) throw new Error("submit exploded");
          submit(list);
        };
        return device;
      };
      return adapter;
    });
    const r = await textReadyRenderer();
    const pending = r.captureTextIds();
    failing = true;
    expect(() => r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }))).toThrow(/submit exploded/);
    expect(await pending, "the capture settles with null").toBeNull();
    expect(f.calls.bufferCopies).toHaveLength(1);
    expect(f.calls.bufferCopies[0]!.buffer.destroyed, "the readback buffer is released").toBe(true);
    failing = false;
    const later = r.captureTextIds();
    r.render(sceneFrame({ paints: TEXT_PAINTS, textAtlas: ATLAS, restAlpha: 0.5 }));
    expect((await later)?.textPass, "a later capture works").toBe(true);
  });
});
