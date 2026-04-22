export interface LiquidPhysicsConfig {
    tension?: number;
    damping?: number;
    repulsionRadius?: number;
    repulsionStrength?: number;
    particleCount?: number;
    substeps?: number;
    neighborSpringK?: number;
}
export interface LiquidOptions {
    capacity?: number;
    autoObserve?: boolean;
    canvasZIndex?: number;
    colorDefault?: string;
    colorHover?: string;
    maxDt?: number;
    forceReducedMotion?: boolean;
    container?: HTMLElement;
    physics?: LiquidPhysicsConfig;
}
export declare const presets: {
    goo: Readonly<LiquidPhysicsConfig>;
    jelly: Readonly<LiquidPhysicsConfig>;
    firm: Readonly<LiquidPhysicsConfig>;
};
export interface LiquidDOMInstance {
    readonly capacity: number;
    readonly isPaused: boolean;
    readonly isReducedMotion: boolean;
    readonly pointerActive: boolean;
    readonly pointerX: number;
    readonly pointerY: number;
    observe(el: HTMLElement, liquidType?: number): number;
    unobserve(el: HTMLElement): void;
    grow(newCapacity: number): void;
    pause(): void;
    resume(): void;
    autoDiscover(root?: Element): void;
    stopAutoDiscover(): void;
    destroy(): void;
}
export declare class LiquidDOM {
    static create(options?: LiquidOptions): Promise<LiquidDOMInstance>;
}
//# sourceMappingURL=index.d.ts.map