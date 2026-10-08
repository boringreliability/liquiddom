/**
 * W64 internal entry (decision D64-8): loads the backend, mounts the canvas,
 * runs the frame loop and owns reduced-motion detection (D64-6) and canvas
 * resize/DPR (D64-14, plan resolution C2). NOT exported from index.ts: W66
 * wraps it in the public `LiquidDOM.create()`. The acceptance scene imports
 * it by relative source path.
 */
import { parseBorderRadius } from "./border-radius";
import { rafClock, type FrameClock } from "./clock";
import { createMicrotaskBatcher, ElementRegistry } from "./element-registry";
import { FluidBridge } from "./fluid-bridge";
import { El, ELEMENT_STRIDE, roundedRectArea, St, STATE_STRIDE, Stat } from "./fluid-layout";
import { DEFAULT_MATERIAL, type Material } from "./material";
import { SplashInput, rectCentre, type ClientPoint } from "./input";
import { DEFAULT_STRENGTH, type ElementOptions } from "./options";
import type { ElementPaint, RenderFrame, Renderer, RenderViewport } from "./renderers/frame";
import { LoopController } from "./loop-control";
import { PointerTracker } from "./pointer-tracker";
import { acquireLiquidStyles, mountLiquidCanvas, remountLiquidCanvas } from "./stylesheet";
import { initCanvas2D, selectRenderer, type ActiveRenderer, type RendererChoice, type SelectedRenderer } from "./renderers/select";
import type { FluidCanvas2DRenderer } from "./renderers/fluid-canvas2d";
import { WebGPURenderer } from "./renderers/webgpu/webgpu-renderer";
import { loadFluidWasm, type FluidBackend, type FluidCoreLike } from "./wasm-loader";

export const LIQUID_CANVAS_CLASS = "liquid-canvas";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const STATIC_CONTAINER_WARNING =
  "[liquiddom] container must be a positioned element (e.g. position: relative); the canvas is absolutely positioned inside it";

/** W72 (D72-3): prefix of the one console.warn when a WebGPU device is lost and the instance continues in Canvas2D. */
export const DEVICE_LOST_WARNING = "[liquiddom] WebGPU device lost";

export interface FluidRuntimeOptions {
  /** Integer in [16, 65536]; the W66 facade narrows the public range. */
  particles: number;
  /** Integer in [1, 256]. */
  maxElements: number;
  /** u32. Same seed + same inputs + same viewport = same positions. */
  seed: number;
  container?: HTMLElement;
  /** Measured for the area hint (B5) and the grid margin (B15); NOT observed. */
  initialElements?: readonly HTMLElement[];
  /** `true` forces reduced motion; otherwise the media query decides. */
  forceReducedMotion?: boolean;
  material?: Readonly<Material>;
  /** @internal jsdom tests. */
  testBackend?: FluidBackend;
  /** @internal Defaults to the module-level single-flight `loadFluidWasm`. */
  loader?: () => Promise<FluidBackend>;
  /** @internal W65 (D65-1): frame scheduling seam. Default: requestAnimationFrame. */
  clock?: FrameClock;
  /** W66: renderer choice; the facade passes the resolved option. Default "canvas2d". */
  renderer?: RendererChoice;
  /** @internal W71 (D71-4): WebGPU T0 render scale; the facade passes the resolved option. */
  webgpuT0Scale?: number;
  /** W72 (D72-1): hide the one console.info of an 'auto' fallback to Canvas2D. Default false. */
  silentFallback?: boolean;
}

export interface FluidElementState {
  s: number;
  maxDev: number;
  restAlpha: number;
}

