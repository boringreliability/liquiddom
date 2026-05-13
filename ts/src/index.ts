import { FLOATS_PER_ENTITY, PhantomObserver } from "./phantom-observer";
import { WasmBridge, WasmCore } from "./wasm-bridge";

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
  preserveBackgrounds?: boolean;
  physics?: LiquidPhysicsConfig;
  /** Ward 052: when 'computed', each observed element's bg-color is read on observe + on style/class changes. Default 'config'. */
  colorSource?: "config" | "computed";
}

const DEFAULT_PHYSICS: Required<LiquidPhysicsConfig> = {
  tension: 100,
  damping: 5,
  repulsionRadius: 100,
  repulsionStrength: 5000,
  particleCount: 16,
  substeps: 1,
  neighborSpringK: 30,
};

export const presets = {
  goo: Object.freeze<LiquidPhysicsConfig>({
    tension: 40,
    damping: 12,
    repulsionRadius: 120,
    repulsionStrength: 6000,
    substeps: 1,
    neighborSpringK: 15,
  }),
  jelly: Object.freeze<LiquidPhysicsConfig>({
    tension: 80,
    damping: 4,
    repulsionRadius: 100,
    repulsionStrength: 5000,
    substeps: 2,
    neighborSpringK: 25,
  }),
  firm: Object.freeze<LiquidPhysicsConfig>({
    tension: 200,
    damping: 8,
    repulsionRadius: 80,
    repulsionStrength: 4000,
    substeps: 4,
    neighborSpringK: 50,
  }),
};

/** @internal — Ward 049 promotion: exported only for adapters/playground; not part of stable public API. */
export function validatePhysicsConfig(cfg: LiquidPhysicsConfig): void {
  const checks: [string, unknown, (v: number) => boolean][] = [
    ["tension", cfg.tension, (v) => Number.isFinite(v) && v >= 0],
    ["damping", cfg.damping, (v) => Number.isFinite(v) && v >= 0],
    ["repulsionRadius", cfg.repulsionRadius, (v) => Number.isFinite(v) && v >= 0],
    ["repulsionStrength", cfg.repulsionStrength, (v) => Number.isFinite(v) && v >= 0],
    ["neighborSpringK", cfg.neighborSpringK, (v) => Number.isFinite(v) && v >= 0],
    ["particleCount", cfg.particleCount, (v) => Number.isInteger(v) && v >= 3],
    ["substeps", cfg.substeps, (v) => Number.isInteger(v) && v >= 1],
  ];
  for (const [name, value, validate] of checks) {
    if (value !== undefined && !validate(value as number)) {
      throw new TypeError(`Invalid physics config: ${name} = ${value}`);
    }
  }
}

export interface LiquidDOMInstance {
  readonly capacity: number;
  readonly isPaused: boolean;
  readonly isReducedMotion: boolean;
  readonly isScrolling: boolean;
  readonly pointerActive: boolean;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly preserveBackgrounds: boolean;
  getBuffer(): Float32Array | null;
  observe(el: HTMLElement, liquidType?: number): number;
  unobserve(el: HTMLElement): void;
  grow(newCapacity: number): void;
  tween(element: HTMLElement, options: {
    toX: number;
    toY: number;
    duration: number;
    easing?: "linear" | "ease-out";
  }): { cancel(): void };
  impulse(element: HTMLElement, options?: {
    direction?: [number, number];
    magnitude?: number;
    duration?: number;
  }): void;
  pause(): void;
  resume(): void;
  autoDiscover(root?: Element): void;
  stopAutoDiscover(): void;
  destroy(): void;
  /** Ward 049: live update of the per-frame physics config. Atomic — invalid input throws and leaves state unchanged. */
  setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void;
  /** Ward 049: read-only snapshot of the current live physics config. Mutating the returned object does NOT affect state. */
  getPhysicsConfig(): Required<LiquidPhysicsConfig>;
  /** Ward 052: re-read computed bg-color for an observed element; no-op if colorSource !== 'computed' or element not observed. */
  refreshTheme(el: HTMLElement): void;
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
    const preserveBg = options?.preserveBackgrounds ?? false;

