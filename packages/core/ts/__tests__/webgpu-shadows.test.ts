/**
 * @vitest-environment jsdom
 * W88 (D88-4, D88-6, D88-10, D88-11, D88-13; Review Focus 4): the WebGPU shadow passes against the
 * fake GPU (_fake-gpu.ts, which records pass labels, scissor rects and dynamic offsets and flags a
 * scissor outside its attachment or an offset off the 256-byte alignment). The canvas backing is
 * 800 × 600 at dpr 2 (400 × 300 CSS): half resolution 400 × 300, quarter 200 × 150.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, Interaction, St, STATE_STRIDE, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { WebGPURenderer } from "../src/renderers/webgpu/webgpu-renderer";
import { SHADOW_SLOT_FLOATS, SP } from "../src/renderers/webgpu/shadow-passes";
import { parseBoxShadow, type ShadowLayer } from "../src/shadow";
import { installFakeGpu, type FakeGpu, type FakePass, type FakePipeline } from "./_fake-gpu";

let fake: FakeGpu | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
  vi.restoreAllMocks();
});

const PER = 6;
const DROP = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");
const paint = (id: number, shadows: readonly ShadowLayer[] = DROP): ElementPaint => ({
  id, background: [47, 111, 222, 1], text: [255, 255, 255, 1], radiusPx: 24, particleCount: PER, areaPerParticle: 4, spacingPx: 2, atlasRect: null, shadows,
});

/** Two slots, 6 particles each (slot 0 at x 110…130, slot 1 at x 210…230, y 120); restAlpha 0 unless `rest`. */
function frame(paints: ReadonlyArray<ElementPaint | undefined>, o: { rest?: boolean; dragged?: boolean; x0?: number; suppressShadows?: boolean } = {}): RenderFrame {
  const cap = 2 * PER;
  const dynamicView = new Float32Array(cap * DYNAMIC_FIELDS);
  const staticView = new Float32Array(cap * STATIC_FIELDS);
  for (let i = 0; i < cap; i++) {
    const id = i < PER ? 0 : 1;
    dynamicView[Dyn.X * cap + i] = (o.x0 ?? 110) + 100 * id + 4 * (i % PER);
    dynamicView[Dyn.Y * cap + i] = 120;
    staticView[Stat.HOME * cap + i] = id;
  }
  const elementView = new Float32Array(2 * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, o.dragged ? Interaction.DRAGGED : Interaction.IDLE, 0, 0, NaN, NaN], 0);
  elementView.set([200, 100, 140, 48, 24, Interaction.IDLE, 0, 0, NaN, NaN], ELEMENT_STRIDE);
  const stateView = new Float32Array(2 * STATE_STRIDE);
  stateView[St.REST_ALPHA] = o.rest ? 1 : 0;
  stateView[STATE_STRIDE + St.REST_ALPHA] = o.rest ? 1 : 0;
  return {
    dynamicView, staticView, generation: 1, stateView, elementView, particleCapacity: cap, activeParticles: cap,
    paints, viewport: { widthCss: 400, heightCss: 300, dpr: 2 }, reducedMotion: false, textAtlas: null,
    ...(o.suppressShadows === undefined ? {} : { suppressShadows: o.suppressShadows }),
  };
}

async function ready(): Promise<{ r: WebGPURenderer; f: FakeGpu }> {
  const f = installFakeGpu();
  fake = f;
  const r = new WebGPURenderer();
  await r.init(document.createElement("canvas"));
  r.resize(800, 600, 2);
  return { r, f };
}

const label = (p: unknown): string => String((p as FakePipeline | null)?.descriptor.label ?? "");
const passLabels = (f: FakeGpu, from = 0): string[] => f.calls.passes.slice(from).map((p) => String(p.label ?? ""));
const screenOf = (f: FakeGpu): FakePass => f.calls.passes.at(-1)!;
const shadowTextures = (f: FakeGpu) => f.calls.textures.filter((t) => String(t.label).startsWith("liquiddom shadow"));
const OVER = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
const ADDITIVE = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };

