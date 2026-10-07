/**
 * W71: pure GPU buffer packing (renderers/webgpu/gpu-buffers.ts), incl. Review Focus 2
 * (empty scene), 3 (unobserve between generations) and 4 (translucent colour).
 */
import { describe, expect, it } from "vitest";
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
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import {
  EG,
  ELEMENT_GPU_FLOATS,
  OFFSCREEN_PX,
  packElements,
  packHomes,
  packParticles,
} from "../src/renderers/webgpu/gpu-buffers";

const CAP = 8;
const SLOTS = 4;
const BLUE = [47, 111, 222, 1] as const;
const GREEN = [26, 131, 97, 1] as const;

function paint(id: number, background: readonly [number, number, number, number], areaPerParticle: number): ElementPaint {
  return {
    id,
    background,
    text: [255, 255, 255, 1],
    radiusPx: 0,
    particleCount: 2,
    areaPerParticle,
    spacingPx: Math.sqrt(areaPerParticle),
    atlasRect: null,
  };
}

interface FrameOpts {
  active?: number;
  homes?: number[];
  paints?: Array<ElementPaint | undefined>;
  reducedMotion?: boolean;
  restAlpha?: number[];
}

function frame(o: FrameOpts = {}): RenderFrame {
  const dynamicView = new Float32Array(CAP * DYNAMIC_FIELDS);
  for (let i = 0; i < CAP; i++) {
    dynamicView[Dyn.X * CAP + i] = 10 + i;
    dynamicView[Dyn.Y * CAP + i] = 100 + i;
  }
  const staticView = new Float32Array(CAP * STATIC_FIELDS);
  (o.homes ?? [0, 0, 1, 1, HOME_NONE, Number.NaN, 2, 3]).forEach((h, i) => {
    staticView[Stat.HOME * CAP + i] = h;
  });
  const elementView = new Float32Array(SLOTS * ELEMENT_STRIDE);
  elementView.set([100, 100, 140, 48, 24, Interaction.IDLE, 0, 0, Number.NaN, Number.NaN], 0);
  elementView.set([300, 100, 100, 40, 8, Interaction.HOVER, 5, -3, Number.NaN, Number.NaN], ELEMENT_STRIDE);
  // Slot 2: unobserved this frame (w = 0); its paint lives until the next generation (B12).
  elementView.set([0, 0, 0, 0, 0, 0, 0, 0, Number.NaN, Number.NaN], 2 * ELEMENT_STRIDE);
  // Slot 3: active, but without a paint record.
  elementView.set([500, 100, 60, 30, 4, 0, 0, 0, Number.NaN, Number.NaN], 3 * ELEMENT_STRIDE);
  const stateView = new Float32Array(SLOTS * STATE_STRIDE);
  (o.restAlpha ?? [0.25, 1, 0, 0]).forEach((a, id) => {
    stateView[id * STATE_STRIDE + St.REST_ALPHA] = a;
  });
  return {
    dynamicView,
    staticView,
    generation: 3,
    stateView,
    elementView,
    particleCapacity: CAP,
    activeParticles: o.active ?? CAP,
    paints: o.paints ?? [paint(0, BLUE, 4), paint(1, GREEN, 9), paint(2, BLUE, 4), undefined],
    viewport: { widthCss: 800, heightCss: 600, dpr: 1 },
    reducedMotion: o.reducedMotion ?? false,
  };
}

function record(out: Float32Array, id: number): number[] {
  return Array.from(out.subarray(id * ELEMENT_GPU_FLOATS, (id + 1) * ELEMENT_GPU_FLOATS));
}

/** Compares the first `expected.length` floats (Float32 storage, 4 decimals). */
function expectRecord(actual: number[], expected: number[]): void {
  expected.forEach((v, i) => expect(actual[i], `float ${i}`).toBeCloseTo(v, 4));
}

