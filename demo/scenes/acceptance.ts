/**
 * Acceptance scene (spec §6, canonical in .wdd/NORTH-STAR.md).
 * W64 created it; W65 adds the query parameters and window.__liquidTest:
 *   ?seed=<u32>         RNG seed (default 1)
 *   ?clock=manual       frames run only via __liquidTest.advance(n) (D65-1)
 *   ?renderer=canvas2d|webgpu|auto  default canvas2d (W71: webgpu, W72: auto)
 *   ?t0=0.5|0.75        WebGPU T0 render scale (W71, D71-4; needs ?renderer=webgpu)
 *   ?rm=1               forceReducedMotion
 *   ?test=1             install window.__liquidTest
 *   ?perf=1             tick/RAF perf probe (RAF clock only, D65-8)
 *   ?nodrag=split,card  observe these [data-liquid] ids with { drag: false } (W84, D84-2)
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime, FluidRuntimeOptions } from "../../packages/core/ts/src/runtime";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { El, ELEMENT_STRIDE } from "../../packages/core/ts/src/fluid-layout";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { LiquidTestHook, ScenePerfProbe, ScenePerfSnapshot } from "../test-hooks";
import { parseSceneParams } from "./scene-params";
import { summarizeTextIds, type TextIdCaptureLike } from "../text-id-report";

const PARTICLES = 8000;
/** W79: a canvas text pixel has every channel and alpha ≥ this (webgpu-robust.spec.ts CANVAS_TEXT_MIN). */
const TEXT_ID_TEXT_MIN = 200;
/** W79 red review (M2): the id readback must resolve within this many ms of the frame. */
const TEXT_ID_TIMEOUT_MS = 2000;
const MAX_ELEMENTS = 32;

const parsed = parseSceneParams(window.location.search);
// Effective reduced motion: ?rm=1 OR the media query (specs emulate the latter).
const params = {
  ...parsed,
  reducedMotion: parsed.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));
/** W84 (D84-2): the elements `?nodrag=` names; re-observed with { drag: false } through the public facade. */
const noDrag = parseNoDrag(new URLSearchParams(window.location.search).get("nodrag"));

function parseNoDrag(raw: string | null): HTMLElement[] {
  if (raw === null) return [];
  return raw.split(",").map((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el) throw new TypeError(`[acceptance] ?nodrag must name [data-liquid] ids (splash, split, merge, card), got "${id}"`);
    return el;
  });
}
const manual: RenderCountingClock | null = params.clock === "manual" ? createRenderCountingClock(createManualClock(0)) : null;

// ---- perf probe state (D65-8) ----
let recording = false;
let stepsTotal = 0;
let framesTotal = 0;
const tickMsPerStep: number[] = [];
const rafMs: number[] = [];

/** RAF clock that times each frame callback (JS main thread). */
const timingClock: FrameClock = {
  now: () => rafClock.now(),
  request: (cb) =>
    rafClock.request((tMs) => {
      const t0 = performance.now();
      cb(tMs);
      if (recording) {
        rafMs.push(performance.now() - t0);
        framesTotal += 1;
      }
    }),
  cancel: (handle) => rafClock.cancel(handle),
};

const clock: FrameClock = manual ?? (params.perf ? timingClock : rafClock);
let runtime: FluidRuntime | null = null;
let slotIds: number[] = [];

/** Wraps core.tick so each call's wall time is divided by the fixed steps it ran. */
function installTickProbe(rt: FluidRuntime): void {
  const core = rt.bridge.core;
  const original = core.tick.bind(core);
  core.tick = (rawDtS, px, py, pvx, pvy, pointerActive, gx, gy) => {
    const t0 = performance.now();
    const steps = original(rawDtS, px, py, pvx, pvy, pointerActive, gx, gy);
    const elapsed = performance.now() - t0;
    if (recording && steps > 0) {
      tickMsPerStep.push(elapsed / steps);
      stepsTotal += steps;
    }
    return steps;
  };
}

