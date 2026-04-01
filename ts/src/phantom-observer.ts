/** Must match Rust FLOATS_PER_ENTITY in src/buffer.rs */
export const FLOATS_PER_ENTITY = 8;

/** Must match Rust PARTICLES_PER_BODY in src/api.rs */
export const PARTICLES_PER_BODY = 16;
const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;

const DEFAULT_COLOR = "rgba(83, 52, 131, 0.8)";
const DEFAULT_COLOR_HOVER = "rgba(120, 80, 180, 0.9)";

export interface PhantomObserverOptions {
  entityView?: Float32Array;
  particleView?: Float32Array;
  colorDefault?: string;
  colorHover?: string;
}

/** Stored listener refs for clean removal in unobserve() */
interface ElementListeners {
  mouseenter: EventListener;
  mouseleave: EventListener;
  focus: EventListener;
  blur: EventListener;
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
  }

  get capacity(): number {
    return this._capacity;
  }

  getBuffer(): Float32Array {
    return this.buffer;
  }

  /** Update views and capacity after WasmBridge rebind. */
  setViews(entityView: Float32Array, particleView: Float32Array | null, newCapacity: number): void {
    this.buffer = entityView;
    this.particleBuffer = particleView;
    this._capacity = newCapacity;
  }

  /** Grow in mock mode (no WASM). Creates a larger local buffer, copies old data. */
  growLocal(newCapacity: number): void {
    const newBuffer = new Float32Array(newCapacity * FLOATS_PER_ENTITY);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this._capacity = newCapacity;
  }

  observe(el: HTMLElement, liquidType?: number): number {
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
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    this.listeners.set(el, {
      mouseenter: onEnter,
      mouseleave: onLeave,
      focus: onFocus,
      blur: onBlur,
    });

    const offset = id * FLOATS_PER_ENTITY;
    const rect = el.getBoundingClientRect();
    this.buffer[offset] = rect.x;
    this.buffer[offset + 1] = rect.y;
    this.buffer[offset + 2] = rect.width;
    this.buffer[offset + 3] = rect.height;
    this.buffer[offset + 4] = 0; // interaction_state: default
    this.buffer[offset + 5] = liquidType ?? 0; // liquid_type
    this.buffer[offset + 6] = 0; // custom_param_1
    this.buffer[offset + 7] = 0; // reserved

    return id;
  }

  /** Unobserve all tracked elements. Used by runtime destroy(). */
  unobserveAll(): void {
    // Collect elements first — unobserve mutates idToElement
    const elements = [...this.idToElement.values()];
    for (const el of elements) {
      this.unobserve(el);
    }
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
      this.listeners.delete(el);
    }

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
      this.buffer[offset] = rect.x;
      this.buffer[offset + 1] = rect.y;
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
   * Render soft body blobs using midpoint quadratic curves.
   * Falls back to filled rect if no particle buffer is available.
   * Optional viewport info enables culling of off-screen entities.
   */
  render(
    ctx: CanvasRenderingContext2D,
    viewport?: { viewportWidth: number; viewportHeight: number; cullMargin: number },
  ): void {
    ctx.save();

    for (const [id] of this.idToElement) {
      const entityOffset = id * FLOATS_PER_ENTITY;
      const x = this.buffer[entityOffset];
      const y = this.buffer[entityOffset + 1];
      const w = this.buffer[entityOffset + 2];
      const h = this.buffer[entityOffset + 3];

      // Skip zero-sized entities
      if (w === 0 || h === 0) continue;

      // Viewport culling: skip entities fully outside viewport + margin
      if (viewport) {
        const m = viewport.cullMargin;
        if (
          x + w < -m ||
          y + h < -m ||
          x > viewport.viewportWidth + m ||
          y > viewport.viewportHeight + m
        ) {
          continue;
        }
      }

      // Read interaction_state for hover visual feedback
      const isHover = this.buffer[entityOffset + 4] === 1.0;
      ctx.fillStyle = isHover ? this.colorHover : this.colorDefault;

      if (this.particleBuffer) {
        const offset = id * PARTICLE_FLOATS_PER_BODY;
        const n = PARTICLES_PER_BODY;

        const lastX = this.particleBuffer[offset + (n - 1) * 2];
        const lastY = this.particleBuffer[offset + (n - 1) * 2 + 1];
        const firstX = this.particleBuffer[offset];
        const firstY = this.particleBuffer[offset + 1];

        const startX = (lastX + firstX) / 2;
        const startY = (lastY + firstY) / 2;

        ctx.beginPath();
        ctx.moveTo(startX, startY);

        for (let i = 0; i < n; i++) {
          const nextI = (i + 1) % n;
          const currIdx = offset + i * 2;
          const nextIdx = offset + nextI * 2;

          const currX = this.particleBuffer[currIdx];
          const currY = this.particleBuffer[currIdx + 1];
          const nextX = this.particleBuffer[nextIdx];
          const nextY = this.particleBuffer[nextIdx + 1];

          const midX = (currX + nextX) / 2;
          const midY = (currY + nextY) / 2;

          ctx.quadraticCurveTo(currX, currY, midX, midY);
        }

        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }
    }

    ctx.restore();
  }
}
