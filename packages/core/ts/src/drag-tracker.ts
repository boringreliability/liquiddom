/**
 * W78 (D78-2, D78-6): the drag gesture (spec §2 interaction table, drag row; slice-5 design §4).
 *
 * One tracker per instance. A press with `pointerType` mouse or pen, the primary button and the
 * primary pointer on an observed element (the innermost one, D67-9's rule) becomes a drag once the
 * pointer is more than DRAG_THRESHOLD_PX from the down point; only then is the pointer captured, so
 * a plain click keeps its native targets. While dragging, `active` reports the element and the
 * offset from the down point in CSS px; the registry writes it into slots 5–7 every frame.
 *
 * Release (`pointerup`) and cancel (`pointercancel`, window `blur`, `Escape`, `lostpointercapture`,
 * a move with the primary button up, detach/unobserve, cancel() for reduced motion, a lost device
 * or a failed frame, frame() for a detached element, destroy) are the same for the engine; `onEnd`
 * tells the runtime which one it was. The click that ends a drag is swallowed once at the window's
 * capture phase (before every other listener, so the splash, the author's handlers and another
 * instance's listeners all miss it); the swallow clears in the task after the pointerup, or at the
 * next press. Only a pointer's click (detail >= 1) is swallowed: an AT or programmatic click passes. While a press is live, `selectstart` and `dragstart` are prevented on the document.
 * The DOM, focus and hit areas never move: drag is decoration. Touch and keyboard never drag.
 */
export const DRAG_THRESHOLD_PX = 4;

export type DragEnd = "release" | "cancel";

/** The active drag: the observed element and the offset from the down point (CSS px). */
export interface ActiveDrag {
  readonly el: HTMLElement;
  readonly dx: number;
  readonly dy: number;
}

export interface DragTrackerDeps {
  /** Read live: under reduced motion a press is ignored (spec §2). */
  reducedMotion(): boolean;
  /** Called once per drag that crossed the threshold, after the tracker let go of it. */
  onEnd?(el: HTMLElement, how: DragEnd): void;
}

interface Press {
  readonly el: HTMLElement;
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  /** The pointer's offset from the down point (client px); the threshold reads only this. */
  cx: number;
  cy: number;
  /** W80 (D80-1): the scroll since the down point that moved the element under the pointer. */
  sx: number;
  sy: number;
  /** The drag offset the registry writes: pointer offset + scroll (`cx + sx`, `cy + sy`). */
  dx: number;
  dy: number;
  dragging: boolean;
}

const THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

export class DragTracker {
  private readonly downListeners = new Map<HTMLElement, (e: PointerEvent) => void>();
  /** pointerdown events an inner observed element already took (they bubble through the outer ones). */
  private readonly handled = new WeakSet<Event>();
  private press: Press | null = null;
  private swallowEl: HTMLElement | null = null;
  private swallowTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelledPointerId = -1;
  private destroyed = false;

  constructor(
    private readonly deps: DragTrackerDeps,
    private readonly doc: Document,
    private readonly win: Window,
  ) {}

  /** Idempotent. */
  attach(el: HTMLElement): void {
    if (this.destroyed || this.downListeners.has(el)) return;
    const onDown = (e: PointerEvent): void => this.onDown(el, e);
    this.downListeners.set(el, onDown);
    el.addEventListener("pointerdown", onDown);
  }

  /** unobserve(): a press or drag on `el` cancels and its pending click swallow is dropped. */
  detach(el: HTMLElement): void {
    const onDown = this.downListeners.get(el);
    if (onDown === undefined) return;
    el.removeEventListener("pointerdown", onDown);
    this.downListeners.delete(el);
    if (this.press?.el === el) this.end("cancel");
    if (this.swallowEl === el) this.clearSwallow();
  }

  /**
   * The drag past the threshold, or null (a press below it is not a drag). Read it within the frame.
   * Returns the live Press (no per-frame allocation): callers must treat it as read-only.
   */
  get active(): ActiveDrag | null {
    const p = this.press;
    return p !== null && p.dragging ? p : null;
  }

  /** Once per frame, before registry.sync(): a pressed element that left the document cancels. */
  frame(): void {
    if (this.press !== null && !this.press.el.isConnected) this.end("cancel");
  }

