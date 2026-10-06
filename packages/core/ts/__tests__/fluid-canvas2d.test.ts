/** W64: Canvas2D fluid renderer draw calls, with the shared fake canvas (A6). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Dyn,
  DYNAMIC_FIELDS,
  ELEMENT_STRIDE,
  HOME_NONE,
  HOVER_SWELL,
  Interaction,
  St,
  STATE_STRIDE,
  Stat,
  STATIC_FIELDS,
} from "../src/fluid-layout";
import { DensityGrid } from "../src/renderers/density-grid";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { installFakeCanvas2D, type FakeCanvasHandle, type FakeContext2D } from "./_fake-canvas";

const CAP = 700; // 70 × 10 particles on a 2 px lattice inside (100, 100, 140, 48)
const BLUE = [47, 111, 222, 1] as const;

let fake: FakeCanvasHandle;

beforeEach(() => {
  fake = installFakeCanvas2D();
});

afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

function paint(id: number): ElementPaint {
  return {
    id,
    background: BLUE,
    text: [255, 255, 255, 1],
    radiusPx: 24,
    particleCount: CAP,
    areaPerParticle: 4,
    spacingPx: 2,
    atlasRect: null,
  };
}

interface FrameOpts {
  restAlpha: number;
  dpr?: number;
  homes?: (i: number) => number;
  paints?: Array<ElementPaint | undefined>;
  interaction?: number;
  reducedMotion?: boolean;
}

function makeFrame(o: FrameOpts): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  const staticView = new Float32Array(CAP * STATIC_FIELDS);
  const stateView = new Float32Array(4 * STATE_STRIDE);
  const elementView = new Float32Array(4 * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, o.interaction ?? Interaction.IDLE, 0, 0, NaN, NaN], 0);
  for (let i = 0; i < CAP; i++) {
    dynamicView[Dyn.X * CAP + i] = 101 + 2 * (i % 70);
    dynamicView[Dyn.Y * CAP + i] = 101 + 2 * Math.floor(i / 70);
    dynamicView[Dyn.F00 * CAP + i] = 1;
    dynamicView[Dyn.F11 * CAP + i] = 1;
    staticView[Stat.HOME * CAP + i] = o.homes ? o.homes(i) : 0;
  }
  stateView[St.S] = 1;
  stateView[St.REST_ALPHA] = o.restAlpha;
  return {
    dynamicView,
    staticView,
    generation: 1,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: CAP,
    paints: o.paints ?? [paint(0)],
    viewport: { widthCss: 400, heightCss: 300, dpr: o.dpr ?? 1 },
    reducedMotion: o.reducedMotion ?? false,
  };
}

async function setup(dpr = 1): Promise<{ renderer: FluidCanvas2DRenderer; ctx: FakeContext2D; offCtx: FakeContext2D }> {
  const canvas = document.createElement("canvas");
  const renderer = new FluidCanvas2DRenderer();
  await renderer.init(canvas);
  renderer.resize(400 * dpr, 300 * dpr, dpr);
  const ctx = fake.ctxFor(canvas)!;
  const offCtx = fake.contexts.find((c) => c !== ctx)!;
  return { renderer, ctx, offCtx };
}

describe("W64 FluidCanvas2DRenderer", () => {
  it("given_rest_alpha_1_when_rendering_then_roundRect_filled_with_element_color_and_radius", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(makeFrame({ restAlpha: 1 }));
    expect(ctx.ops("roundRect").map((c) => c.args)).toEqual([[100, 100, 140, 48, 24]]);
    const fills = ctx.ops("fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe("rgb(47, 111, 222)");
    expect(fills[0].globalAlpha).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("given_rest_alpha_1_when_rendering_then_its_particles_add_no_density", async () => {
    const splat = vi.spyOn(DensityGrid.prototype, "splat");
    const { renderer, ctx, offCtx } = await setup();
    renderer.render(makeFrame({ restAlpha: 1 }));
    expect(splat).not.toHaveBeenCalled();
    expect(offCtx.ops("putImageData")).toHaveLength(0);
    expect(ctx.ops("drawImage")).toHaveLength(0);
  });

  it("given_rest_alpha_0_when_rendering_then_density_is_drawn_in_the_element_colour_and_upscaled", async () => {
    const { renderer, ctx, offCtx } = await setup();
    renderer.render(makeFrame({ restAlpha: 0 }));
    expect(ctx.ops("roundRect")).toHaveLength(0);
    expect(offCtx.ops("putImageData")).toHaveLength(1);
    const draw = ctx.ops("drawImage");
    expect(draw).toHaveLength(1);
    expect(draw[0].args.slice(1)).toEqual([0, 0, 400, 300]);
    const img = offCtx.lastImage!;
    const p = (55 * img.width + 85) * 4; // cell centred at (171, 111): inside the particle block
    expect(Array.from(img.data.subarray(p, p + 4))).toEqual([47, 111, 222, 255]);
  });

  it("given_particle_with_home_none_or_missing_paint_when_rendering_then_skipped", async () => {
    const splat = vi.spyOn(DensityGrid.prototype, "splat");
    const { renderer } = await setup();
    const homes = (i: number) => [0, HOME_NONE, 1][i % 3];
    renderer.render(makeFrame({ restAlpha: 0, homes, paints: [paint(0), undefined] }));
    expect(splat).toHaveBeenCalledTimes(Math.ceil(CAP / 3));
  });

  it("given_dpr_2_when_rendering_each_frame_then_setTransform_dpr_starts_the_frame_and_scale_is_never_called", async () => {
    const { renderer, ctx } = await setup(2);
    for (let f = 0; f < 2; f++) {
      const from = ctx.calls.length;
      renderer.render(makeFrame({ restAlpha: 1, dpr: 2 }));
      const frameCalls = ctx.calls.slice(from);
      expect(frameCalls[0].op).toBe("setTransform");
      expect(frameCalls[0].args).toEqual([2, 0, 0, 2, 0, 0]);
      expect(frameCalls.filter((c) => c.op === "clearRect").map((c) => c.args)).toEqual([[0, 0, 400, 300]]);
    }
    expect(ctx.ops("scale")).toHaveLength(0);
  });

  it("given_fractional_rest_alpha_and_background_alpha_when_rendering_then_global_alpha_is_their_product", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(makeFrame({ restAlpha: 0.5, paints: [{ ...paint(0), background: [47, 111, 222, 0.5] }] }));
    const fills = ctx.ops("fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].globalAlpha).toBeCloseTo(0.25, 6);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("given_hover_interaction_at_rest_when_rendering_then_roundRect_at_swelled_home_rect", async () => {
    const { renderer, ctx } = await setup();
    renderer.render(makeFrame({ restAlpha: 1, interaction: Interaction.HOVER }));
    const [x, y, w, h, r] = ctx.ops("roundRect")[0].args as number[];
    const k = 1 + HOVER_SWELL;
    expect(w).toBeCloseTo(140 * k, 4);
    expect(h).toBeCloseTo(48 * k, 4);
    expect(r).toBeCloseTo(24 * k, 4);
    expect(x + w / 2).toBeCloseTo(170, 4);
    expect(y + h / 2).toBeCloseTo(124, 4);
    renderer.render(makeFrame({ restAlpha: 1, interaction: Interaction.HOVER, reducedMotion: true }));
    expect(ctx.ops("roundRect")[1].args).toEqual([100, 100, 140, 48, 24]);
  });

  it("given_null_2d_context_when_init_then_rejects", async () => {
    fake.restore();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(new FluidCanvas2DRenderer().init(document.createElement("canvas"))).rejects.toThrow(
      /Canvas2D context unavailable/,
    );
  });

  it("given_resize_when_called_then_density_buffer_comes_from_createImageData_at_css_over_scale", async () => {
    const { renderer, offCtx } = await setup();
    renderer.resize(800, 600, 2);
    expect(offCtx.ops("createImageData").map((c) => c.args).at(-1)).toEqual([200, 150]);
    expect(offCtx.canvas.width).toBe(200);
    expect(offCtx.canvas.height).toBe(150);
  });
});

describe("W70 D70-4: full density weight during the Canvas2D cross-fade", () => {
  it("given_fractional_rest_alpha_when_rendering_then_every_particle_splats_at_full_weight", async () => {
    const splat = vi.spyOn(DensityGrid.prototype, "splat");
    const { renderer } = await setup();
    renderer.render(makeFrame({ restAlpha: 0.58 }));
    expect(splat).toHaveBeenCalledTimes(CAP);
    for (const call of splat.mock.calls) expect(call[5]).toBe(1);
  });

  it("given_rest_alpha_0_58_when_rendering_then_the_interior_density_is_opaque_and_the_roundRect_fades_in_on_top", async () => {
    // W69: weight 1 − 0.58 = 0.42 put the interior density at the 0.4–0.6 smoothstep's foot
    // (alpha ≈ 7/255) under a roundRect at 0.58: the pale flash (~151/255 composite).
    const { renderer, ctx, offCtx } = await setup();
    renderer.render(makeFrame({ restAlpha: 0.58 }));
    const img = offCtx.lastImage!;
    const p = (55 * img.width + 85) * 4; // cell centred at (171, 111): inside the particle block
    expect(Array.from(img.data.subarray(p, p + 4))).toEqual([47, 111, 222, 255]);
    const fills = ctx.ops("fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].globalAlpha).toBeCloseTo(0.58, 6);
    const order = ctx.calls.map((c) => c.op).filter((op) => op === "drawImage" || op === "fill");
    expect(order, "density first, the rest contour on top").toEqual(["drawImage", "fill"]);
  });
});
