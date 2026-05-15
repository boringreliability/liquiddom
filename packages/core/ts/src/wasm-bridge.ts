import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "./phantom-observer";

const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;

/** Opaque handle to a LiquidCore WASM instance */
export interface WasmCore {
  ptr(): number;
  particle_ptr(): number;
  capacity(): number;
  grow(newCapacity: number): void;
  tick(
    dt: number,
    px: number,
    py: number,
    active: boolean,
    tension: number,
    damping: number,
    substeps: number,
    repulsionRadius: number,
    repulsionStrength: number,
    neighborSpringK: number,
    /** Ward 045 viewport AABB for FreeDrop cull (top-left x). */
    vpX: number,
    vpY: number,
    vpW: number,
    vpH: number,
    cullMargin: number,
    /** Ward 046 gravity (px/s²). Applied per strategy in tick(). */
    gravityX: number,
    gravityY: number,
  ): void;
  /** Ward 043: clear both bodies[id] and free_particles[id]. Idempotent. */
  release_slot(id: number): void;
  free(): void;
}

/**
 * Single owner of all WASM shared-memory view management.
 * No other class should construct Float32Array views from raw pointers.
 */
export class WasmBridge {
  private memory: WebAssembly.Memory;
  private core: WasmCore;
  private _capacity: number;
  private cachedBuffer: ArrayBuffer;
  private _entityView: Float32Array;
  private _particleView: Float32Array;

  constructor(
    memory: WebAssembly.Memory,
    core: WasmCore,
    capacity: number,
  ) {
    if (core.capacity() !== capacity) {
      throw new Error(
        `WasmBridge capacity mismatch: core has ${core.capacity()}, expected ${capacity}`,
      );
    }
    this.memory = memory;
    this.core = core;
    this._capacity = capacity;
    this.cachedBuffer = memory.buffer;
    this._entityView = new Float32Array(
      memory.buffer,
      core.ptr(),
      capacity * FLOATS_PER_ENTITY,
    );
    this._particleView = new Float32Array(
      memory.buffer,
      core.particle_ptr(),
      capacity * PARTICLE_FLOATS_PER_BODY,
    );
  }

  get capacity(): number {
    return this._capacity;
  }

  entityView(): Float32Array {
    return this._entityView;
  }

  particleView(): Float32Array {
    return this._particleView;
  }

  /** Returns true if the underlying ArrayBuffer has been detached (memory grew). */
  isStale(): boolean {
    return this.memory.buffer !== this.cachedBuffer;
  }

  /** Re-read pointers and create fresh views. Call after core.grow(). */
  rebind(newCapacity: number): void {
    this._capacity = newCapacity;
    this.cachedBuffer = this.memory.buffer;
    this._entityView = new Float32Array(
      this.memory.buffer,
      this.core.ptr(),
      newCapacity * FLOATS_PER_ENTITY,
    );
    this._particleView = new Float32Array(
      this.memory.buffer,
      this.core.particle_ptr(),
      newCapacity * PARTICLE_FLOATS_PER_BODY,
    );
  }
}