export interface FluidRuntime {
  observe(el: HTMLElement, opts?: ElementOptions): number;
  unobserve(el: HTMLElement): void;
  /** One loop iteration: offset → registry.sync → core.tick → syncGeneration → render. */
  frame(nowMs: number): void;
  elementState(el: HTMLElement): FluidElementState | undefined;
  /** The current liquid canvas. W72: replaced after an 'auto' fallback or a device-lost rebuild. */
  readonly canvas: HTMLCanvasElement;
  readonly bridge: FluidBridge;
  readonly reducedMotion: boolean;
  pause(): void;
  resume(): void;
  readonly isPaused: boolean;
  /** W72 (D72-3): 'webgpu' until a lost device rebuilds the instance as 'canvas2d'. */
  readonly activeRenderer: ActiveRenderer;
  /**
   * @internal W72 (D72-3) scene test hook: loses the WebGPU device (reported as reason
   * 'unknown') and resolves once the Canvas2D rebuild finished (true), or false at once when
   * the instance is not on WebGPU, destroyed or stopped.
   */
  simulateDeviceLoss(): Promise<boolean>;
  /** @internal W72 (D72-4): estimated splat fragments of the last frame; 0 under Canvas2D. */
  readonly fragmentEstimate: number;
  /** @internal W72 (D72-6): T0 size in px `[width, height]` of the WebGPU renderer; null under Canvas2D. */
  readonly t0Size: readonly [number, number] | null;
  /** Re-snapshot colours of an observed element (no-op otherwise). */
  refresh(el: HTMLElement): void;
  /**
   * W67: splash an observed element. `at` is client px (null → rect centre); it is
   * converted to buffer space with the container offset. Returns false when `el` is
   * not observed or the runtime is destroyed. After a failed frame it returns true
   * without calling the core. Under reduced motion (W68 D68-5) it also returns true
   * without calling the core. No validation: the facade validates.
   */
  splash(el: HTMLElement, at: ClientPoint | null, strength: number): boolean;
  /** W67: shake every observed element. No-op once destroyed, after a failed frame or under reduced motion (D68-5). */
  shake(strength: number): void;
  /** W68: forward a resolved, validated material to the core (the facade validates). */
  setMaterial(m: Readonly<Material>): void;
  /** Idempotent. */
  destroy(): void;
}

interface Offset {
  x: number;
  y: number;
}

const ZERO: Offset = Object.freeze({ x: 0, y: 0 });

function assertInt(name: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new TypeError(`[liquiddom] ${name} must be an integer in [${min}, ${max}], got ${String(v)}`);
  }
}

/** B2: `max(screen, inner)` per axis; container mode: `max(client, scroll)`. */
function measureWorld(container?: HTMLElement): { w: number; h: number } {
  if (container) {
    return {
      w: Math.max(container.clientWidth, container.scrollWidth, 1),
      h: Math.max(container.clientHeight, container.scrollHeight, 1),
    };
  }
  const sw = typeof screen !== "undefined" ? screen.width || 0 : 0;
  const sh = typeof screen !== "undefined" ? screen.height || 0 : 0;
  return { w: Math.max(sw, window.innerWidth || 0, 1), h: Math.max(sh, window.innerHeight || 0, 1) };
}

/** B5 area hint and B15 tallest height from the initial elements. */
function measureHint(elements: readonly HTMLElement[]): { area: number; tallest: number } {
  let area = 0;
  let tallest = 0;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    const radius = parseBorderRadius(getComputedStyle(el).borderRadius || "", r.width, r.height);
    area += roundedRectArea(r.width, r.height, radius);
    if (r.height > tallest) tallest = r.height;
  }
  return { area, tallest };
}

/** Container mode: buffer space starts at the container's padding box (where the canvas sits). */
function readOffset(container: HTMLElement): Offset {
  const r = container.getBoundingClientRect();
  return { x: r.left + container.clientLeft, y: r.top + container.clientTop };
}

/**
 * W72 (D72-3): routes a WebGPU device loss to the runtime. A loss that resolves before
 * buildRuntime installed its handler (between init and the runtime existing) is kept and
 * replayed there once, so it is never dropped.
 */
interface LossRelay {
  handler: ((info: GPUDeviceLostInfo) => void) | null;
  early: GPUDeviceLostInfo | null;
}

