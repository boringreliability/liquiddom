/**
 * W66 facade test seam. This is the ONLY W66 file that touches W64's helpers
 * (`_fake-canvas.ts`, `_fluid-test-backend.ts`). The React and Vue adapter
 * tests import this file by relative path (A6):
 * `../../core/ts/__tests__/_facade-helpers`.
 */
import { installFakeCanvas2D } from "./_fake-canvas";
import { createTestBackend } from "./_fluid-test-backend";
import { ELEMENT_STRIDE } from "../src/fluid-layout";
import type { FluidBackend, FluidCoreCtor, FluidCoreLike } from "../src/wasm-loader";

/** Idempotent: re-installs the fake 2d context whenever it is missing. */
export function setupFacadeTestEnv(): void {
  if (document.createElement("canvas").getContext("2d") === null) installFakeCanvas2D();
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
}

export function freshBackend(): FluidBackend {
  return createTestBackend();
}

const SPIED = ["tick", "free", "set_reduced_motion", "set_material", "redistribute", "splash", "shake"] as const;
export type SpiedMethod = (typeof SPIED)[number];
export type TickArgs = Parameters<FluidCoreLike["tick"]>;
export interface CoreCall {
  readonly core: FluidCoreLike;
  readonly method: SpiedMethod;
  readonly args: unknown[];
}
export interface SpyBackend {
  readonly backend: FluidBackend;
  readonly cores: FluidCoreLike[];
  readonly ctorArgs: ConstructorParameters<FluidCoreCtor>[];
  readonly calls: CoreCall[];
}

/** Wraps a backend so every constructed core records its scalar FFI calls. */
export function spyBackend(base: FluidBackend = freshBackend()): SpyBackend {
  const cores: FluidCoreLike[] = [];
  const ctorArgs: ConstructorParameters<FluidCoreCtor>[] = [];
  const calls: CoreCall[] = [];
  const Base = base.FluidCore;
  function SpyFluidCore(...args: ConstructorParameters<FluidCoreCtor>): FluidCoreLike {
    const core = new Base(...args);
    const bag = core as unknown as Record<string, unknown>;
    for (const method of SPIED) {
      const original = (bag[method] as (...a: unknown[]) => unknown).bind(core);
      bag[method] = (...a: unknown[]): unknown => {
        calls.push({ core, method, args: a });
        return original(...a);
      };
    }
    cores.push(core);
    ctorArgs.push(args);
    return core;
  }
  const backend: FluidBackend = {
    get memory() {
      return base.memory;
    },
    FluidCore: SpyFluidCore as unknown as FluidCoreCtor,
  };
  return { backend, cores, ctorArgs, calls };
}

export function ticksOf(sb: SpyBackend, core?: FluidCoreLike): TickArgs[] {
  return sb.calls
    .filter((c) => c.method === "tick" && (core === undefined || c.core === core))
    .map((c) => c.args as TickArgs);
}

export function freedOf(sb: SpyBackend): FluidCoreLike[] {
  return sb.calls.filter((c) => c.method === "free").map((c) => c.core);
}

/** The 10 element-buffer floats of slot `id` (fresh view over the current buffer). */
export function elementSlots(sb: SpyBackend, core: FluidCoreLike, id: number): Float32Array {
  return new Float32Array(sb.backend.memory.buffer, core.elements_ptr() + id * ELEMENT_STRIDE * 4, ELEMENT_STRIDE);
}

export function instanceTracker(): { track<T extends { destroy(): void }>(i: T): T; destroyAll(): void } {
  const live: Array<{ destroy(): void }> = [];
  return {
    track<T extends { destroy(): void }>(i: T): T {
      live.push(i);
      return i;
    },
    destroyAll(): void {
      for (const i of live.splice(0)) i.destroy();
    },
  };
}

export function mockRect(el: Element, x: number, y: number, w: number, h: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
}

export function addLiquid(
  tag: "button" | "div",
  rect: readonly [number, number, number, number],
  parent: HTMLElement = document.body,
  liquid = true,
): HTMLElement {
  const el = document.createElement(tag);
  if (liquid) el.setAttribute("data-liquid", "");
  mockRect(el, rect[0], rect[1], rect[2], rect[3]);
  parent.appendChild(el);
  return el;
}

export function resetDom(): void {
  document.body.replaceChildren();
  document.head.replaceChildren();
}

export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function restoreVisibility(): void {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
}

export interface GpuMockCalls {
  requestAdapter: number;
  requestDevice: number;
  configure: unknown[];
  shaderModules: number;
  pipelines: number;
  passes: unknown[];
  submits: number;
  deviceDestroyed: number;
}
export interface GpuMock {
  readonly gpu: unknown;
  readonly canvasContext: { configure(cfg: unknown): void; getCurrentTexture(): { createView(): object } };
  readonly calls: GpuMockCalls;
  readonly adapterError: Error;
  readonly deviceError: Error;
  loseDevice(message: string): void;
}

export function makeGpuMock(
  opts: { adapter?: "ok" | "null" | "throw"; device?: "ok" | "reject"; configureError?: Error } = {},
): GpuMock {
  const calls: GpuMockCalls = {
    requestAdapter: 0, requestDevice: 0, configure: [], shaderModules: 0,
    pipelines: 0, passes: [], submits: 0, deviceDestroyed: 0,
  };
  const adapterError = new Error("adapter exploded");
  const deviceError = new Error("device exploded");
  let resolveLost: (info: { message: string; reason: string }) => void = () => {};
  const lost = new Promise<{ message: string; reason: string }>((r) => {
    resolveLost = r;
  });
  const device = {
    lost,
    queue: { submit: () => { calls.submits += 1; }, writeBuffer() {}, writeTexture() {} },
    destroy: () => { calls.deviceDestroyed += 1; },
    createShaderModule: () => { calls.shaderModules += 1; return {}; },
    createRenderPipeline: () => { calls.pipelines += 1; return {}; },
    createCommandEncoder: () => ({
      beginRenderPass: (desc: unknown) => {
        calls.passes.push(desc);
        return { end() {}, setPipeline() {}, draw() {} };
      },
      finish: () => ({}),
    }),
  };
  const adapter = {
    info: { isFallbackAdapter: false },
    requestDevice: async () => {
      calls.requestDevice += 1;
      if (opts.device === "reject") throw deviceError;
      return device;
    },
  };
  const gpu = {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter: async () => {
      calls.requestAdapter += 1;
      if (opts.adapter === "null") return null;
      if (opts.adapter === "throw") throw adapterError;
      return adapter;
    },
  };
  const canvasContext = {
    configure: (cfg: unknown) => {
      calls.configure.push(cfg);
      if (opts.configureError) throw opts.configureError;
    },
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  return {
    gpu, canvasContext, calls, adapterError, deviceError,
    loseDevice: (message) => resolveLost({ message, reason: "unknown" }),
  };
}

export function installNavigatorGpu(gpu: unknown): () => void {
  const saved = Object.getOwnPropertyDescriptor(navigator, "gpu");
  Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true, writable: true });
  return () => {
    if (saved) Object.defineProperty(navigator, "gpu", saved);
    else delete (navigator as { gpu?: unknown }).gpu;
  };
}

/** Makes `getContext("webgpu")` return `ctx`; every other id falls through (to the fake 2d). */
export function installWebGpuCanvasContext(ctx: object): () => void {
  const proto = HTMLCanvasElement.prototype;
  const previous = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === "webgpu") return ctx;
    return (previous as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, type, ...rest);
  } as HTMLCanvasElement["getContext"];
  return () => {
    proto.getContext = previous;
  };
}
