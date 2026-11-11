/**
 * @vitest-environment jsdom
 * W89 (D89-1 … D89-4, D89-7, D89-8, D89-10): WebGPU ink with the fake GPU. The text pass gains
 * T1ink (rgba16float, Σw·ink) and T1mix (rg16float, Σw·rank and the all-liquid Σw), 26 B per sample;
 * the atlas is visible to the vertex stage (per-particle ink); the text composite reads both and the
 * element records (rank) and fades the crisp text into ink instead of D79-1's cut.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, St, STATE_STRIDE, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame, TextAtlasFrame } from "../src/renderers/frame";
import { EG, ELEMENT_GPU_FLOATS, packElements } from "../src/renderers/webgpu/gpu-buffers";
import { INK_ALPHA_CAP, INK_FADE_HI, INK_FADE_LO, INK_GAIN, INK_SAMPLES, inkFade } from "../src/renderers/ink";
import { TEXT_COMPOSITE_WGSL, TEXT_WGSL } from "../src/renderers/webgpu/shaders";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { installFakeGpu, type FakeGpu } from "./_fake-gpu";

let f: FakeGpu;
beforeEach(() => {
  f = installFakeGpu();
});
afterEach(() => f.restore());

const CAP = 6;
const BYTES: Readonly<Record<string, number>> = { rgba16float: 8, rg16float: 4, r16float: 2 };
const ADDITIVE = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };
const MIN = { color: { srcFactor: "one", dstFactor: "one", operation: "min" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "min" } };
const ATLAS: TextAtlasFrame = { canvas: { width: 320, height: 136 } as unknown as OffscreenCanvas, width: 320, height: 136, dpr: 2, version: 1 };
const textPaint = (id: number): ElementPaint => ({
  id, background: [47, 111, 222, 1], text: [255, 255, 255, 1], radiusPx: 24, particleCount: CAP, areaPerParticle: 4, spacingPx: 2,
  atlasRect: { x: 20, y: 20, w: 280, h: 96 }, shadows: [],
});
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
/** The WGSL f32 literal shaders.ts interpolates (`8` → `8.0`). */
const f32 = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

function textFrame(o: { restAlpha?: number; reducedMotion?: boolean; suppressText?: boolean; textOff?: number } = {}): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  for (let i = 0; i < CAP; i++) {
    dynamicView[Dyn.X * CAP + i] = 110 + 4 * i;
    dynamicView[Dyn.Y * CAP + i] = 120;
    dynamicView[Dyn.F00 * CAP + i] = 1;
    dynamicView[Dyn.F11 * CAP + i] = 1;
  }
  const elementView = new Float32Array(2 * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, 0, 0, 0, Number.NaN, Number.NaN], 0);
  const stateView = new Float32Array(2 * STATE_STRIDE);
  stateView[St.REST_ALPHA] = o.restAlpha ?? 0.5;
  return {
    dynamicView, staticView: new Float32Array(CAP * STATIC_FIELDS), generation: 1, stateView, elementView, particleCapacity: CAP,
    activeParticles: CAP, paints: [textPaint(0), undefined], viewport: { widthCss: 400, heightCss: 300, dpr: 2 },
    reducedMotion: o.reducedMotion ?? false, textAtlas: ATLAS, ...(o.suppressText ? { suppressText: true } : {}),
    ...(o.textOff !== undefined ? { textOff: o.textOff } : {}),
  };
}

/** A renderer whose atlas upload is confirmed (the text pass runs from the next frame). */
async function textReadyRenderer(): Promise<WebGPURenderer> {
  const r = new WebGPURenderer();
  await r.init(document.createElement("canvas"));
  r.resize(800, 600, 2);
  r.render(textFrame());
  await flush();
  return r;
}

const textPasses = () => f.calls.passes.filter((p) => p.label === "liquiddom text");
const byLabel = (label: string) => f.calls.textures.filter((t) => t.label === label);

