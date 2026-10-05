import { DYNAMIC_FIELDS, ELEMENT_STRIDE, STATE_STRIDE, STATIC_FIELDS } from "./fluid-layout";
import type { FluidBackend, FluidCoreLike } from "./wasm-loader";

/**
 * Sole owner of pointers and views into WASM memory (spec §1 "WasmBridge",
 * decision D64-7). Nothing else builds a Float32Array over a core pointer.
 *
 * - `dynamicView()` is a NEW view on every call (spec §2 FFI item 2).
 * - `staticView()` is cached and replaced only when the generation changed
 *   or the memory buffer was replaced (FFI item 3).
 * - Element and state views are rebound when `memory.buffer` changes
 *   (another core's allocation can grow and detach it).
 */
export class FluidBridge {
  readonly core: FluidCoreLike;
  readonly particleCapacity: number;
  readonly elementCapacity: number;
  private readonly memory: FluidBackend["memory"];
  private readonly elPtr: number;
  private readonly dynPtr: number;
  private readonly statPtr: number;
  private readonly statePtr: number;
  private bound: ArrayBufferLike;
  private elView: Float32Array;
  private stView: Float32Array;
  private staticCache: Float32Array | null = null;
  private gen: number;

  constructor(backend: FluidBackend, core: FluidCoreLike) {
    const checks: ReadonlyArray<readonly [string, number, number]> = [
      ["element_stride", core.element_stride(), ELEMENT_STRIDE],
      ["state_stride", core.state_stride(), STATE_STRIDE],
      ["dynamic_fields", core.dynamic_fields(), DYNAMIC_FIELDS],
      ["static_fields", core.static_fields(), STATIC_FIELDS],
    ];
    for (const [name, got, want] of checks) {
      if (got !== want) {
        throw new Error(
          `[liquiddom] FFI stride mismatch: core.${name}() = ${got}, fluid-layout.ts expects ${want}. Rebuild with \`npm run build:wasm\`.`,
        );
      }
    }
    this.core = core;
    this.memory = backend.memory;
    this.particleCapacity = core.particle_capacity();
    this.elementCapacity = core.element_capacity();
    this.elPtr = core.elements_ptr();
    this.dynPtr = core.dynamic_ptr();
    this.statPtr = core.static_ptr();
    this.statePtr = core.state_ptr();
    this.bound = this.memory.buffer;
    this.elView = this.view(this.elPtr, this.elementCapacity * ELEMENT_STRIDE);
    this.stView = this.view(this.statePtr, this.elementCapacity * STATE_STRIDE);
    this.gen = core.generation();
  }

  /** The generation seen by the last `syncGeneration()`. */
  get generation(): number {
    return this.gen;
  }

  /** True when `memory.buffer` was replaced since the views were bound. */
  isStale(): boolean {
    return this.memory.buffer !== this.bound;
  }

  elementView(): Float32Array {
    this.rebindIfStale();
    return this.elView;
  }

  stateView(): Float32Array {
    this.rebindIfStale();
    return this.stView;
  }

  dynamicView(): Float32Array {
    this.rebindIfStale();
    return this.view(this.dynPtr, this.particleCapacity * DYNAMIC_FIELDS);
  }

  /** For `writeBuffer(buf, 0, buffer, byteOffset, byteLength)` (slice 3, B3/B14). */
  dynamicByteRange(): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } {
    return {
      buffer: this.memory.buffer,
      byteOffset: this.dynPtr,
      byteLength: this.particleCapacity * DYNAMIC_FIELDS * 4,
    };
  }

  staticView(): Float32Array {
    this.rebindIfStale();
    if (!this.staticCache) {
      this.staticCache = this.view(this.statPtr, this.particleCapacity * STATIC_FIELDS);
    }
    return this.staticCache;
  }

  /** Reads `core.generation()`; true (and the static view is refreshed) if it changed. */
  syncGeneration(): boolean {
    const g = this.core.generation();
    if (g === this.gen) return false;
    this.gen = g;
    this.staticCache = null;
    return true;
  }

  private view(ptr: number, length: number): Float32Array {
    return new Float32Array(this.memory.buffer, ptr, length);
  }

  private rebindIfStale(): void {
    if (!this.isStale()) return;
    this.bound = this.memory.buffer;
    this.elView = this.view(this.elPtr, this.elementCapacity * ELEMENT_STRIDE);
    this.stView = this.view(this.statePtr, this.elementCapacity * STATE_STRIDE);
    this.staticCache = null;
  }
}