describe("W88: WebGPU shadow pipelines (D88-11, D88-13)", () => {
  it("given_init_when_built_then_six_shadow_pipelines_in_the_liquids_validation_scope_and_the_liquid_composite_blends_over", async () => {
    const { f } = await ready();
    const byLabel = new Map(f.calls.pipelines.map((p) => [String(p.descriptor.label), p.descriptor]));
    const targets = (name: string) => byLabel.get(name)?.fragment?.targets;
    expect(targets("liquiddom shadow density")).toEqual([{ format: "rgba16float", blend: ADDITIVE }]);
    expect(targets("liquiddom shadow resolve")).toEqual([{ format: "rgba16float", blend: OVER }]);
    expect(targets("liquiddom shadow blur h")).toEqual([{ format: "rgba16float" }]);
    expect(targets("liquiddom shadow blur v")).toEqual([{ format: "rgba16float", blend: OVER }]);
    expect(targets("liquiddom shadow knockout")).toEqual([{ format: "r8unorm" }]);
    expect(targets("liquiddom shadow composite")).toEqual([{ format: "bgra8unorm", blend: OVER }]);
    expect(targets("liquiddom composite"), "D88-13").toEqual([{ format: "bgra8unorm", blend: OVER }]);
    const log = f.calls.log;
    expect(log.lastIndexOf("createRenderPipeline")).toBeLessThan(log.lastIndexOf("popErrorScope"));
    expect(shadowTextures(f), "no shadow target before the first shadow").toEqual([]);
    expect(f.calls.errors).toEqual([]);
  });
});

