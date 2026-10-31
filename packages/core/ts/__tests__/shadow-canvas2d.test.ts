/**
 * @vitest-environment jsdom
 * W88 (D88-4, D88-5, D88-10, D88-12, D88-14; Review Focus 4): Canvas2D shadows through
 * FluidCanvas2DRenderer and the shared fake canvas (A6), which records the shadow state and the
 * composite operation of every call. Contexts in creation order: the main canvas, the density
 * buffer (init), then the shadow mask, the spread scratch and the knockout image (first shadow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, FLAG_PARKED, Interaction, St, STATE_STRIDE, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { kernelRadiusPx } from "../src/renderers/kernel-params";
import { KNOCKOUT_CLOSE_PER_KERNEL } from "../src/renderers/shadow-plan";
import { parseBoxShadow, type ShadowLayer } from "../src/shadow";
import { installFakeCanvas2D, type FakeCall, type FakeCanvasHandle, type FakeContext2D } from "./_fake-canvas";

const CAP = 700; // 70 × 10 particles on a 2 px lattice inside (100, 100, 140, 48)
const BLUE = [47, 111, 222, 1] as const;
const R = kernelRadiusPx(2); // 4.6 px; the density cell stays 2 px
const CELL = 2;
const MIN_X = 101;
const MIN_Y = 101;
const DROP = parseBoxShadow("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");

let fake: FakeCanvasHandle;
beforeEach(() => {
  fake = installFakeCanvas2D();
});
afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

function paint(id: number, shadows: readonly ShadowLayer[] = DROP): ElementPaint {
  return { id, background: BLUE, text: [255, 255, 255, 1], radiusPx: 24, particleCount: CAP, areaPerParticle: 4, spacingPx: 2, atlasRect: null, shadows };
}

interface FrameOpts {
  restAlpha?: number;
  paints?: Array<ElementPaint | undefined>;
  homes?: (i: number) => number;
  /** Particles removed (their home set to −1) — e.g. a hole. */
  drop?: (x: number, y: number) => boolean;
  flags?: number;
  interaction?: number;
  w?: number;
  reducedMotion?: boolean;
  suppressShadows?: boolean;
  viewport?: { widthCss: number; heightCss: number; dpr: number };
}

function frame(o: FrameOpts = {}): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  const staticView = new Float32Array(CAP * STATIC_FIELDS);
  const stateView = new Float32Array(4 * STATE_STRIDE);
  const elementView = new Float32Array(4 * ELEMENT_STRIDE);
  elementView.set([100, 100, o.w ?? 140, 48, 24, o.interaction ?? Interaction.IDLE, 0, 0, NaN, NaN], 0);
  elementView.set([300, 100, 60, 40, 8, Interaction.IDLE, 0, 0, NaN, NaN], ELEMENT_STRIDE);
  for (let i = 0; i < CAP; i++) {
    const x = MIN_X + 2 * (i % 70);
    const y = MIN_Y + 2 * Math.floor(i / 70);
    dynamicView[Dyn.X * CAP + i] = x;
    dynamicView[Dyn.Y * CAP + i] = y;
    dynamicView[Dyn.F00 * CAP + i] = 1;
    dynamicView[Dyn.F11 * CAP + i] = 1;
    dynamicView[Dyn.FLAGS * CAP + i] = o.flags ?? 0;
    staticView[Stat.HOME * CAP + i] = o.drop?.(x, y) ? -1 : o.homes ? o.homes(i) : 0;
  }
  stateView[St.REST_ALPHA] = o.restAlpha ?? 0;
  stateView[STATE_STRIDE + St.REST_ALPHA] = o.restAlpha ?? 0;
  return {
    dynamicView,
    staticView,
    generation: 1,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: CAP,
    paints: o.paints ?? [paint(0)],
    viewport: o.viewport ?? { widthCss: 400, heightCss: 300, dpr: 1 },
    reducedMotion: o.reducedMotion ?? false,
    ...(o.suppressShadows === undefined ? {} : { suppressShadows: o.suppressShadows }),
  };
}

async function setup(widthCss = 400, heightCss = 300, dpr = 1): Promise<{ renderer: FluidCanvas2DRenderer; ctx: FakeContext2D; canvas: HTMLCanvasElement }> {
  const canvas = document.createElement("canvas");
  const renderer = new FluidCanvas2DRenderer();
  await renderer.init(canvas);
  renderer.resize(widthCss * dpr, heightCss * dpr, dpr);
  return { renderer, ctx: fake.ctxFor(canvas)!, canvas };
}

