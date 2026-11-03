/**
 * W89 (Epic 16; D89-1, D89-2, D89-8, D89-11): the ink maths both renderers share. Canvas2D calls it
 * per cell (ink-canvas2d.ts); the WGSL mirrors it (shaders.ts interpolates these constants). Pure.
 * W89.1 red: inert bodies; W89.2 replaces them.
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
export function mixOf(_meanRank: number, _lo: number, _hi: number): number {
  return 0;
}

/** D89-1: smoothstep(INK_FADE_LO, INK_FADE_HI, mix); 0 for NaN. */
export function fadeOf(_mix: number): number {
  return 0;
}

/** D89-1: fadeOf(mixOf(Σw·rank / Σw, lo, hi)); 0 without liquid (Σw ≤ 0). */
export function inkFade(_sumW: number, _sumWRank: number, _lo: number, _hi: number): number {
  return 0;
}

/** D89-2, D89-11: the factor turning Σw·ink (premultiplied) into the resolved ink: INK_GAIN / Σw, lowered so the alpha stays ≤ INK_ALPHA_CAP; 0 without liquid or for NaN. */
export function inkScale(_sumWInkA: number, _sumW: number): number {
  return 0;
}

/** D89-1: one premultiplied channel: crisp × (1 − fade) + ink × fade, fade clamped to [0, 1]. */
export function blendInk(crisp: number, _ink: number, _fade: number): number {
  return crisp;
}

/**
 * D89-2: the mean premultiplied texel over a particle's rest cell into out[at … at + 3] (r, g, b, a,
 * 0–1): a `cellPx` square (atlas px) centred on (rect.x + u·rect.w, rect.y + v·rect.h), INK_SAMPLES²
 * cell-centred taps, each the texel under it (floor); a tap off the page counts as transparent.
 */
export function particleInk(_page: AtlasPixels, _rect: AtlasRect, _u: number, _v: number, _cellPx: number, out: Float32Array, at: number): void {
  out.fill(0, at, at + 4);
}

/** D89-8 (a): out[id] = 0 … k−1 for every slot with moving[id] === 1, in id order, −1 for the rest; returns k. */
export function denseRanks(_moving: ArrayLike<number>, out: Int16Array): number {
  out.fill(-1);
  return 0;
}