describe("W88: WebGPU shadow passes (D88-6, D88-11)", () => {
  it("given_one_moving_element_with_one_layer_when_rendering_then_density_resolve_blur_h_blur_v_and_knockout_run_between_the_splat_and_the_screen_pass_whose_first_draw_is_the_shadow_composite", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0), undefined]));
    expect(passLabels(f)).toEqual([
      "liquiddom splat",
      "liquiddom shadow density 0",
      "liquiddom shadow resolve",
      "liquiddom shadow blur h",
      "liquiddom shadow blur v",
      "liquiddom shadow knockout",
      "liquiddom screen",
    ]);
    const [, density, resolve, h, v, knock] = f.calls.passes;
    expect(density!.draws.map((d) => [label(d.pipeline), d.vertexCount, d.instanceCount, d.offsets])).toEqual([["liquiddom shadow density", 6, 2 * PER, [0]]]);
    expect(resolve!.draws.map((d) => [label(d.pipeline), d.vertexCount, d.instanceCount, d.firstInstance])).toEqual([["liquiddom shadow resolve", 6, 1, 0]]);
    expect(h!.draws.map((d) => [label(d.pipeline), d.offsets])).toEqual([["liquiddom shadow blur h", [256]]]);
    expect(v!.draws.map((d) => [label(d.pipeline), d.offsets])).toEqual([["liquiddom shadow blur v", [512]]]);
    expect(knock!.draws.map((d) => [label(d.pipeline), d.offsets])).toEqual([["liquiddom shadow knockout", [768]]]);
    expect(screenOf(f).draws.map((d) => label(d.pipeline)).slice(0, 2)).toEqual(["liquiddom shadow composite", "liquiddom composite"]);
    expect(screenOf(f).draws[0]!.offsets).toEqual([1024]);
    expect(density!.attachments[0]!.view.texture.format).toBe("rgba16float");
    expect([density!.attachments[0]!.view.texture.width, density!.attachments[0]!.view.texture.height], "half resolution").toEqual([400, 300]);
    expect(v!.attachments[0]!.view.texture.label).toBe("liquiddom shadow acc half");
    expect(knock!.attachments[0]!.view.texture.format).toBe("r8unorm");
    expect(r.shadowsDrawn(0)).toBe(true);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_the_blur_pass_records_when_written_then_sigma_is_blur_over_2_in_target_px_and_the_taps_reach_3_sigma", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0), undefined]));
    const params = f.calls.writes.filter((w) => w.buffer.label === "liquiddom shadow params")[0]!;
    const slot = (s: number, k: number): number => params.values[s * SHADOW_SLOT_FLOATS + k]!;
    // Slot 0 is the density source; 1 and 2 the blur: σ = 20 / 2 CSS px × dpr 2 × 0.5 = 10 px.
    expect([slot(1, SP.DIR_X), slot(1, SP.DIR_Y), slot(2, SP.DIR_X), slot(2, SP.DIR_Y)]).toEqual([1, 0, 0, 1]);
    expect(slot(1, SP.SIGMA)).toBeCloseTo(10, 6);
    expect(slot(1, SP.TAPS)).toBe(30);
    expect(slot(0, SP.ELEMENT)).toBe(0);
    expect([slot(0, SP.MASK), slot(0, SP.MASK + 1), slot(0, SP.MASK + 2), slot(0, SP.MASK + 3)]).toEqual([1, 0, 0, 0]);
  });

  it("given_two_elements_with_the_same_blur_when_rendering_then_one_resolve_pass_draws_both_quads", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0), paint(1)]));
    const resolves = f.calls.passes.filter((p) => p.label === "liquiddom shadow resolve");
    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.draws.map((d) => d.instanceCount)).toEqual([2]);
    const density = f.calls.passes.find((p) => p.label === "liquiddom shadow density 0")!;
    expect(density.draws.map((d) => d.offsets[0]), "one draw per source, its own slot").toEqual([0, 256]);
    expect(density.draws.every((d) => d.scissor !== null)).toBe(true);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_a_blur_of_40_px_when_rendering_then_its_resolve_blur_and_accumulator_targets_are_quarter_resolution", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0, parseBoxShadow("rgb(0, 255, 255) 0px 0px 40px 0px")), undefined]));
    for (const name of ["liquiddom shadow resolve", "liquiddom shadow blur h", "liquiddom shadow blur v"]) {
      const t = f.calls.passes.find((p) => p.label === name)!.attachments[0]!.view.texture;
      expect([t.width, t.height], name).toEqual([200, 150]);
    }
    expect(f.calls.passes.find((p) => p.label === "liquiddom shadow blur v")!.attachments[0]!.view.texture.label).toBe("liquiddom shadow acc quarter");
    const composite = f.calls.writes.filter((w) => w.buffer.label === "liquiddom shadow params").at(-1)!;
    expect(composite.values[SP.FLAGS], "the composite reads the quarter accumulator only").toBe(2);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_a_spread_layer_when_rendering_then_its_own_density_source_and_a_knockout_mask_on_the_spread_0_channel_only", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0, parseBoxShadow("rgba(0, 0, 0, 0.3) 0px 4px 0px 6px, rgba(0, 0, 0, 0.4) 0px 8px 20px 0px")), undefined]));
    const density = f.calls.passes.find((p) => p.label === "liquiddom shadow density 0")!;
    expect(density.draws).toHaveLength(2);
    const params = f.calls.writes.filter((w) => w.buffer.label === "liquiddom shadow params")[0]!;
    // Slots: 2 sources, 2 blur (blur 20; the blur-0 spread group has none), knockout, composite.
    const knock = 4 * SHADOW_SLOT_FLOATS;
    expect(Array.from(params.values.slice(knock + SP.MASKS, knock + SP.MASKS + 4))).toEqual([1, 0, 0, 0]);
    expect(params.values[knock + SP.LAYERS]).toBe(1);
    expect(params.values[knock + SP.CLOSE], "1.5 × kernel radius 4.6 CSS px × dpr 2 × 0.5").toBe(7);
    const resolves = f.calls.passes.filter((p) => p.label === "liquiddom shadow resolve");
    expect(resolves, "one resolve per radius group (20 and 0)").toHaveLength(2);
    expect(f.calls.errors).toEqual([]);
  });

  it("given_an_element_at_the_canvas_edge_with_a_far_offset_and_a_large_blur_when_rendering_then_every_scissor_is_clamped_inside_its_attachment_review_focus_4", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0, parseBoxShadow("rgba(0, 0, 0, 0.5) 120px 90px 64px 10px")), undefined], { x0: 380 }));
    const scissors = f.calls.passes.flatMap((p) => p.scissors.map((s) => ({ s, t: p.attachments[0]!.view.texture })));
    expect(scissors.length).toBeGreaterThan(0);
    expect(scissors.some(({ s, t }) => s[0] + s[2] === t.width), "a rect reaching past the right edge is cut at it").toBe(true);
    expect(f.calls.errors, "the fake flags every scissor outside its attachment").toEqual([]);
  });
});

