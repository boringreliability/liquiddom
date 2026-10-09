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

export function installNavigatorGpu(gpu: unknown): () => void {
  const saved = Object.getOwnPropertyDescriptor(navigator, "gpu");
  Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true, writable: true });
  return () => {
    if (saved) Object.defineProperty(navigator, "gpu", saved);
    else delete (navigator as { gpu?: unknown }).gpu;
  };
}
