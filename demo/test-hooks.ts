/**
 * W65 (D65-11): shapes of the window test hooks the Playwright specs read.
 * Types only — no runtime code. Imported by demo pages and e2e/global.d.ts.
 */
export type SceneClock = "raf" | "manual";

export interface SceneParams {
  readonly seed: number;
  readonly clock: SceneClock;
  /** W71: canvas2d | webgpu; W72: auto (webgpu on a hardware adapter, else canvas2d). */
  readonly renderer: "canvas2d" | "webgpu" | "auto";
  /** W71 (D71-4): ?t0, WebGPU T0 render scale; absent = the renderer's default (0.5). */
  readonly t0Scale?: number;
  readonly reducedMotion: boolean;
  readonly test: boolean;
  readonly perf: boolean;
}

export interface ScenePerfSnapshot {
  /** Wall time of each core.tick() call divided by the fixed steps it ran (ms). */
  tickMsPerStep: number[];
  /** Duration of each RAF callback (ms, JS main thread). */
  rafMs: number[];
  steps: number;
  frames: number;
  particleCapacity: number;
  activeParticles: number;
  crossOriginIsolated: boolean;
  userAgent: string;
}

export interface ScenePerfProbe {
  start(): void;
  stop(): ScenePerfSnapshot;
}

export interface LiquidTestHook {
  /** Resolves when the runtime exists, all [data-liquid] elements are observed and the first redistribute ran. */
  readonly ready: Promise<void>;
  /** restAlpha per [data-liquid] element, DOM order (#splash, #split, #merge, #card). NaN if unknown. */
  restAlpha(): number[];
  /** Runs `frames` manual-clock frames of 1000/60 ms. Throws unless ?clock=manual. */
  advance(frames: number): void;
  /**
   * W71: RGBA8 (non-premultiplied) copy of the liquid canvas taken at the end of the last
   * advance() that rendered a frame, in the task that rendered it (a WebGPU canvas is not
   * readable later). An advance() that rendered no frame keeps the previous copy: advance(0),
   * a paused instance, a hidden tab or a failed frame (W71 ward-review M3; counted by
   * demo/render-counting-clock.ts). Throws before the first such advance(). Same width and
   * height as the liquid canvas.
   */
  pixels(): ImageData;
  /** FluidRuntime in W65; LiquidDOMInstance from W66. */
  instance: unknown;
  readonly params: SceneParams;
  /** Non-null only with ?perf=1. */
  readonly perf: ScenePerfProbe | null;
  /**
   * W72 (D72-3): loses the WebGPU device (reported as reason 'unknown') and resolves after the
   * Canvas2D rebuild. Rejects unless the active renderer is webgpu.
   */
  loseDevice(): Promise<void>;
  /** W72 (D72-4): estimated splat fragments of the last frame (0 under canvas2d). Logged, never gated. */
  readonly overdraw: number;
  /** W72 (D72-6): T0 size in px `[width, height]` under webgpu (0.5 × the backing px by default); null under canvas2d. */
  readonly t0Size: readonly [number, number] | null;
}

export interface StressElementState {
  s: number;
  maxDev: number;
  restAlpha: number;
}

export interface StressReport {
  done: boolean;
  ok: boolean;
  n: number;
  durationMs: number;
  /** Successful WebAssembly.instantiate* calls on this page load (W61: must be 1). */
  instantiations: number;
  loaderCalls: number;
  distinctMemories: number;
  frames: number[];
  /** Params the stress page parsed (D65-1: the stress runs on the real RAF clock). */
  params: SceneParams;
  /** Active particles per instance (W65: 2000 each). */
  particlesPerInstance: number[];
  /** D65-10: true when destroying every instance a second time was a silent no-op (no throw, no panic). */
  destroyIdempotent: boolean;
  states: Array<StressElementState | null>;
  error: string | null;
}

export interface WebGpuAdapterSummary {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean | null;
}

export interface WebGpuSmokeResult {
  ok: boolean;
  stage: string;
  adapterInfo: WebGpuAdapterSummary | null;
  /** RGBA8 of 3 texels after a clear to (0.25, 0.5, 0.75, 1). */
  clearPixels: number[][] | null;
  /** RGBA8 of 3 texels after a WGSL full-screen triangle in that colour over black. */
  drawPixels: number[][] | null;
  error: string | null;
}

/** W71 (D71-3): demo/smoke/webgpu-liquid.ts builds the liquid pipelines on its own device. */
export interface PipelineCheckResult {
  ok: boolean;
  /** popErrorScope("validation") message, or null. */
  error: string | null;
  /** getCompilationInfo() messages of the three modules: "<type> <line>:<col> <message>". */
  messages: string[];
}

/** W71: `window.__webgpuLiquid` on demo/smoke/webgpu-liquid.html (?renderer=webgpu|canvas2d, manual clock). */
export interface WebGpuLiquidHook {
  readonly ready: Promise<void>;
  readonly renderer: "canvas2d" | "webgpu";
  readonly activeRenderer: "canvas2d" | "webgpu" | null;
  pipelineCheck(): Promise<PipelineCheckResult>;
  /** Manual-clock frames of 1000/60 ms; snapshots the liquid canvas afterwards (see LiquidTestHook.pixels). */
  advance(frames: number): void;
  pixels(): ImageData;
  /** restAlpha of #solid, #glass, #clear (NaN if unknown). */
  restAlpha(): number[];
  /** instance.splash() on the element with this id, at its centre. */
  splash(id: string): void;
}

/** W72 (D72-6): one instance's current liquid canvas on demo/smoke/webgpu-modes.html. */
export interface WebGpuModesCanvas {
  /** Parent element id, or its lower-case tag name ("body") when it has no id; null when detached. */
  parent: string | null;
  /** Index among the parent's element children; -1 when detached. */
  index: number;
  width: number;
  height: number;
  connected: boolean;
  className: string;
}

/**
 * W72 (D72-6): `window.__webgpuModes` on demo/smoke/webgpu-modes.html (manual clock).
 * ?mode=container: one instance, renderer 'auto', container #box-a (position: relative), observing #a1 and #a2.
 * ?mode=multi: two instances, renderer 'webgpu', body mode; instance 0 observes #a1 and #a2, instance 1 #b1.
 */
export interface WebGpuModesHook {
  readonly ready: Promise<void>;
  readonly mode: "container" | "multi";
  /** activeRenderer per instance, in creation order. */
  activeRenderers(): string[];
  /** Each instance's current canvas (FluidRuntime.canvas, live after a remount). */
  canvases(): WebGpuModesCanvas[];
  /** canvas.liquid-canvas elements in the document. */
  liquidCanvasCount(): number;
  /** FluidRuntime.simulateDeviceLoss() of instance `i`: true once its Canvas2D rebuild finished. */
  loseDevice(i: number): Promise<boolean>;
  /** Manual-clock frames of 1000/60 ms; snapshots every instance's canvas when a frame rendered (W71 pixels() rule). */
  advance(frames: number): void;
  /** restAlpha of instance `i`'s observed elements (NaN if unknown). */
  restAlpha(i: number): number[];
  /** Pixels with alpha > 128 inside element `id`'s rect, read from instance `i`'s last snapshot. */
  opaqueIn(i: number, id: string): number;
}
