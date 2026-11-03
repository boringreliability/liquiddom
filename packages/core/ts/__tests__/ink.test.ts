/**
 * W89 (D89-1, D89-2, D89-8, D89-11; Review Focus 4, 5): the ink maths both renderers share
 * (renderers/ink.ts; the WGSL mirrors it).
 */
import { describe, expect, it } from "vitest";
import { INK_ALPHA_CAP, INK_FADE_HI, INK_FADE_LO, INK_GAIN, INK_SAMPLES, blendInk, denseRanks, fadeOf, inkFade, inkScale, mixOf, particleInk, type AtlasPixels } from "../src/renderers/ink";

/** IEEE half rounding (nearest, ties to even): what one additive blend into an f16 target keeps. */
function f16(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const step = 2 ** (Math.max(Math.floor(Math.log2(Math.abs(v))), -14) - 10);
  const [q, lo] = [v / step, Math.floor(v / step)];
  return (q - lo > 0.5 || (q - lo === 0.5 && lo % 2 !== 0) ? lo + 1 : lo) * step;
}

/** A page of `w × h` RGBA8 texels, `fill(x, y)` each (not premultiplied, as getImageData returns). */
function page(w: number, h: number, fill: (x: number, y: number) => readonly [number, number, number, number]): AtlasPixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

const inkAt = (pg: AtlasPixels, u: number, v: number, cell: number, rect = { x: 0, y: 0, w: pg.width, h: pg.height }): number[] => {
  const out = new Float32Array(8).fill(7);
  particleInk(pg, rect, u, v, cell, out, 4);
  expect(Array.from(out.subarray(0, 4)), "writes only out[at … at + 3]").toEqual([7, 7, 7, 7]);
  return Array.from(out.subarray(4, 8));
};

