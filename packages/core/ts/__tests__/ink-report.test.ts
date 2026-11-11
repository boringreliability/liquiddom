/**
 * W89 (D89-4): demo/text-id-report.ts `summarizeInk`, the acceptance hook's reading of the ink zone
 * (test scaffolding; the amended W79 e2e rests on it). A8: `summarizeTextIds` and its test are unchanged.
 */
import { describe, expect, it } from "vitest";
import { INK_LIGHT_MIN, INK_ZONE_FADE, summarizeInk, type InkCaptureLike } from "../../../../demo/text-id-report";

/** IEEE half bits of a normal, non-negative number (round to nearest). */
function half(v: number): number {
  if (v === 0) return 0;
  const e = Math.floor(Math.log2(v));
  const m = Math.round((v / 2 ** e - 1) * 1024);
  return m === 1024 ? ((e + 16) << 10) : ((e + 15) << 10) | m;
}
const neg = (h: number): number => h | 0x8000;
const EMPTY = half(4096);

/** A 3 × 2 capture with 256-byte rows: ids[y][x] = [lo, hi] (null = empty), mix[y][x] = [Σw·rank, Σw]. */
function capture(ids: Array<Array<[number, number] | null>>, mix: Array<Array<[number, number]>> | null, ranks: number[] | null): InkCaptureLike {
  const data = new Uint16Array(128 * 2);
  const m = new Uint16Array(128 * 2);
  ids.forEach((row, y) =>
    row.forEach((t, x) => {
      data.set(t ? [half(t[0]), neg(half(t[1]))] : [EMPTY, neg(EMPTY)], y * 128 + 2 * x);
      const [r, g] = mix?.[y]?.[x] ?? [0, 0];
      m.set([half(r), half(g)], y * 128 + 2 * x);
    }),
  );
  return { textPass: true, width: 3, height: 2, bytesPerRow: 256, empty: 4096, data, ...(mix ? { mix: m } : {}), ...(ranks ? { ranks } : {}) };
}

/** RGBA8 pixels: opaque dark card everywhere, `set[[x, y]]` elsewhere. */
function pixels(set: Array<[number, number, [number, number, number]]>): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(3 * 2 * 4);
  for (let i = 0; i < 6; i++) data.set([38, 50, 56, 255], i * 4);
  for (const [x, y, rgb] of set) data.set([...rgb, 255], (y * 3 + x) * 4);
  return { width: 3, height: 2, data };
}

describe("W89: demo/text-id-report.ts summarizeInk (D89-4)", () => {
  it("given_a_capture_with_T1mix_and_ranks_when_summarized_then_zone_texels_are_mixed_texels_at_or_above_the_fade_bound_and_text_and_ink_pixels_on_them_are_counted", () => {
    const c = capture(
      [
        [[2, 2], [2, 3], [2, 3]],
        [null, [2, 3], [3, 3]],
      ],
      [
        [[0, 1], [1, 2], [0.02, 2]],
        [[0, 0], [1, 2], [2, 2]],
      ],
      [-1, -1, 0, 1],
    );
    const r = summarizeInk(c, pixels([[1, 0, [245, 245, 245]], [1, 1, [120, 110, 100]], [2, 0, [245, 245, 245]]]), 200, INK_ZONE_FADE, INK_LIGHT_MIN);
    // (1,0) and (1,1) mix 2|3 at p = 0.5 (fade 1); (2,0) mixes at p = 0.01 (fade ≈ 0): outside the zone, its white is the soft edge D89-4 allows.
    expect(r).toEqual({ zone: 2, zoneTextPx: 1, zoneLightPx: 2 });
  });

  it("given_a_capture_without_T1mix_or_ranks_or_without_a_text_pass_when_summarized_then_an_empty_ink_report", () => {
    const ids: Array<Array<[number, number] | null>> = [[[2, 3], null, null], [null, null, null]];
    const mix: Array<Array<[number, number]>> = [[[1, 2], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]]];
    const none = { zone: 0, zoneTextPx: 0, zoneLightPx: 0 };
    expect(summarizeInk(capture(ids, null, [0, 0, 0, 1]), pixels([]), 200, INK_ZONE_FADE, INK_LIGHT_MIN)).toEqual(none);
    expect(summarizeInk(capture(ids, mix, null), pixels([]), 200, INK_ZONE_FADE, INK_LIGHT_MIN)).toEqual(none);
    expect(summarizeInk({ ...capture(ids, mix, [0, 0, 0, 1]), textPass: false }, pixels([]), 200, INK_ZONE_FADE, INK_LIGHT_MIN)).toEqual(none);
    expect([INK_ZONE_FADE, INK_LIGHT_MIN]).toEqual([0.9, 64]);
  });
  it("given_an_rg32float_capture_whose_mix_holds_f32_values_when_summarized_then_it_reads_them_as_values_like_the_half_bits_W89_final_review_I1", () => {
    const ids: Array<Array<[number, number] | null>> = [[[2, 2], [2, 3], [2, 3]], [null, [2, 3], [3, 3]]];
    // Non-integer sums: read as half bits they would turn into other numbers.
    const mix: Array<Array<[number, number]>> = [[[0, 1.5], [0.75, 1.5], [0.015, 1.5]], [[0, 0], [0.75, 1.5], [1.5, 1.5]]];
    const halves = capture(ids, mix, [-1, -1, 0, 1]);
    const f = new Float32Array(128 * 2);
    mix.forEach((row, y) => row.forEach(([r, g], x) => f.set([r, g], y * 128 + 2 * x)));
    const px = pixels([[1, 0, [245, 245, 245]], [1, 1, [120, 110, 100]], [2, 0, [245, 245, 245]]]);
    const expected = summarizeInk(halves, px, 200, INK_ZONE_FADE, INK_LIGHT_MIN);
    expect(expected).toEqual({ zone: 2, zoneTextPx: 1, zoneLightPx: 2 });
    expect(summarizeInk({ ...halves, mix: f }, px, 200, INK_ZONE_FADE, INK_LIGHT_MIN)).toEqual(expected);
  });
});
