/** Must match Rust FLOATS_PER_ENTITY in src/buffer.rs */
export const FLOATS_PER_ENTITY = 8;

export interface WasmMemorySource {
  memory: WebAssembly.Memory;
  ptr: number;
}

export class PhantomObserver {
  private buffer: Float32Array;
  private readonly capacity: number;
  private readonly elementToId: WeakMap<HTMLElement, number> = new WeakMap();
  private readonly idToElement: Map<number, HTMLElement> = new Map();
  private readonly availableIds: number[] = [];
  private nextId = 0;
  private wasmSource: WasmMemorySource | null;

  /**
   * @param capacity - Max number of entities
   * @param wasmSource - If provided, creates a view into WASM linear memory
   *                     instead of allocating a local Float32Array.
   */
  constructor(capacity: number, wasmSource?: WasmMemorySource) {
    this.capacity = capacity;
    this.wasmSource = wasmSource ?? null;

    if (wasmSource) {
      this.buffer = new Float32Array(
        wasmSource.memory.buffer,
        wasmSource.ptr,
        capacity * FLOATS_PER_ENTITY,
      );
    } else {
      this.buffer = new Float32Array(capacity * FLOATS_PER_ENTITY);
    }
  }

  getBuffer(): Float32Array {
    return this.buffer;
  }

  /**
   * Re-create the Float32Array view after a grow() call invalidates
   * the underlying ArrayBuffer. Must be called with the new pointer.
   */
  rebindBuffer(wasmSource: WasmMemorySource, newCapacity: number): void {
    this.wasmSource = wasmSource;
    this.buffer = new Float32Array(
      wasmSource.memory.buffer,
      wasmSource.ptr,
      newCapacity * FLOATS_PER_ENTITY,
    );
  }

  observe(el: HTMLElement, liquidType?: number): number {
    const id =
      this.availableIds.length > 0
        ? this.availableIds.pop()!
        : this.nextId++;

    if (id >= this.capacity) {
      throw new Error(
        `PhantomObserver capacity exceeded: ${this.capacity} elements max`,
      );
    }

    this.elementToId.set(el, id);
    this.idToElement.set(id, el);

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

  unobserve(el: HTMLElement): void {
    const id = this.elementToId.get(el);
    if (id === undefined) return;

    // Zero out the slot
    const offset = id * FLOATS_PER_ENTITY;
    this.buffer.fill(0, offset, offset + FLOATS_PER_ENTITY);

    this.elementToId.delete(el);
    this.idToElement.delete(id);
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
    }
  }

  /**
   * Debug visualization: draw active entities as red rectangles on a canvas.
   * Call this inside a requestAnimationFrame loop with a 2D canvas context.
   */
  debugRender(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
    ctx.lineWidth = 2;

    for (const [id] of this.idToElement) {
      const offset = id * FLOATS_PER_ENTITY;
      const x = this.buffer[offset];
      const y = this.buffer[offset + 1];
      const w = this.buffer[offset + 2];
      const h = this.buffer[offset + 3];
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }
}
