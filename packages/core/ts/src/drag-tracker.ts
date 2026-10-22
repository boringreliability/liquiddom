/**
 * W78 (D78-2, D78-6), W84 (D84-1, D84-2, D84-5): the drag gesture (spec §2 interaction table, drag
 * row; slice-5 design §4, slice-6 design §7).
 *
 * One tracker per instance. A press with the primary button and the primary pointer on an observed
 * element (the innermost one, D67-9's rule) starts a press:
 * - mouse or pen: it becomes a drag once the pointer is more than DRAG_THRESHOLD_PX from the down
 *   point; only then is the pointer captured, so a plain click keeps its native targets;
 * - touch (W84, D84-1): a real LONG_PRESS_MS timer starts; more than TOUCH_SLOP_PX of the finger's
 *   own motion, pointerup or pointercancel before it fires end the press (the page scrolls, a tap
 *   stays a click). When it fires the press drags at the finger's offset (0, 0) plus the scroll
 *   since the down point (W80): the down point moves to where the finger rests, so the liquid does
 *   not jump by the slop. While a touch drag is live, the non-passive `touchmove` listener every
 *   draggable observed element carries from attach() (present before `touchstart`, W84.0 Q1 (a))
 *   prevents the browser's scroll; at any other time it does nothing.
 * While dragging, `active` reports the element and the offset from the down point in CSS px; the
 * registry writes it into slots 5–7 every frame.
 *
 * `attach(el, false)` (`observe(el, { drag: false })`, D84-2): the element still claims its
 * `pointerdown` (so an observed ancestor never drags for it) but starts no press and gets no
 * `touchmove` listener: no mouse, pen or touch drag, and the browser's own long-press behaviour.
 *
 * Release (`pointerup`) and cancel (`pointercancel`, window `blur`, `Escape`, `lostpointercapture`
 * on the element itself, a move with the primary button up, detach/unobserve, cancel() for reduced
 * motion, a lost device or a failed frame, frame() for a detached element, destroy) are the same for
 * the engine; `onEnd` tells the runtime which one it was. Every end clears the long-press timer. The
 * click that ends a drag is swallowed once (not after a touch drag released within 8 px of where the
 * finger rested and with no scroll: a slow tap stays a click) at the window's capture phase (before every other
 * listener, so the splash, the author's handlers and another instance's listeners all miss it); the
 * swallow clears in the task after the pointerup, or at the next press. Only a pointer's click
 * (detail >= 1) is swallowed: an AT or programmatic click passes. While a press is live,
 * `selectstart` and `dragstart` are prevented on the document, and (D84-5) so is `contextmenu`
 * while it is a touch press, so a long-press opens no menu; a mouse right-click is never touched.
 * The DOM, focus and hit areas never move: drag is decoration. The keyboard never drags.
 */
export const DRAG_THRESHOLD_PX = 4;
/** W84 (D84-1): a primary touch press held this long (ms, a real timer) becomes a drag. */
export const LONG_PRESS_MS = 350;
/** W84 (D84-1): a touch press that moves more than this (px) before the long-press fires is a scroll. */
export const TOUCH_SLOP_PX = 8;

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
  /** Called once per drag that crossed the threshold (or whose long-press fired), after the tracker let go of it. */
  onEnd?(el: HTMLElement, how: DragEnd): void;
}

interface Press {
  readonly el: HTMLElement;
  readonly pointerId: number;
  /** W84: a touch press (long-press, slop) rather than a mouse or pen one (threshold). */
  readonly touch: boolean;
  /** The down point (client px); W84: a touch press moves it to where the finger rests at the fire. */
  x0: number;
  y0: number;
  /** The pointer's offset from the down point (client px); the threshold and the slop read only this. */
  cx: number;
  cy: number;
  /** W80 (D80-1): the scroll since the down point that moved the element under the pointer. */
  sx: number;
  sy: number;
  /** The drag offset the registry writes: pointer offset + scroll (`cx + sx`, `cy + sy`). */
  dx: number;
  dy: number;
  dragging: boolean;
  /** W84 ward review I1: a touch drag whose finger went past the slop from where it rested at the fire (sticky). */
  moved: boolean;
}

const THRESHOLD_SQ = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
const TOUCH_SLOP_SQ = TOUCH_SLOP_PX * TOUCH_SLOP_PX;
/** W84 (D84-1): non-passive, so `preventDefault()` can stop the browser's scroll during a touch drag. */
const TOUCHMOVE_OPTIONS: AddEventListenerOptions = { passive: false };