describe("W71 gpu-buffers", () => {
  it("given_the_element_record_when_read_then_16_floats_64_bytes_with_the_wgsl_struct_offsets", () => {
    expect(ELEMENT_GPU_FLOATS).toBe(16);
    expect((ELEMENT_GPU_FLOATS * 4) % 16).toBe(0);
    expect(EG).toEqual({ X: 0, Y: 1, W: 2, H: 3, RADIUS: 4, REST_ALPHA: 5, MASS: 6, KERNEL_R: 7, R: 8, G: 9, B: 10, A: 11, FLAGS: 12 });
  });

  it("given_soa_positions_when_packParticles_then_x_y_are_interleaved_for_the_active_particles_and_the_count_is_returned", () => {
    const out = new Float32Array(CAP * 2 + 4).fill(7);
    expect(packParticles(frame(), out)).toBe(CAP);
    expect(Array.from(out.subarray(0, 6))).toEqual([10, 100, 11, 101, 12, 102]);
    expect(Array.from(out.subarray(14, 16))).toEqual([17, 107]);
    expect(Array.from(out.subarray(CAP * 2))).toEqual([7, 7, 7, 7]);
    const part = new Float32Array(CAP * 2).fill(7);
    expect(packParticles(frame({ active: 3 }), part)).toBe(3);
    expect(Array.from(part.subarray(6, 8))).toEqual([7, 7]);
  });

  it("given_non_finite_positions_when_packParticles_then_the_particle_goes_off_screen_and_a_too_small_output_throws_RangeError", () => {
    const f = frame();
    f.dynamicView[Dyn.X * CAP + 2] = Number.NaN;
    f.dynamicView[Dyn.Y * CAP + 5] = Number.POSITIVE_INFINITY;
    const out = new Float32Array(CAP * 2);
    packParticles(f, out);
    expect(Array.from(out.subarray(4, 6))).toEqual([OFFSCREEN_PX, OFFSCREEN_PX]);
    expect(Array.from(out.subarray(10, 12))).toEqual([OFFSCREEN_PX, OFFSCREEN_PX]);
    expect(Array.from(out.subarray(6, 8))).toEqual([13, 103]);
    expect(() => packParticles(f, new Float32Array(CAP * 2 - 1))).toThrow(RangeError);
    expect(() => packHomes(f, new Int32Array(CAP - 1))).toThrow(RangeError);
    expect(() => packElements(f, new Float32Array(SLOTS * ELEMENT_GPU_FLOATS - 1))).toThrow(RangeError);
  });

  it("given_an_empty_scene_when_packing_then_every_count_is_zero_and_no_particle_or_home_is_written_review_focus_2", () => {
    const empty = frame({ active: 0, paints: [undefined, undefined, undefined, undefined] });
    const xy = new Float32Array(CAP * 2).fill(7);
    const homes = new Int32Array(CAP).fill(9);
    expect(packParticles(empty, xy)).toBe(0);
    packHomes(empty, homes);
    expect(packElements(empty, new Float32Array(SLOTS * ELEMENT_GPU_FLOATS))).toBe(0);
    expect(xy.every((v) => v === 7)).toBe(true);
    expect(Array.from(homes)).toEqual(new Array(CAP).fill(9));
    expect(packParticles(frame({ active: 0 }), new Float32Array(0))).toBe(0);
  });

  it("given_homes_when_packHomes_then_painted_active_slot_ids_and_minus_one_for_none_nan_unpainted_inactive_fractional_or_out_of_range_review_focus_3", () => {
    const out = new Int32Array(CAP).fill(9);
    packHomes(frame(), out);
    // 0, 0, 1, 1: painted and active; HOME_NONE; NaN; slot 2 inactive (w = 0); slot 3 unpainted.
    expect(Array.from(out)).toEqual([0, 0, 1, 1, -1, -1, -1, -1]);
    packHomes(frame({ homes: [7, 1.5, -0, 4, 1, 1, 1, 1] }), out);
    expect(Array.from(out)).toEqual([-1, -1, 0, -1, 1, 1, 1, 1]);
  });

  it("given_painted_slots_when_packElements_then_home_rect_radius_rest_alpha_mass_kernel_radius_straight_colour_and_the_drawable_flag", () => {
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS).fill(7);
    expect(packElements(frame(), out)).toBe(2);
    expectRecord(record(out, 0), [100, 100, 140, 48, 24, 0.25, 4, 4.6, 47 / 255, 111 / 255, 222 / 255, 1, 1, 0, 0, 0]);
    const k = 1 + HOVER_SWELL; // slot 1 is hovered: home rect + (home_dx, home_dy), swelled about its centre
    expectRecord(record(out, 1), [
      305 - (100 * k - 100) / 2, 97 - (40 * k - 40) / 2, 100 * k, 40 * k, 8 * k,
      1, 9, 6.9, 26 / 255, 131 / 255, 97 / 255, 1, 1, 0, 0, 0,
    ]);
  });

  it("given_unpainted_or_inactive_slots_when_packElements_then_their_record_is_zero_and_the_count_ends_at_the_last_drawable_slot_review_focus_3", () => {
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS).fill(7);
    const all = [paint(0, BLUE, 4), paint(1, GREEN, 9), paint(2, BLUE, 4), paint(3, GREEN, 4)];
    expect(packElements(frame({ paints: all }), out)).toBe(4);
    expect(record(out, 2)).toEqual(new Array(ELEMENT_GPU_FLOATS).fill(0)); // w = 0: unobserved this frame
    expect(record(out, 3)[EG.FLAGS]).toBe(1);
    const fresh = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS).fill(7);
    expect(packElements(frame({ paints: [undefined, paint(1, GREEN, 9), undefined, undefined] }), fresh)).toBe(2);
    expect(record(fresh, 0)).toEqual(new Array(ELEMENT_GPU_FLOATS).fill(0)); // unpainted
  });

  it("given_a_translucent_background_and_odd_rest_alphas_when_packElements_then_alpha_is_kept_rgb_stays_straight_and_rest_alpha_is_clamped_review_focus_4", () => {
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS);
    const glass = [paint(0, [0, 128, 255, 0.5], 4), paint(1, BLUE, 9), undefined, undefined];
    packElements(frame({ paints: glass, restAlpha: [Number.NaN, 1.7, 0, 0] }), out);
    const r0 = record(out, 0);
    expect(r0[EG.R]).toBe(0);
    expect(r0[EG.G]).toBeCloseTo(128 / 255, 6);
    expect(r0[EG.B]).toBe(1);
    expect(r0[EG.A]).toBe(0.5);
    expect(r0[EG.REST_ALPHA]).toBe(0);
    expect(record(out, 1)[EG.REST_ALPHA]).toBe(1);
  });

  it("given_reduced_motion_when_packElements_then_a_hovered_slot_is_not_swelled", () => {
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS);
    packElements(frame({ reducedMotion: true }), out);
    expectRecord(record(out, 1), [305, 97, 100, 40, 8]);
  });

  // W71.4 review fix (Minor 6): a non-finite or out-of-range 8-bit channel is packed finite in [0, 1].
  it("given_nan_negative_and_over_255_background_channels_when_packElements_then_rgb_is_finite_and_clamped_to_0_1", () => {
    const out = new Float32Array(SLOTS * ELEMENT_GPU_FLOATS);
    const odd = [paint(0, [Number.NaN, -1, 300, 1], 4), paint(1, BLUE, 9), undefined, undefined];
    packElements(frame({ paints: odd }), out);
    const r0 = record(out, 0);
    expect([r0[EG.R], r0[EG.G], r0[EG.B]]).toEqual([0, 0, 1]);
  });
});
