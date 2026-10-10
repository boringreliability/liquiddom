/**
 * W74 (D74-5): the text atlas (spec §3 "Text atlas"; slice-4 design §3). The runtime builds it
 * from the DOM under WebGPU — text nodes only, line boxes from `Range.getClientRects()`, the
 * computed style of each text node's parent, `fillText` word by word at the device pixel ratio,
 * no re-wrapping — into one shelf-packed canvas page with `ceil(10·dpr)` atlas px of gutter
 * around each element. The renderer only uploads the page: rendering never touches the DOM.
 * jsdom has no OffscreenCanvas, so tests inject `createCanvas`.
 *
 * Fail-safe (README Review Focus 1 and 4): an element without text, wider than the page or past
 * its height gets no rect, so it never gets `liquid-text` and its DOM text stays. A factory that
 * returns null (no OffscreenCanvas) or a page without a 2d context gives no atlas, silently; a
 * missing `Range.getClientRects` throws (the runtime warns once and draws no text).
 * W75: `invalidate(id)` marks the page stale; the runtime rebuilds while `stale`.
 */

/** An element's border box in the atlas page, in atlas px (CSS px × dpr). */
export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Creates the atlas page; null when the environment has no OffscreenCanvas. */
export type AtlasCanvasFactory = (w: number, h: number) => OffscreenCanvas | null;

/** CSS px of empty page around each element (≥ one kernel radius, spec §3): `ceil(10·dpr)` atlas px. */
export const ATLAS_GUTTER_PX = 10;
/** Page edge in atlas px; within WebGPU's guaranteed maxTextureDimension2D (8192). */
export const ATLAS_MAX_SIZE_PX = 4096;
