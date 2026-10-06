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
import { El, ELEMENT_STRIDE } from "../../packages/core/ts/src/fluid-layout";
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

/**
 * What reached the runtime for one element slot (element id == slot index): the
 * element buffer's `viscosity` (slot 8) and `recovery` (slot 9), as the registry
 * wrote them at observe() (Float32, NaN = engine default). W69 ward review: the
 * scenes spec reads this back instead of the HTML data-* attributes.
 * Runtime not bound, or slot out of range → null.
 */
export function elementOptionsAt(
  instance: LiquidDOMInstance,
  slot: number,
): { viscosity: number; recovery: number } | null {
  const runtime = runtimeOf(instance);
  if (runtime === undefined || !(slot >= 0 && slot < runtime.bridge.elementCapacity)) return null;
  const v = runtime.bridge.elementView();
  const o = slot * ELEMENT_STRIDE;
  return { viscosity: v[o + El.VISCOSITY] ?? Number.NaN, recovery: v[o + El.RECOVERY] ?? Number.NaN };
}