describe("W89 WebGPU ink (D89-2, D89-3, D89-7, D89-8)", () => {
  it("given_init_when_built_then_the_text_pipeline_writes_five_targets_in_26_bytes_per_sample_within_the_32_byte_limit_D89_7", async () => {
    await new WebGPURenderer().init(document.createElement("canvas"));
    const text = f.calls.pipelines[3]!.descriptor;
    expect(text.label).toBe("liquiddom text");
    const targets = Array.from(text.fragment!.targets) as GPUColorTargetState[];
    expect(targets).toEqual([
      { format: "rgba16float", blend: ADDITIVE },
      { format: "r16float", blend: ADDITIVE },
      { format: "rg16float", blend: MIN },
      { format: "rgba16float", blend: ADDITIVE },
      { format: "rg16float", blend: ADDITIVE },
    ]);
    const bytes = targets.reduce((n, t) => n + (BYTES[t.format] ?? 99), 0);
    expect(bytes, "T1 8 + T1w 2 + T1id 4 + T1ink 8 + T1mix 4").toBe(26);
    expect(bytes).toBeLessThanOrEqual(32);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_init_when_built_then_the_atlas_and_sampler_are_visible_to_the_vertex_stage_and_the_text_composite_binds_T1ink_T1mix_and_the_element_records_D89_2_D89_8", async () => {
    await new WebGPURenderer().init(document.createElement("canvas"));
    const entries = (label: string) => Array.from(f.calls.bindGroupLayouts.find((l) => l.label === label)!.entries);
    const text = entries("liquiddom text");
    expect(text.find((e) => e.binding === 6)).toEqual({ binding: 6, visibility: 0x3, texture: { sampleType: "float" } });
    expect(text.find((e) => e.binding === 7)).toEqual({ binding: 7, visibility: 0x3, sampler: { type: "filtering" } });
    const composite = entries("liquiddom text composite");
    expect(composite.filter((e) => e.binding >= 5)).toEqual([
      { binding: 5, visibility: 0x2, texture: { sampleType: "float" } },
      { binding: 6, visibility: 0x2, texture: { sampleType: "float" } },
      { binding: 7, visibility: 0x2, buffer: { type: "read-only-storage" } },
    ]);
  });

  it("given_a_moving_text_element_when_rendering_then_the_text_pass_clears_T1ink_and_T1mix_at_1x_the_composite_reads_them_and_they_follow_resize_and_destroy_D89_7", async () => {
    const r = await textReadyRenderer();
    r.render(textFrame());
    const pass = textPasses().at(-1)!;
    expect(pass.attachments.map((a) => [a.view.texture.label, a.view.texture.format, a.view.texture.width, a.view.texture.height, a.loadOp])).toEqual([
      ["liquiddom T1", "rgba16float", 800, 600, "clear"],
      ["liquiddom T1w", "r16float", 800, 600, "clear"],
      ["liquiddom T1id", "rg16float", 800, 600, "clear"],
      ["liquiddom T1ink", "rgba16float", 800, 600, "clear"],
      ["liquiddom T1mix", "rg16float", 800, 600, "clear"],
    ]);
    expect(pass.attachments.slice(3).map((a) => a.clearValue)).toEqual([{ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }]);
    const [ink] = byLabel("liquiddom T1ink");
    const [mix] = byLabel("liquiddom T1mix");
    const group = f.calls.bindGroups.filter((g) => g.label === "liquiddom text composite").at(-1)!;
    const res = (b: number) => Array.from(group.entries as Iterable<GPUBindGroupEntry>).find((e) => e.binding === b)!.resource as unknown as { texture?: unknown; buffer?: { label?: string } };
    expect([res(5).texture, res(6).texture]).toEqual([ink, mix]);
    expect(res(7).buffer?.label, "the element records carry the rank").toBe("liquiddom elements");
    r.resize(1000, 700, 2);
    expect([ink!.destroyed, mix!.destroyed]).toEqual([true, true]);
    expect(byLabel("liquiddom T1ink").at(-1)).toMatchObject({ width: 1000, height: 700 });
    r.destroy();
    expect([...byLabel("liquiddom T1ink"), ...byLabel("liquiddom T1mix")].every((t) => t.destroyed)).toBe(true);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_reduced_motion_suppressText_or_textOff_for_the_only_text_slot_when_rendering_a_moving_text_element_then_no_text_pass_and_no_text_composite_D89_10", async () => {
    const r = await textReadyRenderer();
    r.render(textFrame());
    expect(textPasses(), "precondition: the text pass runs").toHaveLength(1);
    const screens = () => f.calls.passes.filter((p) => p.label === "liquiddom screen");
    for (const o of [{ reducedMotion: true }, { suppressText: true }, { textOff: 0 }]) {
      r.render(textFrame(o));
      expect(textPasses(), JSON.stringify(o)).toHaveLength(1);
      expect(screens().at(-1)!.draws.length, "composite and rest only").toBe(2);
    }
    expect(r.textReady(0), "the atlas stays ready").toBe(true);
  });

  it("given_moving_and_resting_slots_with_ids_up_to_255_when_packElements_then_EG_RANK_holds_the_dense_rank_of_the_moving_drawable_slots_in_id_order_D89_8", () => {
    const SLOTS = 256;
    const paints: Array<ElementPaint | undefined> = new Array<ElementPaint | undefined>(SLOTS).fill(undefined);
    const elementView = new Float32Array(SLOTS * ELEMENT_STRIDE);
    const stateView = new Float32Array(SLOTS * STATE_STRIDE);
    const alpha: Record<number, number> = { 0: 1, 3: 0.5, 7: 0.5, 254: 0.2, 255: 0.7 };
    for (const [k, a] of Object.entries(alpha)) {
      const id = Number(k);
      paints[id] = textPaint(id);
      elementView.set([10 * id, 10, 40, 20, 4, 0, 0, 0, Number.NaN, Number.NaN], id * ELEMENT_STRIDE);
      stateView[id * STATE_STRIDE + St.REST_ALPHA] = a;
    }
    elementView[7 * ELEMENT_STRIDE + 2] = 0; // slot 7: inactive (w = 0), not drawable
    const frame: RenderFrame = {
      dynamicView: new Float32Array(0), staticView: new Float32Array(0), generation: 1, stateView, elementView,
      particleCapacity: 0, activeParticles: 0, paints, viewport: { widthCss: 400, heightCss: 300, dpr: 1 }, reducedMotion: false,
    };
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS);
    expect(packElements(frame, out)).toBe(256);
    const rank = (id: number) => out[id * ELEMENT_GPU_FLOATS + EG.RANK];
    expect(EG.RANK).toBe(13);
    expect([rank(3), rank(254), rank(255)], "moving drawable slots, in id order").toEqual([0, 1, 2]);
    expect([rank(0), rank(7), rank(100)], "at rest, inactive or unpainted").toEqual([0, 0, 0]);
  });

  it("given_a_capture_armed_with_mix_when_the_text_pass_runs_then_it_also_carries_the_T1mix_texels_and_each_slots_rank_and_a_plain_capture_stays_W79s_D89_4", async () => {
    const r = await textReadyRenderer();
    const plain = r.captureTextIds();
    r.render(textFrame());
    expect((await plain)?.mix, "W79's capture is unchanged").toBeUndefined();
    expect(f.calls.bufferCopies.map((b) => b.texture.label)).toEqual(["liquiddom T1id"]);
    f.calls.bufferCopies.length = 0;
    const pending = r.captureTextIds({ mix: true });
    r.render(textFrame());
    const c = await pending;
    expect(c?.textPass).toBe(true);
    expect(c?.mix, "T1mix laid out like the id texels").toBeInstanceOf(Uint16Array);
    expect(c?.mix?.length).toBe(c?.data.length);
    expect(c?.ranks?.[0], "slot 0 moves alone: rank 0").toBe(0);
    const copied = f.calls.bufferCopies.map((b) => b.texture.label);
    expect(copied).toEqual(["liquiddom T1id", "liquiddom T1mix"]);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_the_shaders_when_read_then_the_text_pass_lets_text_less_liquid_in_and_samples_ink_in_the_vertex_stage_and_the_composite_fades_with_the_shared_constants_instead_of_the_D79_1_cut_D89_1_D89_3_D89_4", () => {
    expect(TEXT_WGSL).toContain(`const INK_SAMPLES: u32 = ${INK_SAMPLES}u;`);
    const vs = TEXT_WGSL.slice(TEXT_WGSL.indexOf("fn vs("), TEXT_WGSL.indexOf("fn fs("));
    expect(vs, "per-particle ink in the vertex stage").toContain("textureSampleLevel(atlas");
    expect(TEXT_WGSL, "a text-less element is not skipped (D89-3)").not.toMatch(/if \(info\.size\.z < 0\.5\) \{\s*return out;/);
    expect(TEXT_WGSL).toMatch(/@location\(3\) ink: vec4f,\s*@location\(4\) mix: vec2f,/);
    for (const [name, v] of [["INK_FADE_LO", INK_FADE_LO], ["INK_FADE_HI", INK_FADE_HI], ["INK_GAIN", INK_GAIN], ["INK_ALPHA_CAP", INK_ALPHA_CAP]] as const) {
      expect(TEXT_COMPOSITE_WGSL).toContain(`const ${name}: f32 = ${f32(v)};`);
    }
    expect(TEXT_COMPOSITE_WGSL).toContain("smoothstep(INK_FADE_LO, INK_FADE_HI,");
    expect(TEXT_COMPOSITE_WGSL, "D79-1's hard cut is gone (D89-4)").not.toContain("0.0, mixed)");
  });
});