export class DragTracker {
  private readonly downListeners = new Map<HTMLElement, (e: PointerEvent) => void>();
  /** W84 (D84-1): the draggable elements, each carrying `onTouchMove`. */
  private readonly touchTargets = new Set<HTMLElement>();
  /** W84 (D84-2): `attach(el, false)`: claims its presses, drags nothing. */
  private readonly optedOut = new Set<HTMLElement>();
  /** pointerdown events an inner observed element already took (they bubble through the outer ones). */
  private readonly handled = new WeakSet<Event>();
  private press: Press | null = null;
  /** W84 (D84-1): the long-press timer of a pending touch press; cleared on every end. */
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private swallowEl: HTMLElement | null = null;
  private swallowTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelledPointerId = -1;
  private destroyed = false;

  constructor(
    private readonly deps: DragTrackerDeps,
    private readonly doc: Document,
    private readonly win: Window,
  ) {}

  /** Idempotent: the first attach decides whether `el` is draggable (captured once, D84-2). */
  attach(el: HTMLElement, draggable = true): void {
    if (this.destroyed || this.downListeners.has(el)) return;
    const onDown = (e: PointerEvent): void => this.onDown(el, e);
    this.downListeners.set(el, onDown);
    el.addEventListener("pointerdown", onDown);
    if (draggable) {
      el.addEventListener("touchmove", this.onTouchMove, TOUCHMOVE_OPTIONS);
      this.touchTargets.add(el);
    } else {
      this.optedOut.add(el);
    }
  }

  /** unobserve(): a press or drag on `el` cancels and its pending click swallow is dropped. */
  detach(el: HTMLElement): void {
    const onDown = this.downListeners.get(el);
    if (onDown === undefined) return;
    el.removeEventListener("pointerdown", onDown);
    this.downListeners.delete(el);
    if (this.touchTargets.delete(el)) el.removeEventListener("touchmove", this.onTouchMove, TOUCHMOVE_OPTIONS);
    this.optedOut.delete(el);
    if (this.press?.el === el) this.end("cancel");
    if (this.swallowEl === el) this.clearSwallow();
  }

  /**
   * The drag past the threshold (or after the long-press), or null (a pending press is not a drag).
   * Read it within the frame. Returns the live Press (no per-frame allocation): callers must treat
   * it as read-only.
   */
  get active(): ActiveDrag | null {
    const p = this.press;
    return p !== null && p.dragging ? p : null;
  }

  /** W80 ward review I1: the element of the live press (pending or dragging), or null. */
  get pressed(): HTMLElement | null {
    return this.press?.el ?? null;
  }

  /** Once per frame, before registry.sync(): a pressed element that left the document cancels. */
  frame(): void {
    if (this.press !== null && !this.press.el.isConnected) this.end("cancel");
  }

  /**
   * W80 (D80-1): once per frame before `frame()`, with the scroll tracker's `dragDx/dragDy`. The page
   * (or the container) scrolled the pressed element by (−dx, −dy) under a pointer that stayed put, so
   * the drag offset grows by (dx, dy) and the dragged liquid stays under the pointer. A pending press
   * accumulates it too (the offset includes it once the drag starts), but a scroll alone never starts
   * or ends a press: the threshold and the touch slop read the pointer's own motion. No press: no-op.
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
    for (const el of this.touchTargets) el.removeEventListener("touchmove", this.onTouchMove, TOUCHMOVE_OPTIONS);
    this.touchTargets.clear();
    this.optedOut.clear();
    this.clearSwallow();
    this.destroyed = true;
  }

  private onDown(el: HTMLElement, e: PointerEvent): void {
    if (this.handled.has(e)) return;
    this.handled.add(e);
    // D84-2: the innermost observed element decides; an opted-out one claims the press and drags nothing.
    if (this.optedOut.has(el)) return;
    if (this.press !== null || this.deps.reducedMotion()) return;
    const touch = e.pointerType === "touch";
    if (!touch && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (e.button !== 0 || !e.isPrimary) return; // D84-1: a second finger is never a press
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    this.clearSwallow(); // a new press: a swallow left by a cancelled drag is stale
    this.press = { el, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, cx: 0, cy: 0, sx: 0, sy: 0, dx: 0, dy: 0, dragging: false, moved: false };
    this.listen(true);
    if (touch) this.longPressTimer = setTimeout(this.onLongPress, LONG_PRESS_MS);
  }

  /** W84 (D84-1): the long-press fired; the pending touch press becomes a drag. */
  private readonly onLongPress = (): void => {
    this.longPressTimer = null;
    const p = this.press;
    if (p === null || !p.touch || p.dragging) return;
    if (this.deps.reducedMotion() || !p.el.isConnected) {
      this.end("cancel");
      return;
    }
    // The finger's own offset restarts at (0, 0) where it rests; the scroll since the down point stays (W80).
    p.x0 += p.cx;
    p.y0 += p.cy;
    p.cx = 0;
    p.cy = 0;
    p.dx = p.sx;
    p.dy = p.sy;
    this.startDrag(p);
  };

