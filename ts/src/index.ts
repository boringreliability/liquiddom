import { PhantomObserver } from "./phantom-observer";
import { WasmBridge, WasmCore } from "./wasm-bridge";

export interface LiquidOptions {
  capacity?: number;
  autoObserve?: boolean;
  canvasZIndex?: number;
  colorDefault?: string;
  colorHover?: string;
  maxDt?: number;
  forceReducedMotion?: boolean;
}

export interface LiquidDOMInstance {
  readonly capacity: number;
  readonly isPaused: boolean;
  readonly isReducedMotion: boolean;
  readonly pointerActive: boolean;
  observe(el: HTMLElement, liquidType?: number): number;
  unobserve(el: HTMLElement): void;
  grow(newCapacity: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/** Default maximum dt in milliseconds. Prevents physics explosion after tab sleep. */
const DEFAULT_MAX_DT = 50;

export class LiquidDOM {
  /**
   * Create an isolated LiquidDOM runtime instance.
   * Each instance owns its own canvas, observer, WASM bridge, and RAF loop.
   */
  static async create(options?: LiquidOptions): Promise<LiquidDOMInstance> {
    const capacity = options?.capacity ?? 128;
    const autoObserve = options?.autoObserve ?? true;
    const canvasZIndex = options?.canvasZIndex ?? -1;
    const maxDt = Math.max(1, options?.maxDt ?? DEFAULT_MAX_DT);

    // 1. Inject fullscreen canvas
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = String(canvasZIndex);
    document.body.appendChild(canvas);

    // 2. Try to initialize WASM + bridge (may fail in test environments)
    let core: WasmCore | null = null;
    let bridge: WasmBridge | null = null;

    try {
      const wasmModule = await import("../../pkg/liquiddom.js");
      const initWasm = wasmModule.default;
      const exports = await initWasm();
      core = new wasmModule.LiquidCore(capacity);
      bridge = new WasmBridge(exports.memory, core, capacity);
    } catch {
      // WASM not available (e.g. test environment) — run in mock mode
    }

    // 3. Create PhantomObserver — bridge provides views, or mock mode
    const observer = new PhantomObserver(capacity, {
      colorDefault: options?.colorDefault,
      colorHover: options?.colorHover,
      entityView: bridge?.entityView(),
      particleView: bridge?.particleView(),
    });

    // 4. Auto-observe [data-liquid] elements
    if (autoObserve) {
      const elements =
        document.querySelectorAll<HTMLElement>("[data-liquid]");
      elements.forEach((el) => observer.observe(el));
    }

    // 5. Reduced motion detection
    let reducedMotion = false;
    let motionQuery: MediaQueryList | null = null;

    if (options?.forceReducedMotion !== undefined) {
      reducedMotion = options.forceReducedMotion;
    } else if (typeof window.matchMedia === "function") {
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotion = motionQuery.matches;
    }

    const onMotionChange = (e: MediaQueryListEvent) => {
      if (options?.forceReducedMotion !== undefined) return;
      reducedMotion = e.matches;
    };
    motionQuery?.addEventListener("change", onMotionChange);

    // 6. Pointer tracking via Pointer Events (per-instance, frozen during pause)
    let pointerX = 0;
    let pointerY = 0;
    let pointerActive = false;

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerActive = true;
    };
    const onPointerLeave = () => {
      pointerActive = false;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    // 6. Resize handler with DPR scaling (per-instance)
    const onResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = window.innerWidth;
      const cssHeight = window.innerHeight;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
    };
    onResize();
    window.addEventListener("resize", onResize);

    // 7. RAF loop state (per-instance)
    let animationId = 0;
    let paused = false;
    let destroyed = false;
    let lastTime = performance.now();
    const ctx = canvas.getContext("2d");

    function startLoop() {
      if (!ctx || !core) return;

      const loop = (now: number) => {
        if (paused || destroyed) return;

        const rawDt = now - lastTime;
        lastTime = now;

        // dt clamping — prevents physics explosion after tab sleep or debugger pause
        const dt = Math.min(rawDt, maxDt);

        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        observer.sync();
        // When reduced motion is active, pass dt=0 so physics forces are zero
        // and entities remain at rest positions
        const physicsDt = reducedMotion ? 0 : dt;
        core!.tick(physicsDt, pointerX, pointerY, pointerActive && !reducedMotion);
        observer.render(ctx, {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          cullMargin: 100,
        });

        animationId = requestAnimationFrame(loop);
      };

      animationId = requestAnimationFrame(loop);
    }

    startLoop();

    // 8. Visibility handler (per-instance) — auto pause/resume on tab hide/show
    // Note: references `instance` before declaration — safe because the callback
    // only fires asynchronously after `instance` is fully constructed below.
    const onVisibilityChange = () => {
      if (destroyed) return;
      if (document.visibilityState === "hidden") {
        instance.pause();
      } else {
        instance.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 9. Build instance
    const instance: LiquidDOMInstance = {
      get capacity(): number {
        return observer.capacity;
      },

      get isPaused(): boolean {
        return paused;
      },

      get isReducedMotion(): boolean {
        return reducedMotion;
      },

      get pointerActive(): boolean {
        return pointerActive;
      },

      observe(el: HTMLElement, liquidType?: number): number {
        if (destroyed) {
          throw new Error("Cannot observe on a destroyed LiquidDOM instance");
        }
        return observer.observe(el, liquidType);
      },

      unobserve(el: HTMLElement): void {
        if (destroyed) return;
        observer.unobserve(el);
      },

      grow(newCapacity: number): void {
        if (destroyed) {
          throw new Error("Cannot grow a destroyed LiquidDOM instance");
        }
        if (newCapacity <= observer.capacity) {
          throw new Error(
            `newCapacity (${newCapacity}) must be greater than current capacity (${observer.capacity})`,
          );
        }

        if (core && bridge) {
          core.grow(newCapacity);
          bridge.rebind(newCapacity);
          observer.setViews(bridge.entityView(), bridge.particleView(), newCapacity);
        } else {
          observer.growLocal(newCapacity);
        }
      },

      pause(): void {
        if (destroyed || paused) return;
        paused = true;
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }
      },

      resume(): void {
        if (destroyed || !paused) return;
        paused = false;
        // Reset timestamp so first frame sees dt ≈ 0, not the wall-clock gap
        lastTime = performance.now();
        startLoop();
      },

      destroy(): void {
        if (destroyed) return;
        destroyed = true;

        // 1. Stop render loop
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }

        // 2. Unobserve all tracked elements
        observer.unobserveAll();

        // 3. Remove all listeners
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        motionQuery?.removeEventListener("change", onMotionChange);
        window.removeEventListener("resize", onResize);

        // 4. Remove canvas from DOM
        canvas.remove();

        // 5. Free WASM core
        if (core) {
          core.free();
          core = null;
        }
      },
    };

    return instance;
  }
}