// ---- W89 final review (I1, amends D89-8 to its option (b); Dennis 2026-11-09, saga dec_7d9fb007) ----
// T1mix is rg32float when the device has float32-blendable (requested when the adapter offers it),
// rg16float otherwise. f16 Σw·rank loses p precision linearly with the rank (final-review.md I1).

/** WebGPU "render target pixel byte cost" and "component alignment" of the text pass formats. */
const TARGET_COST: Readonly<Record<string, readonly [number, number]>> = { rgba16float: [8, 2], r16float: [2, 2], rg16float: [4, 2], rg32float: [8, 4] };
/** The spec's maxColorAttachmentBytesPerSample check: each attachment starts at its alignment. */
function alignedBytesPerSample(formats: readonly string[]): number {
  let n = 0;
  for (const fmt of formats) {
    const [cost, align] = TARGET_COST[fmt] ?? [99, 1];
    n = Math.ceil(n / align) * align + cost;
  }
  return n;
}

/** IEEE half rounding (nearest, ties to even): what one additive blend into an f16 target keeps. */
function f16(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const step = 2 ** (Math.max(Math.floor(Math.log2(Math.abs(v))), -14) - 10);
  const [q, lo] = [v / step, Math.floor(v / step)];
  return (q - lo > 0.5 || (q - lo === 0.5 && lo % 2 !== 0) ? lo + 1 : lo) * step;
}
/** What one additive blend into a channel of `format` keeps. */
const roundFor = (format: string): ((v: number) => number) => (format === "rg32float" ? Math.fround : format === "rg16float" ? f16 : () => Number.NaN);

