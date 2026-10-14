/**
 * W82 (D82-1, D82-2): the "under the page" scene for e2e/under-page.spec.ts and the gold smoke test.
 * One instance observes #pill; #note is an unobserved paragraph the splash reaches. `?page=` picks
 * the variant (demo/scenes/under-page.html): body (default), opaque, wrapper (body mode), isolate,
 * relative (container mode on #box). RAF clock by default (live in a browser); `?clock=manual`
 * switches to the manual render-counting clock the e2e needs. `?renderer=canvas2d|webgpu|auto`
 * (default canvas2d). `window.__underPage` (demo/test-hooks.ts UnderPageHook).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { UnderPage, UnderPageHook } from "../test-hooks";

const PAGES: readonly UnderPage[] = ["body", "opaque", "wrapper", "isolate", "relative"];
const query = new URLSearchParams(window.location.search);
const pageRaw = query.get("page") ?? "body";
if (!(PAGES as readonly string[]).includes(pageRaw)) {
  throw new TypeError(`[under-page] ?page must be one of ${PAGES.join(", ")}, got "${pageRaw}"`);
}
const page = pageRaw as UnderPage;
const rendererRaw = query.get("renderer") ?? "canvas2d";
if (rendererRaw !== "canvas2d" && rendererRaw !== "webgpu" && rendererRaw !== "auto") {
  throw new TypeError(`[under-page] ?renderer must be canvas2d, webgpu or auto, got "${rendererRaw}"`);
}
const renderer: "canvas2d" | "webgpu" | "auto" = rendererRaw;
const clockRaw = query.get("clock") ?? "raf";
if (clockRaw !== "raf" && clockRaw !== "manual") {
  throw new TypeError(`[under-page] ?clock must be "raf" or "manual", got "${clockRaw}"`);
}
const manual: RenderCountingClock | null = clockRaw === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;
// The variant's CSS applies before the instance reads any computed style.
document.documentElement.dataset.page = page;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[under-page] #${id} not found`);
  return el;
}

let instance: LiquidDOMInstance | null = null;

function runtime(): FluidRuntime {
  const rt = instance ? runtimeOf(instance) : undefined;
  if (!rt) throw new Error("[under-page] no instance yet");
  return rt;
}

async function start(): Promise<void> {
  const container = page === "isolate" || page === "relative" ? byId("box") : undefined;
  instance = await LiquidDOM.create({ seed: 1, particles: 4000, maxElements: 4, clock, renderer, autoObserve: false, container });
  instance.observe(byId("pill"));
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
}

const ready = start();
ready.catch((err: unknown) => {
  console.error("[under-page] start failed", err);
});

const hook: UnderPageHook = {
  ready,
  page,
  advance(frames) {
    if (!manual) throw new Error("[under-page] advance() needs ?clock=manual");
    manual.advance(frames);
  },
  restAlpha: () => [runtime().elementState(byId("pill"))?.restAlpha ?? Number.NaN],
  canvasZ: () => getComputedStyle(runtime().canvas).zIndex,
  stack: () => byId("pill").getAttribute("data-liquid-stack"),
  splash(strength) {
    if (!instance) throw new Error("[under-page] no instance yet");
    instance.splash(byId("pill"), { strength });
  },
};
(window as Window & { __underPage?: UnderPageHook }).__underPage = hook;
