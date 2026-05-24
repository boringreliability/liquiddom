import { parseBorderRadius } from "./border-radius";
import { parseBoxShadowMargin, ZERO_MARGIN, type ShadowMargin } from "./box-shadow";
import type { RenderFrame, RenderFrameViewport } from "./renderers/renderer";

/** Must match Rust FLOATS_PER_ENTITY in src/buffer.rs */
export const FLOATS_PER_ENTITY = 9;

/** Must match Rust PARTICLES_PER_BODY in src/api.rs */
export const PARTICLES_PER_BODY = 16;

/**
 * Ward 052: resolve a `getComputedStyle(...).backgroundColor` string to a
 * usable CSS color or null. Null signals "transparent / unparseable" and the
 * caller falls back to `colorDefault`.
 *
 * The regex matches only the 4-arg `rgba(...)` form to extract alpha for the
 * transparent check. 3-arg `rgb()` and CSS4 space-separated forms fall
 * through to the return statement — by design (no alpha == fully opaque).
 */
function parseComputedColor(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (
    trimmed === "" ||
    trimmed === "transparent" ||
    trimmed === "initial" ||
    trimmed === "inherit"
  ) {
    return null;
  }
  const m = trimmed.match(/^rgba?\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([0-9.]+)\s*\)$/i);
  if (m && parseFloat(m[1]!) === 0) return null;
  return trimmed;
}

const DEFAULT_COLOR = "rgba(83, 52, 131, 0.8)";
const DEFAULT_COLOR_HOVER = "rgba(120, 80, 180, 0.9)";

export interface PhantomObserverOptions {
  entityView?: Float32Array;
  particleView?: Float32Array;
  colorDefault?: string;
  colorHover?: string;
  /** Ward 052: when true, read getComputedStyle(el).backgroundColor on observe + style/class mutations. */
  useComputedTheme?: boolean;
  /** Ward 043: called on unobserve, unobserveAll, and spawnDroplet to clear stale Rust slot state. */
  releaseSlot?: (id: number) => void;
  /** Ward 039: metaball fusion radius in CSS px (WebGPU only). Default 0 (no fusion). */
  fusionRadius?: number;
  /**
   * Ward 040: refraction config (WebGPU only). Pre-clamped at the public API.
   * `strength` is finite non-negative; `enabled: false` keeps shader path
   * dormant. Omitting the option keeps refraction off.
   */
  refraction?: { enabled: boolean; strength: number };
}

/** Ward 043+045: options for spawning a DOM-less free-floating particle. */
export interface SpawnDropletOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual radius in CSS px. Default 4 (diameter 8). */
  radius?: number;
  /** Ward 045: ms before auto-despawn. Default 5000. */
  lifetimeMs?: number;
}

/** Stored listener refs for clean removal in unobserve() */
interface ElementListeners {
  mouseenter: EventListener;
  mouseleave: EventListener;
  focus: EventListener;
  blur: EventListener;
  pointerdown: EventListener;
  pointermove: EventListener;
  pointerup: EventListener;
  pointercancel: EventListener;
}

export class PhantomObserver {
  private buffer: Float32Array;
  private particleBuffer: Float32Array | null = null;
  private _capacity: number;
  private readonly elementToId: WeakMap<HTMLElement, number> = new WeakMap();
  private readonly idToElement: Map<number, HTMLElement> = new Map();
  private readonly availableIds: number[] = [];
  private nextId = 0;
  private readonly hoverState: WeakMap<HTMLElement, boolean> = new WeakMap();
  private readonly focusState: WeakMap<HTMLElement, boolean> = new WeakMap();
  private readonly listeners: WeakMap<HTMLElement, ElementListeners> =
    new WeakMap();
  private readonly colorDefault: string;
  private readonly colorHover: string;
  private coordOffsetX = 0;
  private coordOffsetY = 0;
  private resizeObserver: ResizeObserver | null = null;
  // Ward 052: per-element theme cache + per-element MutationObservers
  // Ward 054: MO became unconditional, also drives shadowCache refresh.
  private readonly useComputedTheme: boolean;
  private readonly themeCache: Map<number, string> = new Map();
  private readonly shadowCache: Map<number, ShadowMargin> = new Map();
  private readonly mutationObservers: Map<number, MutationObserver> = new Map();
  // Ward 043: DOM-less free-floating particle slot tracking + Rust-side clearer.
  private readonly dropletIds: Set<number> = new Set();
  private readonly releaseSlot?: (id: number) => void;
  /** Ward 039: metaball fusion radius (CSS px), 0 = disabled. */
  private readonly fusionRadius: number;
  /** Ward 040: refraction config (pre-clamped at instance API). */
  private readonly refraction: { enabled: boolean; strength: number } | undefined;

