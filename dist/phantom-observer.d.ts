/** Must match Rust FLOATS_PER_ENTITY in src/buffer.rs */
export declare const FLOATS_PER_ENTITY = 8;
/** Must match Rust PARTICLES_PER_BODY in src/api.rs */
export declare const PARTICLES_PER_BODY = 16;
export interface PhantomObserverOptions {
    entityView?: Float32Array;
    particleView?: Float32Array;
    colorDefault?: string;
    colorHover?: string;
}
export declare class PhantomObserver {
    private buffer;
    private particleBuffer;
    private _capacity;
    private readonly elementToId;
    private readonly idToElement;
    private readonly availableIds;
    private nextId;
    private readonly hoverState;
    private readonly focusState;
    private readonly listeners;
    private readonly colorDefault;
    private readonly colorHover;
    /**
     * @param capacity - Max number of entities
     * @param options - Optional WASM source and color configuration
     */
    constructor(capacity: number, options?: PhantomObserverOptions);
    get capacity(): number;
    getBuffer(): Float32Array;
    /** Update views and capacity after WasmBridge rebind. */
    setViews(entityView: Float32Array, particleView: Float32Array | null, newCapacity: number): void;
    /** Grow in mock mode (no WASM). Creates a larger local buffer, copies old data. */
    growLocal(newCapacity: number): void;
    observe(el: HTMLElement, liquidType?: number): number;
    /** Unobserve all tracked elements. Used by runtime destroy(). */
    unobserveAll(): void;
    unobserve(el: HTMLElement): void;
    sync(): void;
    /**
     * Render soft body blobs using midpoint quadratic curves.
     * Falls back to filled rect if no particle buffer is available.
     * Optional viewport info enables culling of off-screen entities.
     */
    render(ctx: CanvasRenderingContext2D, viewport?: {
        viewportWidth: number;
        viewportHeight: number;
        cullMargin: number;
    }): void;
}
//# sourceMappingURL=phantom-observer.d.ts.map