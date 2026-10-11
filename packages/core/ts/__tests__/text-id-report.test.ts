/**
 * W79 (D79-1): demo/text-id-report.ts, the acceptance hook's reading of the WebGPU text id target
 * (test scaffolding; the e2e "labels never overlap" check rests on it).
 */
import { describe, expect, it } from "vitest";
import { halfToFloat, summarizeTextIds, type TextIdCaptureLike } from "../../../../demo/text-id-report";

/** IEEE half bits: 1, 2, 3, −2, −3 and the empty value 4096 = 2^12. */
const H = { one: 0x3c00, two: 0x4000, three: 0x4200, minusOne: 0xbc00, minusTwo: 0xc000, minusThree: 0xc200, empty: 0x6c00 };

/** A 3 × 2 capture with 256-byte rows (128 halves): `texels[y][x] = [r, g]`. */
function capture(texels: Array<Array<[number, number]>>): TextIdCaptureLike {
  const data = new Uint16Array(128 * 2);
  texels.forEach((row, y) => row.forEach(([r, g], x) => data.set([r, g], y * 128 + 2 * x)));
  return { textPass: true, width: 3, height: 2, bytesPerRow: 256, empty: 4096, data };
}

function pixels(white: Array<[number, number]>): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(3 * 2 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque black
  for (const [x, y] of white) data.set([245, 245, 245, 255], (y * 3 + x) * 4);
  return { width: 3, height: 2, data };
}

describe("W79: demo/text-id-report.ts (D79-1)", () => {
  it("given_half_float_bits_when_decoded_then_ids_their_negatives_the_empty_value_and_the_specials_round_trip", () => {
    expect([H.one, H.two, H.three, H.minusOne, H.minusTwo, H.minusThree, H.empty].map(halfToFloat)).toEqual([1, 2, 3, -1, -2, -3, 4096]);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(halfToFloat(0x5bf8), "255, the largest slot id (MAX_ELEMENTS_MAX 256), is exact").toBe(255);
  });

  it("given_a_capture_and_its_pixels_when_summarized_then_mixed_texels_are_those_with_min_below_max_and_text_on_them_is_counted", () => {
    const c = capture([
      [[H.empty, H.empty], [H.two, H.minusTwo], [H.two, H.minusThree]],
      [[H.three, H.minusThree], [H.one, H.minusThree], [H.empty, H.empty]],
    ]);
    const r = summarizeTextIds(c, pixels([[1, 0], [2, 0]]), 200);
    expect(r).toEqual({ textPass: true, mixed: 2, mixedTextPx: 1, textPx: 2, ids: [1, 2, 3] });
  });

  it("given_no_text_pass_or_a_size_mismatch_when_summarized_then_an_empty_report_or_a_throw", () => {
    const none: TextIdCaptureLike = { textPass: false, width: 0, height: 0, bytesPerRow: 0, empty: 4096, data: new Uint16Array(0) };
    expect(summarizeTextIds(none, pixels([]), 200)).toEqual({ textPass: false, mixed: 0, mixedTextPx: 0, textPx: 0, ids: [] });
    const c = capture([[[H.two, H.minusTwo], [H.empty, H.empty], [H.empty, H.empty]], [[H.empty, H.empty], [H.empty, H.empty], [H.empty, H.empty]]]);
    expect(() => summarizeTextIds(c, { width: 6, height: 4, data: new Uint8ClampedArray(96) }, 200)).toThrow(/capture 3x2 vs pixels 6x4/);
  });
});
