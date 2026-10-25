/**
 * W88 (D88-8): the shadows scene for e2e/shadows.spec.ts, the webgpu-hw block of
 * e2e/webgpu-robust.spec.ts and the gold smoke test. One instance observes the seven [data-liquid]
 * elements (a drop shadow, a two-layer glow, a spread shadow, a currentColor glow, an inset card, a
 * translucent pill with a black glow, a pill without a shadow). RAF clock by default (live in a
 * browser); `?clock=manual` switches to the manual render-counting clock the e2e needs.
 * `?renderer=canvas2d|webgpu|auto` (default canvas2d); `?rm=1` forces reduced motion.
 * `window.__shadows` (demo/test-hooks.ts ShadowsHook).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { SHADOW_AWAY_CLASS } from "../../packages/core/ts/src/stylesheet";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { ShadowsHook, ShadowsId } from "../test-hooks";

/** The observed elements in DOM order (autoObserve: every [data-liquid]). */
const SHADOWS_IDS: readonly ShadowsId[] = ["drop", "glow", "spread", "current", "inset", "glass", "plain", "fade"];
const query = new URLSearchParams(window.location.search);
const rendererRaw = query.get("renderer") ?? "canvas2d";
if (rendererRaw !== "canvas2d" && rendererRaw !== "webgpu" && rendererRaw !== "auto") {
  throw new TypeError(`[shadows] ?renderer must be canvas2d, webgpu or auto, got "${rendererRaw}"`);
}
const renderer: "canvas2d" | "webgpu" | "auto" = rendererRaw;
const clockRaw = query.get("clock") ?? "raf";
if (clockRaw !== "raf" && clockRaw !== "manual") {
  throw new TypeError(`[shadows] ?clock must be "raf" or "manual", got "${clockRaw}"`);
}
const manual: RenderCountingClock | null = clockRaw === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;
const forceReducedMotion = query.get("rm") === "1";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[shadows] #${id} not found`);
  return el;
}

let instance: LiquidDOMInstance | null = null;

function runtime(): FluidRuntime {
  const rt = instance ? runtimeOf(instance) : undefined;
  if (!rt) throw new Error("[shadows] no instance yet");
  return rt;
}

async function start(): Promise<void> {
  instance = await LiquidDOM.create({ seed: 1, particles: 16000, maxElements: 8, clock, renderer, forceReducedMotion });
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
}

const ready = start();
ready.catch((err: unknown) => {
  console.error("[shadows] start failed", err);
});

// A WebGPU canvas is readable only in the task that rendered it (W71): copy it after each advance.
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function capture(): void {
  const src = runtime().canvas;
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[shadows] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  const { canvas, ctx } = snapshot;
  if (canvas.width !== src.width) canvas.width = src.width;
  if (canvas.height !== src.height) canvas.height = src.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
}

const hook: ShadowsHook = {
  ready,
  ids: SHADOWS_IDS,
  advance(frames) {
    if (!manual) throw new Error("[shadows] advance() needs ?clock=manual");
    if (manual.advance(frames) === 0) return; // no frame rendered: keep the previous snapshot
    capture();
  },
  pixels() {
    if (!snapshot) throw new Error("[shadows] no snapshot yet: advance() first");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  restAlpha: () => SHADOWS_IDS.map((id) => runtime().elementState(byId(id))?.restAlpha ?? Number.NaN),
  held: () => SHADOWS_IDS.map((id) => byId(id).classList.contains(SHADOW_AWAY_CLASS)),
  splash(id: ShadowsId, strength = 1) {
    if (!instance) throw new Error("[shadows] no instance yet");
    instance.splash(byId(id), { strength });
  },
  layers: (id: ShadowsId) => runtime().shadowLayers(byId(id)).map((l) => ({ color: [...l.color], dx: l.dx, dy: l.dy, blur: l.blur, spread: l.spread, inset: l.inset })),
  rect(id: ShadowsId) {
    const r = byId(id).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  },
  get activeRenderer() {
    return instance ? instance.activeRenderer : "none";
  },
};
(window as Window & { __shadows?: ShadowsHook }).__shadows = hook;