const shadowDraws = (ctx: FakeContext2D): FakeCall[] => ctx.ops("drawImage").filter((c) => c.shadowColor !== "rgba(0, 0, 0, 0)");
const knockoutDraws = (ctx: FakeContext2D): FakeCall[] => ctx.ops("drawImage").filter((c) => c.composite === "destination-out");
/** The density image: the one drawImage with five arguments (the off canvas, 0, 0, w, h). */
const densityIndex = (ctx: FakeContext2D): number => ctx.calls.findIndex((c) => c.op === "drawImage" && c.args.length === 5 && c.composite === "source-over");
/** The mask's CSS origin: the caster's particle bounds grown by the kernel radius, floored to the cell. */
const MASK_X = Math.floor((MIN_X - R) / CELL) * CELL;
const MASK_Y = Math.floor((MIN_Y - R) / CELL) * CELL;

describe("W88: Canvas2D shadows (D88-4, D88-5, D88-14)", () => {
  it("given_a_moving_element_with_one_layer_when_rendered_then_its_shadow_is_drawn_before_the_density_image_with_the_css_colour_blur_and_offset", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(frame());
    const draws = shadowDraws(ctx);
    expect(draws).toHaveLength(1);
    const d = draws[0]!;
    expect(d.shadowColor).toBe("rgba(0, 0, 0, 0.4)");
    expect(d.shadowBlur).toBe(20);
    expect(d.shadowOffsetY).toBe(8);
    expect(d.composite).toBe("source-over");
    expect(ctx.calls.indexOf(d), "D88-4: before all liquid").toBeLessThan(densityIndex(ctx));
    expect(densityIndex(ctx)).toBeGreaterThan(-1);
    expect(ctx.shadowColor, "the shadow state is reset after the shadows").toBe("rgba(0, 0, 0, 0)");
    expect([ctx.shadowBlur, ctx.shadowOffsetX, ctx.shadowOffsetY]).toEqual([0, 0, 0]);
    expect(renderer.shadowsDrawn?.(0)).toBe(true);
  });

  it("given_the_mask_drawn_off_the_canvas_when_rendered_then_the_source_lies_left_of_x_0_and_the_offset_brings_the_shadow_back_to_the_mask_D88_5", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(frame());
    const d = shadowDraws(ctx)[0]!;
    const [, , , , , dx, dy, dw, dh] = d.args as number[];
    expect(dx! + dw!, "the source's right edge is off the canvas").toBeLessThanOrEqual(0);
    expect(dx! + d.shadowOffsetX, "the shadow lands on the mask's own place").toBeCloseTo(MASK_X, 6);
    expect(dy).toBeCloseTo(MASK_Y, 6);
    expect(dw! % CELL).toBe(0);
    expect(dh! % CELL).toBe(0);
  });

  it("given_dpr_2_when_rendered_then_shadowBlur_and_both_offsets_including_the_off_canvas_compensation_are_scaled_by_the_dpr_D88_14", async () => {
    const { renderer, ctx } = await setup(400, 300, 2);
    renderer.render(frame({ viewport: { widthCss: 400, heightCss: 300, dpr: 2 } }));
    const d = shadowDraws(ctx)[0]!;
    const dx = (d.args as number[])[5]!;
    expect(d.shadowBlur).toBe(40);
    expect(d.shadowOffsetY).toBe(16);
    expect(dx * 2 + d.shadowOffsetX, "device px: the destination is transformed, the offset is not").toBeCloseTo(MASK_X * 2, 6);
    expect(ctx.ops("setTransform")[0]!.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it("given_three_layers_when_rendered_then_one_shadow_draw_per_layer_with_the_last_css_layer_first", async () => {
    const { renderer, ctx } = await setup();
    const layers = parseBoxShadow("rgb(255, 0, 0) 0px 0px 4px 0px, rgb(0, 255, 0) 0px 2px 8px 0px, rgb(0, 0, 255) 0px 4px 16px 0px");
    renderer.render(frame({ paints: [paint(0, layers)] }));
    expect(shadowDraws(ctx).map((c) => [c.shadowColor, c.shadowBlur])).toEqual([
      ["rgba(0, 0, 255, 1)", 16],
      ["rgba(0, 255, 0, 1)", 8],
      ["rgba(255, 0, 0, 1)", 4],
    ]);
  });

  it("given_a_spread_layer_with_blur_0_when_rendered_then_an_8_direction_dilation_and_a_shadowBlur_floor_of_one_cell_D88_5_D88_12", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(frame({ paints: [paint(0, parseBoxShadow("rgba(0, 0, 0, 0.3) 0px 4px 0px 6px"))] }));
    const spread = fake.contexts[3]!;
    const copies = spread.ops("drawImage");
    expect(copies, "the centre and 8 shifted copies").toHaveLength(9);
    expect(copies.every((c) => c.composite === "source-over")).toBe(true);
    const offsets = copies.slice(1).map((c) => [(c.args[5] as number) - (copies[0]!.args[5] as number), (c.args[6] as number) - (copies[0]!.args[6] as number)]);
    for (const [ox, oy] of offsets) expect(Math.hypot(ox!, oy!), "each copy is shifted by the spread in cells").toBeCloseTo(6 / CELL, 6);
    const d = shadowDraws(ctx)[0]!;
    expect(d.args[0], "the dilated mask casts the shadow").toBe(spread.canvas);
    expect(d.shadowBlur, "D88-12: one density cell").toBe(CELL);
  });

  // approved-test change (saga dec_ffc55d76): the pad follows the 128 px cap, not the viewport diagonal
  it("given_a_spread_of_9999_when_rendered_then_the_spread_scratch_stays_within_the_128px_cap_pad_I1", async () => {
    const { renderer } = await setup();
    renderer.render(frame({ paints: [paint(0, parseBoxShadow("rgba(0, 0, 0, 0.5) 0px 0px 0px 9999px"))] }));
    const mask = fake.contexts[2]!.canvas;
    const scratch = fake.contexts[3]!.canvas;
    const pad = Math.ceil(128 / CELL) + 1; // SHADOW_SPREAD_CAP_PX
    // the scratch only grows past a canvas's default 300 × 150
    expect(scratch.width).toBeLessThanOrEqual(Math.max(300, mask.width + 2 * pad));
    expect(scratch.height).toBeLessThanOrEqual(Math.max(150, mask.height + 2 * pad));
  });

  it("given_a_negative_spread_when_rendered_then_the_8_shifted_copies_erode_the_mask_with_destination_in", async () => {
    const { renderer } = await setup();
    renderer.render(frame({ paints: [paint(0, parseBoxShadow("rgba(0, 0, 0, 0.3) 0px 6px 10px -4px"))] }));
    const copies = fake.contexts[3]!.ops("drawImage");
    expect(copies[0]!.composite).toBe("source-over");
    expect(copies.slice(1).map((c) => c.composite)).toEqual(Array(8).fill("destination-in"));
  });
});

