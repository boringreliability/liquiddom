/**
 * Multi-instance stress (spec §6, D65-10), the browser port of
 * docs/superpowers/specs/assets/w61-rca/race3.mjs: n runtimes are created in
 * the SAME task; single-flight init (W64) must yield exactly one WebAssembly
 * instantiation and one shared memory, and every instance must tick.
 * Elements deliberately carry NO data-liquid (W66 autoObserve would make every
 * instance observe every element — W66 passes autoObserve: false here).
 */
import { createFluidRuntime } from "../../packages/core/ts/src/runtime";
import { rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { loadFluidWasm, type FluidBackend } from "../../packages/core/ts/src/wasm-loader";
import type { SceneParams, StressReport } from "../test-hooks";

// Count SUCCESSFUL instantiations (race3 counts calls; a MIME fallback would double-count calls).
// Patched at module evaluation, before the first loadFluidWasm() imports the glue lazily.
let instantiations = 0;
const originalStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly) as (...args: unknown[]) => Promise<unknown>;
function counted<T>(p: Promise<T>): Promise<T> {
  return p.then((result) => {
    instantiations += 1;
    return result;
  });
}
WebAssembly.instantiateStreaming = ((source: Response | PromiseLike<Response>, imports?: WebAssembly.Imports) =>
  counted(originalStreaming(source, imports))) as typeof WebAssembly.instantiateStreaming;
WebAssembly.instantiate = ((...args: unknown[]) => counted(originalInstantiate(...args))) as typeof WebAssembly.instantiate;

const COLORS = ["#2563eb", "#db2777", "#059669", "#7c3aed"];
const PARTICLES_PER_INSTANCE = 2000;

const report: StressReport = {
  done: false,
  ok: false,
  n: 0,
  durationMs: 0,
  instantiations: 0,
  loaderCalls: 0,
  distinctMemories: 0,
  frames: [],
  params: { seed: 0, clock: "raf", renderer: "canvas2d", reducedMotion: false, test: false, perf: false },
  particlesPerInstance: [],
  destroyIdempotent: false,
  states: [],
  error: null,
};
(window as Window & { __stress?: StressReport }).__stress = report;

function intParam(q: URLSearchParams, name: string, lo: number, hi: number, fallback: number): number {
  const raw = q.get(name);
  if (raw === null) return fallback;
  const v = Number(raw);
  if (!/^\d+$/.test(raw) || v < lo || v > hi) {
    throw new TypeError(`[stress] ?${name} must be an integer in [${lo}, ${hi}], got "${raw}"`);
  }
  return v;
}

function mountElements(n: number): HTMLElement[] {
  const stage = document.getElementById("stage");
  if (!stage) throw new Error("[stress] #stage missing");
  return Array.from({ length: n }, (_, i) => {
    const el = document.createElement("div");
    el.className = "stress-el";
    el.textContent = `Instance ${i + 1}`;
    el.style.left = `${80 + i * 220}px`;
    el.style.backgroundColor = COLORS[i % COLORS.length];
    stage.appendChild(el);
    return el;
  });
}

const memories = new Set<object>();
let loaderCalls = 0;
async function countingLoader(): Promise<FluidBackend> {
  loaderCalls += 1;
  const backend = await loadFluidWasm();
  memories.add(backend.memory);
  return backend;
}

function countingClock(counter: { frames: number }): FrameClock {
  return {
    now: () => rafClock.now(),
    request: (cb) =>
      rafClock.request((tMs) => {
        counter.frames += 1;
        cb(tMs);
      }),
    cancel: (handle) => rafClock.cancel(handle),
  };
}

async function main(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const n = intParam(q, "n", 2, 4, 2);
  const ms = intParam(q, "ms", 100, 10_000, 3000);
  report.n = n;
  // D65-1: the stress always runs on the real RAF clock; params record that.
  const params: SceneParams = { ...report.params, clock: "raf" };
  report.params = params;
  report.durationMs = ms;

  const els = mountElements(n);
  const counters = els.map(() => ({ frames: 0 }));
  // All n creates start synchronously in this task (spec §6, race3.mjs).
  const pending = els.map((el, i) =>
    createFluidRuntime({
      particles: PARTICLES_PER_INSTANCE,
      maxElements: 4,
      seed: i + 1,
      initialElements: [el],
      clock: countingClock(counters[i]),
      loader: countingLoader,
    }),
  );
  const runtimes = await Promise.all(pending);
  runtimes.forEach((rt, i) => {
    rt.observe(els[i]);
  });

  await new Promise<void>((resolve) => setTimeout(resolve, ms));

  report.frames = counters.map((c) => c.frames);
  report.states = runtimes.map((rt, i) => {
    const s = rt.elementState(els[i]);
    return s ? { s: s.s, maxDev: s.maxDev, restAlpha: s.restAlpha } : null;
  });
  report.particlesPerInstance = runtimes.map((rt) => rt.bridge.particleCapacity);
  for (const rt of runtimes) rt.destroy();
  // D65-10: a second destroy() must be a silent no-op (throwing lands in main()'s catch -> ok stays false).
  for (const rt of runtimes) rt.destroy();
  report.destroyIdempotent = true;
  report.instantiations = instantiations;
  report.loaderCalls = loaderCalls;
  report.distinctMemories = memories.size;
  report.ok = true;
}

main()
  .catch((err: unknown) => {
    report.error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error("[stress] failed", err);
  })
  .finally(() => {
    report.done = true;
  });