  /**
   * W80 (D80-1): once per frame before `frame()`, with the scroll tracker's `dragDx/dragDy`. The page
   * (or the container) scrolled the pressed element by (−dx, −dy) under a pointer that stayed put, so
   * the drag offset grows by (dx, dy) and the dragged liquid stays under the pointer. A press below
   * the threshold accumulates it too (the offset includes it once the drag starts), but a scroll alone
   * never starts a drag: the threshold reads the pointer's own motion. No press: no-op.
   */
  scrolled(dx: number, dy: number): void {
    const p = this.press;
    if (p === null || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    p.sx += dx;
    p.sy += dy;
    p.dx = p.cx + p.sx;
    p.dy = p.cy + p.sy;
  }

  /** Reduced motion switched on, a lost device, a failed frame. */
  cancel(): void {
    if (this.press !== null) this.end("cancel");
  }

  /** Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.cancel();
    for (const [el, onDown] of this.downListeners) el.removeEventListener("pointerdown", onDown);
    this.downListeners.clear();
    this.clearSwallow();
    this.destroyed = true;
  }

  private onDown(el: HTMLElement, e: PointerEvent): void {
    if (this.handled.has(e)) return;
    this.handled.add(e);
    if (this.press !== null || this.deps.reducedMotion()) return;
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return; // D78-2: no touch drag in slice 5
    if (e.button !== 0 || !e.isPrimary) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    this.clearSwallow(); // a new press: a swallow left by a cancelled drag is stale
    this.press = { el, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, cx: 0, cy: 0, sx: 0, sy: 0, dx: 0, dy: 0, dragging: false };
    this.listen(true);
  }

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.press;
    if (p === null || e.pointerId !== p.pointerId) return;
    if ((e.buttons & 1) === 0) {
      this.end("cancel"); // the release went elsewhere (design resolution 6)
      if (this.swallowEl !== null) this.scheduleClear(); // the release already happened: no click follows
      return;
    }
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    p.cx = dx;
    p.cy = dy;
    p.dx = dx + p.sx;
    p.dy = dy + p.sy;
    // W80: the threshold is the pointer's own motion; a scroll alone never starts a drag.
    if (!p.dragging && dx * dx + dy * dy > THRESHOLD_SQ) {
      p.dragging = true;
      // Captured only now (design resolution 1), so a plain click keeps its native targets.
      if (typeof p.el.setPointerCapture === "function") {
        try {
          p.el.setPointerCapture(p.pointerId);
        } catch {
          // The pointer is no longer active; the document listeners keep tracking it.
        }
      }
      p.el.addEventListener("lostpointercapture", this.onLost);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.press !== null && e.pointerId === this.press.pointerId) this.end("release");
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.press !== null && e.pointerId === this.press.pointerId) this.end("cancel");
  };

  private readonly onLost = (e: PointerEvent): void => {
    if (this.press !== null && this.press.dragging && e.pointerId === this.press.pointerId) this.end("cancel");
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.end("cancel");
  };

  private readonly onBlur = (): void => {
    this.end("cancel");
  };

  private readonly onSelect = (e: Event): void => {
    if (this.press !== null) e.preventDefault();
  };

  private readonly onClickCapture = (e: MouseEvent): void => {
    // W78 ward review I1: only a click a pointer release produced (detail >= 1) ends a drag. An
    // assistive-tech default action or `el.click()` has detail 0 and always passes, so a swallow
    // left armed by a cancel whose pointerup never reaches this document cannot eat it.
    if (e.detail === 0) return;
    const el = this.swallowEl;
    const target = e.target as Node | null;
    if (el === null || target === null || typeof target.nodeType !== "number" || !el.contains(target)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.clearSwallow();
  };

  private readonly onUpAfterCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.cancelledPointerId) this.scheduleClear();
  };

  /** A new press or any key means the swallow's gesture is over. */
  private readonly onStale = (): void => {
    this.clearSwallow();
  };

  /** Document and window listeners exist only while a press is live. */
  private listen(on: boolean): void {
    const d = this.doc;
    if (on) {
      d.addEventListener("pointermove", this.onMove);
      d.addEventListener("pointerup", this.onUp);
      d.addEventListener("pointercancel", this.onPointerCancel);
      d.addEventListener("keydown", this.onKey, true); // capture: a stopPropagation cannot keep the drag alive
      d.addEventListener("selectstart", this.onSelect);
      d.addEventListener("dragstart", this.onSelect);
      this.win.addEventListener("blur", this.onBlur);
    } else {
      d.removeEventListener("pointermove", this.onMove);
      d.removeEventListener("pointerup", this.onUp);
      d.removeEventListener("pointercancel", this.onPointerCancel);
      d.removeEventListener("keydown", this.onKey, true);
      d.removeEventListener("selectstart", this.onSelect);
      d.removeEventListener("dragstart", this.onSelect);
      this.win.removeEventListener("blur", this.onBlur);
    }
  }

  private end(how: DragEnd): void {
    const p = this.press;
    if (p === null) return;
    this.press = null;
    this.listen(false);
    if (!p.dragging) return; // a press below the threshold stays a click (D78-2)
    p.el.removeEventListener("lostpointercapture", this.onLost);
    this.armSwallow(p.el);
    if (how === "release") {
      this.scheduleClear(); // the click follows this pointerup in the same task
    } else {
      // The press goes on without us: the swallow lasts until its pointerup (or the next press).
      this.cancelledPointerId = p.pointerId;
      this.doc.addEventListener("pointerup", this.onUpAfterCancel, true);
      if (typeof p.el.hasPointerCapture === "function" && p.el.hasPointerCapture(p.pointerId)) {
        try {
          p.el.releasePointerCapture(p.pointerId);
        } catch {
          // Already released.
        }
      }
    }
    this.deps.onEnd?.(p.el, how);
  }

  private armSwallow(el: HTMLElement): void {
    this.clearSwallow();
    this.swallowEl = el;
    this.win.addEventListener("click", this.onClickCapture, true);
    this.win.addEventListener("pointerdown", this.onStale, true);
    this.win.addEventListener("keydown", this.onStale, true);
  }

  private scheduleClear(): void {
    if (this.swallowTimer !== null) return;
    this.swallowTimer = setTimeout(() => {
      this.swallowTimer = null;
      this.clearSwallow();
    }, 0);
  }

  private clearSwallow(): void {
    if (this.swallowTimer !== null) {
      clearTimeout(this.swallowTimer);
      this.swallowTimer = null;
    }
    if (this.swallowEl === null) return;
    this.swallowEl = null;
    this.win.removeEventListener("click", this.onClickCapture, true);
    this.win.removeEventListener("pointerdown", this.onStale, true);
    this.win.removeEventListener("keydown", this.onStale, true);
    this.doc.removeEventListener("pointerup", this.onUpAfterCancel, true);
  }
}
