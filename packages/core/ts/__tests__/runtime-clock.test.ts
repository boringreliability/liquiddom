/**
 * W65 (D65-1): the runtime schedules frames through the injected FrameClock.
 * Uses the REAL FluidCore via initSync (pattern from ffi-integration /
 * fluid-ffi tests) so determinism is checked against the actual engine.
 * Requires `npm run build:wasm` (D4).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type FrameClock } from "../src/clock";
import { DYNAMIC_FIELDS } from "../src/fluid-layout";
import type { FluidBackend, FluidCoreCtor, FluidCoreLike } from "../src/wasm-loader";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

const PARTICLES = 2000;
const MAX_ELEMENTS = 8;
/** Acceptance layout (spike bench): 3 buttons 140x48 r24 at y 260, card 320x180 r16 at y 340. */
const LAYOUT: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [406, 260, 140, 48, 24],
  [570, 260, 140, 48, 24],
  [734, 260, 140, 48, 24],
  [480, 340, 320, 180, 16],
];

let backend: FluidBackend;
let fakeCanvas: FakeCanvasHandle | undefined;

beforeAll(async () => {
  const wasmBytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../pkg/liquiddom_bg.wasm"));
  const mod = await import("../../../../pkg/liquiddom.js");
  const exports = mod.initSync({ module: wasmBytes });
  backend = { memory: exports.memory, FluidCore: mod.FluidCore as unknown as FluidCoreCtor };
  // W64's installFakeCanvas2D() returns a FakeCanvasHandle; restore() undoes the patch (A6).
  fakeCanvas = installFakeCanvas2D();
});

beforeEach(() => {
  // Re-stubbed per test because afterEach unstubs globals (rAF stub must not leak).
  if (typeof window.matchMedia !== "function") {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  }
});

afterAll(() => {
  fakeCanvas?.restore();
});

function mountScene(): HTMLElement[] {
  return LAYOUT.map(([x, y, w, h, r]) => {
    const el = document.createElement("div");
    el.style.borderRadius = `${r}px`;
    el.style.backgroundColor = "rgb(37, 99, 235)";
    el.style.color = "rgb(255, 255, 255)";
    el.textContent = "liquid";
    el.getBoundingClientRect = () =>
      ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    return el;
  });
}

/** Wraps the backend so every core.tick() return value is recorded. */
function withTickLog(base: FluidBackend, log: number[]): FluidBackend {
  const Base = base.FluidCore;
  const Wrapped = function (...args: ConstructorParameters<FluidCoreCtor>): FluidCoreLike {
    const core = new Base(...args);
    const original = core.tick.bind(core);
    core.tick = (rawDtS, px, py, pvx, pvy, pointerActive, gx, gy) => {
      const steps = original(rawDtS, px, py, pvx, pvy, pointerActive, gx, gy);
      log.push(steps);
      return steps;
    };
    return core;
  } as unknown as FluidCoreCtor;
  return { memory: base.memory, FluidCore: Wrapped };
}

async function start(seed: number, clock: FrameClock, log?: number[]): Promise<FluidRuntime> {
  const els = mountScene();
  const rt = await createFluidRuntime({
    particles: PARTICLES,
    maxElements: MAX_ELEMENTS,
    seed,
    initialElements: els,
    forceReducedMotion: false,
    testBackend: log ? withTickLog(backend, log) : backend,
    clock,
  });
  for (const el of els) rt.observe(el);
  await new Promise<void>((resolve) => queueMicrotask(resolve)); // flush the batched redistribute
  // The scene is at rest, so nothing would move. Identically perturb every run: shift the
  // first element's rect by a fixed offset; the next frame's sync moves its home and the
  // particles crawl toward it.
  const moved = els[0]!;
  const original = moved.getBoundingClientRect.bind(moved);
  moved.getBoundingClientRect = () => {
    const r = original();
    return {
      x: r.x + 40, y: r.y + 12, left: r.left + 40, top: r.top + 12,
      width: r.width, height: r.height, right: r.right + 40, bottom: r.bottom + 12, toJSON: () => ({}),
    } as DOMRect;
  };
  live.push(rt);
  return rt;
}

/** Bit pattern of a Float32Array (bit-identical comparison, NaN-safe). */
function bits(view: Float32Array): number[] {
  return Array.from(new Uint32Array(view.slice().buffer));
}

const live: FluidRuntime[] = [];

describe("W65 runtime frame scheduling through FrameClock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const rt of live.splice(0)) rt.destroy();
    document.body.replaceChildren();
  });

  it("given_two_runtimes_same_seed_manual_clock_when_advanced_120_frames_then_dynamic_views_identical", async () => {
    const clockA = createManualClock(0);
    const clockB = createManualClock(0);
    const a = await start(42, clockA);
    const b = await start(42, clockB);
    const before = bits(a.bridge.dynamicView());
    clockA.advance(120);
    clockB.advance(120);
    expect(bits(a.bridge.dynamicView()), "advancing must change the state").not.toEqual(before);
    const va = a.bridge.dynamicView();
    const vb = b.bridge.dynamicView();
    expect(va.length).toBe(PARTICLES * DYNAMIC_FIELDS);
    expect(va.some((v) => v !== 0)).toBe(true);
    expect(Array.from(va).every(Number.isFinite)).toBe(true);
    expect(bits(va)).toEqual(bits(vb));
  });

  it("given_two_runtimes_different_seeds_manual_clock_when_advanced_then_dynamic_views_differ", async () => {
    const clockA = createManualClock(0);
    const clockB = createManualClock(0);
    const a = await start(1, clockA);
    const b = await start(2, clockB);
    clockA.advance(10);
    clockB.advance(10);
    expect(bits(a.bridge.dynamicView())).not.toEqual(bits(b.bridge.dynamicView()));
  });

  it("given_manual_clock_at_one_sixtieth_when_frames_run_then_tick_returns_one_step_each", async () => {
    const clock = createManualClock(0);
    const log: number[] = [];
    await start(7, clock, log);
    clock.advance(10);
    expect(log).toHaveLength(10);
    // The first frame may have no previous timestamp (raw dt 0); every following one is exactly one fixed step.
    expect([0, 1]).toContain(log[0]);
    expect(log.slice(1)).toEqual(Array(9).fill(1));
  });

  it("given_clock_option_when_runtime_runs_then_requestAnimationFrame_is_never_called", async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const clock = createManualClock(0);
    const log: number[] = [];
    await start(7, clock, log);
    clock.advance(5);
    expect(log).toHaveLength(5);
    expect(raf).not.toHaveBeenCalled();
  });

  it("given_manual_clock_without_advance_when_real_time_passes_then_no_frame_runs", async () => {
    const clock = createManualClock(0);
    const log: number[] = [];
    await start(7, clock, log);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual([]);
  });
});
