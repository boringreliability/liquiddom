import { parseBorderRadius } from "./border-radius";
import { snapshotColorsWithout, type RGBA } from "./color";
import type { FluidBridge } from "./fluid-bridge";
import { ELEMENT_STRIDE, El, Interaction, roundedRectArea } from "./fluid-layout";
import type { ElementOptions } from "./options";
import { ELEMENT_CLASS, decorateElement, undecorateElement } from "./stylesheet";

export interface ElementRecord {
  readonly id: number;
  readonly el: HTMLElement;
  readonly opts: ElementOptions;
  background: RGBA;
  text: RGBA;
}

export interface RegistryDeps {
  /** Buffer-space origin in client px (container mode: the container's padding box). */
  coordOffset(): { x: number; y: number };
  /** Called on every observe/unobserve; the caller batches (see createMicrotaskBatcher). */
  scheduleRedistribute(): void;
  /** W68: live reduced-motion state; interaction is written as IDLE while true (D68-5). */
  reducedMotion?(): boolean;
}

export interface MicrotaskBatcher {
  schedule(): void;
  /** Drops any pending run and ignores every later schedule(). */
  cancel(): void;
  readonly pending: boolean;
}

/** Runs `run` once per microtask however many times `schedule()` was called (decision D64-18). */
export function createMicrotaskBatcher(run: () => void): MicrotaskBatcher {
  let pending = false;
  let cancelled = false;
  return {
    schedule() {
      if (pending || cancelled) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (!cancelled) run();
      });
    },
    cancel() {
      cancelled = true;
    },
    get pending() {
      return pending;
    },
  };
}

interface InternalRecord extends ElementRecord {
  readonly rawRadius: string;
  /** W68: a hover-capable pointer is over the element (pointerenter/pointerleave, touch ignored; D68-2 amended). */
  hovered: boolean;
  /** W68: the element itself has focus (focus/blur). */
  focused: boolean;
}

/**
 * Observed elements and their slots for the fluid engine (the retired
 * soft-body engine's DOM observer is gone). Element id == slot index, always
 * the lowest free slot.
 */
export class ElementRegistry {
  private readonly slots: Array<InternalRecord | undefined>;
  private readonly byEl = new Map<HTMLElement, InternalRecord>();
  /** This registry's decoration claims; the refcount itself lives in stylesheet.ts (shared across instances). */
  private readonly decorated = new Set<HTMLElement>();

  private readonly interactionListeners = new Map<
    HTMLElement,
    {
      readonly enter: (e: PointerEvent) => void;
      readonly leave: (e: PointerEvent) => void;
      readonly focus: () => void;
      readonly blur: () => void;
    }
  >();

  /**
   * D68-2 (amended 2026-10-06, saga dec_58e41ded): hover comes from pointerenter/pointerleave
   * with touch ignored (a tap's compatibility mouseenter has no matching mouseleave, so the
   * swell stuck). The initial `:hover` is read only where the primary input can hover.
   */
  private attachInteraction(rec: InternalRecord): void {
    const el = rec.el;
    rec.hovered = canHover(el) && matchesHover(el);
    rec.focused = el.ownerDocument.activeElement === el;
    const ls = {
      enter: (e: PointerEvent) => {
        if (e.pointerType !== "touch") rec.hovered = true;
      },
      leave: (e: PointerEvent) => {
        if (e.pointerType !== "touch") rec.hovered = false;
      },
      focus: () => {
        rec.focused = true;
      },
      blur: () => {
        rec.focused = false;
      },
    };
    el.addEventListener("pointerenter", ls.enter);
    el.addEventListener("pointerleave", ls.leave);
    el.addEventListener("focus", ls.focus);
    el.addEventListener("blur", ls.blur);
    this.interactionListeners.set(el, ls);
  }

  private detachInteraction(el: HTMLElement): void {
    const ls = this.interactionListeners.get(el);
    if (!ls) return;
    el.removeEventListener("pointerenter", ls.enter);
    el.removeEventListener("pointerleave", ls.leave);
    el.removeEventListener("focus", ls.focus);
    el.removeEventListener("blur", ls.blur);
    this.interactionListeners.delete(el);
  }

  /** D68-2: focus beats hover; D68-5: IDLE under reduced motion. */
  private interactionCode(rec: InternalRecord): number {
    if (this.deps.reducedMotion?.() === true) return Interaction.IDLE;
    if (rec.focused) return Interaction.FOCUSED;
    if (rec.hovered) return Interaction.HOVER;
    return Interaction.IDLE;
  }

  constructor(
    private readonly bridge: FluidBridge,
    private readonly deps: RegistryDeps,
  ) {
    this.slots = new Array<InternalRecord | undefined>(bridge.elementCapacity).fill(undefined);
  }

  get size(): number {
    return this.byEl.size;
  }

  has(el: HTMLElement): boolean {
    return this.byEl.has(el);
  }