    // Validate and merge physics config
    const userPhysics = options?.physics ?? {};
    validatePhysicsConfig(userPhysics);
    const physics: Required<LiquidPhysicsConfig> = { ...DEFAULT_PHYSICS, ...userPhysics };

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
      useComputedTheme: options?.colorSource === "computed",
    });

    // 3b. Set initial coord offset for container mode
    if (isContainerMode) {
      const rect = container.getBoundingClientRect();
      observer.setCoordOffset(rect.left, rect.top);
    }

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

    // 7. Scroll-aware physics: pause substeps during scroll, snap on idle
    let scrolling = false;
    let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const SCROLL_IDLE_MS = 100;

    const onScroll = () => {
      scrolling = true;
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        scrolling = false;
        // Snap: sync will pick up new getBoundingClientRect values on next frame
        observer.sync();
      }, SCROLL_IDLE_MS);
    };

    // Listen on window (captures page scroll) + container if scoped
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    if (isContainerMode) {
      container.addEventListener("scroll", onScroll, { passive: true });
    }

    // 8. Resize handling — container uses ResizeObserver, fullscreen uses window
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

    // 8. Impulse timer tracking (per entity ID)
    const impulseTimers = new Map<number, ReturnType<typeof setTimeout>>();

    // 9. RAF loop + MutationObserver state
    let animationId = 0;
    let paused = false;
    let destroyed = false;
    let mutationObserver: MutationObserver | null = null;
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

        // Cache container rect once per frame for coordinate transform
        if (isContainerMode) {
          containerRect = container.getBoundingClientRect();
          observer.setCoordOffset(containerRect.left, containerRect.top);
        }

        const dpr = window.devicePixelRatio || 1;
        const vp = getViewportSize();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vp.w, vp.h);
        observer.sync();

        const physicsDt = reducedMotion ? 0 : dt;
        core!.tick(
          physicsDt,
          pointerX,
          pointerY,
          pointerActive && !reducedMotion,
          physics.tension,
          physics.damping,
          physics.substeps,
          physics.repulsionRadius,
          physics.repulsionStrength,
          physics.neighborSpringK,
        );
        observer.render(ctx, {
          viewportWidth: vp.w,
          viewportHeight: vp.h,
          cullMargin: 100,
          preserveBackgrounds: preserveBg,
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

      get isScrolling(): boolean {
        return scrolling;
      },

      get pointerActive(): boolean {
        return pointerActive;
      },

      get preserveBackgrounds(): boolean {
        return preserveBg;
      },

      getBuffer(): Float32Array | null {
        return observer.getBuffer();
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

      tween(element: HTMLElement, opts: {
        toX: number;
        toY: number;
        duration: number;
        easing?: "linear" | "ease-out";
      }): { cancel(): void } {
        if (destroyed) {
          throw new Error("Cannot tween on a destroyed LiquidDOM instance");
        }
        const id = observer.getEntityId(element);
        if (id === undefined) {
          throw new Error("Element is not observed by this LiquidDOM instance");
        }

        const buf = observer.getBuffer();
        const off = id * FLOATS_PER_ENTITY;
        const startX = buf[off];
        const startY = buf[off + 1];
        const { toX, toY, duration } = opts;
        const easingFn = opts.easing === "ease-out"
          ? (t: number) => 1 - (1 - t) * (1 - t)
          : (t: number) => t; // linear

        const startTime = performance.now();
        let cancelled = false;

        const intervalId = setInterval(() => {
          if (cancelled || destroyed) {
            clearInterval(intervalId);
            return;
          }
          const elapsed = performance.now() - startTime;
          const rawT = Math.min(elapsed / duration, 1);
          const t = easingFn(rawT);

          buf[off] = startX + (toX - startX) * t;
          buf[off + 1] = startY + (toY - startY) * t;

          if (rawT >= 1) {
            clearInterval(intervalId);
          }
        }, 16);

        return {
          cancel() {
            cancelled = true;
            clearInterval(intervalId);
          },
        };
      },

      impulse(element: HTMLElement, options?: {
        direction?: [number, number];
        magnitude?: number;
        duration?: number;
      }): void {
        if (destroyed) {
          throw new Error("Cannot impulse on a destroyed LiquidDOM instance");
        }
        const id = observer.getEntityId(element);
        if (id === undefined) {
          throw new Error("Element is not observed by this LiquidDOM instance");
        }

        const [dx, dy] = options?.direction ?? [1, 0];
        const mag = options?.magnitude ?? 10;
        const dur = options?.duration ?? 300;

        const buf = observer.getBuffer();
        const off = id * FLOATS_PER_ENTITY;
        buf[off + 5] = 4.0; // liquid_type = Shake
        buf[off + 6] = dx * mag; // impulse_vx
        buf[off + 7] = dy * mag; // impulse_vy

        // Clear previous impulse timer for this entity
        const prev = impulseTimers.get(id);
        if (prev !== undefined) clearTimeout(prev);

        // Auto-reset after duration
        const timerId = setTimeout(() => {
          if (destroyed) return;
          buf[off + 5] = 0.0;
          buf[off + 6] = 0.0;
          buf[off + 7] = 0.0;
          impulseTimers.delete(id);
        }, dur);
        impulseTimers.set(id, timerId);
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

      autoDiscover(root?: Element): void {
        if (destroyed) return;
        if (mutationObserver) return; // Already active

        const searchRoot = root ?? container ?? document.body;
        mutationObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            // Handle added nodes
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLElement) {
                if (node.hasAttribute("data-liquid")) {
                  observer.observe(node);
                }
                // Also check descendants
                const children = node.querySelectorAll<HTMLElement>("[data-liquid]");
                children.forEach((child) => observer.observe(child));
              }
            }
            // Handle removed nodes
            for (const node of mutation.removedNodes) {
              if (node instanceof HTMLElement) {
                if (node.hasAttribute("data-liquid")) {
                  observer.unobserve(node);
                }
                const children = node.querySelectorAll<HTMLElement>("[data-liquid]");
                children.forEach((child) => observer.unobserve(child));
              }
            }
          }
        });
        mutationObserver.observe(searchRoot, { childList: true, subtree: true });
      },

      stopAutoDiscover(): void {
        if (mutationObserver) {
          mutationObserver.disconnect();
          mutationObserver = null;
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

      setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void {
        if (destroyed) {
          throw new Error("Cannot setPhysicsConfig on a destroyed LiquidDOM instance");
        }
        // Ward 049 §1: merge → validate → assign for atomicity.
        // Validation on the MERGED config catches cross-field invariants;
        // mutation only occurs after validation succeeds.
        const merged = { ...physics, ...partial };
        validatePhysicsConfig(merged);
        Object.assign(physics, merged);
      },

      getPhysicsConfig(): Required<LiquidPhysicsConfig> {
        if (destroyed) {
          throw new Error("Cannot getPhysicsConfig on a destroyed LiquidDOM instance");
        }
        // Shallow copy so callers cannot mutate internal state via the
        // returned reference (Ward 049 §1).
        return { ...physics };
      },

      refreshTheme(el: HTMLElement): void {
        if (destroyed) {
          throw new Error("Cannot refreshTheme on a destroyed LiquidDOM instance");
        }
        observer.refreshTheme(el);
      },

      destroy(): void {
        if (destroyed) return;
        destroyed = true;

        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }

        // Stop auto-discovery if active
        if (mutationObserver) {
          mutationObserver.disconnect();
          mutationObserver = null;
        }

        observer.unobserveAll();

        // Clear all pending impulse timers
        for (const timerId of impulseTimers.values()) {
          clearTimeout(timerId);
        }
        impulseTimers.clear();

        // Clear scroll timer
        if (scrollIdleTimer !== null) {
          clearTimeout(scrollIdleTimer);
          scrollIdleTimer = null;
        }
        window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
        if (isContainerMode) {
          container.removeEventListener("scroll", onScroll);
        }

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
