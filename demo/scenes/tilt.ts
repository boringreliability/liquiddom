/**
 * W83 (D83-1 … D83-5): the tilt scene for e2e/tilt.spec.ts and the gold smoke test. The acceptance
 * layout observed with `autoObserve` ([data-liquid]); the "Gravity" slider sets a fixed gravity
 * through `setGravity` (0° = straight down, +90° = to the right), so moving it sloshes the liquid
 * and it rests at home; "Use device tilt" asks for permission (iOS) and switches to
 * `source: 'orientation'`. RAF clock by default (live in a browser); `?clock=manual` switches to the
 * manual render-counting clock the e2e needs. `?renderer=canvas2d|webgpu|auto` (default canvas2d),
 * `?gravity=fixed|none|orientation` (default fixed), `?angle=<deg>` (the fixed vector at create(),
 * default 0). `window.__tilt` (demo/test-hooks.ts TiltHook).
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { createManualClock, rafClock, type FrameClock } from "../../packages/core/ts/src/clock";
import { runtimeOf } from "../../packages/core/ts/src/internal";
import { createRenderCountingClock, type RenderCountingClock } from "../render-counting-clock";
import type { TiltHook } from "../test-hooks";

const query = new URLSearchParams(window.location.search);
const rendererRaw = query.get("renderer") ?? "canvas2d";
if (rendererRaw !== "canvas2d" && rendererRaw !== "webgpu" && rendererRaw !== "auto") {
  throw new TypeError(`[tilt] ?renderer must be canvas2d, webgpu or auto, got "${rendererRaw}"`);
}
const renderer: "canvas2d" | "webgpu" | "auto" = rendererRaw;
const clockRaw = query.get("clock") ?? "raf";
if (clockRaw !== "raf" && clockRaw !== "manual") {
  throw new TypeError(`[tilt] ?clock must be "raf" or "manual", got "${clockRaw}"`);
}
const sourceRaw = query.get("gravity") ?? "fixed";
if (sourceRaw !== "fixed" && sourceRaw !== "none" && sourceRaw !== "orientation") {
  throw new TypeError(`[tilt] ?gravity must be fixed, none or orientation, got "${sourceRaw}"`);
}
const source: "fixed" | "none" | "orientation" = sourceRaw;
const angle0 = Number(query.get("angle") ?? "0");
if (!Number.isFinite(angle0)) throw new TypeError(`[tilt] ?angle must be a number of degrees, got "${query.get("angle")}"`);
const manual: RenderCountingClock | null = clockRaw === "manual" ? createRenderCountingClock(createManualClock(0)) : null;
const clock: FrameClock = manual ?? rafClock;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[tilt] #${id} not found`);
  return el as T;
}

const slider = byId<HTMLInputElement>("angle");
const angleOut = byId<HTMLOutputElement>("angle-out");
const deviceTilt = byId<HTMLButtonElement>("device-tilt");
const status = byId<HTMLSpanElement>("status");
const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-liquid]"));

/** Degrees from straight down, clockwise (+90: to the right) → a gravity direction in CSS axes. */
function vectorOf(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

let instance: LiquidDOMInstance | null = null;

function live(): LiquidDOMInstance {
  if (!instance) throw new Error("[tilt] no instance yet");
  return instance;
}

function setAngle(deg: number): void {
  slider.value = String(deg);
  angleOut.textContent = `${deg}°`;
  live().setGravity({ source: "fixed", vector: vectorOf(deg) });
}

async function start(): Promise<void> {
  slider.value = String(angle0);
  angleOut.textContent = `${angle0}°`;
  const gravity = source === "fixed" ? { source, vector: vectorOf(angle0) } : { source };
  instance = await LiquidDOM.create({ seed: 1, particles: 8000, maxElements: 8, clock, renderer, gravity });
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // the batched redistribute
  if (source === "orientation") {
    slider.disabled = true;
    status.textContent = "Following the device tilt";
  }
}

slider.addEventListener("input", () => {
  if (instance) setAngle(Number(slider.value));
});
deviceTilt.addEventListener("click", () => {
  void (async () => {
    if (!instance) return;
    if (!(await instance.requestOrientationPermission())) {
      status.textContent = "Tilt permission denied";
      return;
    }
    instance.setGravity({ source: "orientation" });
    slider.disabled = true;
    status.textContent = "Following the device tilt";
  })();
});

const ready = start();
ready.catch((err: unknown) => {
  console.error("[tilt] start failed", err);
});

// A WebGPU canvas is readable only in the task that rendered it (W71): copy it after each advance.
let snapshot: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function liquidCanvas(): HTMLCanvasElement {
  const src = document.querySelector<HTMLCanvasElement>("canvas.liquid-canvas");
  if (!src) throw new Error("[tilt] canvas.liquid-canvas not found");
  return src;
}

function capture(): void {
  const src = liquidCanvas();
  if (!snapshot) {
    const canvas = document.createElement("canvas"); // detached: never in the DOM
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[tilt] no 2d context for the pixel snapshot");
    snapshot = { canvas, ctx };
  }
  const { canvas, ctx } = snapshot;
  if (canvas.width !== src.width) canvas.width = src.width;
  if (canvas.height !== src.height) canvas.height = src.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
}

function pixels(): ImageData {
  if (!snapshot) throw new Error("[tilt] no snapshot yet: advance() first");
  return snapshot.ctx.getImageData(0, 0, snapshot.canvas.width, snapshot.canvas.height);
}

const hook: TiltHook = {
  ready,
  advance(frames) {
    if (!manual) throw new Error("[tilt] advance() needs ?clock=manual");
    if (manual.advance(frames) === 0) return; // no frame rendered: keep the previous snapshot
    capture();
  },
  restAlpha: () => elements.map((el) => (instance ? runtimeOf(instance)?.elementState(el)?.restAlpha : undefined) ?? Number.NaN),
  setAngle,
  orient(beta, gamma) {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta, gamma }));
  },
  hash() {
    const data = pixels().data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  },
  outside(marginPx) {
    const img = pixels();
    const cr = liquidCanvas().getBoundingClientRect();
    const sx = img.width / cr.width;
    const sy = img.height / cr.height;
    const rects = elements.map((e) => e.getBoundingClientRect());
    let out = 0;
    for (let py = 0; py < img.height; py++) {
      const y = (py + 0.5) / sy + cr.top;
      for (let px = 0; px < img.width; px++) {
        if (img.data[(py * img.width + px) * 4 + 3] <= 128) continue;
        const x = (px + 0.5) / sx + cr.left;
        if (!rects.some((r) => x >= r.left - marginPx && x <= r.right + marginPx && y >= r.top - marginPx && y <= r.bottom + marginPx)) out++;
      }
    }
    return out;
  },
  get activeRenderer() {
    return instance?.activeRenderer ?? "none";
  },
};
(window as Window & { __tilt?: TiltHook }).__tilt = hook;