describe("W88: what costs nothing, shadowsDrawn and the targets' life (D88-4, D88-13)", () => {
  it("given_a_moving_element_without_shadows_or_a_resting_one_when_rendering_then_no_shadow_pass_texture_or_buffer_and_the_screen_pass_starts_with_the_liquid_composite", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0, []), undefined]));
    r.render(frame([paint(0), undefined], { rest: true }));
    r.render(frame([paint(0), undefined], { suppressShadows: true }));
    expect(passLabels(f)).toEqual(["liquiddom splat", "liquiddom screen", "liquiddom splat", "liquiddom screen", "liquiddom splat", "liquiddom screen"]);
    expect(shadowTextures(f)).toEqual([]);
    expect(f.calls.buffers.filter((b) => String(b.label).startsWith("liquiddom shadow"))).toEqual([]);
    expect(label(screenOf(f).draws[0]!.pipeline)).toBe("liquiddom composite");
    expect(r.shadowsDrawn(0)).toBe(false);
  });

  it("given_a_dragged_element_at_restAlpha_1_when_rendering_then_its_shadow_passes_run_D88_1", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0), undefined], { rest: true, dragged: true }));
    expect(passLabels(f)).toContain("liquiddom shadow knockout");
    expect(r.shadowsDrawn(0)).toBe(true);
  });

  it("given_shadows_drawn_when_resized_lost_or_destroyed_then_the_targets_are_rebuilt_at_the_new_size_shadowsDrawn_turns_false_and_nothing_is_left_or_flagged", async () => {
    const { r, f } = await ready();
    r.render(frame([paint(0), undefined]));
    const first = shadowTextures(f);
    expect(first.length).toBeGreaterThan(0);
    r.resize(1000, 600, 2);
    expect(first.every((t) => t.destroyed), "a resize drops the targets").toBe(true);
    r.render(frame([paint(0), undefined]));
    expect(shadowTextures(f).find((t) => t.label === "liquiddom shadow density" && !t.destroyed)!.width).toBe(500);
    expect(r.shadowsDrawn(0)).toBe(true);
    r.render(frame([paint(0), undefined], { rest: true }));
    expect(r.shadowsDrawn(0), "a frame without the element's shadow").toBe(false);
    r.render(frame([paint(0), undefined]));
    f.loseDevice("gpu reset");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    r.render(frame([paint(0), undefined]));
    expect(r.shadowsDrawn(0), "a lost device draws nothing").toBe(false);
    r.destroy();
    expect(shadowTextures(f).every((t) => t.destroyed)).toBe(true);
    expect(f.calls.buffers.filter((b) => String(b.label).startsWith("liquiddom shadow")).every((b) => b.destroyed)).toBe(true);
    expect(r.shadowsDrawn(0)).toBe(false);
    expect(f.calls.errors).toEqual([]);
  });
});
