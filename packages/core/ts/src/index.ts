import { FLOATS_PER_ENTITY, PhantomObserver, type SpawnDropletOptions } from "./phantom-observer";

export type { SpawnDropletOptions };
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

/**
 * Ward 046: gravity source + vector for FreeDrop + soft-body particles.
 *
 * - `source: 'none'` (default) → gravity always (0, 0), no behavior change.
 * - `source: 'fixed'` → use `vector` verbatim each frame. Omitted vector = [0, 0].
 * - `source: 'orientation'` → subscribe to `DeviceOrientationEvent`, map
 *   `gamma → x, beta → y` normalized to [-1, 1] × `strength`. On iOS 13+
 *   call `instance.requestOrientationPermission()` from a user-gesture handler
 *   first. Requires HTTPS in modern browsers (localhost is exempt for dev).
 */
export interface GravityOptions {
  source: "none" | "fixed" | "orientation";
  /** Used when `source === 'fixed'`. Units: px/s². Omitted → [0, 0]. */
  vector?: [number, number];
  /**
   * Multiplier for the normalized [-1, 1] orientation mapping. Units: px/s².
   * Default 980 (≈ 1 g at typical screen scale of 100 px/m).
   */
  strength?: number;
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
  /** Ward 046: gravity source for FreeDrop + soft-body particles. Default `{ source: 'none' }`. */
  gravity?: GravityOptions;
  /**
   * Ward 055: snap-back lerp duration in ms after a scroll ends. Default 150.
   * Reduced-motion bypasses the lerp (instant snap regardless of this value).
   */
  snapDurationMs?: number;
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

/**
 * Ward 044: optional splash configuration for `impulse()`. When supplied AND
 * `magnitude >= threshold`, droplets spawn at the element's perimeter with
 * velocities derived from the impulse vector + jitter. Backwards-compatible:
 * omit `splash` to keep classic Shake-only behavior.
 *
 * Note: `magnitude` defaults to `10` when omitted from `impulse()` options.
 * A splash with `threshold: 5` fires on every call unless `magnitude` is
 * explicitly set below 5. Set `magnitude` deliberately when using splash.
 */
export interface SplashOptions {
  /** Minimum `magnitude` required to fire splash. Below this → zero droplets. */
  threshold: number;
  /** Number of droplets to spawn (best-effort; capped by capacity). */
  count: number;
  /** Random unit-vector jitter added to droplet velocity. Default 0. */
  jitter?: number;
  /** Scale applied to magnitude when deriving droplet speed. Default 0.3. */
  speedScale?: number;
  /** Lifetime per droplet (ms). Defaults to spawnDroplet's own default. */
  lifetimeMs?: number;
  /** Visual radius per droplet (px). Defaults to spawnDroplet's own default. */
  radius?: number;
}

/**
 * Ward 044: edge-walking perimeter sampler. `t ∈ [0, 1)` traverses the rect's
 * four edges in order top → right → bottom → left. Callers use
 * `t = (j + 0.5) / count` to center samples within their arc segment — for
 * `count=4` this lands at the four mid-edges. (The `count=1` case lands at
 * `t=0.5`, the bottom-right corner; deterministic but visually neutral.)
 */
function samplePerimeterPoint(
  t: number,
  x: number, y: number, w: number, h: number,
): [number, number] {
  if (t < 0.25)      return [x + w * (t * 4),                 y];
  else if (t < 0.5)  return [x + w,                            y + h * ((t - 0.25) * 4)];
  else if (t < 0.75) return [x + w - w * ((t - 0.5) * 4),      y + h];
  else               return [x,                                y + h - h * ((t - 0.75) * 4)];
}

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
  /** Ward 055: true while the scroll-end lerp is active (between scroll-idle and lerp completion). */
  readonly isScrollSnapping: boolean;
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
    /** Ward 044: opt-in droplet spawning when magnitude exceeds threshold. */
    splash?: SplashOptions;
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
  /**
   * Ward 054: re-read computed box-shadow for an observed element. Useful for
   * stylesheet-cascade-driven changes (e.g., ancestor `data-theme` toggling a
   * CSS rule with a different `box-shadow`) that the per-element MutationObserver
   * cannot see. No-op if element not observed.
   */
  refreshShadow(el: HTMLElement): void;
  /** Ward 043: spawn a DOM-less free-floating particle. Returns its slot id. */
  spawnDroplet(opts: SpawnDropletOptions): number;
  /** Ward 045: explicitly remove a droplet by id. No-op if not a droplet slot. */
  despawnDroplet(id: number): void;
  /**
   * Ward 046: prompt for device orientation permission (iOS 13+).
   *
   * **MUST be called from a user-gesture event handler** (e.g. button `click`)
   * — iOS WebKit silently denies non-gesture permission requests. Returns
   * `true` on grant or when no permission is required (Chrome, Firefox,
   * non-iOS Safari). Throws after `destroy()`.
   */
  requestOrientationPermission(): Promise<boolean>;
}

