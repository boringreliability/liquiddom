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
import { DEFAULT_STRENGTH, type ElementOptions, type ResolvedGravity } from "./options";
import type { ElementPaint, RenderFrame, Renderer, RenderViewport, TextAtlasFrame } from "./renderers/frame";
import { ATLAS_MAX_SIZE_PX, TextAtlas, type AtlasCanvasFactory, type AtlasRect } from "./renderers/webgpu/text-atlas";
import { clearTextClasses, releaseTextClass, syncTextClasses, type TextToggleArgs } from "./text-toggle";
import { ElementObserver } from "./element-observer";
import { clearAwayClasses, releaseAwayClass, syncAwayClasses, type AwaySyncArgs } from "./away-toggle";
import { clearHaloClasses, releaseHaloClass, syncHaloClasses, type HaloSyncArgs } from "./halo-toggle";
import { LoopController } from "./loop-control";
import { PointerTracker } from "./pointer-tracker";
import { DragTracker } from "./drag-tracker";
import { GravityInput } from "./gravity";
import { ScrollTracker } from "./scroll-tracker";
import { clampWorld, grownWorld, measureWorld, WORLD_RESIZE_INFO, type WorldSize } from "./world";
import { CANVAS_Z_FALLBACK, CANVAS_Z_UNDER, acquireLiquidStyles, mountLiquidCanvas, remountLiquidCanvas } from "./stylesheet";
import { canvasBlocker, opaqueAncestor, opaqueBackgroundWarning } from "./stacking";
import { initCanvas2D, selectRenderer, type ActiveRenderer, type RendererChoice, type SelectedRenderer } from "./renderers/select";
import { FluidCanvas2DRenderer } from "./renderers/fluid-canvas2d";
import { WebGPURenderer, type TextIdCapture } from "./renderers/webgpu/webgpu-renderer";
import { loadFluidWasm, type FluidBackend, type FluidCoreLike } from "./wasm-loader";

export const LIQUID_CANVAS_CLASS = "liquid-canvas";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const STATIC_CONTAINER_WARNING =
  "[liquiddom] container must be a positioned element (e.g. position: relative); the canvas is absolutely positioned inside it";

/** W72 (D72-3): prefix of the one console.warn when a WebGPU device is lost and the instance continues in Canvas2D. */
export const DEVICE_LOST_WARNING = "[liquiddom] WebGPU device lost";
/** W74 (D74-5): the one console.warn per instance when the text atlas cannot be built (no liquid text, DOM text stays). */
export const TEXT_ATLAS_WARNING =
  "[liquiddom] the text atlas could not be built; the DOM text stays visible while elements move";
const NO_ATLAS_RECTS: ReadonlyMap<number, AtlasRect> = new Map();

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
  /** @internal W74 (D74-5): jsdom tests inject the atlas canvas (jsdom has no OffscreenCanvas). */
  textAtlasCanvas?: AtlasCanvasFactory;
  /** W83 (D83-1 … D83-5): the resolved gravity (the facade validates). Default: none. */
  gravity?: Readonly<ResolvedGravity>;
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
  /** @internal W82 (D82-4): the Canvas2D density cell in CSS px (the scene hook reads it); null under WebGPU. */
  readonly densityCellPx: number | null;
  /** @internal W75 (Review Focus 3, 5): atlas re-render requests issued so far; the scene hook reads it. */
  readonly textInvalidations: number;
  /** @internal W81 (D81-2): the world the core's grid covers, px (grows with resize_world, never shrinks). */
  readonly world: WorldSize;
  /**
   * @internal W79 (D79-1) scene test hook: the text id target of the next rendered frame (WebGPU);
   * null under Canvas2D, after a lost device or destroy(). Only the acceptance hook calls it.
   */
  captureTextIds(): Promise<TextIdCapture | null>;
  /** Re-snapshot colours of an observed element (no-op otherwise). W75: also re-colours the halo rule and re-renders the atlas entry. */
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
  /** W83 (D83-3): a resolved, validated gravity (the facade validates); it reaches the core with the next frame's tick. */
  setGravity(g: Readonly<ResolvedGravity>): void;
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