/** W66: the public facade instance behind the scene (D66-5). */
let sceneInstance: LiquidDOMInstance | null = null;

/** Drop-in replacement for createFluidRuntime: creates through the public API. */
async function createSceneInstance(opts: FluidRuntimeOptions): Promise<FluidRuntime> {
  // autoObserve finds the scene's [data-liquid] elements, which are exactly W65's
  // `initialElements`, so the area hint (D66-13) and the step-1 baseline do not move.
  const instance = await LiquidDOM.create({
    particles: opts.particles,
    maxElements: opts.maxElements,
    seed: opts.seed,
    container: opts.container,
    forceReducedMotion: opts.forceReducedMotion,
    material: opts.material,
    renderer: opts.renderer,
    clock: opts.clock,
    webgpuT0Scale: opts.webgpuT0Scale,
    autoObserve: true,
  });
  sceneInstance = instance;
  const runtime = runtimeOf(instance);
  if (!runtime) throw new Error("[acceptance] runtimeOf(instance) returned undefined");
  return runtime;
}

async function start(): Promise<FluidRuntime> {
  if (elements.length !== 4) {
    throw new Error(`[acceptance] expected 4 [data-liquid] elements, found ${elements.length}`);
  }
  const rt = await createSceneInstance({
    particles: PARTICLES,
    maxElements: MAX_ELEMENTS,
    seed: params.seed,
    initialElements: elements,
    // Pass only ?rm so the media-query path runs through the runtime's own listener; params.reducedMotion stays the effective flag for the hook.
    forceReducedMotion: parsed.reducedMotion,
    clock,
    renderer: params.renderer,
    webgpuT0Scale: params.t0Scale,
  });
  for (const el of noDrag) {
    // W84 (D84-2): through the public facade, so the option is validated as an author's would be.
    sceneInstance!.unobserve(el);
    sceneInstance!.observe(el, { drag: false });
  }
  slotIds = elements.map((el) => rt.observe(el));
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // let the batched redistribute run
  if (params.perf) installTickProbe(rt);
  runtime = rt;
  return rt;
}

const perfProbe: ScenePerfProbe | null = params.perf
  ? {
      start(): void {
        tickMsPerStep.length = 0;
        rafMs.length = 0;
        stepsTotal = 0;
        framesTotal = 0;
        recording = true;
      },
      stop(): ScenePerfSnapshot {
        recording = false;
        if (!runtime) throw new Error("[acceptance] perf.stop() called before the scene was ready");
        return {
          tickMsPerStep: [...tickMsPerStep],
          rafMs: [...rafMs],
          steps: stepsTotal,
          frames: framesTotal,
          particleCapacity: runtime.bridge.particleCapacity,
          activeParticles: runtime.bridge.core.active_particles(),
          crossOriginIsolated: window.crossOriginIsolated,
          userAgent: navigator.userAgent,
        };
      },
    }
  : null;

const started = start();

// ---- W71: pixel snapshot (a WebGPU canvas is readable only in the task that rendered it) ----
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
let snapshotTaken = false;

function captureLiquidCanvas(): void {
  const src = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
  if (!src) return;
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[acceptance] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  const { canvas, ctx } = snapshot;
  if (canvas.width !== src.width) canvas.width = src.width;
  if (canvas.height !== src.height) canvas.height = src.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
  snapshotTaken = true;
}

