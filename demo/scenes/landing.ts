/**
 * Landing page scene (W76, D76-2): an ordinary one-screen SaaS page at 1280×800 with liquid on
 * its nav pill, its two hero CTAs and its three feature cards. A foreign test page: liquiddom
 * meets author CSS it did not write (hover transitions, focus rings, nested icon chips).
 * The acceptance scene's query parameters and window.__liquidTest hook, except ?perf=1 (no perf
 * report here: `perf` is null) and the pixel snapshot, which needs a prior advance() under
 * ?clock=manual:
 *   ?seed=<u32>         RNG seed (default 1)
 *   ?clock=manual       frames run only via __liquidTest.advance(n) (D65-1)
 *   ?renderer=canvas2d|webgpu|auto  default canvas2d
 *   ?t0=0.5|0.75        WebGPU T0 render scale (needs ?renderer=webgpu)
 *   ?rm=1               forceReducedMotion
 *   ?test=1             install window.__liquidTest
 * The page uses liquiddom's defaults (particles, maxElements, material) as a site author would.
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { LiquidTestHook } from "../test-hooks";
import { parseSceneParams } from "./scene-params";

const LIQUID_COUNT = 6;

const parsed = parseSceneParams(window.location.search);
// Effective reduced motion: ?rm=1 OR the media query (specs emulate the latter).
const params = {
  ...parsed,
  reducedMotion: parsed.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};
const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));
const manual: RenderCountingClock | null = params.clock === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;

let sceneInstance: LiquidDOMInstance | null = null;
let runtime: FluidRuntime | null = null;

async function start(): Promise<FluidRuntime> {
  if (elements.length !== LIQUID_COUNT) {
    throw new Error(`[landing] expected ${LIQUID_COUNT} [data-liquid] elements, found ${elements.length}`);
  }
  const instance = await LiquidDOM.create({
    seed: params.seed,
    // Pass only ?rm so the media-query path runs through the runtime's own listener.
    forceReducedMotion: parsed.reducedMotion,
    renderer: params.renderer,
    clock,
    webgpuT0Scale: params.t0Scale,
    autoObserve: true,
  });
  sceneInstance = instance;
  const rt = runtimeOf(instance);
  if (!rt) throw new Error("[landing] runtimeOf(instance) returned undefined");
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // let the batched redistribute run
  runtime = rt;
  return rt;
}

const started = start();

// A WebGPU canvas is readable only in the task that rendered it (W71): copy it after each advance.
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function captureLiquidCanvas(): void {
  const src = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
  if (!src) return;
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[landing] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  const { canvas, ctx } = snapshot;
  if (canvas.width !== src.width) canvas.width = src.width;
  if (canvas.height !== src.height) canvas.height = src.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
}

const hook: LiquidTestHook = {
  ready: started.then(() => undefined),
  restAlpha: () => elements.map((el) => runtime?.elementState(el)?.restAlpha ?? Number.NaN),
  advance: (frames) => {
    if (!manual) throw new Error("[landing] __liquidTest.advance() needs ?clock=manual");
    if (manual.advance(frames) === 0) return; // no frame rendered: keep the previous snapshot
    captureLiquidCanvas();
  },
  pixels: () => {
    if (!snapshot) throw new Error("[landing] __liquidTest.pixels() needs a prior advance()");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  get instance(): unknown {
    return sceneInstance;
  },
  params,
  perf: null,
  loseDevice: async () => {
    if (!runtime) throw new Error("[landing] loseDevice() called before the scene was ready");
    if (!(await runtime.simulateDeviceLoss())) {
      throw new Error(`[landing] loseDevice() needs the webgpu renderer; active: ${runtime.activeRenderer}`);
    }
  },
  get overdraw(): number {
    return runtime?.fragmentEstimate ?? 0;
  },
  get t0Size(): readonly [number, number] | null {
    return runtime?.t0Size ?? null;
  },
  get textInvalidations(): number {
    return runtime?.textInvalidations ?? 0;
  },
};

started.catch((err: unknown) => {
  console.error("[landing] scene failed to start", err);
});
hook.ready.catch(() => {
  /* reported above; awaiting callers still see the rejection */
});

if (params.test) {
  (window as Window & { __liquidTest?: LiquidTestHook }).__liquidTest = hook;
}
