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
  container?: HTMLElement;
}

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
  destroy(): void;
}

/** Default maximum dt in milliseconds. */
const DEFAULT_MAX_DT = 50;

export class LiquidDOM {
  static async create(options?: LiquidOptions): Promise<LiquidDOMInstance> {
    const capacity = options?.capacity ?? 128;
    const autoObserve = options?.autoObserve ?? true;
    const canvasZIndex = options?.canvasZIndex ?? -1;
    const maxDt = Math.max(1, options?.maxDt ?? DEFAULT_MAX_DT);
    const container = options?.container;
    const isContainerMode = !!container;

    // 1. Create and mount canvas
    const canvas = document.createElement("canvas");
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = String(canvasZIndex);

    if (isContainerMode) {
      // Container mode: position absolute inside container
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      container.appendChild(canvas);
    } else {
      // Fullscreen mode: fixed, covers viewport
      canvas.style.position = "fixed";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      document.body.appendChild(canvas);
    }

    // 2. Try to initialize WASM + bridge
    let core: WasmCore | null = null;
    let bridge: WasmBridge | null = null;

    try {
      const wasmModule = await import("../../pkg/liquiddom.js");
      const initWasm = wasmModule.default;
      const exports = await initWasm();
      core = new wasmModule.LiquidCore(capacity);
      bridge = new WasmBridge(exports.memory, core, capacity);
    } catch {
      // WASM not available — mock mode
    }

    // 3. Create PhantomObserver
    const observer = new PhantomObserver(capacity, {
      colorDefault: options?.colorDefault,
      colorHover: options?.colorHover,
      entityView: bridge?.entityView(),
      particleView: bridge?.particleView(),
    });

    // 4. Auto-observe [data-liquid] elements
    if (autoObserve) {
      const searchRoot = container ?? document;
      const elements =
        searchRoot.querySelectorAll<HTMLElement>("[data-liquid]");
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

    // 6. Pointer tracking with container-relative coordinate transform
    let pointerX = 0;
    let pointerY = 0;
    let pointerActive = false;
    // Container rect cached per frame to avoid layout thrashing
    let containerRect: DOMRect | null = null;

    const onPointerMove = (e: PointerEvent) => {
      if (isContainerMode) {
        // Use cached rect if available, otherwise read fresh
        const rect = containerRect ?? container.getBoundingClientRect();
        pointerX = e.clientX - rect.left;
        pointerY = e.clientY - rect.top;
      } else {
        pointerX = e.clientX;
        pointerY = e.clientY;
      }
      pointerActive = true;
    };
    const onPointerLeave = () => {
      pointerActive = false;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerleave", onPointerLeave);

    // 7. Resize handling — container uses ResizeObserver, fullscreen uses window
    let resizeObserver: ResizeObserver | null = null;

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      if (isContainerMode) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      } else {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
      }
    }
    resizeCanvas();

    if (isContainerMode) {
      resizeObserver = new ResizeObserver(() => resizeCanvas());
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", resizeCanvas);
    }

    // 8. RAF loop
    let animationId = 0;
    let paused = false;
    let destroyed = false;
    let lastTime = performance.now();
    const ctx = canvas.getContext("2d");

    function getViewportSize(): { w: number; h: number } {
      if (isContainerMode) {
        return { w: container.clientWidth, h: container.clientHeight };
      }
      return { w: window.innerWidth, h: window.innerHeight };
    }

    function startLoop() {
      if (!ctx || !core) return;

      const loop = (now: number) => {
        if (paused || destroyed) return;

        const rawDt = now - lastTime;
        lastTime = now;
        const dt = Math.min(rawDt, maxDt);

        // Cache container rect once per frame for pointer coordinate transform
        if (isContainerMode) {
          containerRect = container.getBoundingClientRect();
        }

        const dpr = window.devicePixelRatio || 1;
        const vp = getViewportSize();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vp.w, vp.h);
        observer.sync();

        const physicsDt = reducedMotion ? 0 : dt;
        core!.tick(physicsDt, pointerX, pointerY, pointerActive && !reducedMotion);
        observer.render(ctx, {
          viewportWidth: vp.w,
          viewportHeight: vp.h,
          cullMargin: 100,
        });

        animationId = requestAnimationFrame(loop);
      };

      animationId = requestAnimationFrame(loop);
    }

    startLoop();

    // 9. Visibility handler
    const onVisibilityChange = () => {
      if (destroyed) return;
      if (document.visibilityState === "hidden") {
        instance.pause();
      } else {
        instance.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 10. Build instance
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

      get pointerX(): number {
        return pointerX;
      },

      get pointerY(): number {
        return pointerY;
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
        lastTime = performance.now();
        startLoop();
      },

      destroy(): void {
        if (destroyed) return;
        destroyed = true;

        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }

        observer.unobserveAll();

        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        motionQuery?.removeEventListener("change", onMotionChange);

        if (resizeObserver) {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener("resize", resizeCanvas);
        }

        canvas.remove();

        if (core) {
          core.free();
          core = null;
        }
      },
    };

    return instance;
  }
}