const hook: LiquidTestHook = {
  ready: started.then(() => undefined),
  restAlpha: () => elements.map((el) => runtime?.elementState(el)?.restAlpha ?? Number.NaN),
  advance: (frames) => {
    if (!manual) throw new Error("[acceptance] __liquidTest.advance() needs ?clock=manual");
    // No frame rendered in this task (advance(0), paused, hidden tab, failed frame): a WebGPU
    // canvas would read back cleared, so keep the previous snapshot (W71.5 review Minor 1,
    // W71 ward-review M3).
    if (manual.advance(frames) === 0) return;
    captureLiquidCanvas();
  },
  pixels: () => {
    if (!snapshot || !snapshotTaken) throw new Error("[acceptance] __liquidTest.pixels() needs a prior advance()");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  // A getter: returns the public facade instance (W66, D66-5).
  get instance(): unknown {
    return sceneInstance;
  },
  params,
  perf: perfProbe,
  // W72 (D72-3): the device-lost e2e. Resolves after the Canvas2D rebuild.
  loseDevice: async () => {
    if (!runtime) throw new Error("[acceptance] loseDevice() called before the scene was ready");
    if (!(await runtime.simulateDeviceLoss())) {
      throw new Error(`[acceptance] loseDevice() needs the webgpu renderer; active: ${runtime.activeRenderer}`);
    }
  },
  // W72 (D72-4): logged by webgpu-robust.spec.ts and perf.spec.ts, never gated.
  get overdraw(): number {
    return runtime?.fragmentEstimate ?? 0;
  },
  // W72 (D72-6): the DPR-2 e2e checks T0 = 0.5 × the backing px.
  get t0Size(): readonly [number, number] | null {
    return runtime?.t0Size ?? null;
  },
  // W75 (Review Focus 3, 5): atlas re-render requests issued by the runtime so far.
  get textInvalidations(): number {
    return runtime?.textInvalidations ?? 0;
  },
  // W78: slots 5–7 and s per [data-liquid] element, read back from the element and state views.
  slots: () =>
    elements.map((el, i) => {
      const id = slotIds[i];
      const st = runtime?.elementState(el);
      if (!runtime || id === undefined || !st) return { interaction: Number.NaN, homeDx: Number.NaN, homeDy: Number.NaN, s: Number.NaN };
      const v = runtime.bridge.elementView();
      const o = id * ELEMENT_STRIDE;
      return { interaction: v[o + El.INTERACTION], homeDx: v[o + El.HOME_DX], homeDy: v[o + El.HOME_DY], s: st.s };
    }),
  // W79 (D79-1): arm the capture, run one frame (its pixels are snapshotted in that task), read both.
  textIds: async () => {
    if (!manual) throw new Error("[acceptance] textIds() needs ?clock=manual");
    const rt = runtime as (FluidRuntime & { captureTextIds?: () => Promise<TextIdCaptureLike | null> }) | null;
    if (!rt?.captureTextIds) throw new Error("[acceptance] textIds(): FluidRuntime.captureTextIds is missing (W79.3)");
    const pending = rt.captureTextIds();
    hook.advance(1);
    // W79 red review (M2): a capture that never resolves (device stall, no frame rendered) must fail loudly, not hang the e2e.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`[acceptance] textIds(): the id readback did not resolve within ${TEXT_ID_TIMEOUT_MS} ms`)), TEXT_ID_TIMEOUT_MS);
    });
    let capture: TextIdCaptureLike | null;
    try {
      capture = await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (!capture) throw new Error(`[acceptance] textIds(): no capture (renderer ${rt.activeRenderer})`);
    const report = summarizeTextIds(capture, hook.pixels(), TEXT_ID_TEXT_MIN);
    const dom = (id: number): number => slotIds.indexOf(id);
    const textPxByElement: Record<number, number> = {};
    for (const [id, n] of Object.entries(report.textPxById)) {
      const i = dom(Number(id));
      if (i >= 0) textPxByElement[i] = n;
    }
    const pairs = report.pairs
      .map(([lo, hi]) => [dom(lo), dom(hi)].sort((a, b) => a - b) as [number, number])
      .filter(([a]) => a >= 0)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { ...report, elements: report.ids.map(dom).filter((i) => i >= 0), pairs, textPxByElement };
  },
};

started.catch((err: unknown) => {
  console.error("[acceptance] scene failed to start", err);
});
hook.ready.catch(() => {
  /* reported above; awaiting callers still see the rejection */
});

if (params.test) {
  (window as Window & { __liquidTest?: LiquidTestHook }).__liquidTest = hook;
}
