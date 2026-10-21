/**
 * W74 (D74-6): the `liquid-text` toggle (spec §3 "Crisp at rest", §4). The runtime calls
 * `syncTextClasses` once per frame AFTER `renderer.render()`, so the class and the atlas text
 * appear and disappear in the same frame. An element carries the class exactly while the active
 * renderer is WebGPU, motion is not reduced, the renderer draws its atlas text (`textReady`) and
 * its restAlpha < 1. Every other path takes it off (README Review Focus 1): `clearTextClasses`
 * for a lost device, reduced motion, a failed frame, a failed rebuild and destroy;
 * `releaseTextClass` for unobserve. Holds are refcounted across instances in stylesheet.ts;
 * `held` is this instance's own set (one hold per element per instance).
 */
import type { Renderer } from "./renderers/frame";
import type { ActiveRenderer } from "./renderers/select";
import { addTextClass, removeTextClass } from "./stylesheet";

export interface TextToggleArgs {
  /** The observed slot ids this frame. */
  readonly ids: Iterable<number>;
  elementOf(id: number): HTMLElement | undefined;
  restAlpha(id: number): number;
  /** null while a device-lost rebuild is in flight. */
  readonly renderer: Renderer | null;
  readonly activeRenderer: ActiveRenderer;
  readonly reducedMotion: boolean;
  readonly held: Set<HTMLElement>;
}

/** Elements visited by the current sync; reused (the toggle is synchronous and never re-entered). */
const seen = new Set<HTMLElement>();

export function syncTextClasses(a: TextToggleArgs): void {
  seen.clear();
  const r = a.renderer;
  const gate = a.activeRenderer === "webgpu" && !a.reducedMotion && r !== null;
  for (const id of a.ids) {
    const el = a.elementOf(id);
    if (!el) continue;
    seen.add(el);
    const want = gate && r !== null && r.textReady?.(id) === true && a.restAlpha(id) < 1;
    if (want && !a.held.has(el)) {
      a.held.add(el);
      addTextClass(el);
    } else if (!want && a.held.has(el)) {
      a.held.delete(el);
      removeTextClass(el);
    }
  }
  // An element this instance still holds but no longer observes (a missed release) lets go too.
  for (const el of a.held) {
    if (!seen.has(el)) {
      a.held.delete(el);
      removeTextClass(el);
    }
  }
  seen.clear();
}

/** Releases every hold of this instance (fail-safe paths). */
export function clearTextClasses(held: Set<HTMLElement>): void {
  for (const el of held) removeTextClass(el);
  held.clear();
}

/** Releases this instance's hold on `el` (unobserve); no-op when it holds none. */
export function releaseTextClass(held: Set<HTMLElement>, el: HTMLElement): void {
  if (held.delete(el)) removeTextClass(el);
}