describe("W88: the Canvas2D knockout (D88-10)", () => {
  it("given_shadows_when_rendered_then_one_destination_out_draw_of_the_knockout_image_follows_the_shadows_and_precedes_the_density_image", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(frame());
    const knock = knockoutDraws(ctx);
    expect(knock).toHaveLength(1);
    const k = ctx.calls.indexOf(knock[0]!);
    expect(k).toBeGreaterThan(ctx.calls.indexOf(shadowDraws(ctx)[0]!));
    expect(k).toBeLessThan(densityIndex(ctx));
    // W88.5b: only the caster's dirty rect (cells 48,48 75×15) is drawn, not the whole 400 × 300 grid
    expect(knock[0]!.args.slice(1)).toEqual([48, 48, 75, 15, 96, 96, 150, 30]);
    expect(knock[0]!.shadowColor, "the knockout casts no shadow").toBe("rgba(0, 0, 0, 0)");
    expect(ctx.globalCompositeOperation).toBe("source-over");
    expect(fake.contexts[4]!.ops("putImageData")).toHaveLength(1);
  });

  it("given_a_hole_in_the_liquid_when_rendered_then_the_mask_shows_the_hole_and_the_knockout_closes_it_while_the_page_beside_the_liquid_stays_clear", async () => {
    expect(KNOCKOUT_CLOSE_PER_KERNEL).toBe(1.5);
    const { renderer } = await setup();
    const hole = (x: number, y: number): boolean => Math.hypot(x - 171, y - 111) < 4.5;
    renderer.render(frame({ drop: hole }));
    const mask = fake.contexts[2]!.lastImage!;
    const knock = fake.contexts[4]!.lastImage!;
    const maskAlpha = (cx: number, cy: number): number => mask.data[((Math.floor(cy / CELL) - MASK_Y / CELL) * mask.width + (Math.floor(cx / CELL) - MASK_X / CELL)) * 4 + 3]!;
    const knockAlpha = (cx: number, cy: number): number => knock.data[(Math.floor(cy / CELL) * knock.width + Math.floor(cx / CELL)) * 4 + 3]!;
    expect(maskAlpha(171, 111), "the hole is in the liquid's own coverage").toBeLessThan(64);
    expect(maskAlpha(140, 111), "the liquid beside it").toBe(255);
    expect(knockAlpha(171, 111), "the closed coverage covers the hole").toBeGreaterThan(200);
    expect(knockAlpha(140, 111)).toBe(255);
    expect(knockAlpha(80, 111), "20 px beside the liquid the shadow stays").toBe(0);
    expect(knockAlpha(171, 130), "below the liquid (where the drop shadow falls) too").toBe(0);
  });
});

