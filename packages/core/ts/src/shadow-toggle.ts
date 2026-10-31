/**
 * W88 (D88-1, D88-2, D88-7): the `liquid-shadow-away` toggle, W74's text-toggle.ts pattern. The runtime
 * calls `syncShadowClasses` once per frame after `render()` (and after syncText, syncAway and
 * syncHalo; the four never read each other's classes), so the class and the renderer's shadow
 * change in the same frame: the instant handoff of D88-7. An element holds the class while its
 * liquid is away (`liquidAway`: restAlpha < 1 or dragged, never under reduced motion) and a renderer
 * drew this frame — for an element with outer layers only when that renderer drew them
 * (`shadowsDrawn`), so the browser's shadow never hides without the renderer's; an inset-only
 * element hides its inset in motion (D88-2). An element without a box-shadow is never written.
 * Holds are refcounted across instances in stylesheet.ts; `held` is this instance's own set.
 * Every other path takes the class off: `clearShadowClasses` (a stop, reduced motion, a lost device,
 * a failed rebuild, destroy), `releaseShadowClass` (unobserve), the sweep (a missed release).
 */
import type { Renderer } from "./renderers/frame";
import { hasOuterLayer, liquidAway, type ShadowLayer } from "./shadow";
import { addShadowAwayClass, removeShadowAwayClass } from "./stylesheet";

export interface ShadowEntry {
  readonly id: number;
  readonly el: HTMLElement;
  /** Every layer the snapshot read, inset ones included (ElementRecord.shadows). */
  readonly shadows: readonly ShadowLayer[];
}

export interface ShadowSyncArgs {
  readonly entries: Iterable<ShadowEntry>;
  restAlpha(id: number): number;
  /** Slot 5 of the element buffer this frame (Interaction). */
  interaction(id: number): number;
  /** null while a device-lost rebuild is in flight. */
  readonly renderer: Renderer | null;
  readonly reducedMotion: boolean;
  readonly held: Set<HTMLElement>;
}

/**
 * D88-1, D88-2: `rendererOn` (a renderer drew this frame), `away` (liquidAway), the element's layers and
 * whether the renderer drew its outer layers this frame.
 */
export function wantsShadowAway(rendererOn: boolean, away: boolean, layers: readonly ShadowLayer[], drawn: boolean): boolean {
  if (!rendererOn || !away || layers.length === 0) return false;
  return hasOuterLayer(layers) ? drawn : true;
}

/** Elements visited by the current sync; reused (the sync is synchronous and never re-entered). */
const seen = new Set<HTMLElement>();

export function syncShadowClasses(a: ShadowSyncArgs): void {
  seen.clear();
  const r = a.renderer;
  for (const { id, el, shadows } of a.entries) {
    seen.add(el);
    const away = shadows.length > 0 && liquidAway(a.reducedMotion, a.restAlpha(id), a.interaction(id));
    const want = wantsShadowAway(r !== null, away, shadows, r?.shadowsDrawn?.(id) === true);
    const held = a.held.has(el);
    if (want && !held) {
      a.held.add(el);
      addShadowAwayClass(el);
    } else if (!want && held) {
      a.held.delete(el);
      removeShadowAwayClass(el);
    }
  }
  // An element this instance still holds but no longer observes (a missed release) lets go too (W74's rule).
  for (const el of a.held) {
    if (!seen.has(el)) {
      a.held.delete(el);
      removeShadowAwayClass(el);
    }
  }
  seen.clear();
}

/** Releases every hold of this instance. */
export function clearShadowClasses(held: Set<HTMLElement>): void {
  for (const el of held) removeShadowAwayClass(el);
  held.clear();
}

/** Releases this instance's hold on `el` (unobserve); no-op when it holds none. */
export function releaseShadowClass(held: Set<HTMLElement>, el: HTMLElement): void {
  if (held.delete(el)) removeShadowAwayClass(el);
}