/**
 * W75 amendment B (D75-2, saga dec_5b38c40e): true while `el` runs a CSS transition of its own,
 * which the colour snapshot's inline `transition: none` would cancel. A CSS transition is told
 * apart by its `transitionProperty` (CSSTransition; jsdom has no such class). @keyframes and Web
 * Animations never block: `transition: none` does not cancel them, and an infinite one would
 * starve the re-read. Called only for an element with a pending re-read, never on idle frames.
 */
function runsCssTransition(el: HTMLElement): boolean {
  if (typeof el.getAnimations !== "function") return false;
  let animations: Animation[];
  try {
    animations = el.getAnimations();
  } catch {
    return false;
  }
  for (const a of animations) {
    // A paused transition resumes later; the snapshot would cancel it too (B review M4).
    if ("transitionProperty" in a && (a.playState === "running" || a.playState === "paused" || a.pending)) return true;
  }
  return false;
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
    // W82 (D82-1, D82-2): under the page (z-index -1) unless the page or the container cannot take it;
    // the warning is logged once the runtime exists (buildRuntime).
    const blocked = canvasBlocker(opts.container);
    canvas = mountLiquidCanvas(opts.container, blocked === null ? CANVAS_Z_UNDER : CANVAS_Z_FALLBACK);
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
    return startRuntime(opts, core, bridge, selected, relay, world, blocked);
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
  world: WorldSize,
  blocked: string | null,
): FluidRuntime {
  const releaseStyles = acquireLiquidStyles(document);
  try {
    return buildRuntime(opts, core, bridge, selected, relay, releaseStyles, world, blocked);
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
  initialWorld: WorldSize,
  blocked: string | null,
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
  // W82 (D82-1, D82-2): "under" while the canvas sits at z-index -1; "fallback" (z-index 0, the D7
  // rules on every observed element) from the first blocker on, for the rest of the instance's life.
  let stacking: "under" | "fallback" = blocked === null ? "under" : "fallback";
  if (blocked !== null) console.warn(blocked);
  let destroyed = false;
  /** Ward-fix M2a: set by the first frame that throws; the loop is gone for good. */
  let failed = false;
  /** W81: true once the loop runs; growWorld waits for it, since stopInstance needs `loop`. */
  let started = false;
  /**
   * W82 (D82-5): the visible window in buffer px (CSS px: the canvas's size) for the shake's edge
   * mirror. Sent here, before the first frame, and again from resizeCanvas() whenever it changed;
   * never inside a frame, never to a stopped instance's core.
   */
  let sentViewport = "";
  const sendViewport = (w: number, h: number): void => {
    const key = `${w}x${h}`;
    if (failed || key === sentViewport) return;
    sentViewport = key;
    core.set_viewport(w, h);
  };
  sendViewport(container ? container.clientWidth : window.innerWidth, container ? container.clientHeight : window.innerHeight);
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
  /** W81 (D81-2): the core's world (Rust's clamp mirrored); grows with resize_world, never shrinks. */
  let world: WorldSize = clampWorld(initialWorld);
  // ---- W74 (D74-5, D74-6): the text atlas and the liquid-text toggle ----
  // W74 review: the page never exceeds the device's maxTextureDimension2D (min(4096, limit)).
  const atlasMaxSize =
    selected.renderer instanceof WebGPURenderer
      ? Math.min(ATLAS_MAX_SIZE_PX, selected.renderer.maxTextureDimension)
      : ATLAS_MAX_SIZE_PX;
  const textAtlas = new TextAtlas({
    maxSize: atlasMaxSize,
    ...(opts.textAtlasCanvas ? { createCanvas: opts.textAtlasCanvas } : {}),
  });
  let atlasRects: ReadonlyMap<number, AtlasRect> = NO_ATLAS_RECTS;
  let atlasFrame: TextAtlasFrame | null = null;
  let warnedAtlas = false;
  /**
   * W75 amendment B (D75-1): a page build skipped while an upload is in flight (a generation or
   * paints change); the build runs on the first frame after the confirmation.
   */
  let atlasDeferred = false;
  /**
   * W75 amendment B (D75-1): slots whose text changed (or that were newly observed) since the last
   * build. While a build waits, their paints carry no atlas rect, so the in-flight page's record for
   * them is never valid (no stale glyphs once it confirms) and the DOM text shows until the next page.
   */
  const atlasOutdated = new Set<number>();
  /** This instance's liquid-text holds (refcounted across instances in stylesheet.ts). */
  const textHeld = new Set<HTMLElement>();
  /** Observed slot ids, refreshed with the paints. */
  let observedIds: number[] = [];

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
    // W78 (D78-4): the active drag, read during sync(); `dragTracker` is declared below.
    drag: () => dragTracker.active,
    // W82 (D82-3): an instance in the fallback stacks its elements (data-liquid-stack).
    stacked: () => stacking === "fallback",
  });
  /**
   * W82 (D82-2): one-way. The current canvas goes to z-index 0 (a remount keeps it), every observed
   * element takes the D7 stacking, one console.warn.
   */
  const fallBack = (warning: string): void => {
    if (stacking === "fallback") return;
    stacking = "fallback";
    canvas.style.zIndex = CANVAS_Z_FALLBACK;
    registry.stackAll();
    console.warn(warning);
  };

  // ---- W75: text that stays true ------------------------------------------------
  // D75-1: one MutationObserver per observed element; D75-2: transitionend; RF5: fonts and DPR.
  // Everything is recorded here and applied once per frame in applyDomChanges().
  const elementObserver = new ElementObserver();
  /**
   * D75-2 (amendment B, ward-review M4): elements whose colours must be re-read. An entry stays
   * while the element runs a CSS transition or is detached, and is re-read on the first frame
   * where neither holds.
   */
  const colourPending = new Set<HTMLElement>();
  let invalidateAllText = false;
  let textInvalidations = 0;
  /** D75-3: this instance's halo holds (W74's `textHeld` pattern; refcounted across instances in stylesheet.ts). */
  const haloHeld = new Set<HTMLElement>();
  /** W78 (D78-1): this instance's liquid-away holds (refcounted across instances in stylesheet.ts). */
  const awayHeld = new Set<HTMLElement>();

  const onTransitionEnd = (e: Event): void => {
    const el = e.currentTarget as HTMLElement | null;
    if (el === null || e.target !== el) return; // a descendant's transition bubbled up
    const prop = (e as Event & { propertyName?: string }).propertyName;
    if (prop === "background-color" || prop === "color") colourPending.add(el);
  };
  const watchElement = (el: HTMLElement): void => {
    elementObserver.observe(el);
    el.addEventListener("transitionend", onTransitionEnd);
  };
  const unwatchElement = (el: HTMLElement): void => {
    elementObserver.unobserve(el);
    el.removeEventListener("transitionend", onTransitionEnd);
    colourPending.delete(el);
    // W75.2 review: the halo CLASS hold goes before the registry releases the halo RULE claim.
    releaseHaloClass(haloHeld, el);
  };
  /** Once per frame, before registry.sync(): colours (D75-2) and atlas entries (D75-1, RF3, RF5). */
  const applyDomChanges = (): void => {
    // W75.3: drain() returns a shared empty map on idle frames; it is read here, never mutated.
    const changes = elementObserver.drain();
    const all = invalidateAllText;
    invalidateAllText = false;
    if (changes.size === 0 && colourPending.size === 0 && !all) return;
    for (const rec of registry.entries()) {
      const c = changes.get(rec.el);
      if (c?.colour === true) colourPending.add(rec.el); // amendment B: own class/style only (element-observer.ts)
      let recoloured = false;
      // Amendment B: the snapshot's inline `transition: none` would cancel a running author
      // transition, so the re-read waits for it (M4: and for a detached element to re-attach).
      // isConnected first: a detached element waits without a getAnimations() call per frame (B review M1).
      if (colourPending.has(rec.el) && rec.el.isConnected && !runsCssTransition(rec.el) && registry.refresh(rec.el)) {
        colourPending.delete(rec.el);
        paintsDirty = true;
        recoloured = true;
      }
      // A colour change re-renders the atlas entry too (the text colour is baked into the page).
      if (all || recoloured || c?.text === true) invalidateText(rec.id);
    }
  };
  /** D75-3: after the render and W74's syncText(); reads only the state view. Runs while a device-lost rebuild is in flight too (activeRenderer is already "canvas2d"). */
  // One args object and one restAlpha reader for the instance's life (W74 review M1's syncText pattern).
  let haloStateView: Float32Array | null = null;
  const haloArgs: { -readonly [K in keyof HaloSyncArgs]: HaloSyncArgs[K] } = {
    entries: [],
    restAlpha: (id) => haloStateView?.[id * STATE_STRIDE + St.REST_ALPHA] ?? Number.NaN,
    activeRenderer,
    reducedMotion: false, // set per call (declared further down)
    held: haloHeld,
    suppressed: awayHeld, // W78 (D78-1): no halo around hidden glyphs
  };
  const syncHalo = (): void => {
    haloStateView = bridge.stateView();
    haloArgs.entries = registry.entries();
    haloArgs.activeRenderer = activeRenderer;
    haloArgs.reducedMotion = reducedMotion;
    syncHaloClasses(haloArgs);
    haloStateView = null; // a fresh view every frame (WASM memory can grow)
  };
  /** W78 (D78-1): after syncText(), before syncHalo() (a held element gets no halo). Reads the state view and the drag. */
  let awayStateView: Float32Array | null = null;
  const awayArgs: { -readonly [K in keyof AwaySyncArgs]: AwaySyncArgs[K] } = {
    entries: [],
    restAlpha: (id) => awayStateView?.[id * STATE_STRIDE + St.REST_ALPHA] ?? Number.NaN,
    dragged: null,
    activeRenderer,
    reducedMotion: false, // set per call
    held: awayHeld,
  };
  // RF5: a DPR (zoom) change. The resolution query matches only the current DPR, so it is
  // re-armed for the new one on every change; resizeCanvas() decides whether the DPR changed.
  let dprQuery: MediaQueryList | null = null;
  let lastDpr: number | null = null;
  const onDprChange = (): void => resizeCanvas();
  const armDprWatch = (dpr: number): void => {
    dprQuery?.removeEventListener("change", onDprChange);
    dprQuery = null;
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia(`(resolution: ${dpr}dppx)`);
    if (typeof q?.addEventListener !== "function") return;
    q.addEventListener("change", onDprChange);
    dprQuery = q;
  };

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
    // W74 (Review Focus 1): reduced motion switched on mid-splash shows the DOM text at once, without waiting for a frame.
    if (reducedMotion) {
      dragTracker.cancel(); // W78: reduced motion ignores drag (spec §2)
      clearTextClasses(textHeld);
      clearHaloClasses(haloHeld); // W75 (D75-3): the halo goes at once as well
      clearAwayClasses(awayHeld); // W78: the drag label goes at once as well
    }
  };
  mql?.addEventListener("change", onMotionChange);

  // W68: pointer input for the soft pointer field (D68-4, D68-7).
  // The container's own document and window (W68 green review), so a container in another
  // document (e.g. an iframe) gets its pointer input; a window-less document falls back to `window`.
  const pointer = new PointerTracker();
  const pointerDoc = container?.ownerDocument ?? document;
  const detachPointer = pointer.attach(pointerDoc, pointerDoc.defaultView ?? window);
  // W78 (D78-2, D78-6): the drag gesture on observed elements, on the pointer field's document and window.
  // D78-1: a cancel shows the DOM label at once; a release keeps it hidden until the liquid is at rest.
  const dragTracker = new DragTracker(
    {
      reducedMotion: () => reducedMotion,
      onEnd: (el, how) => {
        if (how === "cancel") releaseAwayClass(awayHeld, el);
      },
    },
    pointerDoc,
    pointerDoc.defaultView ?? window,
  );
  // W80 (D80-1): the scroll of the window (body mode) or of the container, read once per frame.
  const scrollTracker = new ScrollTracker(pointerDoc.defaultView ?? window, container);
  // W83 (D83-1 … D83-5): the gravity source; `orientation` listens on the same window.
  const gravityInput = new GravityInput(pointerDoc.defaultView ?? window, opts.gravity ?? { source: "none", vector: [0, 0], strength: 0 });
  const syncAway = (): void => {
    awayStateView = bridge.stateView();
    awayArgs.entries = registry.entries();
    awayArgs.dragged = dragTracker.active?.el ?? null;
    awayArgs.activeRenderer = activeRenderer;
    awayArgs.reducedMotion = reducedMotion;
    syncAwayClasses(awayArgs);
    awayStateView = null; // a fresh view every frame (WASM memory can grow)
  };
  // W75 (RF5): a web font that finishes after observe re-renders every atlas entry once (next frame).
  const fontSet = (pointerDoc as Document & { fonts?: EventTarget }).fonts ?? null;
  const onFontsDone = (): void => {
    invalidateAllText = true;
  };
  fontSet?.addEventListener("loadingdone", onFontsDone);

  /**
   * W81 (D81-2): when the viewport (or the container's window) outgrew the world, one
   * `resize_world` grows the grid, from `resizeCanvas()` (the resize handler, a DPR change, a
   * device-loss rebuild; never inside a frame), with one console.info. Never shrinks; a stopped
   * instance's core (maybe poisoned) is not called. Before the loop starts it does nothing: the
   * call right after `loop.start()` covers a window that grew during init, so a throw always
   * takes the `stopInstance` path (W81 ward review m1).
   */
  const growWorld = (): void => {
    if (failed || !started) return;
    const next = grownWorld(world, measureWorld(container));
    if (next === null) return;
    let grew: boolean;
    try {
      grew = core.resize_world(next.w, next.h);
    } catch (err) {
      stopInstance("[liquiddom] growing the fluid world failed; the instance stopped. Call destroy() and create a new instance.", err);
      return;
    }
    world = next;
    if (grew) console.info(`${WORLD_RESIZE_INFO} ${next.w}×${next.h} px.`);
  };

  // Canvas backing store + DPR (D64-14, C2).
  const resizeCanvas = (): void => {
    if (destroyed) return;
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // W75 (RF5): a DPR change re-renders every atlas entry once (next frame) and re-arms the query.
    if (dpr !== lastDpr) {
      if (lastDpr !== null) invalidateAllText = true;
      lastDpr = dpr;
      armDprWatch(dpr);
    }
    const w = container ? container.clientWidth : window.innerWidth;
    const h = container ? container.clientHeight : window.innerHeight;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    canvas.width = bw;
    canvas.height = bh;
    viewport = { widthCss: Math.max(1, w), heightCss: Math.max(1, h), dpr };
    renderer?.resize(bw, bh, dpr);
    sendViewport(w, h); // W82 (D82-5)
    growWorld(); // W81 (D81-2)
  };
  resizeCanvas();
  let resizeObserver: ResizeObserver | null = null;
  if (container && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  /** W74 (D74-5): rebuilt with the paints under WebGPU; any failure means no atlas text (one console.warn). */
  const rebuildAtlas = (): void => {
    atlasDeferred = false;
    atlasOutdated.clear();
    atlasRects = NO_ATLAS_RECTS;
    atlasFrame = null;
    if (activeRenderer !== "webgpu") return;
    const entries: Array<{ id: number; el: HTMLElement; dpr: number }> = [];
    for (const rec of registry.entries()) entries.push({ id: rec.id, el: rec.el, dpr: viewport.dpr });
    try {
      atlasRects = textAtlas.build(entries);
      const page = textAtlas.canvas;
      atlasFrame = page
        ? { canvas: page, width: textAtlas.width, height: textAtlas.height, dpr: textAtlas.dpr, version: textAtlas.version }
        : null;
    } catch (err) {
      atlasRects = NO_ATLAS_RECTS;
      atlasFrame = null;
      if (!warnedAtlas) {
        warnedAtlas = true;
        console.warn(TEXT_ATLAS_WARNING, err);
      }
    }
  };

  /** W74 (D74-6): after render(), so the class and the atlas text change in the same frame. */
  // W74 ward-review (M1): one args object and two closures for the life of the instance, refreshed
  // per frame (the state view is taken fresh every frame), instead of new ones every frame.
  let textStateView = bridge.stateView();
  const textArgs: { -readonly [K in keyof TextToggleArgs]: TextToggleArgs[K] } = {
    ids: observedIds,
    elementOf: (id) => registry.get(id)?.el,
    restAlpha: (id) => textStateView[id * STATE_STRIDE + St.REST_ALPHA] ?? Number.NaN,
    renderer,
    activeRenderer,
    reducedMotion,
    held: textHeld,
  };
  const syncText = (): void => {
    textStateView = bridge.stateView();
    textArgs.ids = observedIds;
    textArgs.renderer = renderer;
    textArgs.activeRenderer = activeRenderer;
    textArgs.reducedMotion = reducedMotion;
    syncTextClasses(textArgs);
  };

  /** W74 ward-review (I1): one owner token per element, so the renderer can tell a reused slot apart. */
  const owners = new WeakMap<HTMLElement, number>();
  let nextOwner = 1;
  const ownerOf = (el: HTMLElement): number => {
    let t = owners.get(el);
    if (t === undefined) {
      t = nextOwner++;
      owners.set(el, t);
    }
    return t;
  };
  /** D75-1 A: a new paint owner token for `el`; the confirmed (old) page masks its slot. */
  const renewOwner = (el: HTMLElement): void => {
    owners.set(el, nextOwner++);
  };
  /** W75 (RF3, RF5): W74's atlas (owned by this runtime) is rebuilt with the paints in this frame, before render(). */
  const invalidateText = (id: number): void => {
    textInvalidations += 1;
    textAtlas.invalidate(id);
    atlasOutdated.add(id);
    // D75-1 A: W74's double-buffered upload keeps drawing the confirmed (old) page for 1–2 frames;
    // a new owner token masks this slot on it, so textReady is false and the DOM text shows meanwhile.
    const el = registry.get(id)?.el;
    if (el) renewOwner(el);
    // The atlas entry (and its rect in ElementPaint.atlasRect) is rebuilt: rebuild the paints too.
    paintsDirty = true;
  };

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
        atlasRect: atlasOutdated.has(rec.id) ? null : (atlasRects.get(rec.id) ?? null),
        owner: ownerOf(rec.el),
      };
    }
    paints = next;
    observedIds = Array.from(registry.entries(), (rec) => rec.id);
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
    textAtlas: atlasFrame,
  });

  const frameBody = (nowMs: number): void => {
    const dtS = lastMs === null || !Number.isFinite(nowMs) ? 0 : Math.max(0, (nowMs - lastMs) / 1000);
    if (Number.isFinite(nowMs)) lastMs = nowMs;
    frameOffset = container ? readOffset(container) : ZERO;
    inFrame = true;
    try {
      applyDomChanges(); // W75: coalesced DOM, colour, font and DPR changes, once per frame
      // W80 (D80-1): the scroll since the last frame; a scrolled container keeps the canvas on its window.
      const sc = scrollTracker.sample(dtS, frameOffset, reducedMotion);
      scrollTracker.placeCanvas(canvas);
      // W80: a live press keeps the dragged liquid under the pointer (slots 6-7 grow by the scroll),
      // only when its element moved with the scroll (ward review I1: a fixed or stuck sticky one did not).
      if (sc.dragDx !== 0 || sc.dragDy !== 0) {
        const pressed = dragTracker.pressed;
        if (pressed !== null && registry.movedWithScroll(pressed, sc.dx, sc.dy)) dragTracker.scrolled(sc.dragDx, sc.dragDy);
      }
      dragTracker.frame(); // W78: a pressed element that left the document cancels
      registry.sync();
      // W80 (D80-1): after this frame's rects, before the tick; only when something scrolled.
      if (sc.dx !== 0 || sc.dy !== 0 || sc.ivx !== 0 || sc.ivy !== 0) core.scroll_shift(sc.dx, sc.dy, sc.ivx, sc.ivy);
      // W68: soft pointer field input, gated by reduced motion (D68-5).
      const ptr = pointer.sample(nowMs, frameOffset);
      const pointerOn = ptr.active && !reducedMotion;
      // W83 (D83-1, D83-4): this frame's gravity (0 under reduced motion). A gravity that starts fresh
      // (create, a source switch, the first orientation reading, the end of reduced motion) seeds the
      // core's low-pass first, so it starts at rest; only later changes act.
      const g = gravityInput.sample(reducedMotion);
      if (g.seed) core.seed_gravity(g.gx, g.gy);
      core.tick(
        dtS,
        pointerOn ? ptr.x : 0,
        pointerOn ? ptr.y : 0,
        pointerOn ? ptr.vx : 0,
        pointerOn ? ptr.vy : 0,
        pointerOn,
        g.gx,
        g.gy,
      );
      // W75 amendment B (D75-1): at most one atlas upload in flight. While one awaits its error
      // scope no page is built; `stale` (or atlasDeferred) stays set and the build runs on the
      // first frame after the confirmation, with the newest text.
      const atlasBusy = activeRenderer === "webgpu" && renderer instanceof WebGPURenderer && renderer.atlasPending;
      const atlasDue = activeRenderer === "webgpu" && (textAtlas.stale || atlasDeferred) && !atlasBusy;
      if (bridge.syncGeneration() || paintsDirty || atlasDue) {
        paintsDirty = false;
        if (atlasBusy) atlasDeferred = true;
        else rebuildAtlas(); // W74 (D74-5): before the paints, which carry each element's atlas rect
        rebuildPaints();
      }
      // W72 (D72-3): null only while a device-lost rebuild is in flight; the core keeps ticking.
      if (renderer !== null) renderer.render(buildFrame());
      syncText(); // W74 (D74-6)
      syncAway(); // W78 (D78-1)
      syncHalo(); // W75 (D75-3)
    } finally {
      inFrame = false;
    }
  };

  // Ward-fix M2a: a throwing frame (e.g. a Rust panic → RuntimeError: unreachable,
  // after which the core's borrow is poisoned) stops the instance for good: one
  // console.error, the loop is destroyed so pause/resume/visibility cannot re-arm
  // it, and destroy() keeps working. Recovery is destroy() + create().
  // W78.4: a stopped instance must not leave DRAGGED in the element buffer. The tracker has no active press any more, so one sync rewrites slots 5-7 as not dragged. Best effort: the frame already failed and reports exactly one console.error.
  const resyncStopped = (): void => {
    try {
      registry.sync();
    } catch {
      /* the frame already failed; one console.error only */
    }
  };

  // Stops the instance for good with one console.error (a failed frame, or a throwing resize_world).
  const stopInstance = (msg: string, err: unknown): void => {
    failed = true;
    clearTextClasses(textHeld); // W74: a stopped instance never leaves text hidden
    dragTracker.destroy(); // W78: a stopped instance takes no more drags
    gravityInput.destroy(); // W83: a stopped instance drops its deviceorientation listener (idempotent)
    loop.destroy();
    clearHaloClasses(haloHeld); // W75: a stopped instance leaves no halo behind
    clearAwayClasses(awayHeld); // W78: a stopped instance hides no label
    resyncStopped();
    console.error(msg, err);
  };

  const frame = (nowMs: number): void => {
    if (destroyed || failed) return;
    try {
      frameBody(nowMs);
    } catch (err) {
      stopInstance("[liquiddom] frame failed; the instance stopped. Call destroy() and create a new instance.", err);
    }
  };

  // D66-12: user pause and hidden-tab pause are independent; frames go through W65's clock.
  const loop = new LoopController(clock, frame, document, () => {
    lastMs = null; // the dt must not span a pause
  });
  loop.start();
  started = true;
  growWorld(); // W81: a window that grew while create() awaited the renderer (ward review m1)

  // W72 (D72-3): a lost WebGPU device (any loss not caused by our own destroy(); the renderer
  // decides on device identity, not the reason string, since a crashed GPU process also
  // reports 'destroyed') rebuilds this instance as Canvas2D on a remounted canvas, with the same core
  // and particle state and one console.warn. A failing rebuild takes the failed-frame path.
  // W72 review fix (M1, M2): every rebuild failure, synchronous or async, takes this path.
  const rebuildFailed = (err: unknown): void => {
    rebuilding = false;
    if (renderer !== null) {
      renderer.destroy();
      renderer = null;
    }
    settleRebuild(false);
    clearTextClasses(textHeld);
    clearHaloClasses(haloHeld); // W75: the halo may already apply while the Canvas2D rebuild was in flight
    clearAwayClasses(awayHeld); // W78
    if (destroyed || failed) return;
    failed = true;
    dragTracker.destroy(); // W78: a stopped instance takes no more drags
    loop.destroy();
    resyncStopped();
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
    dragTracker.cancel(); // W78 (slice design §4): a lost device cancels the drag
    clearAwayClasses(awayHeld); // W78
    console.warn(`${DEVICE_LOST_WARNING} (${info.reason}: ${info.message}); continuing with the Canvas2D renderer.`);
    // W74 (D74-6, Review Focus 1): the atlas text is gone with the device; show the DOM text now,
    // before the asynchronous Canvas2D init, and drop the atlas (Canvas2D never draws text).
    clearTextClasses(textHeld);
    atlasRects = NO_ATLAS_RECTS;
    atlasFrame = null;
    atlasDeferred = false;
    atlasOutdated.clear();
    paintsDirty = true;
    let pending: Promise<FluidCanvas2DRenderer>;
    try {
      const lostRenderer = renderer;
      renderer = null;
      lostRenderer?.destroy();
      canvas = remountLiquidCanvas(canvas, container);
      scrollTracker.placeCanvas(canvas); // W80.3 review (m1): also right while the loop is paused
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
        if (failed) {
          // W81 ward review (m2): a failing resize_world in resizeCanvas() stopped the instance.
          settleRebuild(false);
          return;
        }
        // W72 ward-review (m2): a paused loop (user pause or hidden tab) has no next frame, so
        // draw one render-only frame (no core.tick) rather than leave the remounted canvas blank.
        if (loop.isPaused) c2d.render(buildFrame());
        settleRebuild(true);
      })
      .catch(rebuildFailed); // W72 review fix (M1): also a throw in the success handler
  };
  relay.handler = rebuildAsCanvas2D;
  if (relay.early !== null) rebuildAsCanvas2D(relay.early);

  return {
    observe(el, elementOpts) {
      if (destroyed) throw new Error("[liquiddom] observe() called after destroy().");
      const fresh = registry.idOf(el) === undefined;
      const id = registry.observe(el, elementOpts);
      if (fresh) {
        // Ward-review M3: a new observation gets a new paint owner token, so a page built for an
        // earlier observation of the same element (unobserve + observe in one task) never matches.
        renewOwner(el);
        // W75 amendment B: no atlas rect until a page is built for this observation.
        atlasOutdated.add(id);
        // W82 (D82-2): an opaque box between the element and the canvas's stacking context (up to the
        // container, or <html>) would hide its liquid: fall back to z-index 0 for good.
        if (stacking === "under") {
          const hit = opaqueAncestor(el.parentElement, container ?? null);
          if (hit !== null) fallBack(opaqueBackgroundWarning(hit));
        }
      }
      splashInput.attach(el);
      dragTracker.attach(el); // W78
      watchElement(el); // W75 (D75-1, D75-2)
      return id;
    },
    unobserve(el) {
      if (destroyed) return;
      dragTracker.detach(el); // W78: cancels a press or drag on el (README Review Focus 5)
      releaseAwayClass(awayHeld, el); // W78: before the registry restores the element
      releaseTextClass(textHeld, el); // W74: before the registry restores the element
      if (registry.idOf(el) !== undefined) unwatchElement(el); // W75: observer, transitionend, halo hold
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
    setGravity(g: Readonly<ResolvedGravity>): void {
      if (destroyed) return;
      gravityInput.set(g);
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
    get densityCellPx() {
      return renderer instanceof FluidCanvas2DRenderer ? renderer.densityCellPx : null;
    },
    get textInvalidations() {
      return textInvalidations;
    },
    get world() {
      return world;
    },
    captureTextIds() {
      return renderer instanceof WebGPURenderer ? renderer.captureTextIds() : Promise.resolve(null);
    },
    refresh(el: HTMLElement) {
      if (destroyed) return;
      const id = registry.idOf(el);
      if (id === undefined) return;
      // Amendment B: a manual refresh() stays immediate, even during a running transition (the
      // author asked for it). Ward-review M4: a detached element keeps its colours; the re-read
      // is queued and runs on the first frame after re-attachment.
      if (!registry.refresh(el)) {
        colourPending.add(el);
        return;
      }
      colourPending.delete(el);
      invalidateText(id); // W75: the atlas colour follows (and marks the paints dirty)
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loop.destroy();
      batcher.cancel();
      splashInput.destroy();
      dragTracker.destroy(); // W78
      clearAwayClasses(awayHeld);
      clearTextClasses(textHeld); // W74
      // W75: release the halo holds and stop watching before the registry releases rules and decorations.
      clearHaloClasses(haloHeld);
      for (const rec of registry.entries()) rec.el.removeEventListener("transitionend", onTransitionEnd);
      elementObserver.disconnect();
      colourPending.clear();
      fontSet?.removeEventListener("loadingdone", onFontsDone);
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = null;
      registry.unobserveAll();
      releaseStyles();
      mql?.removeEventListener("change", onMotionChange);
      gravityInput.destroy(); // W83 (D83-5): the deviceorientation listener goes with the instance
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
