/** Opaque handle to a LiquidCore WASM instance */
export interface WasmCore {
    ptr(): number;
    particle_ptr(): number;
    capacity(): number;
    grow(newCapacity: number): void;
    tick(dt: number, px: number, py: number, active: boolean, tension: number, damping: number, substeps: number): void;
    free(): void;
}
/**
 * Single owner of all WASM shared-memory view management.
 * No other class should construct Float32Array views from raw pointers.
 */
export declare class WasmBridge {
    private memory;
    private core;
    private _capacity;
    private cachedBuffer;
    private _entityView;
    private _particleView;
    constructor(memory: WebAssembly.Memory, core: WasmCore, capacity: number);
    get capacity(): number;
    entityView(): Float32Array;
    particleView(): Float32Array;
    /** Returns true if the underlying ArrayBuffer has been detached (memory grew). */
    isStale(): boolean;
    /** Re-read pointers and create fresh views. Call after core.grow(). */
    rebind(newCapacity: number): void;
}
//# sourceMappingURL=wasm-bridge.d.ts.map