/** W80.1 (red) stub: W80.3 replaces this file (scroll-tracker.ts, D80-1, D80-2). */

/** D80-2: share of the scroll speed added as inertia (W80.0; gate 2026-10-13). */
export const SCROLL_INERTIA = 0.02;
/** D80-2: inertia cap in px/s per 1/60 s; the per-call cap is `SCROLL_INERTIA_MAX_PX_S · dt · 60` (W80.0; gate 2026-10-13). */
export const SCROLL_INERTIA_MAX_PX_S = 30;

export interface ScrollSample {
  readonly dx: number;
  readonly dy: number;
  readonly ivx: number;
  readonly ivy: number;
  readonly dragDx: number;
  readonly dragDy: number;
}

const NONE: ScrollSample = Object.freeze({ dx: 0, dy: 0, ivx: 0, ivy: 0, dragDx: 0, dragDy: 0 });

export class ScrollTracker {
  constructor(
    private readonly win: Window,
    private readonly container?: HTMLElement,
  ) {}

  reset(): void {}

  sample(_dtS: number, _offset: { readonly x: number; readonly y: number }, _reducedMotion: boolean): ScrollSample {
    void this.win;
    void this.container;
    return NONE;
  }

  placeCanvas(_canvas: HTMLCanvasElement): void {}
}
