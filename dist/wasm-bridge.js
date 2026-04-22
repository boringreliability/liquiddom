import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "./phantom-observer";
const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;
/**
 * Single owner of all WASM shared-memory view management.
 * No other class should construct Float32Array views from raw pointers.
 */
export class WasmBridge {
    memory;
    core;
    _capacity;
    cachedBuffer;
    _entityView;
    _particleView;
    constructor(memory, core, capacity) {
        if (core.capacity() !== capacity) {
            throw new Error(`WasmBridge capacity mismatch: core has ${core.capacity()}, expected ${capacity}`);
        }
        this.memory = memory;
        this.core = core;
        this._capacity = capacity;
        this.cachedBuffer = memory.buffer;
        this._entityView = new Float32Array(memory.buffer, core.ptr(), capacity * FLOATS_PER_ENTITY);
        this._particleView = new Float32Array(memory.buffer, core.particle_ptr(), capacity * PARTICLE_FLOATS_PER_BODY);
    }
    get capacity() {
        return this._capacity;
    }
    entityView() {
        return this._entityView;
    }
    particleView() {
        return this._particleView;
    }
    /** Returns true if the underlying ArrayBuffer has been detached (memory grew). */
    isStale() {
        return this.memory.buffer !== this.cachedBuffer;
    }
    /** Re-read pointers and create fresh views. Call after core.grow(). */
    rebind(newCapacity) {
        this._capacity = newCapacity;
        this.cachedBuffer = this.memory.buffer;
        this._entityView = new Float32Array(this.memory.buffer, this.core.ptr(), newCapacity * FLOATS_PER_ENTITY);
        this._particleView = new Float32Array(this.memory.buffer, this.core.particle_ptr(), newCapacity * PARTICLE_FLOATS_PER_BODY);
    }
}
