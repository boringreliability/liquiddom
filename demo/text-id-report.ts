/**
 * W79 (D79-1): the acceptance hook's reading of the WebGPU text id target (test scaffolding, like
 * render-counting-clock.ts; never part of the package). A capture holds the raw rg16float texels
 * of one frame: r = the smallest element id of every text splat that reached the texel, g = minus
 * the largest, both `empty` where none did. A texel is "mixed" when its smallest id is below its
 * largest: text splats of two elements met there, and no canvas text may show on it. Structural
 * types only, so the scene loads even before the renderer exports its own (W79.1 red).
 * W89 (D89-4): `summarizeInk` reads the same frame's T1mix (Σw·rank, the all-liquid Σw) with the
 * slots' ranks and counts the pixels of the ink zone: mixed texels whose fade is at least `zoneFade`.
 */
import { inkFade } from "../packages/core/ts/src/renderers/ink";
export interface TextIdCaptureLike {
  readonly textPass: boolean;
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly empty: number;
  readonly data: Uint16Array;
}

export interface PixelsLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface TextIdReport {
  textPass: boolean;
  /** Texels where the smallest id is below the largest. */
  mixed: number;
  /** Canvas text pixels (every channel and alpha ≥ textMin) on mixed texels. */
  mixedTextPx: number;
  /** Canvas text pixels anywhere in the capture. */
  textPx: number;
  /** Every slot id seen, ascending. */
  ids: number[];
  /** W79 red review (I3): the distinct mixed (smallest, largest) id pairs, ascending. */
  pairs: Array<[number, number]>;
  /** W79 red review (M1): canvas text pixels on texels where smallest == largest == id (one element only), by id. */
  textPxById: Record<number, number>;
}

/** IEEE 754 half (as its 16 bits) → number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** One frame's ids against the same frame's pixels (same size: T1 is at 1× the backing). */
export function summarizeTextIds(c: TextIdCaptureLike, px: PixelsLike, textMin: number): TextIdReport {
  const report: TextIdReport = { textPass: c.textPass, mixed: 0, mixedTextPx: 0, textPx: 0, ids: [], pairs: [], textPxById: {} };
  if (!c.textPass) return report;
  const pairSeen = new Map<number, [number, number]>();
  if (c.width !== px.width || c.height !== px.height) {
    throw new Error(`text-id-report: capture ${c.width}x${c.height} vs pixels ${px.width}x${px.height}`);
  }
  const seen = new Set<number>();
  const row = c.bytesPerRow / 2;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const o = (y * px.width + x) * 4;
      const d = px.data;
      const text = d[o + 3] >= textMin && d[o] >= textMin && d[o + 1] >= textMin && d[o + 2] >= textMin;
      if (text) report.textPx++;
      const lo = halfToFloat(c.data[y * row + 2 * x]);
      const hi = -halfToFloat(c.data[y * row + 2 * x + 1]);
      if (!(lo < c.empty)) continue;
      seen.add(lo);
      seen.add(hi);
      if (lo + 0.5 < hi) {
        report.mixed++;
        if (text) report.mixedTextPx++;
        pairSeen.set(lo * 4096 + hi, [lo, hi]);
      } else if (text) {
        report.textPxById[lo] = (report.textPxById[lo] ?? 0) + 1;
      }
    }
  }
  report.ids = [...seen].sort((a, b) => a - b);
  report.pairs = [...pairSeen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return report;
}

/** W89 (D89-4): a texel whose fade is at least this is in the ink zone (the crisp text weighs ≤ 0.1 there). */
export const INK_ZONE_FADE = 0.9;
/** W89: a zone pixel whose every channel is at least this is lit by ink (the card and Merge colours stay below it). */
export const INK_LIGHT_MIN = 64;

/**
 * W89: a capture that may carry T1mix (laid out like `data`) and the slots' dense ranks. T1mix is
 * half bits (rg16float) or, final review I1, the f32 values themselves (rg32float).
 */
export interface InkCaptureLike extends TextIdCaptureLike {
  readonly mix?: Uint16Array | Float32Array;
  readonly ranks?: readonly number[];
}

