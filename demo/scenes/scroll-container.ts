/**
 * W80 (D80-1): the scroll scenes for e2e/scroll.spec.ts. scroll-container.html: one instance in
 * container mode on #box (an `overflow: auto`, positioned container inside a page that scrolls as
 * well), observing #c1 (a pill) and #c2 (a card); `<body data-scene="container">` makes a missing
 * #box throw. scroll-fixed.html (W80 ward review I1): `data-scene="body"`, no #box,
 * so body mode, observing a `position: fixed` pill, a `position: sticky` pill and a normal card.
 * Every `[data-liquid]` element with an id is observed, in document order. RAF clock by default
 * (so the scene runs live in a browser); `?clock=manual` switches to the manual render-counting
 * clock that e2e/scroll.spec.ts needs (frames run only via `advance(n)`, which throws without it).
 * `?renderer=canvas2d|webgpu|auto` (default canvas2d). `window.__scrollContainer`
 * (demo/test-hooks.ts ScrollContainerHook).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { ScrollContainerHook } from "../test-hooks";

const rendererRaw = new URLSearchParams(window.location.search).get("renderer") ?? "canvas2d";
if (rendererRaw !== "canvas2d" && rendererRaw !== "webgpu" && rendererRaw !== "auto") {
  throw new TypeError(`[scroll-container] ?renderer must be canvas2d, webgpu or auto, got "${rendererRaw}"`);
}
const renderer: "canvas2d" | "webgpu" | "auto" = rendererRaw;
const manual: RenderCountingClock | null =
  new URLSearchParams(window.location.search).get("clock") === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;
const IDS = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid][id]"), (el) => el.id);
let instance: LiquidDOMInstance | null = null;
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[scroll-container] #${id} not found`);
  return el;
}

/** `<body data-scene="container">` needs #box (throws when missing); `"body"` is body mode. Anything else throws. */
function sceneContainer(): HTMLElement | undefined {
  const scene = document.body.dataset.scene;
  if (scene === "container") return byId("box");
  if (scene === "body") return undefined;
  throw new TypeError(`[scroll-container] body[data-scene] must be "container" or "body", got "${String(scene)}"`);
}

function runtime(): FluidRuntime {
  const rt = instance ? runtimeOf(instance) : undefined;
  if (!rt) throw new Error("[scroll-container] no instance yet");
  return rt;
}

function capture(): void {
  const src = runtime().canvas;
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[scroll-container] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  if (snapshot.canvas.width !== src.width) snapshot.canvas.width = src.width;
  if (snapshot.canvas.height !== src.height) snapshot.canvas.height = src.height;
  snapshot.ctx.clearRect(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  snapshot.ctx.drawImage(src, 0, 0);
}

async function start(): Promise<void> {
  instance = await LiquidDOM.create({
    seed: 1,
    particles: 4000,
    maxElements: 4,
    clock,
    renderer,
    container: sceneContainer(),
    autoObserve: false,
  });
  for (const id of IDS) instance.observe(byId(id));
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
}

const ready = start();
ready.catch((err: unknown) => {
  console.error("[scroll-container] start failed", err);
});

const hook: ScrollContainerHook = {
  ready,
  advance(frames) {
    if (!manual) throw new Error("[scroll-container] advance() needs ?clock=manual");
    // No frame rendered in this task: keep the previous snapshot (W71 ward-review M3).
    if (manual.advance(frames) === 0) return;
    capture();
  },
  pixels() {
    if (!snapshot) throw new Error("[scroll-container] pixels() needs a prior advance()");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  restAlpha: () => IDS.map((id) => runtime().elementState(byId(id))?.restAlpha ?? Number.NaN),
  canvasTransform: () => runtime().canvas.style.transform,
};
(window as Window & { __scrollContainer?: ScrollContainerHook }).__scrollContainer = hook;