/** Default maximum dt in milliseconds. */
const DEFAULT_MAX_DT = 50;

function clamp(v: number, lo: number, hi: number): number {
  // NaN propagation guard: a malformed DeviceOrientationEvent could deliver
  // NaN, which would silently corrupt gravity downstream. Map NaN → 0.
  if (!Number.isFinite(v)) return 0;
  return v < lo ? lo : v > hi ? hi : v;
}

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
      const wasmModule = await import("../../../../pkg/liquiddom.js");
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
      // Ward 043: bridge slot cleanup between TS and Rust. In mock mode
      // (no WASM) `core` is null and this is a no-op — droplet integration
      // doesn't run anyway without Rust.
      releaseSlot: (id) => core?.release_slot(id),
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

    // Ward 046: gravity source. `fixed` writes once; `orientation` attaches
    // a window listener that mutates gravityX/gravityY on each event.
    // gamma maps to screen x (tilt left/right), beta maps to screen y
    // (tilt front/back, positive = down in CSS), each normalized from
    // [-90, 90] degrees to [-1, 1] then scaled by `strength` (px/s²).
    const gravityOpt = options?.gravity ?? { source: "none" as const };
    const gravityStrength = gravityOpt.strength ?? 980;
    let [gravityX, gravityY] =
      gravityOpt.source === "fixed" ? (gravityOpt.vector ?? [0, 0]) : [0, 0];
    let orientationListener: ((e: DeviceOrientationEvent) => void) | null = null;
    if (gravityOpt.source === "orientation" && typeof window !== "undefined") {
      orientationListener = (e) => {
        gravityX = (clamp(e.gamma ?? 0, -90, 90) / 90) * gravityStrength;
        gravityY = (clamp(e.beta ?? 0, -90, 90) / 90) * gravityStrength;
      };
      window.addEventListener("deviceorientation", orientationListener);
    }

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

    // 7. Scroll-aware physics: pause substeps during scroll (W26 fix), then
    // ease base_pos back to live rect via W55 lerp on scroll-idle.
    let scrolling = false;
    let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const SCROLL_IDLE_MS = 100;

    // W55: per-entity lerp state. Keyed on slot id — element refs are held
    // for live getBoundingClientRect reads during the lerp window.
    interface ScrollSnapState {
      fromX: number;
      fromY: number;
      el: HTMLElement;
      startTime: number;
    }
    const scrollSnap = new Map<number, ScrollSnapState>();
    const snapDurationMs = options?.snapDurationMs ?? 150;

    function initiateScrollSnap(): void {
      // W55 Decision §6: bypass under reduced-motion (instant snap on next sync).
      if (reducedMotion) return;
      const buf = observer.getBuffer();
      const now = performance.now();
      for (const [id, el] of observer.getObservedEntries()) {
        const off = id * FLOATS_PER_ENTITY;
        scrollSnap.set(id, {
          fromX: buf[off]!,
          fromY: buf[off + 1]!,
          el,
          startTime: now,
        });
      }
    }

    function runScrollSnapLerp(): void {
      const buf = observer.getBuffer();
      const now = performance.now();
      // Container offset (coordOffsetX/Y) — closure-captured per W55 R5.
      // Reuse the per-frame containerRect when in container mode.
      const offX = isContainerMode && containerRect ? containerRect.left : 0;
      const offY = isContainerMode && containerRect ? containerRect.top : 0;
      for (const [id, state] of scrollSnap) {
        const elapsed = now - state.startTime;
        const t = Math.min(1, elapsed / snapDurationMs);
        const rect = state.el.getBoundingClientRect();
        const targetX = rect.x - offX;
        const targetY = rect.y - offY;
        const off = id * FLOATS_PER_ENTITY;
        buf[off]     = state.fromX + (targetX - state.fromX) * t;
        buf[off + 1] = state.fromY + (targetY - state.fromY) * t;
        // slot[2]/[3] are live-tracked (not lerped). Width/height could change
        // mid-scroll on responsive layouts.
        buf[off + 2] = rect.width;
        buf[off + 3] = rect.height;
        if (t >= 1) scrollSnap.delete(id);
      }
    }

    const onScroll = () => {
      scrolling = true;
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        scrolling = false;
        // W55: drop redundant observer.sync() here (W26 §9). Initiate the
        // ease-back lerp instead — runScrollSnapLerp runs in the RAF loop.
        initiateScrollSnap();
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
      // W55: in mock-mode (no WASM) `core` is null but render fallbacks
      // (W56 mock-mode) + scroll-snap lerp still need to run. Only bail
      // when the canvas context itself is missing.
      if (!ctx) return;

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
        // W55: lerp owns slot[0..3] writes while it's active.
        if (scrollSnap.size > 0) {
          runScrollSnapLerp();
        } else {
          observer.sync();
        }

        // W26 fix: physics pauses during scroll (was previously only gated
        // on reduced-motion despite W26's spec promising scroll-pause too).
        const physicsDt = (reducedMotion || scrolling) ? 0 : dt;
        // W45: viewport AABB for FreeDrop auto-cull (soft-body slots ignored,
        // Decision §9). CULL_MARGIN_PX is reused for the render-cull default.
        const CULL_MARGIN_PX = 100;
        // W46: gravity passes through every frame. Clamped to (0, 0) under
        // reduced-motion (mirrors the existing physicsDt clamp).
        const gx = reducedMotion ? 0 : gravityX;
        const gy = reducedMotion ? 0 : gravityY;
        // W55: tick is WASM-only. Mock-mode (core=null) still runs sync/lerp/render.
        if (core) {
          core.tick(
            physicsDt,
            pointerX,
            pointerY,
            pointerActive && !reducedMotion && !scrolling,
            physics.tension,
            physics.damping,
            physics.substeps,
            physics.repulsionRadius,
            physics.repulsionStrength,
            physics.neighborSpringK,
            0, 0, vp.w, vp.h, CULL_MARGIN_PX,
            gx, gy,
          );
        }
        observer.render(ctx, {
          viewportWidth: vp.w,
          viewportHeight: vp.h,
          cullMargin: CULL_MARGIN_PX,
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

      get isScrollSnapping(): boolean {
        return scrollSnap.size > 0;
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
        // W55 Decision §4: drop any active lerp entry for this slot before
        // the observer clears the id. Prevents a 1-frame ghost-write.
        const id = observer.getEntityId(el);
        if (id !== undefined) scrollSnap.delete(id);
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

        // W55 Decision §7: tween wins composition — drop any active lerp
        // for this slot so its writes don't fight tween's setInterval.
        scrollSnap.delete(id);

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
        splash?: SplashOptions;
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

        // Ward 044: splash spawning runs AFTER the impulse buffer writes
        // (so it reads the same slot[0..3] the next tick will use) and
        // BEFORE the auto-reset timer is scheduled.
        const splash = options?.splash;
        if (splash !== undefined && mag >= splash.threshold) {
          const ex = buf[off];
          const ey = buf[off + 1];
          const ew = buf[off + 2];
          const eh = buf[off + 3];
          const speed = mag * (splash.speedScale ?? 0.3);
          const jitter = splash.jitter ?? 0;

          for (let j = 0; j < splash.count; j++) {
            const t = (j + 0.5) / splash.count;
            const [px, py] = samplePerimeterPoint(t, ex, ey, ew, eh);
            const angle = Math.random() * Math.PI * 2;
            const vx = dx * speed + Math.cos(angle) * jitter;
            const vy = dy * speed + Math.sin(angle) * jitter;
            try {
              observer.spawnDroplet({
                x: px,
                y: py,
                vx,
                vy,
                radius: splash.radius,
                lifetimeMs: splash.lifetimeMs,
              });
            } catch {
              // Pool exhausted (today the only throw path) — abandon remaining splash.
              break;
            }
          }
        }

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

      refreshShadow(el: HTMLElement): void {
        if (destroyed) {
          throw new Error("Cannot refreshShadow on a destroyed LiquidDOM instance");
        }
        observer.refreshShadow(el);
      },

      spawnDroplet(opts: SpawnDropletOptions): number {
        if (destroyed) {
          throw new Error("Cannot spawnDroplet on a destroyed LiquidDOM instance");
        }
        return observer.spawnDroplet(opts);
      },

      despawnDroplet(id: number): void {
        if (destroyed) {
          throw new Error("Cannot despawnDroplet on a destroyed LiquidDOM instance");
        }
        observer.despawnDroplet(id);
      },

      async requestOrientationPermission(): Promise<boolean> {
        if (destroyed) {
          throw new Error("Cannot requestOrientationPermission on a destroyed LiquidDOM instance");
        }
        // iOS 13+: DeviceOrientationEvent has a static requestPermission().
        // Chrome / Firefox / non-iOS Safari: no permission required → true.
        const evCtor = (window as unknown as {
          DeviceOrientationEvent?: {
            requestPermission?: () => Promise<"granted" | "denied">;
          };
        }).DeviceOrientationEvent;
        if (!evCtor || typeof evCtor.requestPermission !== "function") {
          return true;
        }
        try {
          const result = await evCtor.requestPermission();
          return result === "granted";
        } catch {
          return false;
        }
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

        // W46: remove orientation listener if attached.
        if (orientationListener) {
          window.removeEventListener("deviceorientation", orientationListener);
          orientationListener = null;
        }

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
        // W55: release element refs held by the lerp map.
        scrollSnap.clear();
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