  private startDrag(p: Press): void {
    p.dragging = true;
    // Captured only now (W78 design resolution 1), so a plain click keeps its native targets.
    if (typeof p.el.setPointerCapture === "function") {
      try {
        p.el.setPointerCapture(p.pointerId);
      } catch {
        // The pointer is no longer active; the document listeners keep tracking it.
      }
    }
    p.el.addEventListener("lostpointercapture", this.onLost);
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
    // W80: the threshold and the slop are the pointer's own motion; a scroll alone never starts or ends a press.
    const d2 = dx * dx + dy * dy;
    if (p.dragging) {
      if (p.touch && d2 > TOUCH_SLOP_SQ) p.moved = true; // W84 ward review I1: past the slop, it is a drag for good
      return;
    }
    if (p.touch) {
      if (d2 > TOUCH_SLOP_SQ) this.end("cancel"); // D84-1: a swipe, the page scrolls
    } else if (d2 > THRESHOLD_SQ) {
      this.startDrag(p);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.press !== null && e.pointerId === this.press.pointerId) this.end("release");
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.press !== null && e.pointerId === this.press.pointerId) this.end("cancel");
  };

  private readonly onLost = (e: PointerEvent): void => {
    const p = this.press;
    // W84: a touch press starts implicitly captured by its target; when the drag captures the observed
    // element, a child target loses that capture and its lostpointercapture bubbles here: not ours.
    if (p !== null && p.dragging && e.pointerId === p.pointerId && e.target === p.el) this.end("cancel");
  };

  /** W84 (D84-1): on every draggable element from attach(); prevents the browser's scroll only while a touch drag is live. */
  private readonly onTouchMove = (e: Event): void => {
    const p = this.press;
    if (p !== null && p.touch && p.dragging && e.cancelable) e.preventDefault();
  };

  /** W84 (D84-5): a live touch press (pending or dragging) opens no context menu; a mouse press never matches. */
  private readonly onContextMenu = (e: Event): void => {
    if (this.press !== null && this.press.touch) e.preventDefault();
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
      d.addEventListener("contextmenu", this.onContextMenu, true); // capture: an author's stopPropagation cannot open the menu mid-drag
      this.win.addEventListener("blur", this.onBlur);
    } else {
      d.removeEventListener("pointermove", this.onMove);
      d.removeEventListener("pointerup", this.onUp);
      d.removeEventListener("pointercancel", this.onPointerCancel);
      d.removeEventListener("keydown", this.onKey, true);
      d.removeEventListener("selectstart", this.onSelect);
      d.removeEventListener("dragstart", this.onSelect);
      d.removeEventListener("contextmenu", this.onContextMenu, true);
      this.win.removeEventListener("blur", this.onBlur);
    }
  }

  private clearLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private end(how: DragEnd): void {
    const p = this.press;
    if (p === null) return;
    this.press = null;
    this.clearLongPress(); // W84 (D84-1): no timer outlives its press
    this.listen(false);
    if (!p.dragging) return; // a pending press stays a click (D78-2) or a scroll (D84-1)
    p.el.removeEventListener("lostpointercapture", this.onLost);
    // W84 ward review I1 (Dennis 2026-10-21): a touch drag released within the slop of where it rested,
    // with no scroll since the down point, is a slow tap: its click passes, like a mouse press below 4 px.
    if (how === "release" && p.touch && !p.moved && p.sx === 0 && p.sy === 0) {
      this.deps.onEnd?.(p.el, how);
      return;
    }
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
