/**
 * W80 (D80-1, D80-2; slice-6 design §3): scroll follows.
 *
 * One tracker per instance. Once per frame, right after `applyDomChanges()`, `sample()` reads the
 * scroll position (body mode: the window's `scrollX/scrollY`; container mode: the container's
 * `scrollLeft/scrollTop`) and returns the delta since the previous frame. The runtime hands it to
 * `core.scroll_shift(dx, dy, ivx, ivy)` after `registry.sync()` and before `core.tick()`, so Rust
 * shifts the liquid rigidly with the page instead of reading the moved rects as motion. The first
 * sample of a tracker (a new instance) and the first after `reset()` give 0. A canvas remount does
 * not reset it: the core keeps its particles, and a delta dropped there would be the snap step 7
 * forbids.
 *
 * Inertia (D80-2): `iv = Δ · 60 · SCROLL_INERTIA` px/s (equal to `Δ / frameDt · SCROLL_INERTIA` at
 * 60 Hz), capped at `SCROLL_INERTIA_MAX_PX_S · dt · 60` with its direction kept (the cap per 1/60 s,
 * amended at the gate; dt counts up to the core's 100 ms clamp). Both are proportional to the
 * frame's scroll distance or duration, not to Δ/dt, so a scroll adds the same total impulse at 60 Hz
 * and at 120 Hz, also while the cap bites. A frame without elapsed time (the first frame after a
 * pause or a hidden tab) and reduced motion add none. Scrolling down (Δy > 0) gives ivy > 0: the
 * liquid lags below its home.
 *
 * `dragDx/dragDy` is what a live press adds to its drag offset (`DragTracker.scrolled`) so the
 * dragged liquid stays under the pointer: the element moved by −Δ in buffer space, and in container
 * mode the pointer also moves by −Δoffset when the page around the container scrolls.
 *
 * Container mode: the canvas is absolutely positioned at the container's padding-box origin, which
 * scrolls with the content; `placeCanvas()` keeps it on the container's visible window with a
 * `transform` on the canvas element only (liquiddom never restyles author DOM).
 *
 * No allocation per frame: `sample()` returns one reused record.
 */

/** D80-2: share of the scroll speed added as inertia (W80.0; gate 2026-10-13). */
export const SCROLL_INERTIA = 0.02;
/** D80-2: inertia cap in px/s per 1/60 s; the per-call cap is `SCROLL_INERTIA_MAX_PX_S · dt · 60` (W80.0; gate 2026-10-13). */
export const SCROLL_INERTIA_MAX_PX_S = 30;
/** The frame rate the inertia share is defined at (Δ · 60 = Δ / frameDt at 60 Hz). */
const REFERENCE_FPS = 60;
/** The core's own frame clamp (100 ms): a longer frame scales the inertia cap no further. */
const MAX_FRAME_DT_S = 0.1;

/** One frame's scroll. Read it within the frame; the next `sample()` overwrites it. */
export interface ScrollSample {
  /** Scroll delta in CSS px since the previous frame (the content moved by −dx, −dy). */
  readonly dx: number;
  readonly dy: number;
  /** Inertia in px/s for `core.scroll_shift` (0 under reduced motion or without elapsed time). */
  readonly ivx: number;
  readonly ivy: number;
  /** What a live press adds to its drag offset (D80-1): Δscroll minus the buffer origin's change. */
  readonly dragDx: number;
  readonly dragDy: number;
}

interface MutableSample {
  dx: number;
  dy: number;
  ivx: number;
  ivy: number;
  dragDx: number;
  dragDy: number;
}

export class ScrollTracker {
  private readonly out: MutableSample = { dx: 0, dy: 0, ivx: 0, ivy: 0, dragDx: 0, dragDy: 0 };
  private hasPrev = false;
  private sx = 0;
  private sy = 0;
  private ox = 0;
  private oy = 0;
  private placed: HTMLCanvasElement | null = null;
  private placedX = 0;
  private placedY = 0;

  /** `container` undefined: body mode (the window scrolls). */
  constructor(
    private readonly win: Window,
    private readonly container?: HTMLElement,
  ) {}

  /** The next sample gives 0 (as a new instance's first frame does). */
  reset(): void {
    this.hasPrev = false;
  }

  /**
   * Once per frame. `dtS`: seconds since the previous frame (0 on the first frame after a pause);
   * `offset`: this frame's buffer-space origin in client px (container mode: the container's
   * padding box; body mode: 0, 0).
   */
  sample(dtS: number, offset: { readonly x: number; readonly y: number }, reducedMotion: boolean): ScrollSample {
    const o = this.out;
    const sx = this.container ? this.container.scrollLeft : this.win.scrollX;
    const sy = this.container ? this.container.scrollTop : this.win.scrollY;
    const ox = offset.x;
    const oy = offset.y;
    // A detached container reports scrollTop 0: its sample is unusable (keep the last good position).
    const usable =
      (this.container === undefined || this.container.isConnected) &&
      Number.isFinite(sx) &&
      Number.isFinite(sy) &&
      Number.isFinite(ox) &&
      Number.isFinite(oy);
    if (!usable || !this.hasPrev) {
      o.dx = o.dy = o.ivx = o.ivy = o.dragDx = o.dragDy = 0;
      if (usable) {
        this.hasPrev = true;
        this.sx = sx;
        this.sy = sy;
        this.ox = ox;
        this.oy = oy;
      }
      return o;
    }
    o.dx = sx - this.sx;
    o.dy = sy - this.sy;
    o.dragDx = o.dx - (ox - this.ox);
    o.dragDy = o.dy - (oy - this.oy);
    this.sx = sx;
    this.sy = sy;
    this.ox = ox;
    this.oy = oy;
    if (reducedMotion || !(Number.isFinite(dtS) && dtS > 0)) {
      o.ivx = 0;
      o.ivy = 0;
      return o;
    }
    let ivx = o.dx * REFERENCE_FPS * SCROLL_INERTIA;
    let ivy = o.dy * REFERENCE_FPS * SCROLL_INERTIA;
    // D80-2 (amended at the gate): the cap is per 1/60 s, so a 120 Hz display adds no more impulse.
    const cap = SCROLL_INERTIA_MAX_PX_S * Math.min(dtS, MAX_FRAME_DT_S) * REFERENCE_FPS;
    const speed = Math.hypot(ivx, ivy);
    if (speed > cap) {
      const k = cap / speed;
      ivx *= k;
      ivy *= k;
    }
    o.ivx = ivx;
    o.ivy = ivy;
    return o;
  }

  /**
   * Container mode, once per frame after `sample()`: keeps `canvas` on the container's visible
   * window (`translate(scrollLeft, scrollTop)`). Writes the style only when the scroll or the canvas
   * changed (a remounted canvas gets it on its first frame). Body mode: never writes.
   */
  placeCanvas(canvas: HTMLCanvasElement): void {
    const c = this.container;
    if (!c || !c.isConnected) return;
    const x = c.scrollLeft;
    const y = c.scrollTop;
    if (!(Number.isFinite(x) && Number.isFinite(y))) return;
    if (canvas === this.placed && x === this.placedX && y === this.placedY) return;
    this.placed = canvas;
    this.placedX = x;
    this.placedY = y;
    canvas.style.transform = x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px)`;
  }
}
