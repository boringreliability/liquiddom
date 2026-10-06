/**
 * Per-element rest read for the W69 demo scenes' `?test=1` hooks.
 * The accessor belongs to W66 (D66-5): `runtimeOf` in internal.ts maps a
 * public instance to its FluidRuntime and is never exported from index.ts, so
 * scenes import it by relative source path. The expression is the one the
 * acceptance hook uses (`runtime?.elementState(el)?.restAlpha ?? Number.NaN`).
 * Unobserved element, or a runtime not bound → NaN, which never equals 1, so
 * "at rest" checks stay honest.
 */
import type { LiquidDOMInstance } from "liquiddom";
import { runtimeOf } from "../../packages/core/ts/src/internal";

export function restAlphaOf(instance: LiquidDOMInstance, el: HTMLElement): number {
  return runtimeOf(instance)?.elementState(el)?.restAlpha ?? Number.NaN;
}

/**
 * The fluid grid cell size in px (B5; fixed at create). Without an area hint it is
 * CELL_MAX_PX = 8, and the rest-ring spacing is cell / 2 (ring_spacing_px). D69-5
 * ring-density evidence. A runtime not bound → NaN.
 */
export function cellPxOf(instance: LiquidDOMInstance): number {
  return runtimeOf(instance)?.bridge.core.cell_px() ?? Number.NaN;
}
