/**
 * W89 (Epic 16; D89-1, D89-2, D89-8, D89-11): the ink maths both renderers share. Canvas2D calls it
 * per cell (ink-canvas2d.ts); the WGSL mirrors it (shaders.ts interpolates these constants). Pure.
 */
import type { AtlasRect } from "./webgpu/text-atlas";

/** D89-2: resolved ink = Σw·ink / Σw × INK_GAIN (spike 1.2). D89-11: tunable, never above 1.2. */
export const INK_GAIN = 1.2;
/** D89-11: the resolved ink alpha never exceeds this (spike suggestion ≈ 0.6); tunable, never above 1. */
export const INK_ALPHA_CAP = 0.6;
/** D89-1: fade = smoothstep(INK_FADE_LO, INK_FADE_HI, mix) (spike 0.03, 0.3). D89-11: tunable, never lower. */
export const INK_FADE_LO = 0.03;
export const INK_FADE_HI = 0.3;
/** D89-2: per-particle ink taps per side of the rest cell (4 × 4). */
export const INK_SAMPLES = 4;

/** An atlas page as getImageData returns it: RGBA8, not premultiplied, row by row. */
export interface AtlasPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** D89-1: 4p(1 − p), p = (meanRank − lo) / (hi − lo) clamped to [0, 1]; 0 unless hi > lo (and for NaN). */
export function mixOf(meanRank: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 0;
  const p = Math.min(1, Math.max(0, (meanRank - lo) / (hi - lo)));
  return p === p ? 4 * p * (1 - p) : 0;
}

/** D89-1: smoothstep(INK_FADE_LO, INK_FADE_HI, mix); 0 for NaN. */
export function fadeOf(mix: number): number {
  if (mix !== mix) return 0;
  const t = Math.min(1, Math.max(0, (mix - INK_FADE_LO) / (INK_FADE_HI - INK_FADE_LO)));
  return t * t * (3 - 2 * t);
}

/** D89-1: fadeOf(mixOf(Σw·rank / Σw, lo, hi)); 0 without liquid (Σw ≤ 0). */
export function inkFade(sumW: number, sumWRank: number, lo: number, hi: number): number {
  if (!(sumW > 0)) return 0;
  return fadeOf(mixOf(sumWRank / sumW, lo, hi));
}

/** D89-2, D89-11: the factor turning Σw·ink (premultiplied) into the resolved ink: INK_GAIN / Σw, lowered so the alpha stays ≤ INK_ALPHA_CAP; 0 without liquid or for NaN. */
export function inkScale(sumWInkA: number, sumW: number): number {
  if (!(sumW > 0) || !(sumWInkA >= 0)) return 0;
  let k = INK_GAIN / sumW;
  if (sumWInkA * k > INK_ALPHA_CAP) k = INK_ALPHA_CAP / sumWInkA;
  return k;
}

/** D89-1: one premultiplied channel: crisp × (1 − fade) + ink × fade, fade clamped to [0, 1]. */
export function blendInk(crisp: number, ink: number, fade: number): number {
  const f = Math.min(1, Math.max(0, fade));
  return crisp * (1 - f) + ink * f;
}

/**
 * D89-2: the mean premultiplied texel over a particle's rest cell into out[at … at + 3] (r, g, b, a,
 * 0–1): a `cellPx` square (atlas px) centred on (rect.x + u·rect.w, rect.y + v·rect.h), INK_SAMPLES²
 * cell-centred taps, each the texel under it (floor); a tap off the page counts as transparent.
 */
export function particleInk(page: AtlasPixels, rect: AtlasRect, u: number, v: number, cellPx: number, out: Float32Array, at: number): void {
  const cx = rect.x + u * rect.w;
  const cy = rect.y + v * rect.h;
  const step = cellPx / INK_SAMPLES;
  const x0 = cx - cellPx / 2 + step / 2;
  const y0 = cy - cellPx / 2 + step / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < INK_SAMPLES; j++) {
    const ty = Math.floor(y0 + j * step);
    if (ty < 0 || ty >= page.height) continue;
    for (let i = 0; i < INK_SAMPLES; i++) {
      const tx = Math.floor(x0 + i * step);
      if (tx < 0 || tx >= page.width) continue;
      const o = (ty * page.width + tx) * 4;
      const al = (page.data[o + 3] ?? 0) / 255;
      r += ((page.data[o] ?? 0) / 255) * al;
      g += ((page.data[o + 1] ?? 0) / 255) * al;
      b += ((page.data[o + 2] ?? 0) / 255) * al;
      a += al;
    }
  }
  const n = INK_SAMPLES * INK_SAMPLES;
  out[at] = r / n;
  out[at + 1] = g / n;
  out[at + 2] = b / n;
  out[at + 3] = a / n;
}

/** D89-8 (a): out[id] = 0 … k−1 for every slot with moving[id] === 1, in id order, −1 for the rest; returns k. */
export function denseRanks(moving: ArrayLike<number>, out: Int16Array): number {
  out.fill(-1);
  let k = 0;
  const n = Math.min(moving.length, out.length);
  for (let id = 0; id < n; id++) if (moving[id] === 1) out[id] = k++;
  return k;
}
