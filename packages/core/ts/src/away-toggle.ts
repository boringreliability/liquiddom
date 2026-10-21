/**
 * W78 (D78-1): the Canvas2D drag label (slice-5 design §4). Canvas2D draws no liquid text, so while
 * an element is dragged, and after a release until its restAlpha is 1, the runtime hides its DOM
 * glyphs with `liquid-away` (the `liquid-text` declarations: -webkit-text-fill-color, never
 * `color`; screen + forced-colors: none only, so print and forced colours show the text). Same
 * pattern as text-toggle.ts and halo-toggle.ts: one hold per element per instance in `held`,
 * refcounted across instances in stylesheet.ts, written only on change, and a sweep for an element
 * this instance no longer observes. Never under WebGPU (the atlas text rides the liquid there) or
 * reduced motion (drag is ignored). A cancel releases at once through `releaseAwayClass`.
 */
import type { HaloEntry } from "./halo-toggle";
import type { ActiveRenderer } from "./renderers/select";
import { addAwayClass, removeAwayClass } from "./stylesheet";

export interface AwaySyncArgs {
  readonly entries: Iterable<HaloEntry>;
  restAlpha(id: number): number;
  /** The instance's dragged element (`DragTracker.active?.el`), or null. */
  readonly dragged: HTMLElement | null;
  readonly activeRenderer: ActiveRenderer;
  readonly reducedMotion: boolean;
  /** This instance's holds (one per element; refcounted across instances in stylesheet.ts). */
  readonly held: Set<HTMLElement>;
}

/** Dragged, or held since a drag and not yet at rest. NaN counts as at rest (the DOM label shows). */
export function wantsAway(activeRenderer: ActiveRenderer, reducedMotion: boolean, dragged: boolean, held: boolean, restAlpha: number): boolean {
  if (activeRenderer !== "canvas2d" || reducedMotion) return false;
  return dragged || (held && restAlpha < 1);
}

/** Elements visited by the current sync; reused (the sync is synchronous and never re-entered). */
const seen = new Set<HTMLElement>();

export function syncAwayClasses(a: AwaySyncArgs): void {
  seen.clear();
  for (const { id, el } of a.entries) {
    seen.add(el);
    const held = a.held.has(el);
    const want = wantsAway(a.activeRenderer, a.reducedMotion, el === a.dragged, held, a.restAlpha(id));
    if (want && !held) {
      a.held.add(el);
      addAwayClass(el);
    } else if (!want && held) {
      a.held.delete(el);
      removeAwayClass(el);
    }
  }
  // An element this instance still holds but no longer observes (a missed release) lets go too (W74's rule).
  for (const el of a.held) {
    if (!seen.has(el)) {
      a.held.delete(el);
      removeAwayClass(el);
    }
  }
  seen.clear();
}

/** Releases every hold of this instance (reduced motion, a failed frame or rebuild, destroy). */
export function clearAwayClasses(held: Set<HTMLElement>): void {
  for (const el of held) removeAwayClass(el);
  held.clear();
}

/** Releases this instance's hold on `el` (a cancel, unobserve); no-op when it holds none. */
export function releaseAwayClass(held: Set<HTMLElement>, el: HTMLElement): void {
  if (held.delete(el)) removeAwayClass(el);
}
