/**
 * W71 (D71-3, Review Focus 4): WebGPU liquid check page for e2e/webgpu-liquid.spec.ts.
 *   ?renderer=webgpu|canvas2d   (default webgpu)
 * An opaque, a translucent (rgba(…, 0.5)) and a transparent element (→ the default liquid
 * colour) on a manual clock. window.__webgpuLiquid also builds the three liquid pipelines on its
 * own device under a validation error scope (pipelineCheck).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import { buildPipelines } from "../../packages/core/ts/src/renderers/webgpu/webgpu-renderer";
import type { PipelineCheckResult, WebGpuLiquidHook } from "../test-hooks";

const rendererRaw = new URLSearchParams(window.location.search).get("renderer") ?? "webgpu";
if (rendererRaw !== "webgpu" && rendererRaw !== "canvas2d") {
  throw new TypeError(`[webgpu-liquid] ?renderer must be "webgpu" or "canvas2d", got "${rendererRaw}"`);
}
const renderer: "webgpu" | "canvas2d" = rendererRaw;
const clock = createManualClock(0);
const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));
let instance: LiquidDOMInstance | null = null;

async function pipelineCheck(): Promise<PipelineCheckResult> {
  const gpu = navigator.gpu;
  if (!gpu) return { ok: false, error: "navigator.gpu is undefined", messages: [] };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { ok: false, error: "requestAdapter returned null", messages: [] };
  const device = await adapter.requestDevice();
  try {
    device.pushErrorScope("validation");
    const built = buildPipelines(device, gpu.getPreferredCanvasFormat());
    const error = await device.popErrorScope();
    const messages: string[] = [];
    for (const module of built.modules) {
      for (const m of (await module.getCompilationInfo()).messages) messages.push(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
    }
    return { ok: error === null && !messages.some((m) => m.startsWith("error")), error: error ? error.message : null, messages };
  } finally {
    device.destroy();
  }
}

let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
function capture(): void {
  const src = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
  if (!src) return;
  if (!snapshot) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[webgpu-liquid] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  if (snapshot.canvas.width !== src.width) snapshot.canvas.width = src.width;
  if (snapshot.canvas.height !== src.height) snapshot.canvas.height = src.height;
  snapshot.ctx.clearRect(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  snapshot.ctx.drawImage(src, 0, 0);
}

const ready = LiquidDOM.create({ renderer, seed: 1, particles: 4000, maxElements: 4, clock, autoObserve: true }).then(
  async (created) => {
    instance = created;
    await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
  },
);
ready.catch((err: unknown) => {
  console.error("[webgpu-liquid] LiquidDOM.create failed", err);
});

const hook: WebGpuLiquidHook = {
  ready,
  renderer,
  get activeRenderer() {
    return instance?.activeRenderer ?? null;
  },
  pipelineCheck,
  advance(frames) {
    clock.advance(frames);
    // advance(0) renders no frame in this task; keep the previous snapshot (W71.5 review, Minor 1).
    if (frames === 0) return;
    capture();
  },
  pixels() {
    if (!snapshot) throw new Error("[webgpu-liquid] pixels() needs a prior advance()");
    return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
  },
  restAlpha() {
    const rt = instance ? runtimeOf(instance) : undefined;
    return elements.map((el) => rt?.elementState(el)?.restAlpha ?? Number.NaN);
  },
  splash(id) {
    const el = document.getElementById(id);
    if (!instance || !el) throw new Error(`[webgpu-liquid] cannot splash #${id}`);
    instance.splash(el);
  },
};
(window as Window & { __webgpuLiquid?: WebGpuLiquidHook }).__webgpuLiquid = hook;