  /**
   * @param capacity - Max number of entities
   * @param options - Optional WASM source and color configuration
   */
  constructor(capacity: number, options?: PhantomObserverOptions) {
    this._capacity = capacity;
    this.colorDefault = options?.colorDefault ?? DEFAULT_COLOR;
    this.colorHover = options?.colorHover ?? DEFAULT_COLOR_HOVER;
    this.buffer = options?.entityView ?? new Float32Array(capacity * FLOATS_PER_ENTITY);
    this.particleBuffer = options?.particleView ?? null;
    this.useComputedTheme = options?.useComputedTheme === true;
    this.releaseSlot = options?.releaseSlot;
    this.fusionRadius = options?.fusionRadius ?? 0;
    this.refraction = options?.refraction;

    // Ward 042 §6: single shared ResizeObserver for border-radius refresh.
    // Lazy: only construct when ResizeObserver is available (browsers + the
    // ControllableResizeObserver test mock).
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = this.elementToId.get(el);
          if (id === undefined) continue;
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          const styleSrc = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
          const raw = styleSrc?.borderRadius ?? "";
          this.buffer[id * FLOATS_PER_ENTITY + 8] = parseBorderRadius(raw, w, h);
        }
      });
    }
  }

  get capacity(): number {
    return this._capacity;
  }

  getBuffer(): Float32Array {
    return this.buffer;
  }

  /** Get entity ID for an observed element, or undefined if not observed. */
  getEntityId(el: HTMLElement): number | undefined {
    return this.elementToId.get(el);
  }

  /**
   * Ward 055: public iterator over (slot id → element) pairs for currently
   * observed soft-body entities. Used by `LiquidDOM.create()`'s scroll-snap
   * lerp to snapshot every entity's base_pos at scroll-end. Does NOT include
   * droplet ids (see `dropletIds` set — droplets aren't subject to scroll-snap).
   */
  getObservedEntries(): IterableIterator<[number, HTMLElement]> {
    return this.idToElement.entries();
  }

  /** Update views and capacity after WasmBridge rebind. */
  setViews(entityView: Float32Array, particleView: Float32Array | null, newCapacity: number): void {
    this.buffer = entityView;
    this.particleBuffer = particleView;
    this._capacity = newCapacity;
  }

  /** Set coordinate offset for container mode. Subtracted from getBoundingClientRect in sync(). */
  setCoordOffset(x: number, y: number): void {
    this.coordOffsetX = x;
    this.coordOffsetY = y;
  }

  /** Grow in mock mode (no WASM). Creates a larger local buffer, copies old data. */
  growLocal(newCapacity: number): void {
    const newBuffer = new Float32Array(newCapacity * FLOATS_PER_ENTITY);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this._capacity = newCapacity;
  }

  observe(el: HTMLElement, liquidType?: number): number {
    // Ward 043: liquid_type=6 (FreeDrop) is allocated via spawnDroplet, not observe.
    // Round to match Rust's dispatch_strategy semantics (6.4 → FreeDrop).
    if (liquidType !== undefined && Math.round(liquidType) === 6) {
      throw new Error(
        "observe() does not accept liquid_type=6 (FreeDrop). Use instance.spawnDroplet() instead.",
      );
    }
    // Idempotent: if already observed, return existing ID
    const existingId = this.elementToId.get(el);
    if (existingId !== undefined) return existingId;

    const id =
      this.availableIds.length > 0
        ? this.availableIds.pop()!
        : this.nextId++;

    if (id >= this._capacity) {
      throw new Error(
        `PhantomObserver capacity exceeded: ${this._capacity} elements max`,
      );
    }

    this.elementToId.set(el, id);
    this.idToElement.set(id, el);
    this.hoverState.set(el, false);
    this.focusState.set(el, false);

    // Bind interaction listeners (store refs for cleanup)
    const onEnter = () => this.hoverState.set(el, true);
    const onLeave = () => this.hoverState.set(el, false);
    const onFocus = () => this.focusState.set(el, true);
    const onBlur = () => this.focusState.set(el, false);

    // Drag listeners — move DOM element with pointer, blob follows via sync().
    //
    // Drag-mode is OPT-IN via `liquid_type=3` (Dragged). Captured ONCE at
    // observe-time via the closure flag below. Any element observed with
    // a different type — Default(0), Tear(1), Magnet(2), Shake(4), Tween(5),
    // or no liquidType argument — gets pointer listeners that no-op. This
    // prevents the W30 regression where every click on a `[data-liquid]`
    // element hijacked the DOM via `position: fixed` + style mutations.
    //
    // Using a closure flag (not the buffer state) is important: the buffer
    // is volatile — `onPointerUp` resets it to 0 and `impulse()` writes 4
    // for Shake. Reading the buffer at pointerdown-time would break the
    // legitimate Dragged path after the first drag/release cycle.
    const isDraggable = liquidType === 3;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragging = false;

    const onPointerDown = (e: Event) => {
      if (!isDraggable) return;
      const pe = e as PointerEvent;
      const eid = this.elementToId.get(el);
      if (eid === undefined) return;
      dragging = true;
      // Signal to Rust: skip rigid translation, let springs create squish.
      // The buffer is reset to 0 (Default) in onPointerUp.
      this.buffer[eid * FLOATS_PER_ENTITY + 5] = 3.0; // liquid_type = Dragged
      const rect = el.getBoundingClientRect();
      dragStartX = rect.left;
      dragStartY = rect.top;
      dragOffsetX = pe.clientX - rect.left;
      dragOffsetY = pe.clientY - rect.top;
      el.style.position = "fixed";
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.margin = "0";
      el.style.zIndex = "1000";
      if (typeof el.setPointerCapture === "function") {
        el.setPointerCapture(pe.pointerId);
      }
    };
    const onPointerMove = (e: Event) => {
      if (!dragging) return;
      const pe = e as PointerEvent;
      el.style.left = `${pe.clientX - dragOffsetX}px`;
      el.style.top = `${pe.clientY - dragOffsetY}px`;
    };
    const onPointerUp = (e: Event) => {
      if (!dragging) return;
      dragging = false;
      const pe = e as PointerEvent;
      // Reset liquid_type so rigid translation resumes
      const eid = this.elementToId.get(el);
      if (eid !== undefined) {
        this.buffer[eid * FLOATS_PER_ENTITY + 5] = 0.0; // Default
      }
      // Snap back to original position
      el.style.position = "";
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.height = "";
      el.style.margin = "";
      el.style.zIndex = "";
      if (typeof el.releasePointerCapture === "function") {
        el.releasePointerCapture(pe.pointerId);
      }
    };

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp); // same handler
    this.listeners.set(el, {
      mouseenter: onEnter,
      mouseleave: onLeave,
      focus: onFocus,
      blur: onBlur,
      pointerdown: onPointerDown,
      pointermove: onPointerMove,
      pointerup: onPointerUp,
      pointercancel: onPointerUp,
    });

    const offset = id * FLOATS_PER_ENTITY;
    const rect = el.getBoundingClientRect();
    this.buffer[offset] = rect.x - this.coordOffsetX;
    this.buffer[offset + 1] = rect.y - this.coordOffsetY;
    this.buffer[offset + 2] = rect.width;
    this.buffer[offset + 3] = rect.height;
    this.buffer[offset + 4] = 0; // interaction_state: default
    this.buffer[offset + 5] = liquidType ?? 0; // liquid_type
    this.buffer[offset + 6] = 0; // custom_param_1
    this.buffer[offset + 7] = 0; // reserved

    // Ward 042 §2: resolve border-radius once on observe.
    const rawBr = typeof window !== "undefined"
      ? window.getComputedStyle(el).borderRadius
      : "";
    this.buffer[offset + 8] = parseBorderRadius(rawBr, rect.width, rect.height);

    // Ward 042 §6: subscribe to resize for radius refresh.
    this.resizeObserver?.observe(el);

    // Ward 054: box-shadow margin cached on every observe (regardless of
    // useComputedTheme — clip-inflation is independent of theme tracking).
    this.refreshElementShadow(el, id);

    // Ward 052: per-element computed-theme tracking (opt-in).
    if (this.useComputedTheme) {
      this.refreshElementTheme(el, id);
    }

    // Ward 054: per-element MO is now unconditional — fires on either theme
    // or box-shadow style change. Theme branch is gated inside the callback
    // so useComputedTheme: false consumers don't get auto-populated themeCache.
    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(() => {
        if (this.useComputedTheme) this.refreshElementTheme(el, id);
        this.refreshElementShadow(el, id);
      });
      mo.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
      this.mutationObservers.set(id, mo);
    }

    return id;
  }

  /** Ward 052: read computed bg-color for `el` and update themeCache for `id`. */
  private refreshElementTheme(el: HTMLElement, id: number): void {
    if (typeof window === "undefined") return;
    const raw = window.getComputedStyle(el).backgroundColor;
    const resolved = parseComputedColor(raw);
    if (resolved === null) {
      this.themeCache.delete(id);
    } else {
      this.themeCache.set(id, resolved);
    }
  }

  /**
   * Ward 052: re-read computed bg-color for an observed element.
   * No-op if not in computed mode or element not observed.
   */
  refreshTheme(el: HTMLElement): void {
    if (!this.useComputedTheme) return;
    const id = this.elementToId.get(el);
    if (id === undefined) return;
    this.refreshElementTheme(el, id);
  }

  /** Ward 054: read computed box-shadow for `el` and update shadowCache for `id`. */
  private refreshElementShadow(el: HTMLElement, id: number): void {
    if (typeof window === "undefined") return;
    const margin = parseBoxShadowMargin(window.getComputedStyle(el).boxShadow);
    // parseBoxShadowMargin returns the ZERO_MARGIN singleton for any all-zero result.
    if (margin === ZERO_MARGIN) {
      this.shadowCache.delete(id);
    } else {
      this.shadowCache.set(id, margin);
    }
  }

  /**
   * Ward 054: re-read computed box-shadow for an observed element.
   * Used for stylesheet-cascade-driven changes outside MutationObserver scope.
   * No-op if element not observed.
   */
  refreshShadow(el: HTMLElement): void {
    const id = this.elementToId.get(el);
    if (id === undefined) return;
    this.refreshElementShadow(el, id);
  }

  /**
   * Ward 043: spawn a DOM-less free-floating particle. Allocates a slot from
   * the same pool as `observe()` and writes initial state into the buffer.
   * Calls `releaseSlot` (if provided) to clear any stale Rust state for
   * recycled slots — Decision §1's invariant: bodies[id] and free_particles[id]
   * are never both `Some`.
   */
  spawnDroplet(opts: SpawnDropletOptions): number {
    // Allocator priority (W45 Decision §7):
    //   1. availableIds  — explicit recycle queue (despawnDroplet, unobserve)
    //   2. scan          — slots Rust deactivated via cull but TS hasn't recycled
    //   3. nextId        — fresh allocation, with capacity guard
    let id = this.availableIds.pop() ?? this.scanForFreedDropletSlot();
    if (id === undefined) {
      if (this.nextId >= this._capacity) {
        throw new Error(`PhantomObserver capacity exceeded: ${this._capacity} slots max`);
      }
      id = this.nextId++;
    }
    this.releaseSlot?.(id);
    this.dropletIds.add(id);

    const radius = opts.radius ?? 4;
    const lifetimeMs = opts.lifetimeMs ?? 5000;
    const diameter = radius * 2;
    const off = id * FLOATS_PER_ENTITY;
    this.buffer[off]     = opts.x;
    this.buffer[off + 1] = opts.y;
    this.buffer[off + 2] = diameter;
    this.buffer[off + 3] = lifetimeMs; // W45: slot[3] is lifetime (was diameter symmetry)
    this.buffer[off + 4] = 0;
    this.buffer[off + 5] = 6.0;
    this.buffer[off + 6] = opts.vx;
    this.buffer[off + 7] = opts.vy;
    this.buffer[off + 8] = 0;
    return id;
  }

  /**
   * Ward 045: find a droplet slot that Rust cull deactivated (slot[2] === 0
   * AND id still in dropletIds). despawnDroplet removes from dropletIds before
   * zeroing, so a hit here is unambiguously a Rust-driven cull.
   */
  private scanForFreedDropletSlot(): number | undefined {
    for (const id of this.dropletIds) {
      if (this.buffer[id * FLOATS_PER_ENTITY + 2] === 0) {
        this.dropletIds.delete(id);
        return id;
      }
    }
    return undefined;
  }

  /**
   * Ward 045: explicit droplet removal. Idempotent — silent no-op for ids
   * not in dropletIds (covers soft-body slots, already-despawned droplets,
   * and out-of-range ids).
   */
  despawnDroplet(id: number): void {
    if (!this.dropletIds.has(id)) return;
    this.dropletIds.delete(id);
    this.releaseSlot?.(id);
    const off = id * FLOATS_PER_ENTITY;
    this.buffer.fill(0, off, off + FLOATS_PER_ENTITY);
    this.availableIds.push(id);
  }

  /** Unobserve all tracked elements + droplet slots. Used by runtime destroy(). */
  unobserveAll(): void {
    // Collect elements first — unobserve mutates idToElement
    const elements = [...this.idToElement.values()];
    for (const el of elements) {
      this.unobserve(el);
    }
    // Ward 043: also clear droplet slots — they have no DOM element so the
    // element-iteration above skips them.
    for (const id of this.dropletIds) {
      this.releaseSlot?.(id);
      const off = id * FLOATS_PER_ENTITY;
      this.buffer.fill(0, off, off + FLOATS_PER_ENTITY);
      this.availableIds.push(id);
    }
    this.dropletIds.clear();
  }

  unobserve(el: HTMLElement): void {
    const id = this.elementToId.get(el);
    if (id === undefined) return;

    // Clean up event listeners
    const ls = this.listeners.get(el);
    if (ls) {
      el.removeEventListener("mouseenter", ls.mouseenter);
      el.removeEventListener("mouseleave", ls.mouseleave);
      el.removeEventListener("focus", ls.focus);
      el.removeEventListener("blur", ls.blur);
      el.removeEventListener("pointerdown", ls.pointerdown);
      el.removeEventListener("pointermove", ls.pointermove);
      el.removeEventListener("pointerup", ls.pointerup);
      el.removeEventListener("pointercancel", ls.pointercancel);
      this.listeners.delete(el);
    }

    // Ward 052 + Ward 054: disconnect per-element MutationObserver (now
    // unconditional) and clear both theme + shadow caches.
    const mo = this.mutationObservers.get(id);
    if (mo) {
      mo.disconnect();
      this.mutationObservers.delete(id);
    }
    this.themeCache.delete(id);
    this.shadowCache.delete(id);

    // Ward 042 §6: unsubscribe from resize.
    this.resizeObserver?.unobserve(el);

    // Ward 043: clear Rust slot state so a future spawnDroplet on this id
    // starts clean (Decision §1 invariant).
    this.releaseSlot?.(id);

    // Zero out the slot
    const offset = id * FLOATS_PER_ENTITY;
    this.buffer.fill(0, offset, offset + FLOATS_PER_ENTITY);

    this.elementToId.delete(el);
    this.idToElement.delete(id);
    this.hoverState.delete(el);
    this.focusState.delete(el);
    this.availableIds.push(id);
  }

  sync(): void {
    for (const [id, el] of this.idToElement) {
      const offset = id * FLOATS_PER_ENTITY;
      const rect = el.getBoundingClientRect();
      this.buffer[offset] = rect.x - this.coordOffsetX;
      this.buffer[offset + 1] = rect.y - this.coordOffsetY;
      this.buffer[offset + 2] = rect.width;
      this.buffer[offset + 3] = rect.height;
      // interaction_state: 0.0 = idle, 1.0 = hover, 2.0 = focused
      // Focus takes priority over hover (keyboard a11y > pointer feedback)
      if (this.focusState.get(el)) {
        this.buffer[offset + 4] = 2.0;
      } else if (this.hoverState.get(el)) {
        this.buffer[offset + 4] = 1.0;
      } else {
        this.buffer[offset + 4] = 0.0;
      }
    }
  }

  /**
   * Ward 036: build a per-frame RenderFrame DTO. Replaces the old `render()`.
   * Buffers and theme/shadow Maps are passed by reference (Decision §1);
   * id arrays are snapshotted (Decision §12) to immunize against any
   * intervening observer mutation between frame build and renderer draw.
   *
   * Ward 040: `reducedMotion` flows in from the RAF loop's closure variable
   * (Rule of Two — the observer/renderer never read `window.matchMedia` directly).
   */
  buildFrame(viewport: RenderFrameViewport, reducedMotion = false): RenderFrame {
    return {
      entities: this.buffer,
      particles: this.particleBuffer,
      capacity: this._capacity,
      softBodyIds: Array.from(this.idToElement.keys()),
      dropletIds: Array.from(this.dropletIds),
      viewport,
      reducedMotion,
      theme: {
        colorDefault: this.colorDefault,
        colorHover: this.colorHover,
        themeCache: this.themeCache,
        shadowCache: this.shadowCache,
        fusionRadius: this.fusionRadius,
        refraction: this.refraction,
      },
    };
  }

}