describe("W89 ink maths (D89-1, D89-2, D89-8)", () => {
  it("given_one_element_lo_equal_hi_or_no_liquid_when_mixed_then_mix_and_fade_are_0_D89_1", () => {
    expect([mixOf(5, 5, 5), mixOf(0, 0, 1), mixOf(1, 0, 1), mixOf(Number.NaN, 0, 1), mixOf(0.5, 1, 0)]).toEqual([0, 0, 0, 0, 0]);
    expect(inkFade(1, 0, 0, 0), "one element: today's path").toBe(0);
    expect(inkFade(0, 0, 0, 1), "no liquid").toBe(0);
    expect(inkFade(2, 2, 1, 1), "lo == hi").toBe(0);
  });

  it("given_a_50_50_mix_when_inkFade_then_mix_1_and_fade_1_and_a_25_75_mix_gives_mix_0_75_D89_1", () => {
    expect(mixOf(0.5, 0, 1)).toBe(1);
    expect(mixOf(0.25, 0, 1)).toBeCloseTo(0.75, 12);
    expect(mixOf(3.5, 3, 4)).toBe(1);
    expect(inkFade(2, 1, 0, 1)).toBe(1);
    expect(inkFade(4, 1, 0, 1), "p = 0.25 → mix 0.75 ≥ INK_FADE_HI").toBe(1);
  });

  it("given_mix_values_around_the_thresholds_when_fadeOf_then_smoothstep_from_INK_FADE_LO_to_INK_FADE_HI_D89_1", () => {
    expect(fadeOf(INK_FADE_LO)).toBe(0);
    expect(fadeOf(0)).toBe(0);
    expect(fadeOf(INK_FADE_HI)).toBe(1);
    expect(fadeOf(1)).toBe(1);
    expect(fadeOf((INK_FADE_LO + INK_FADE_HI) / 2)).toBeCloseTo(0.5, 12);
    expect(fadeOf(Number.NaN)).toBe(0);
    const t = 0.25;
    expect(fadeOf(INK_FADE_LO + t * (INK_FADE_HI - INK_FADE_LO))).toBeCloseTo(t * t * (3 - 2 * t), 12);
  });

  it("given_three_ranks_in_one_pixel_when_inkFade_then_the_fade_stays_above_0_where_they_mix_review_focus_4", () => {
    const fadeOfWeights = (w: readonly [number, number, number]): number => {
      const sumW = w[0] + w[1] + w[2];
      return inkFade(sumW, w[1] * 1 + w[2] * 2, 0, 2);
    };
    expect(fadeOfWeights([1, 1, 1])).toBe(1);
    expect(fadeOfWeights([0.6, 0.1, 0.3])).toBeGreaterThan(0.5);
    expect(fadeOfWeights([0.05, 0.9, 0.05]), "the middle element dominates").toBeGreaterThan(0.5);
    expect(fadeOfWeights([0.9, 0, 0.1])).toBeGreaterThan(0.5);
  });

  it("given_crisp_ink_and_fade_when_blendInk_then_crisp_times_1_minus_fade_plus_ink_times_fade_with_fade_clamped_D89_1", () => {
    expect(blendInk(1, 0.2, 0)).toBe(1);
    expect(blendInk(1, 0.2, 1)).toBe(0.2);
    expect(blendInk(1, 0.2, 0.5)).toBeCloseTo(0.6, 12);
    expect(blendInk(1, 0.2, 2)).toBe(0.2);
    expect(blendInk(1, 0.2, -1)).toBe(1);
  });

  it("given_sums_when_inkScale_then_gain_over_sum_w_capped_at_INK_ALPHA_CAP_and_0_without_liquid_D89_2", () => {
    expect(inkScale(0.2, 1)).toBeCloseTo(INK_GAIN, 6);
    expect(inkScale(0.1, 2)).toBeCloseTo(INK_GAIN / 2, 6);
    expect(1 * inkScale(1, 1), "a full cell of ink is capped").toBeCloseTo(INK_ALPHA_CAP, 6);
    expect(3 * inkScale(3, 2)).toBeCloseTo(INK_ALPHA_CAP, 6);
    expect([inkScale(0.3, 0), inkScale(Number.NaN, 1), inkScale(0.3, Number.NaN)]).toEqual([0, 0, 0]);
    expect(inkScale(0, 1), "no ink: the factor is still gain / Σw").toBeCloseTo(INK_GAIN, 6);
  });

  it("given_the_tunable_values_when_read_then_the_zone_is_never_wider_and_the_ink_never_stronger_than_the_spike_D89_11", () => {
    expect(INK_GAIN).toBeLessThanOrEqual(1.2);
    expect(INK_ALPHA_CAP).toBeLessThanOrEqual(1);
    expect(INK_ALPHA_CAP).toBeGreaterThan(0);
    expect(INK_FADE_LO).toBeGreaterThanOrEqual(0.03);
    expect(INK_FADE_HI).toBeGreaterThanOrEqual(0.3);
    expect(INK_FADE_HI).toBeGreaterThan(INK_FADE_LO);
    expect(INK_SAMPLES).toBe(4);
  });

  it("given_an_atlas_page_when_particleInk_then_the_mean_premultiplied_texel_over_the_rest_cell_is_text_colour_times_coverage_D89_2", () => {
    const white = page(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(inkAt(white, 0.5, 0.5, 4), "the cell lies inside the glyph").toEqual([1, 1, 1, 1]);
    expect(inkAt(white, 0.25, 0.25, 4), "a quarter of the cell is glyph").toEqual([0.25, 0.25, 0.25, 0.25]);
    const red = page(8, 8, () => [255, 0, 0, 128]);
    const r = inkAt(red, 0.5, 0.5, 4);
    expect(r[0]).toBeCloseTo(128 / 255, 6);
    expect([r[1], r[2]]).toEqual([0, 0]);
    expect(r[3]).toBeCloseTo(128 / 255, 6);
    const offset = page(16, 16, (x, y) => (x >= 10 && y >= 10 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(inkAt(offset, 0.5, 0.5, 4, { x: 8, y: 8, w: 4, h: 4 }), "the rect places the cell: centre (10, 10)").toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("given_a_rest_cell_partly_off_the_page_or_a_blank_cell_when_particleInk_then_off_page_taps_count_as_transparent_and_a_blank_cell_is_0_D89_2", () => {
    const full = page(8, 8, () => [255, 255, 255, 255]);
    expect(inkAt(full, 1, 0.5, 4), "two of four columns lie past x = 8").toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(inkAt(full, 1, 1, 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    const blank = page(8, 8, () => [255, 255, 255, 0]);
    expect(inkAt(blank, 0.5, 0.5, 4)).toEqual([0, 0, 0, 0]);
  });

  it("given_moving_slots_with_ids_up_to_255_when_denseRanks_then_ranks_0_to_k_minus_1_in_id_order_and_minus_1_elsewhere_D89_8", () => {
    const moving = new Uint8Array(256);
    for (const id of [255, 3, 254]) moving[id] = 1;
    const out = new Int16Array(256).fill(9);
    expect(denseRanks(moving, out)).toBe(3);
    expect([out[3], out[254], out[255]]).toEqual([0, 1, 2]);
    expect(Array.from(out).filter((r) => r === -1)).toHaveLength(253);
    expect(denseRanks(new Uint8Array(4), out)).toBe(0);
    expect(Array.from(out).every((r) => r === -1)).toBe(true);
  });

  it("given_15_fragments_accumulated_in_f16_when_p_is_read_from_ranks_then_it_matches_the_exact_p_for_ids_254_and_255_review_focus_5", () => {
    const moving = new Uint8Array(256);
    moving[254] = 1;
    moving[255] = 1;
    const ranks = new Int16Array(256);
    denseRanks(moving, ranks);
    let sumW = 0;
    let sumWRank = 0;
    let sumWId = 0;
    let exactB = 0;
    let exactW = 0;
    for (let k = 0; k < 15; k++) {
      const id = k % 3 === 0 ? 255 : 254;
      const w = 0.04 + 0.013 * k;
      sumW = f16(sumW + w);
      sumWRank = f16(sumWRank + f16(w * (ranks[id] ?? -1)));
      sumWId = f16(sumWId + f16(w * id));
      exactW += w;
      if (id === 255) exactB += w;
    }
    const p = exactB / exactW;
    const lo = ranks[254] ?? -1;
    const hi = ranks[255] ?? -1;
    expect([lo, hi]).toEqual([0, 1]);
    const pRank = (sumWRank / sumW - lo) / (hi - lo);
    const pId = sumWId / sumW - 254;
    expect(Math.abs(pRank - p), `p from ranks ${pRank} vs exact ${p}`).toBeLessThan(0.01);
    expect(Math.abs(pId - p), `p from raw ids ${pId} (the f16 step at 254 · Σw is 0.25)`).toBeGreaterThan(0.02);
    expect(inkFade(sumW, sumWRank, lo, hi)).toBeCloseTo(fadeOf(mixOf(lo + p * (hi - lo), lo, hi)), 2);
  });
});
