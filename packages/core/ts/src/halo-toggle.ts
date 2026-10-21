/**
 * W75 (D75-3): the Canvas2D DOM-text halo, the same pattern as W74's text-toggle.ts. Each
 * instance holds `liquid-halo` per element while the element moves (restAlpha < 1) under
 * Canvas2D without reduced motion. The class write happens only when the hold changes (never per
 * frame), and holds are refcounted in stylesheet.ts, so two instances that observe one element
 * agree. Under WebGPU the text rides its own liquid (W74), so there is no halo.
 */
import type { ActiveRenderer } from "./renderers/select";
import { addHaloClass, removeHaloClass } from "./stylesheet";

export interface HaloEntry {
  readonly id: number;
  readonly el: HTMLElement;
}

export interface HaloSyncArgs {
  readonly entries: Iterable<HaloEntry>;
  restAlpha(id: number): number;
  readonly activeRenderer: ActiveRenderer;
  readonly reducedMotion: boolean;
  /** This instance's halo holds (one per element; refcounted across instances in stylesheet.ts). */
  readonly held: Set<HTMLElement>;
  /** W78 (D78-1): elements whose glyphs `liquid-away` hides; they get no halo. */
  readonly suppressed?: ReadonlySet<HTMLElement>;
}

/** NaN (unknown) counts as not moving. */
export function wantsHalo(activeRenderer: ActiveRenderer, reducedMotion: boolean, restAlpha: number): boolean {
  return activeRenderer === "canvas2d" && !reducedMotion && restAlpha < 1;
}

/** Elements visited by the current sync; reused (the sync is synchronous and never re-entered). */
const seen = new Set<HTMLElement>();

export function syncHaloClasses(a: HaloSyncArgs): void {
  seen.clear();
  for (const { id, el } of a.entries) {
    seen.add(el);
    const want = a.suppressed?.has(el) !== true && wantsHalo(a.activeRenderer, a.reducedMotion, a.restAlpha(id));
    if (want && !a.held.has(el)) {
      a.held.add(el);
      addHaloClass(el);
    } else if (!want && a.held.has(el)) {
      a.held.delete(el);
      removeHaloClass(el);
    }
  }
  // An element this instance still holds but no longer observes (a missed release) lets go too (W74's rule).
  for (const el of a.held) {
    if (!seen.has(el)) {
      a.held.delete(el);
      removeHaloClass(el);
    }
  }
  seen.clear();
}

/** Releases every hold of this instance (a failed frame or rebuild, destroy). */
export function clearHaloClasses(held: Set<HTMLElement>): void {
  for (const el of held) removeHaloClass(el);
  held.clear();
}

/** Releases this instance's hold on `el` (unobserve); no-op when it holds none. */
export function releaseHaloClass(held: Set<HTMLElement>, el: HTMLElement): void {
  if (held.delete(el)) removeHaloClass(el);
}
