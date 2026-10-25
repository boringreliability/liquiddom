/**
 * W88 (D88-4, D88-6, D88-11): the shadow casters and the WebGPU shadow plan. W88.1 stub: the shared
 * interface only; W88.3 fills it.
 */
import type { RenderFrame } from "./frame";

export const SHADOW_SCALE_HALF = 0.5;
export const SHADOW_SCALE_QUARTER = 0.25;
export const SHADOW_QUARTER_FROM_PX = 32;
export const SHADOW_MAX_EXACT_GROUPS = 6;
export const SHADOW_BUCKETS_PX: readonly number[] = Object.freeze([4, 8, 16, 32, 64]);
export const SHADOW_CHANNELS = 4;
export const SHADOW_MAX_DENSITY_LAYERS = 4;
export const SHADOW_MAX_SOURCES = SHADOW_CHANNELS * SHADOW_MAX_DENSITY_LAYERS;
export const KNOCKOUT_CLOSE_PER_KERNEL = 1.5;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class ShadowCasters {
  readonly ids: number[] = [];
  bounds = new Float64Array(0);
  start = new Int32Array(0);
  count = new Int32Array(0);
  order = new Int32Array(0);

  collect(_frame: RenderFrame): number {
    return 0;
  }
}

export function nearestBucket(blur: number): number {
  return blur;
}

export function groupBlur(blur: number): number {
  return blur;
}

export function spreadKernel(kernelR: number, _spread: number): { readonly radius: number; readonly weightScale: number } {
  return { radius: kernelR, weightScale: 1 };
}

export interface ShadowSource {
  readonly id: number;
  readonly spread: number;
  readonly layer: number;
  readonly channel: number;
  readonly radius: number;
  readonly weight: number;
  readonly rect: Rect;
}

export interface ShadowRecord {
  readonly source: number;
  readonly dx: number;
  readonly dy: number;
  readonly color: readonly [number, number, number, number];
  readonly rect: Rect;
}

export interface ShadowGroup {
  readonly blur: number;
  readonly scale: number;
  readonly first: number;
  readonly count: number;
  readonly reach: Rect;
}

export interface ShadowPlan {
  readonly sources: readonly ShadowSource[];
  readonly records: readonly ShadowRecord[];
  readonly groups: readonly ShadowGroup[];
  readonly drawn: readonly number[];
  readonly densityLayers: number;
}

export const EMPTY_PLAN: ShadowPlan = Object.freeze({ sources: [], records: [], groups: [], drawn: [], densityLayers: 0 });

export function planShadows(_casters: ShadowCasters, _frame: RenderFrame, _texelCss: number): ShadowPlan {
  return EMPTY_PLAN;
}
