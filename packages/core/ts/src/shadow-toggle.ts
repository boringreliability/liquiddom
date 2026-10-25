/**
 * W88 (D88-1, D88-2, D88-7): the `liquid-shadow-away` toggle. W88.1 stub: the shared interface
 * only; W88.2 fills it.
 */
import type { Renderer } from "./renderers/frame";
import type { ShadowLayer } from "./shadow";

export interface ShadowEntry {
  readonly id: number;
  readonly el: HTMLElement;
  readonly shadows: readonly ShadowLayer[];
}

export interface ShadowSyncArgs {
  readonly entries: Iterable<ShadowEntry>;
  restAlpha(id: number): number;
  interaction(id: number): number;
  readonly renderer: Renderer | null;
  readonly reducedMotion: boolean;
  readonly held: Set<HTMLElement>;
}

export function wantsShadowAway(_rendererOn: boolean, _away: boolean, _layers: readonly ShadowLayer[], _drawn: boolean): boolean {
  return false;
}

export function syncShadowClasses(_a: ShadowSyncArgs): void {}

export function clearShadowClasses(_held: Set<HTMLElement>): void {}

export function releaseShadowClass(_held: Set<HTMLElement>, _el: HTMLElement): void {}
