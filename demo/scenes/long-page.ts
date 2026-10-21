/**
 * W81 (D81-1, D81-2): the long page for e2e/parking.spec.ts and the gold smoke test. Body mode, one
 * instance observing #top, #hide (inside #wrap), #far1 and #far2 in document order; #far1 and #far2
 * start parked. RAF clock by default (live in a browser); `?clock=manual` switches to the manual
 * render-counting clock the e2e needs (frames run only via `advance(n)`, which throws without it).
 * `?renderer=canvas2d|webgpu|auto` (default canvas2d); `?compact=1` pulls the far cards onto the
 * first screen (the perf comparison). `window.__longPage` (demo/test-hooks.ts LongPageHook).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { Dyn, FLAG_PARKED, Stat } from "../../packages/core/ts/src/fluid-layout";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { LongPageHook } from "../test-hooks";

const query = new URLSearchParams(window.location.search);
const rendererRaw = query.get("renderer") ?? "canvas2d";
if (rendererRaw !== "canvas2d" && rendererRaw !== "webgpu" && rendererRaw !== "auto") {
  throw new TypeError(`[long-page] ?renderer must be canvas2d, webgpu or auto, got "${rendererRaw}"`);
}
const renderer: "canvas2d" | "webgpu" | "auto" = rendererRaw;
const clockRaw = query.get("clock") ?? "raf";
if (clockRaw !== "raf" && clockRaw !== "manual") {
  throw new TypeError(`[long-page] ?clock must be "raf" or "manual", got "${clockRaw}"`);
}
const manual: RenderCountingClock | null = clockRaw === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;
if (query.get("compact") === "1") document.body.classList.add("compact");
const IDS = ["top", "hide", "far1", "far2"] as const;
const slots = new Map<string, number>();
let instance: LiquidDOMInstance | null = null;
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[long-page] #${id} not found`);
  return el;
}

function runtime(): FluidRuntime {
  const rt = instance ? runtimeOf(instance) : undefined;
  if (!rt) throw new Error("[long-page] no instance yet");
  return rt;
}

function capture(): void {
  const src = runtime().canvas;
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[long-page] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  if (snapshot.canvas.width !== src.width) snapshot.canvas.width = src.width;
  if (snapshot.canvas.height !== src.height) snapshot.canvas.height = src.height;
  snapshot.ctx.clearRect(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  snapshot.ctx.drawImage(src, 0, 0);
}

async function start(): Promise<void> {
  instance = await LiquidDOM.create({ seed: 1, particles: 8000, maxElements: 8, clock, renderer, autoObserve: false });
  for (const id of IDS) slots.set(id, instance.observe(byId(id)));
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
}

const ready = start();
ready.catch((err: unknown) => {
  console.error("[long-page] start failed", err);
});

const hook: LongPageHook = {
  ready,
  advance(frames) {
    if (!manual) throw new Error("[long-page] advance() needs ?clock=manual");
    // No frame rendered in this task: keep the previous snapshot (W71 ward-review M3).
    if (manual.advance(frames) === 0) return;
    capture();
  },
  pixels() {
    if (!snapshot) throw new Error("[long-page] pixels() needs a prior advance()");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  restAlpha: () => IDS.map((id) => runtime().elementState(byId(id))?.restAlpha ?? Number.NaN),
  parked() {
    const bridge = runtime().bridge;
    const cap = bridge.particleCapacity;
    const st = bridge.staticView();
    const dyn = bridge.dynamicView();
    return IDS.map((id) => {
      const slot = slots.get(id);
      let mine = 0;
      let flagged = 0;
      for (let i = 0; i < cap; i++) {
        if (st[Stat.HOME * cap + i] !== slot) continue;
        mine += 1;
        if (((dyn[Dyn.FLAGS * cap + i] as number) & FLAG_PARKED) !== 0) flagged += 1;
      }
      return mine > 0 && flagged === mine;
    });
  },
  world: () => ({ ...runtime().world }),
  shake() {
    if (!instance) throw new Error("[long-page] no instance yet");
    instance.shake();
  },
};
(window as Window & { __longPage?: LongPageHook }).__longPage = hook;
