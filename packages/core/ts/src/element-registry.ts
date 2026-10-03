import { parseBorderRadius } from "./border-radius";
import { snapshotColors, type RGBA } from "./color";
import type { FluidBridge } from "./fluid-bridge";
import { ELEMENT_STRIDE, El, roundedRectArea } from "./fluid-layout";
import type { ElementOptions } from "./options";

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
}

/**
 * Observed elements and their slots (replaces PhantomObserver for the fluid
 * engine). Element id == slot index, always the lowest free slot.
 */
export class ElementRegistry {
  private readonly slots: Array<InternalRecord | undefined>;
  private readonly byEl = new Map<HTMLElement, InternalRecord>();

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
    const { background, text } = snapshotColors(el);
    const cs = getComputedStyle(el);
    const rec: InternalRecord = {
      id,
      el,
      opts: { ...opts },
      background,
      text,
      rawRadius: cs.borderRadius || cs.borderTopLeftRadius || "",
    };
    this.slots[id] = rec;
    this.byEl.set(el, rec);
    const v = this.bridge.elementView();
    const o = id * ELEMENT_STRIDE;
    v[o + El.INTERACTION] = 0;
    v[o + El.HOME_DX] = 0;
    v[o + El.HOME_DY] = 0;
    v[o + El.VISCOSITY] = typeof opts.viscosity === "number" ? opts.viscosity : NaN;
    v[o + El.RECOVERY] = typeof opts.recovery === "number" ? opts.recovery : NaN;
    this.writeRect(rec, v, this.deps.coordOffset());
    this.deps.scheduleRedistribute();
    return id;
  }

  /** Zeroes the slot (w = 0 → inactive) and schedules a redistribution. */
  unobserve(el: HTMLElement): void {
    const rec = this.byEl.get(el);
    if (!rec) return;
    this.byEl.delete(el);
    this.slots[rec.id] = undefined;
    const o = rec.id * ELEMENT_STRIDE;
    this.bridge.elementView().fill(0, o, o + ELEMENT_STRIDE);
    this.deps.scheduleRedistribute();
  }

  unobserveAll(): void {
    for (const el of [...this.byEl.keys()]) this.unobserve(el);
  }

  /** Per frame: x, y, w, h (buffer space) and the radius for the current size. */
  sync(): void {
    if (this.byEl.size === 0) return;
    const v = this.bridge.elementView();
    const off = this.deps.coordOffset();
    for (const rec of this.byEl.values()) this.writeRect(rec, v, off);
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