export interface InkReport {
  /** Mixed texels (smallest id < largest) whose fade is ≥ zoneFade. */
  zone: number;
  /** Canvas text pixels (every channel and alpha ≥ textMin) on zone texels: 0 is D89-4's "no crisp text where ink took over". */
  zoneTextPx: number;
  /** Zone pixels with every channel ≥ lightMin: the ink. */
  zoneLightPx: number;
}

/** One T1mix channel value: f32 as is, f16 decoded from its bits. */
function mixAt(mix: Uint16Array | Float32Array, i: number): number {
  return mix instanceof Float32Array ? (mix[i] ?? 0) : halfToFloat(mix[i] ?? 0);
}

/** W89 (D89-4): the ink zone of one frame; all 0 without a text pass, T1mix or ranks. */
export function summarizeInk(c: InkCaptureLike, px: PixelsLike, textMin: number, zoneFade: number, lightMin: number): InkReport {
  const report: InkReport = { zone: 0, zoneTextPx: 0, zoneLightPx: 0 };
  const { mix, ranks } = c;
  if (!c.textPass || !mix || !ranks) return report;
  if (c.width !== px.width || c.height !== px.height) {
    throw new Error(`text-id-report: capture ${c.width}x${c.height} vs pixels ${px.width}x${px.height}`);
  }
  const row = c.bytesPerRow / 2;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const t = y * row + 2 * x;
      const lo = halfToFloat(c.data[t] ?? 0);
      const hi = -halfToFloat(c.data[t + 1] ?? 0);
      if (!(lo < c.empty) || !(lo + 0.5 < hi)) continue;
      const fade = inkFade(mixAt(mix, t + 1), mixAt(mix, t), ranks[lo] ?? 0, ranks[hi] ?? 0);
      if (!(fade >= zoneFade)) continue;
      report.zone++;
      const o = (y * px.width + x) * 4;
      const d = px.data;
      if (d[o + 3]! >= textMin && d[o]! >= textMin && d[o + 1]! >= textMin && d[o + 2]! >= textMin) report.zoneTextPx++;
      if (d[o]! >= lightMin && d[o + 1]! >= lightMin && d[o + 2]! >= lightMin) report.zoneLightPx++;
    }
  }
  return report;
}

/** W89 (D89-4): upper edges of the fade bands whose text pixels A1 logs: [0.1, 0.2), [0.2, 0.5), [0.5, 0.9), [0.9, 1]. */
export const INK_BAND_EDGES = [0.1, 0.2, 0.5, 0.9] as const;

/**
 * W89 (D89-4, log only): canvas text pixels (every channel and alpha >= textMin) on mixed texels, per fade band
 * (see INK_BAND_EDGES). The last band is the asserted zone (0); the others are the soft edge A1 only logs.
 * All 0 without a text pass, T1mix or ranks.
 */
export function summarizeInkBands(c: InkCaptureLike, px: PixelsLike, textMin: number): [number, number, number, number] {
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  const { mix, ranks } = c;
  if (!c.textPass || !mix || !ranks) return bands;
  if (c.width !== px.width || c.height !== px.height) {
    throw new Error(`text-id-report: capture ${c.width}x${c.height} vs pixels ${px.width}x${px.height}`);
  }
  const row = c.bytesPerRow / 2;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const t = y * row + 2 * x;
      const lo = halfToFloat(c.data[t] ?? 0);
      const hi = -halfToFloat(c.data[t + 1] ?? 0);
      if (!(lo < c.empty) || !(lo + 0.5 < hi)) continue;
      const fade = inkFade(mixAt(mix, t + 1), mixAt(mix, t), ranks[lo] ?? 0, ranks[hi] ?? 0);
      if (!(fade >= INK_BAND_EDGES[0])) continue;
      const o = (y * px.width + x) * 4;
      const d = px.data;
      if (!(d[o + 3]! >= textMin && d[o]! >= textMin && d[o + 1]! >= textMin && d[o + 2]! >= textMin)) continue;
      bands[fade < INK_BAND_EDGES[1] ? 0 : fade < INK_BAND_EDGES[2] ? 1 : fade < INK_BAND_EDGES[3] ? 2 : 3]++;
    }
  }
  return bands;
}