export async function createFluidRuntime(opts: FluidRuntimeOptions): Promise<FluidRuntime> {
  assertInt("particles", opts.particles, 16, 65_536);
  assertInt("maxElements", opts.maxElements, 1, 256);
  assertInt("seed", opts.seed, 0, 0xffff_ffff);
  // Loud failure (spec §2): a load error rejects before anything is mounted.
  const backend = opts.testBackend ?? (await (opts.loader ?? loadFluidWasm)());
  const world = measureWorld(opts.container);
  const hint = measureHint(opts.initialElements ?? []);
  const core = new backend.FluidCore(
    opts.particles,
    opts.maxElements,
    world.w,
    world.h,
    hint.area,
    hint.tallest,
    opts.seed,
  );
  let canvas: HTMLCanvasElement | null = null;
  const relay: LossRelay = { handler: null, early: null };
  try {
    const bridge = new FluidBridge(backend, core);
    const material = opts.material ?? DEFAULT_MATERIAL;
    core.set_material(material.viscosity, material.cohesion, material.recovery);
    canvas = mountLiquidCanvas(opts.container);
    // D66-2 / W72 (D72-1): selectRenderer destroys a renderer whose init failed. An 'auto'
    // fallback remounts the canvas through remountCanvas, so `canvas` is always the one in
    // the DOM, and the catch below (W64) removes it and frees the core exactly once.
    const selected = await selectRenderer(opts.renderer ?? "canvas2d", canvas, {
      silentFallback: opts.silentFallback === true,
      remountCanvas: () => {
        canvas = remountLiquidCanvas(canvas as HTMLCanvasElement, opts.container);
        return canvas;
      },
      onDeviceLost: (info) => {
        if (relay.handler) relay.handler(info);
        else relay.early ??= info;
      },
      ...(opts.webgpuT0Scale === undefined ? {} : { t0Scale: opts.webgpuT0Scale }),
    });
    canvas = selected.canvas;
    return startRuntime(opts, core, bridge, selected, relay);
  } catch (err) {
    canvas?.remove();
    core.free();
    throw err;
  }
}

function startRuntime(
  opts: FluidRuntimeOptions,
  core: FluidCoreLike,
  bridge: FluidBridge,
  selected: SelectedRenderer,
  relay: LossRelay,
): FluidRuntime {
  const releaseStyles = acquireLiquidStyles(document);
  try {
    return buildRuntime(opts, core, bridge, selected, relay, releaseStyles);
  } catch (err) {
    // A synchronous failure after the styles/renderer were acquired: undo both,
    // createFluidRuntime's catch removes the canvas and frees the core.
    releaseStyles();
    selected.renderer.destroy();
    throw err;
  }
}

