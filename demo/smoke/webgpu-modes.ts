/**
 * W72 (D72-6): WebGPU check page for container mode and two instances (e2e/webgpu-robust.spec.ts,
 * local webgpu-hw project only).
 *   ?mode=container  one instance, renderer 'auto', container #box-a (position: relative), observes #a1, #a2
 *   ?mode=multi      two instances, renderer 'webgpu', body mode; instance 0 observes #a1, #a2, instance 1 #b1
 * One manual render-counting clock drives every instance; advance(n) snapshots each instance's
 * current canvas in the task that rendered it (a WebGPU canvas is not readable later, W71).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import type { FluidRuntime } from "../../packages/core/ts/src/runtime";
import { createRenderCountingClock } from "../render-counting-clock";
import type { WebGpuModesCanvas, WebGpuModesHook } from "../test-hooks";

const modeRaw = new URLSearchParams(window.location.search).get("mode") ?? "container";
if (modeRaw !== "container" && modeRaw !== "multi") {
  throw new TypeError(`[webgpu-modes] ?mode must be "container" or "multi", got "${modeRaw}"`);
}
const mode: "container" | "multi" = modeRaw;
const clock = createRenderCountingClock(createManualClock(0));
/** Observed element ids per instance, in creation order. */
const GROUPS: ReadonlyArray<readonly string[]> = mode === "container" ? [["a1", "a2"]] : [["a1", "a2"], ["b1"]];
const instances: LiquidDOMInstance[] = [];
const snapshots: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined> = [];

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[webgpu-modes] #${id} not found`);
  return el;
}

function runtime(i: number): FluidRuntime {
  const inst = instances[i];
  const rt = inst ? runtimeOf(inst) : undefined;
  if (!rt) throw new Error(`[webgpu-modes] no instance ${i}`);
  return rt;
}

function capture(i: number): void {
  const src = runtime(i).canvas; // live: the remounted canvas after a device-lost rebuild
  let snap = snapshots[i];
  if (!snap) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[webgpu-modes] no 2d context for the pixel snapshot");
    snap = { canvas, ctx };
    snapshots[i] = snap;
  }
  if (snap.canvas.width !== src.width) snap.canvas.width = src.width;
  if (snap.canvas.height !== src.height) snap.canvas.height = src.height;
  snap.ctx.clearRect(0, 0, snap.canvas.width, snap.canvas.height);
  snap.ctx.drawImage(src, 0, 0);
}

async function start(): Promise<void> {
  const base = { seed: 1, particles: 4000, maxElements: 4, clock, autoObserve: false } as const;
  if (mode === "container") {
    instances.push(await LiquidDOM.create({ ...base, renderer: "auto", container: byId("box-a") }));
  } else {
    // A first, so A's canvas precedes B's at the end of body.
    instances.push(await LiquidDOM.create({ ...base, renderer: "webgpu" }));
    instances.push(await LiquidDOM.create({ ...base, renderer: "webgpu" }));
  }
  GROUPS.forEach((ids, i) => {
    for (const id of ids) instances[i]!.observe(byId(id));
  });
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
}

const ready = start();
ready.catch((err: unknown) => {
  console.error("[webgpu-modes] start failed", err);
});

const hook: WebGpuModesHook = {
  ready,
  mode,
  activeRenderers: () => instances.map((inst) => inst.activeRenderer),
  canvases: () =>
    instances.map((_, i): WebGpuModesCanvas => {
      const c = runtime(i).canvas;
      const parent = c.parentElement;
      return {
        parent: parent ? parent.id || parent.tagName.toLowerCase() : null,
        index: parent ? Array.prototype.indexOf.call(parent.children, c) : -1,
        width: c.width,
        height: c.height,
        connected: c.isConnected,
        className: c.className,
      };
    }),
  liquidCanvasCount: () => document.querySelectorAll("canvas.liquid-canvas").length,
  loseDevice: (i) => runtime(i).simulateDeviceLoss(),
  advance(frames) {
    // No frame rendered in this task: keep the previous snapshots (W71 ward-review M3).
    if (clock.advance(frames) === 0) return;
    for (let i = 0; i < instances.length; i++) capture(i);
  },
  restAlpha: (i) => (GROUPS[i] ?? []).map((id) => runtime(i).elementState(byId(id))?.restAlpha ?? Number.NaN),
  opaqueIn(i, id) {
    const snap = snapshots[i];
    if (!snap) throw new Error("[webgpu-modes] opaqueIn() needs a prior advance()");
    const cr = runtime(i).canvas.getBoundingClientRect();
    const r = byId(id).getBoundingClientRect();
    const sx = snap.canvas.width / cr.width;
    const sy = snap.canvas.height / cr.height;
    const x0 = Math.max(0, Math.floor((r.left - cr.left) * sx));
    const x1 = Math.min(snap.canvas.width, Math.ceil((r.right - cr.left) * sx));
    const y0 = Math.max(0, Math.floor((r.top - cr.top) * sy));
    const y1 = Math.min(snap.canvas.height, Math.ceil((r.bottom - cr.top) * sy));
    if (x1 <= x0 || y1 <= y0) return 0;
    const data = snap.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let n = 0;
    for (let p = 3; p < data.length; p += 4) if (data[p]! > 128) n++;
    return n;
  },
};
(window as Window & { __webgpuModes?: WebGpuModesHook }).__webgpuModes = hook;