describe("W88: what casts no Canvas2D shadow (D88-4) and shadowsDrawn", () => {
  it("given_rest_parked_inactive_reduced_motion_suppressed_or_no_layers_when_rendered_then_no_shadow_draw_no_knockout_and_shadowsDrawn_false", async () => {
    const cases: Array<[string, FrameOpts]> = [
      ["at rest", { restAlpha: 1 }],
      ["parked", { flags: FLAG_PARKED }],
      ["inactive (w == 0)", { w: 0 }],
      ["reduced motion", { reducedMotion: true }],
      ["the stop repaint", { suppressShadows: true }],
      ["no layers", { paints: [paint(0, [])] }],
    ];
    for (const [name, o] of cases) {
      const { renderer, ctx } = await setup();
      renderer.render(frame(o));
      expect(shadowDraws(ctx), name).toEqual([]);
      expect(knockoutDraws(ctx), name).toEqual([]);
      expect(renderer.shadowsDrawn?.(0), name).toBe(false);
    }
  });

  it("given_two_elements_and_a_dragged_one_at_rest_when_rendered_then_shadowsDrawn_is_true_exactly_for_the_casters_of_the_last_render", async () => {
    const { renderer } = await setup();
    const homes = (i: number): number => (i < 350 ? 0 : 1);
    renderer.render(frame({ homes, paints: [paint(0), paint(1, [])] }));
    expect([renderer.shadowsDrawn?.(0), renderer.shadowsDrawn?.(1), renderer.shadowsDrawn?.(7)]).toEqual([true, false, false]);
    renderer.render(frame({ homes, restAlpha: 1, paints: [paint(0), paint(1, [])] }));
    expect(renderer.shadowsDrawn?.(0), "at rest the browser draws it").toBe(false);
    renderer.render(frame({ homes, restAlpha: 1, interaction: Interaction.DRAGGED, paints: [paint(0), paint(1, [])] }));
    expect(renderer.shadowsDrawn?.(0), "D88-1: dragged counts as away").toBe(true);
    renderer.destroy();
    expect(renderer.shadowsDrawn?.(0)).toBe(false);
  });

  it("given_a_small_container_canvas_and_a_caster_wholly_outside_the_grid_in_y_when_rendered_then_no_throw_the_shadow_is_drawn_for_the_canvas_to_clip_and_no_knockout_review_focus_4", async () => {
    const { renderer, ctx } = await setup(120, 80, 2);
    const big = parseBoxShadow("rgba(0, 0, 0, 0.5) 30px 40px 60px 12px");
    expect(() => renderer.render(frame({ paints: [paint(0, big)], viewport: { widthCss: 120, heightCss: 80, dpr: 2 } }))).not.toThrow();
    expect(shadowDraws(ctx)).toHaveLength(1);
    expect(knockoutDraws(ctx), "W88.5b: the caster lies outside the small grid, so its dirty rect is empty and nothing is drawn").toHaveLength(0);
    expect(renderer.shadowsDrawn?.(0)).toBe(true);
  });
});