function buildRuntime(
  opts: FluidRuntimeOptions,
  core: FluidCoreLike,
  bridge: FluidBridge,
  selected: SelectedRenderer,
  relay: LossRelay,
  releaseStyles: () => void,
): FluidRuntime {
  // W72 (D72-3): the renderer slot and the canvas are mutable. A lost WebGPU device swaps in
  // Canvas2D on a remounted canvas; the slot is null while that rebuild is in flight.
  let canvas: HTMLCanvasElement = selected.canvas;
  let renderer: Renderer | null = selected.renderer;
  let activeRenderer: ActiveRenderer = selected.active;
  let rebuilding = false;
  const rebuildWaiters: Array<(rebuilt: boolean) => void> = [];
  const settleRebuild = (rebuilt: boolean): void => {
    for (const resolve of rebuildWaiters.splice(0)) resolve(rebuilt);
  };
  const clock: FrameClock = opts.clock ?? rafClock;
  const container = opts.container;
  // Ward-fix I2: the canvas is absolutely positioned inside the container. The
  // author's container is never restyled (that would move the containing block
  // of their own absolutely positioned descendants); a static one gets a warning.
  if (container && getComputedStyle(container).position === "static") {
    console.warn(STATIC_CONTAINER_WARNING);
  }
  let destroyed = false;
  /** Ward-fix M2a: set by the first frame that throws; the loop is gone for good. */
  let failed = false;
  let lastMs: number | null = null;
  let inFrame = false;
  let frameOffset: Offset = ZERO;
  let warnedArea = false;
  let activeParticles = core.active_particles();
  let paintsDirty = false;
  let paints: Array<ElementPaint | undefined> = new Array<ElementPaint | undefined>(
    bridge.elementCapacity,
  ).fill(undefined);
  const counts = new Uint32Array(bridge.elementCapacity);
  let viewport: RenderViewport = { widthCss: 1, heightCss: 1, dpr: 1 };

  const coordOffset = (): Offset => {
    if (inFrame) return frameOffset;
    return container ? readOffset(container) : ZERO;
  };

  // One redistribution per microtask after a batch of observe/unobserve (D64-18).
  const batcher = createMicrotaskBatcher(() => {
    if (destroyed) return;
    core.redistribute();
    const area = registry.observedArea();
    const budget = core.max_area_px2();
    if (!warnedArea && area > budget) {
      warnedArea = true;
      console.warn(
        `[liquiddom] observed area ${Math.round(area)} px² exceeds the particle budget ${Math.round(budget)} px² (particles × cell² / 2). The liquid will look noisier; raise \`particles\` or observe less area.`,
      );
    }
  });
  const registry = new ElementRegistry(bridge, {
    coordOffset,
    scheduleRedistribute: () => batcher.schedule(),
    // W68 (D68-5): read live; `reducedMotion` is declared below and only read during sync().
    reducedMotion: () => reducedMotion,
  });

  // ---- W67: splash / shake ----------------------------------------------------
  const splashAt = (el: HTMLElement, at: ClientPoint | null, strength: number): boolean => {
    if (destroyed) return false;
    const id = registry.idOf(el);
    if (id === undefined) return false;
    // W67 ward-review fix: after a failed frame the core may be poisoned; the element is
    // still observed (no facade error), but the core is not called.
    if (failed) return true;
    // W68 D68-5: an observed element under reduced motion is not an error. Report
    // success (true) so the facade does not throw "not observed", but skip the core.
    // The facade has already validated strength/at (D67-4) before calling us.
    if (reducedMotion) return true;
    const point = at ?? rectCentre(el);
    const offset = coordOffset();
    core.splash(id, point.x - offset.x, point.y - offset.y, strength);
    return true;
  };
  const splashInput = new SplashInput((el, at) => {
    splashAt(el, at, DEFAULT_STRENGTH);
  });

  // Reduced motion (spec §2, the single definition; D64-6, C5).
  const forced = opts.forceReducedMotion === true;
  const mql =
    !forced && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  let reducedMotion = forced || (mql?.matches ?? false);
  core.set_reduced_motion(reducedMotion);
  const onMotionChange = (e: { matches: boolean }): void => {
    if (destroyed) return;
    reducedMotion = e.matches;
    core.set_reduced_motion(reducedMotion);
  };
  mql?.addEventListener("change", onMotionChange);

  // W68: pointer input for the soft pointer field (D68-4, D68-7).
  // The container's own document and window (W68 green review), so a container in another
  // document (e.g. an iframe) gets its pointer input; a window-less document falls back to `window`.
  const pointer = new PointerTracker();
  const pointerDoc = container?.ownerDocument ?? document;
  const detachPointer = pointer.attach(pointerDoc, pointerDoc.defaultView ?? window);

  // Canvas backing store + DPR (D64-14, C2).
  const resizeCanvas = (): void => {
    if (destroyed) return;
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const w = container ? container.clientWidth : window.innerWidth;
    const h = container ? container.clientHeight : window.innerHeight;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    canvas.width = bw;
    canvas.height = bh;
    viewport = { widthCss: Math.max(1, w), heightCss: Math.max(1, h), dpr };
    renderer?.resize(bw, bh, dpr);
  };
  resizeCanvas();
  let resizeObserver: ResizeObserver | null = null;
  if (container && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  const rebuildPaints = (): void => {
    const cap = bridge.particleCapacity;
    const st = bridge.staticView();
    const base = Stat.HOME * cap;
    counts.fill(0);
    for (let i = 0; i < cap; i++) {
      const h = st[base + i];
      if (h >= 0 && h < counts.length) counts[h | 0] += 1;
    }
    const ev = bridge.elementView();
    const next = new Array<ElementPaint | undefined>(bridge.elementCapacity).fill(undefined);
    for (const rec of registry.entries()) {
      const o = rec.id * ELEMENT_STRIDE;
      const n = counts[rec.id];
      const area = roundedRectArea(ev[o + El.W], ev[o + El.H], ev[o + El.RADIUS]);
      const app = n > 0 ? area / n : 0;
      next[rec.id] = {
        id: rec.id,
        background: rec.background,
        text: rec.text,
        radiusPx: ev[o + El.RADIUS],
        particleCount: n,
        areaPerParticle: app,
        spacingPx: Math.sqrt(app),
        atlasRect: null,
      };
    }
    paints = next;
    activeParticles = core.active_particles();
  };

  const buildFrame = (): RenderFrame => ({
    dynamicView: bridge.dynamicView(),
    staticView: bridge.staticView(),
    generation: bridge.generation,
    stateView: bridge.stateView(),
    elementView: bridge.elementView(),
    particleCapacity: bridge.particleCapacity,
    activeParticles,
    paints,
    viewport,
    reducedMotion,
  });

  const frameBody = (nowMs: number): void => {
    const dtS = lastMs === null || !Number.isFinite(nowMs) ? 0 : Math.max(0, (nowMs - lastMs) / 1000);
    if (Number.isFinite(nowMs)) lastMs = nowMs;
    frameOffset = container ? readOffset(container) : ZERO;
    inFrame = true;
    try {
      registry.sync();
      // W68: soft pointer field input, gated by reduced motion (D68-5).
      const ptr = pointer.sample(nowMs, frameOffset);
      const pointerOn = ptr.active && !reducedMotion;
      core.tick(
        dtS,
        pointerOn ? ptr.x : 0,
        pointerOn ? ptr.y : 0,
        pointerOn ? ptr.vx : 0,
        pointerOn ? ptr.vy : 0,
        pointerOn,
        0,
        0,
      );
      if (bridge.syncGeneration() || paintsDirty) {
        paintsDirty = false;
        rebuildPaints();
      }
      // W72 (D72-3): null only while a device-lost rebuild is in flight; the core keeps ticking.
      if (renderer !== null) renderer.render(buildFrame());
    } finally {
      inFrame = false;
    }
  };

  // Ward-fix M2a: a throwing frame (e.g. a Rust panic → RuntimeError: unreachable,
  // after which the core's borrow is poisoned) stops the instance for good: one
  // console.error, the loop is destroyed so pause/resume/visibility cannot re-arm
  // it, and destroy() keeps working. Recovery is destroy() + create().
  const frame = (nowMs: number): void => {
    if (destroyed || failed) return;
    try {
      frameBody(nowMs);
    } catch (err) {
      failed = true;
      loop.destroy();
      console.error("[liquiddom] frame failed; the instance stopped. Call destroy() and create a new instance.", err);
    }
  };

  // D66-12: user pause and hidden-tab pause are independent; frames go through W65's clock.
  const loop = new LoopController(clock, frame, document, () => {
    lastMs = null; // the dt must not span a pause
  });
  loop.start();

  // W72 (D72-3): a lost WebGPU device (any reason but our own 'destroyed'; the renderer
  // filters that) rebuilds this instance as Canvas2D on a remounted canvas, with the same core
  // and particle state and one console.warn. A failing rebuild takes the failed-frame path.
  // W72 review fix (M1, M2): every rebuild failure, synchronous or async, takes this path.
  const rebuildFailed = (err: unknown): void => {
    rebuilding = false;
    if (renderer !== null) {
      renderer.destroy();
      renderer = null;
    }
    settleRebuild(false);
    if (destroyed || failed) return;
    failed = true;
    loop.destroy();
    console.error(
      "[liquiddom] the Canvas2D rebuild after a lost WebGPU device failed; the instance stopped. Call destroy() and create a new instance.",
      err,
    );
  };
  const rebuildAsCanvas2D = (info: GPUDeviceLostInfo): void => {
    if (destroyed || failed) {
      settleRebuild(false); // W72 review fix (M3): a waiting simulateDeviceLoss() never hangs
      return;
    }
    if (rebuilding || activeRenderer !== "webgpu") return;
    rebuilding = true;
    activeRenderer = "canvas2d";
    console.warn(`${DEVICE_LOST_WARNING} (${info.reason}: ${info.message}); continuing with the Canvas2D renderer.`);
    let pending: Promise<FluidCanvas2DRenderer>;
    try {
      const lostRenderer = renderer;
      renderer = null;
      lostRenderer?.destroy();
      canvas = remountLiquidCanvas(canvas, container);
      pending = initCanvas2D(canvas);
    } catch (err) {
      rebuildFailed(err);
      return;
    }
    pending
      .then((c2d) => {
        rebuilding = false;
        if (destroyed || failed) {
          // W72 review fix (M3): the instance stopped meanwhile; the new renderer is not used.
          c2d.destroy();
          settleRebuild(false);
          return;
        }
        renderer = c2d;
        resizeCanvas(); // the new canvas gets the backing store and the renderer its grid
        settleRebuild(true);
      })
      .catch(rebuildFailed); // W72 review fix (M1): also a throw in the success handler
  };
  relay.handler = rebuildAsCanvas2D;
  if (relay.early !== null) rebuildAsCanvas2D(relay.early);

  return {
    observe(el, elementOpts) {
      if (destroyed) throw new Error("[liquiddom] observe() called after destroy().");
      const id = registry.observe(el, elementOpts);
      splashInput.attach(el);
      return id;
    },
    unobserve(el) {
      if (destroyed) return;
      registry.unobserve(el);
      splashInput.detach(el);
    },
    splash: splashAt,
    shake(strength: number): void {
      if (destroyed || failed || reducedMotion) return;
      core.shake(strength);
    },
    setMaterial(m: Readonly<Material>): void {
      // W67 ward-fix (3861e77): no core calls after a failed frame (the core may be poisoned).
      if (destroyed || failed) return;
      core.set_material(m.viscosity, m.cohesion, m.recovery);
    },
    frame,
    elementState(el) {
      if (destroyed) return undefined;
      const id = registry.idOf(el);
      if (id === undefined) return undefined;
      const sv = bridge.stateView();
      const o = id * STATE_STRIDE;
      return { s: sv[o + St.S], maxDev: sv[o + St.MAX_DEV], restAlpha: sv[o + St.REST_ALPHA] };
    },
    get canvas() {
      return canvas;
    },
    bridge,
    get reducedMotion() {
      return reducedMotion;
    },
    pause() {
      loop.pause();
    },
    resume() {
      loop.resume();
    },
    get isPaused() {
      return loop.isPaused;
    },
    get activeRenderer() {
      return activeRenderer;
    },
    simulateDeviceLoss(): Promise<boolean> {
      if (destroyed || failed || activeRenderer !== "webgpu" || !(renderer instanceof WebGPURenderer)) {
        return Promise.resolve(false);
      }
      const rebuilt = new Promise<boolean>((resolve) => rebuildWaiters.push(resolve));
      renderer.loseDeviceForTest();
      return rebuilt;
    },
    get fragmentEstimate() {
      return renderer instanceof WebGPURenderer ? renderer.lastFragmentEstimate : 0;
    },
    get t0Size() {
      return renderer instanceof WebGPURenderer ? renderer.t0Size : null;
    },
    refresh(el: HTMLElement) {
      if (destroyed || registry.idOf(el) === undefined) return;
      registry.refresh(el);
      paintsDirty = true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loop.destroy();
      batcher.cancel();
      splashInput.destroy();
      registry.unobserveAll();
      releaseStyles();
      mql?.removeEventListener("change", onMotionChange);
      detachPointer();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      relay.handler = null;
      renderer?.destroy();
      renderer = null;
      canvas.remove();
      settleRebuild(false);
      // Ward-fix M2b: a poisoned core (after a panic) may throw on free; adapter
      // cleanups call destroy() and must never throw.
      try {
        core.free();
      } catch (err) {
        console.warn("[liquiddom] freeing the fluid core failed during destroy(); ignored.", err);
      }
    },
  };
}