/**
 * A fringe texel: 15 fragments of two adjacent ranks lo and hi = lo + 1, the second liquid 0–10 % of
 * Σw, blended in order into one T1mix texel rounded by `round`. Returns the worst |fade − exact fade|
 * over `trials` seeded texels (deterministic LCG).
 */
function worstFadeError(round: (v: number) => number, lo: number, trials = 400): number {
  const hi = lo + 1;
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let worst = 0;
  for (let t = 0; t < trials; t++) {
    const share = 0.1 * rnd();
    let [sumW, sumWRank, exactW, exactHi] = [0, 0, 0, 0];
    for (let k = 0; k < 15; k++) {
      const w = 0.02 + 0.3 * rnd();
      const rank = rnd() < share ? hi : lo;
      sumW = round(sumW + w);
      sumWRank = round(sumWRank + round(w * rank));
      exactW += w;
      if (rank === hi) exactHi += w;
    }
    const exact = inkFade(exactW, lo * exactW + exactHi, lo, hi);
    worst = Math.max(worst, Math.abs(inkFade(sumW, sumWRank, lo, hi) - exact));
  }
  return worst;
}

async function textReadyRendererWith(adapterFeatures: readonly string[]): Promise<WebGPURenderer> {
  f.restore();
  f = installFakeGpu({ adapterFeatures });
  return textReadyRenderer();
}

