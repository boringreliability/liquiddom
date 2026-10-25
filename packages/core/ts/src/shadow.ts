/**
 * W88 (D88-1 … D88-3): the author's `box-shadow`, read for the renderers. W88.1 stub: the shared
 * interface only; W88.2 fills it.
 */
import type { RGBA } from "./color";

/** One `box-shadow` layer in CSS px (D88-3). */
export interface ShadowLayer {
  readonly color: RGBA;
  readonly dx: number;
  readonly dy: number;
  /** ≥ 0. */
  readonly blur: number;
  /** May be negative. */
  readonly spread: number;
  readonly inset: boolean;
}

/** D88-2: the renderer draws at most this many outer layers per element (the first ones in CSS order). */
export const MAX_SHADOW_LAYERS = 4;

const NONE: readonly ShadowLayer[] = Object.freeze([]);

export function parseBoxShadow(_computed: string | null | undefined): readonly ShadowLayer[] {
  return NONE;
}

export function outerShadows(_layers: readonly ShadowLayer[]): readonly ShadowLayer[] {
  return NONE;
}

export function hasOuterLayer(_layers: readonly ShadowLayer[]): boolean {
  return false;
}

export function snapshotShadow(_el: HTMLElement): readonly ShadowLayer[] {
  return NONE;
}

export function liquidAway(_reducedMotion: boolean, _restAlpha: number, _interaction: number): boolean {
  return false;
}
