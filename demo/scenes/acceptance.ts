/**
 * Acceptance scene (spec §6, canonical in .wdd/NORTH-STAR.md).
 * W64 created it; W65 adds the query parameters and window.__liquidTest:
 *   ?seed=<u32>         RNG seed (default 1)
 *   ?clock=manual       frames run only via __liquidTest.advance(n) (D65-1)
 *   ?renderer=canvas2d  the only renderer before W66
 *   ?rm=1               forceReducedMotion
 *   ?test=1             install window.__liquidTest
 *   ?perf=1             tick/RAF perf probe (RAF clock only, D65-8)
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime, FluidRuntimeOptions } from "../../packages/core/ts/src/runtime";
import { createManualClock, rafClock, type FrameClock, type ManualClock } from "../../packages/core/ts/src/clock";
import type { LiquidTestHook, ScenePerfProbe, ScenePerfSnapshot } from "../test-hooks";
import { parseSceneParams } from "./scene-params";

const PARTICLES = 8000;
const MAX_ELEMENTS = 32;

const parsed = parseSceneParams(window.location.search);
// Effective reduced motion: ?rm=1 OR the media query (specs emulate the latter).
const params = {
  ...parsed,
  reducedMotion: parsed.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));
const manual: ManualClock | null = params.clock === "manual" ? createManualClock(0) : null;

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
  });
  for (const el of elements) rt.observe(el);
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

const hook: LiquidTestHook = {
  ready: started.then(() => undefined),
  restAlpha: () => elements.map((el) => runtime?.elementState(el)?.restAlpha ?? Number.NaN),
  advance: (frames) => {
    if (!manual) throw new Error("[acceptance] __liquidTest.advance() needs ?clock=manual");
    manual.advance(frames);
  },
  // A getter: returns the public facade instance (W66, D66-5).
  get instance(): unknown {
    return sceneInstance;
  },
  params,
  perf: perfProbe,
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
