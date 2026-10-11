/**
 * W79 (D79-1): the acceptance hook's reading of the WebGPU text id target (test scaffolding, like
 * render-counting-clock.ts; never part of the package). A capture holds the raw rg16float texels
 * of one frame: r = the smallest element id of every text splat that reached the texel, g = minus
 * the largest, both `empty` where none did. A texel is "mixed" when its smallest id is below its
 * largest: text splats of two elements met there, and no canvas text may show on it. Structural
 * types only, so the scene loads even before the renderer exports its own (W79.1 red).
 */
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
  const report: TextIdReport = { textPass: c.textPass, mixed: 0, mixedTextPx: 0, textPx: 0, ids: [] };
  if (!c.textPass) return report;
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
      }
    }
  }
  report.ids = [...seen].sort((a, b) => a - b);
  return report;
}
