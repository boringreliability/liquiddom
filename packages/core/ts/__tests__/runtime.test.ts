/**
 * W64: the internal runtime (D64-8): loop order, reduced motion + listener
 * (D64-6, C5), resize/DPR (D64-14, C2), area hint and margin (B5, B15), the
 * frame it renders (D64-17: B3, B12), destroy, and loud failure on a null 2d
 * context (D64-5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementRegistry } from "../src/element-registry";
import { FluidBridge } from "../src/fluid-bridge";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import type { RenderFrame } from "../src/renderers/frame";
import { createFluidRuntime, LIQUID_CANVAS_CLASS, type FluidRuntime, type FluidRuntimeOptions } from "../src/runtime";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { createTestBackend, type TestBackend } from "./_fluid-test-backend";

interface FakeMql {
  matches: boolean;
  listeners: Set<(e: { matches: boolean }) => void>;
  addEventListener(type: string, l: (e: { matches: boolean }) => void): void;
  removeEventListener(type: string, l: (e: { matches: boolean }) => void): void;
  fire(matches: boolean): void;
}

function installMatchMedia(matches: boolean): FakeMql {
  const mql: FakeMql = {
    matches,
    listeners: new Set(),
    addEventListener: (_t, l) => mql.listeners.add(l),
    removeEventListener: (_t, l) => mql.listeners.delete(l),
    fire(m) {
      mql.matches = m;
      for (const l of [...mql.listeners]) l({ matches: m });
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) =>
      q.includes("prefers-reduced-motion") ? mql : { matches: false, addEventListener() {}, removeEventListener() {} },
    ),
  );
  return mql;
}

function addElement(x: number, y: number, w: number, h: number, radius = "8px"): HTMLElement {
  const el = document.createElement("div");
  el.style.backgroundColor = "rgb(47, 111, 222)";
  el.style.borderRadius = radius;
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const setWindow = (key: string, value: number) => Object.defineProperty(window, key, { value, configurable: true });

let fake: FakeCanvasHandle;
const created: FluidRuntime[] = [];

async function create(extra: Partial<FluidRuntimeOptions> = {}, backend: TestBackend = createTestBackend()) {
  const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, ...extra });
  created.push(rt);
  return { rt, backend };
}

beforeEach(() => {
  fake = installFakeCanvas2D();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  for (const rt of created.splice(0)) rt.destroy();
  fake.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setWindow("innerWidth", 1024);
  setWindow("innerHeight", 768);
  setWindow("devicePixelRatio", 1);
  document.body.replaceChildren();
});

describe("W64 fluid runtime", () => {
  it("given_testBackend_when_frame_runs_then_order_is_sync_tick_syncGeneration_render", async () => {
    const order: string[] = [];
    const wrap = (proto: object, name: string) => {
      const target = proto as Record<string, (...args: unknown[]) => unknown>;
      const original = target[name];
      vi.spyOn(target, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
        order.push(name);
        return original.apply(this, args);
      });
    };
    wrap(ElementRegistry.prototype, "sync");
    wrap(FluidBridge.prototype, "syncGeneration");
    wrap(FluidCanvas2DRenderer.prototype, "render");
    const backend = createTestBackend({ onCall: (n) => n === "tick" && order.push("tick") });
    const { rt } = await create({}, backend);
    rt.observe(addElement(10, 10, 100, 40));
    await flushMicrotasks();
    order.length = 0;
    rt.frame(16);
    expect(order).toEqual(["sync", "tick", "syncGeneration", "render"]);
  });

  it("given_prefers_reduced_motion_when_created_then_set_reduced_motion_true_and_change_listener_attached", async () => {
    const mql = installMatchMedia(true);
    const { rt, backend } = await create();
    expect(backend.calls).toContain("set_reduced_motion:true");
    expect(rt.reducedMotion).toBe(true);
    expect(mql.listeners.size).toBe(1);
  });

  it("given_reduced_motion_media_change_when_fired_then_set_reduced_motion_follows", async () => {
    const mql = installMatchMedia(false);
    const { rt, backend } = await create();
    expect(backend.calls.at(-1)).toBe("set_reduced_motion:false");
    mql.fire(true);
    expect(backend.calls.at(-1)).toBe("set_reduced_motion:true");
    expect(rt.reducedMotion).toBe(true);
    mql.fire(false);
    expect(backend.calls.at(-1)).toBe("set_reduced_motion:false");
    expect(rt.reducedMotion).toBe(false);
  });

  it("given_forceReducedMotion_when_media_changes_then_ignored", async () => {
    const mql = installMatchMedia(false);
    const { rt, backend } = await create({ forceReducedMotion: true });
    expect(backend.calls).toContain("set_reduced_motion:true");
    const before = backend.calls.length;
    mql.fire(false);
    expect(backend.calls.length).toBe(before);
    expect(rt.reducedMotion).toBe(true);
  });

  it("given_runtime_when_destroyed_then_core_freed_canvas_removed_listeners_detached_and_idempotent", async () => {
    const mql = installMatchMedia(false);
    const { rt, backend } = await create();
    const el = addElement(10, 10, 100, 40);
    rt.observe(el);
    const resize = vi.spyOn(FluidCanvas2DRenderer.prototype, "resize");
    rt.destroy();
    expect(backend.cores[0].freed).toBe(true);
    expect(document.querySelector(`canvas.${LIQUID_CANVAS_CLASS}`)).toBeNull();
    expect(mql.listeners.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    window.dispatchEvent(new Event("resize"));
    expect(resize).not.toHaveBeenCalled();
    rt.destroy();
    expect(backend.calls.filter((c) => c === "free")).toHaveLength(1);
    expect(() => rt.observe(el)).toThrow(/after destroy/);
    expect(() => rt.unobserve(el)).not.toThrow();
    const callsAfterDestroy = backend.calls.length;
    await flushMicrotasks();
    expect(backend.calls.length).toBe(callsAfterDestroy); // no redistribute on a freed core
  });

  it("given_null_2d_context_when_creating_then_rejects", async () => {
    fake.restore();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const backend = createTestBackend();
    await expect(
      createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend }),
    ).rejects.toThrow(/Canvas2D context unavailable/);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(backend.cores[0].freed).toBe(true);
  });

  it("given_core_index_when_imported_then_createFluidRuntime_is_not_exported", async () => {
    const mod = await import("../src/index");
    expect(Object.keys(mod)).not.toContain("createFluidRuntime");
    expect(Object.keys(mod)).not.toContain("FluidBridge");
  });

  it("given_observed_area_over_max_area_when_redistributed_then_console_warn_once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rt } = await create({}, createTestBackend({ maxAreaPx2: 1000 }));
    rt.observe(addElement(0, 0, 100, 100));
    rt.observe(addElement(200, 0, 100, 100));
    await flushMicrotasks();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/particle budget/);
    rt.observe(addElement(400, 0, 100, 100));
    await flushMicrotasks();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("given_window_resize_when_fired_then_canvas_backing_store_and_renderer_resized_with_dpr", async () => {
    setWindow("devicePixelRatio", 2);
    const { rt } = await create();
    expect([rt.canvas.width, rt.canvas.height]).toEqual([2048, 1536]);
    const resize = vi.spyOn(FluidCanvas2DRenderer.prototype, "resize");
    setWindow("innerWidth", 800);
    setWindow("innerHeight", 600);
    window.dispatchEvent(new Event("resize"));
    expect([rt.canvas.width, rt.canvas.height]).toEqual([1600, 1200]);
    expect(resize).toHaveBeenLastCalledWith(1600, 1200, 2);
  });

  it("given_container_mode_when_container_resizes_then_ResizeObserver_resizes_canvas_and_canvas_is_inside_container", async () => {
    let callback: (() => void) | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    const { rt } = await create({ container });
    expect(rt.canvas.parentElement).toBe(container);
    expect(rt.canvas.style.position).toBe("absolute");
    expect(rt.canvas.getAttribute("aria-hidden")).toBe("true");
    expect(rt.canvas.style.pointerEvents).toBe("none");
    expect(rt.canvas.width).toBe(400);
    Object.defineProperty(container, "clientWidth", { value: 500, configurable: true });
    callback!();
    expect(rt.canvas.width).toBe(500);
    rt.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("given_initial_elements_when_created_then_area_hint_and_tallest_height_passed_to_core", async () => {
    const pill = addElement(406, 260, 140, 48, "24px");
    const card = addElement(480, 340, 320, 180, "16px");
    const { backend } = await create({ initialElements: [pill, card], seed: 7 });
    const [particles, maxElements, worldW, worldH, area, tallest, seed] = backend.cores[0].ctorArgs;
    expect([particles, maxElements, seed]).toEqual([256, 4, 7]);
    expect([worldW, worldH]).toEqual([1024, 768]); // max(screen, inner) in jsdom
    const expected = 140 * 48 - (4 - Math.PI) * 24 * 24 + 320 * 180 - (4 - Math.PI) * 16 * 16;
    expect(area).toBeCloseTo(expected, 3);
    expect(tallest).toBe(180);
  });

  it("given_created_runtime_when_inspecting_canvas_then_class_literal_aria_hidden_and_no_pointer_events", async () => {
    expect(LIQUID_CANVAS_CLASS).toBe("liquid-canvas");
    const { rt } = await create();
    expect(rt.canvas.className).toContain("liquid-canvas");
    expect(rt.canvas.getAttribute("aria-hidden")).toBe("true");
    expect(rt.canvas.style.pointerEvents).toBe("none");
  });

  it("given_unobserve_before_the_batched_redistribute_when_frame_runs_then_paint_is_kept_until_the_generation_bump", async () => {
    const render = vi.spyOn(FluidCanvas2DRenderer.prototype, "render");
    const { rt } = await create();
    const el = addElement(10, 10, 100, 40);
    rt.observe(el);
    await flushMicrotasks();
    rt.frame(0);
    expect((render.mock.calls.at(-1)![0] as RenderFrame).paints[0]).toBeDefined();
    rt.unobserve(el);
    rt.frame(16); // same task: the batched redistribute has not run, no generation bump yet
    expect((render.mock.calls.at(-1)![0] as RenderFrame).paints[0]).toBeDefined();
    await flushMicrotasks(); // redistribute runs, generation bumps
    rt.frame(32);
    expect((render.mock.calls.at(-1)![0] as RenderFrame).paints[0]).toBeUndefined();
  });

  it("given_container_mode_when_created_then_exactly_one_ResizeObserver_and_no_window_resize_listener", async () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          constructed();
        }
        observe() {}
        disconnect() {}
      },
    );
    const add = vi.spyOn(window, "addEventListener");
    const container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 300, configurable: true });
    await create({ container });
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.filter(([type]) => type === "resize")).toHaveLength(0);
  });

  it("given_fractional_dpr_when_created_then_backing_store_is_max_1_round_css_times_dpr", async () => {
    setWindow("devicePixelRatio", 1.5);
    setWindow("innerWidth", 801);
    setWindow("innerHeight", 601);
    const { rt } = await create();
    expect([rt.canvas.width, rt.canvas.height]).toEqual([
      Math.max(1, Math.round(801 * 1.5)),
      Math.max(1, Math.round(601 * 1.5)),
    ]);
    expect([rt.canvas.width, rt.canvas.height]).toEqual([1202, 902]);
  });

  it("given_observed_element_when_frame_runs_then_render_frame_carries_capacity_active_count_and_paint_by_slot", async () => {
    const render = vi.spyOn(FluidCanvas2DRenderer.prototype, "render");
    const { rt } = await create();
    const el = addElement(10, 10, 100, 40);
    rt.observe(el);
    await flushMicrotasks();
    rt.frame(0);
    rt.frame(1000 / 60);
    const frame = render.mock.calls.at(-1)![0] as RenderFrame;
    expect(frame.particleCapacity).toBe(256);
    expect(frame.activeParticles).toBe(256);
    expect(frame.paints).toHaveLength(4);
    expect(frame.paints[0]?.background).toEqual([47, 111, 222, 1]);
    expect(frame.paints[0]?.particleCount).toBe(256);
    expect(frame.paints[1]).toBeUndefined();
    expect(frame.viewport).toEqual({ widthCss: 1024, heightCss: 768, dpr: 1 });
    expect(rt.elementState(el)).toEqual({ s: 1, maxDev: 0, restAlpha: 1 });
  });
});