  idOf(el: HTMLElement): number | undefined {
    return this.byEl.get(el)?.id;
  }

  get(id: number): ElementRecord | undefined {
    return this.slots[id];
  }

  entries(): IterableIterator<ElementRecord> {
    return this.byEl.values();
  }

  /** Idempotent. Throws RangeError when every slot is in use. */
  observe(el: HTMLElement, opts: ElementOptions = {}): number {
    const existing = this.byEl.get(el);
    if (existing) return existing.id;
    const id = this.slots.indexOf(undefined);
    if (id < 0) {
      throw new RangeError(
        `[liquiddom] observe(): all ${this.slots.length} element slots are in use (maxElements = ${this.slots.length}). unobserve() an element first or raise maxElements.`,
      );
    }
    // W66.5 fix round 2: another instance may already have decorated `el`; read the
    // author colours with the liquid class lifted (no-op when it is absent). Snapshot first, then decorate.
    const { background, text } = snapshotColorsWithout(el, ELEMENT_CLASS);
    const cs = getComputedStyle(el);
    const rec: InternalRecord = {
      id,
      el,
      opts: { ...opts },
      background,
      text,
      rawRadius: cs.borderRadius || cs.borderTopLeftRadius || "",
      hovered: false,
      focused: false,
    };
    this.slots[id] = rec;
    this.byEl.set(el, rec);
    this.attachInteraction(rec);
    const v = this.bridge.elementView();
    const o = id * ELEMENT_STRIDE;
    v[o + El.INTERACTION] = 0;
    v[o + El.HOME_DX] = 0;
    v[o + El.HOME_DY] = 0;
    v[o + El.VISCOSITY] = typeof opts.viscosity === "number" ? opts.viscosity : NaN;
    v[o + El.RECOVERY] = typeof opts.recovery === "number" ? opts.recovery : NaN;
    this.writeRect(rec, v, this.deps.coordOffset());
    if (!this.decorated.has(el)) {
      decorateElement(el);
      this.decorated.add(el);
    }
    this.deps.scheduleRedistribute();
    return id;
  }

  /** Zeroes the slot (w = 0 → inactive) and schedules a redistribution. */
  unobserve(el: HTMLElement): void {
    const rec = this.byEl.get(el);
    if (!rec) return;
    this.detachInteraction(el);
    this.byEl.delete(el);
    this.slots[rec.id] = undefined;
    const o = rec.id * ELEMENT_STRIDE;
    this.bridge.elementView().fill(0, o, o + ELEMENT_STRIDE);
    if (this.decorated.delete(el)) undecorateElement(el);
    this.deps.scheduleRedistribute();
  }

  /** W66: re-snapshot an observed element's colours (D66-10: unobserved → no-op). */
  refresh(el: HTMLElement): void {
    for (const rec of this.entries()) {
      if (rec.el !== el) continue;
      const colors = snapshotColorsWithout(el, ELEMENT_CLASS);
      rec.background = colors.background;
      rec.text = colors.text;
      return;
    }
  }

  unobserveAll(): void {
    for (const el of [...this.byEl.keys()]) this.unobserve(el);
  }

  /** Per frame: x, y, w, h (buffer space) and the radius for the current size. */
  sync(): void {
    if (this.byEl.size === 0) return;
    const v = this.bridge.elementView();
    const off = this.deps.coordOffset();
    for (const rec of this.byEl.values()) {
      this.writeRect(rec, v, off);
      v[rec.id * ELEMENT_STRIDE + El.INTERACTION] = this.interactionCode(rec);
    }
  }

  /** Σ rounded-rect area of the observed elements (the density-budget warning). */
  observedArea(): number {
    const v = this.bridge.elementView();
    let area = 0;
    for (const rec of this.byEl.values()) {
      const o = rec.id * ELEMENT_STRIDE;
      area += roundedRectArea(v[o + El.W], v[o + El.H], v[o + El.RADIUS]);
    }
    return area;
  }

  private writeRect(rec: InternalRecord, v: Float32Array, off: { x: number; y: number }): void {
    const r = rec.el.getBoundingClientRect();
    const o = rec.id * ELEMENT_STRIDE;
    v[o + El.X] = r.left - off.x;
    v[o + El.Y] = r.top - off.y;
    v[o + El.W] = r.width;
    v[o + El.H] = r.height;
    v[o + El.RADIUS] = parseBorderRadius(rec.rawRadius, r.width, r.height);
  }
}

/** D68-2 amended: `(hover: hover)` on the element's own window; no matchMedia → cannot tell → false. */
function canHover(el: HTMLElement): boolean {
  try {
    const win = el.ownerDocument.defaultView ?? (typeof window === "undefined" ? null : window);
    return typeof win?.matchMedia === "function" && win.matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
}

function matchesHover(el: HTMLElement): boolean {
  try {
    return el.matches(":hover");
  } catch {
    return false;
  }
}