describe("W89 final review: T1mix precision (I1, D89-8 amended to (b), saga dec_7d9fb007)", () => {
  it("given_an_adapter_with_float32_blendable_when_init_then_the_feature_is_requested_T1mix_is_rg32float_read_unfilterable_and_the_text_pass_stays_within_32_bytes_per_sample", async () => {
    const r = await textReadyRendererWith(["float32-blendable", "timestamp-query"]);
    const desc = f.calls.deviceDescriptors[0];
    expect(Array.from((desc?.requiredFeatures ?? []) as Iterable<string>), "only the feature T1mix needs").toEqual(["float32-blendable"]);
    const text = f.calls.pipelines.find((p) => p.descriptor.label === "liquiddom text")!.descriptor;
    const targets = Array.from(text.fragment!.targets) as GPUColorTargetState[];
    expect(targets.map((t) => t.format)).toEqual(["rgba16float", "r16float", "rg16float", "rgba16float", "rg32float"]);
    expect(targets[4]!.blend, "T1mix stays additive").toEqual(ADDITIVE);
    const formats = targets.map((t) => t.format);
    expect(formats.reduce((n, fmt) => n + (TARGET_COST[fmt]?.[0] ?? 99), 0), "T1 8 + T1w 2 + T1id 4 + T1ink 8 + T1mix 8").toBe(30);
    expect(alignedBytesPerSample(formats), "with rg32float's 4-byte alignment").toBeLessThanOrEqual(32);
    const composite = Array.from(f.calls.bindGroupLayouts.find((l) => l.label === "liquiddom text composite")!.entries);
    expect(composite.find((e) => e.binding === 6), "rg32float is not filterable in core WebGPU").toEqual({ binding: 6, visibility: 0x2, texture: { sampleType: "unfilterable-float" } });
    expect(TEXT_COMPOSITE_WGSL, "T1mix is loaded, never sampled with the filtering sampler").toContain("textureLoad(t1_mix,");
    expect(TEXT_COMPOSITE_WGSL).not.toContain("textureSample(t1_mix,");
    r.render(textFrame());
    expect(byLabel("liquiddom T1mix").map((t) => t.format)).toEqual(["rg32float"]);
    expect(textPasses().at(-1)!.attachments[4]!.view.texture.format).toBe("rg32float");
    expect(f.calls.errors, "blendable and bound as unfilterable-float").toEqual([]);
    r.destroy();
  });

  it("given_an_adapter_without_float32_blendable_when_init_then_no_feature_is_requested_and_T1mix_stays_rg16float_within_26_bytes_per_sample", async () => {
    for (const features of [[], ["timestamp-query", "float32-filterable"]]) {
      const r = await textReadyRendererWith(features);
      const desc = f.calls.deviceDescriptors[0];
      expect(Array.from((desc?.requiredFeatures ?? []) as Iterable<string>), `adapter features ${features.join(",")}`).toEqual([]);
      const text = f.calls.pipelines.find((p) => p.descriptor.label === "liquiddom text")!.descriptor;
      const formats = (Array.from(text.fragment!.targets) as GPUColorTargetState[]).map((t) => t.format);
      expect(formats[4]).toBe("rg16float");
      expect(alignedBytesPerSample(formats)).toBe(26);
      r.render(textFrame());
      expect(byLabel("liquiddom T1mix").map((t) => t.format)).toEqual(["rg16float"]);
      expect(f.calls.errors).toEqual([]);
      r.destroy();
    }
  });

  it("given_rg32float_T1mix_and_a_capture_armed_with_mix_when_the_text_pass_runs_then_mix_holds_f32_values_laid_out_like_the_id_texels", async () => {
    const r = await textReadyRendererWith(["float32-blendable"]);
    f.calls.bufferCopies.length = 0;
    const pending = r.captureTextIds({ mix: true });
    r.render(textFrame());
    const c = await pending;
    expect(c?.mix, "f32 values, not half bits").toBeInstanceOf(Float32Array);
    expect(c?.mix?.length, "index t = y · bytesPerRow / 2 + 2x, as data").toBe(c?.data.length);
    const mixCopy = f.calls.bufferCopies.find((b) => b.texture.label === "liquiddom T1mix")!;
    expect(mixCopy.bytesPerRow, "8 B per rg32float texel, 256-aligned").toBe(Math.ceil((800 * 8) / 256) * 256);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_15_fragments_of_ranks_22_23_or_62_63_in_a_fringe_texel_when_blended_into_the_T1mix_format_the_device_gets_then_the_fade_error_stays_below_0_05_and_f16_s_error_is_documented", async () => {
    const r = await textReadyRendererWith(["float32-blendable"]);
    r.render(textFrame());
    const format = byLabel("liquiddom T1mix")[0]!.format;
    expect(format).toBe("rg32float");
    const round = roundFor(format);
    for (const lo of [22, 62]) {
      expect(worstFadeError(round, lo), `ranks ${lo}/${lo + 1} in ${format}`).toBeLessThan(0.05);
    }
    // Documented, not a bound: the rg16float fallback (no float32-blendable) at the same texels.
    // Measured with this generator: ranks 22/23 worst ≈ 0.7, 62/63 ≈ 1 (final-review.md I1's table).
    expect(worstFadeError(roundFor("rg16float"), 22), "f16 at ranks 22/23").toBeGreaterThan(0.3);
    expect(worstFadeError(roundFor("rg16float"), 62), "f16 at ranks 62/63").toBeGreaterThan(0.5);
    expect(worstFadeError(roundFor("rg16float"), 0), "f16 is fine at ranks 0/1 (rows 10, 11)").toBeLessThan(0.05);
    r.destroy();
  });
});
