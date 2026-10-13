/**
 * @vitest-environment jsdom
 * W80 in the runtime (D80-1, D80-2): the scroll tracker wired through createFluidRuntime. The
 * frame order is applyDomChanges → scroll sample → dragTracker.frame → registry.sync →
 * core.scroll_shift → core.tick; scroll_shift is called only when something scrolled; reduced
 * motion and a resumed loop add no inertia; a live drag keeps its liquid under the pointer; a
 * scrolled container keeps the canvas on its window. jsdom does not scroll, so the tests set
 * window.scrollY and the container's scrollTop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime, type FluidRuntimeOptions } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { ElementRegistry } from "../src/element-registry";
import { ELEMENT_STRIDE, El, Interaction } from "../src/fluid-layout";
import { SCROLL_INERTIA, SCROLL_INERTIA_MAX_PX_S } from "../src/scroll-tracker";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv } from "./_facade-helpers";
import { createTestBackend, type TestBackend } from "./_fluid-test-backend";
import { installFakeGpuLifecycle } from "./_fake-gpu";

let fake2d: FakeCanvasHandle;
const live: FluidRuntime[] = [];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const setScroll = (x: number, y: number): void => {
  Object.defineProperty(window, "scrollX", { configurable: true, writable: true, value: x });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: y });
};

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  setScroll(0, 0);
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  setScroll(0, 0);
  fake2d.restore();
  vi.restoreAllMocks();
});

interface Started {
  rt: FluidRuntime;
  clock: ManualClock;
  backend: TestBackend;
  /** "sync", "tick" and "scroll_shift:dx:dy:ivx:ivy" in call order. */
  order: string[];
}

async function start(extra: Partial<FluidRuntimeOptions> = {}): Promise<Started> {
  const order: string[] = [];
  const backend = createTestBackend({ onCall: (n) => (n === "tick" || n.startsWith("scroll_shift")) && order.push(n) });
  const sync = ElementRegistry.prototype.sync;
  vi.spyOn(ElementRegistry.prototype, "sync").mockImplementation(function (this: ElementRegistry) {
    order.push("sync");
    return sync.call(this);
  });
  const clock = createManualClock();
  const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: backend, clock, ...extra });
  live.push(rt);
  return { rt, clock, backend, order };
}

/** "Merge" (734, 260, 140×48) with pointer-capture stand-ins (jsdom has none). */
function button(parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement("button");
  el.textContent = "Merge";
  mockRect(el, 734, 260, 140, 48);
  let held: number | null = null;
  Object.assign(el, {
    setPointerCapture: (id: number) => {
      held = id;
    },
    releasePointerCapture: (id: number) => {
      if (held === id) held = null;
    },
    hasPointerCapture: (id: number) => held === id,
  });
  parent.appendChild(el);
  return el;
}

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;

function slots(rt: FluidRuntime, id: number): number[] {
  const v = rt.bridge.elementView();
  const o = id * ELEMENT_STRIDE;
  return [v[o + El.INTERACTION], v[o + El.HOME_DX], v[o + El.HOME_DY]];
}

const shifts = (order: string[]): string[] => order.filter((n) => n.startsWith("scroll_shift"));
/** The numbers of a recorded `scroll_shift:dx:dy:ivx:ivy` (the capped inertia is compared numerically). */
const args = (name: string): number[] => name.split(":").slice(1).map(Number);

describe("W80 runtime: scroll follows (D80-1, D80-2)", () => {
  // 1
  it("given_body_mode_when_the_window_scrolls_30_px_between_frames_then_scroll_shift_gets_the_delta_and_inertia_after_sync_and_before_tick", async () => {
    const { rt, clock, order } = await start();
    rt.observe(button());
    await flush();
    clock.advance(1);
    order.length = 0;
    setScroll(0, 30);
    clock.advance(1);
    expect(order.map((n) => n.split(":")[0])).toEqual(["sync", "scroll_shift", "tick"]);
    const [dx, dy, ivx, ivy] = args(order[1]);
    expect([dx, dy, ivx]).toEqual([0, 30, 0]);
    expect(ivy, "36 px/s uncapped; the cap per 1/60 s bites (D80-2)").toBeCloseTo(Math.min(30 * 60 * SCROLL_INERTIA, SCROLL_INERTIA_MAX_PX_S), 6);
  });

  // 2
  it("given_no_scroll_when_frames_run_then_scroll_shift_is_never_called", async () => {
    const { rt, clock, order } = await start();
    rt.observe(button());
    await flush();
    clock.advance(30);
    expect(shifts(order), "an idle page never calls the core (bit-identical to W79)").toEqual([]);
    expect(order.slice(-2)).toEqual(["sync", "tick"]);
  });

  // 3
  it("given_reduced_motion_when_the_page_scrolls_then_scroll_shift_gets_the_delta_with_zero_inertia", async () => {
    const { rt, clock, order } = await start({ forceReducedMotion: true });
    rt.observe(button());
    await flush();
    clock.advance(1);
    setScroll(0, 12);
    clock.advance(1);
    expect(shifts(order)).toEqual(["scroll_shift:0:12:0:0"]);
  });

  // 4
  it("given_a_mouse_drag_when_the_page_scrolls_40_px_then_slots_6_7_grow_by_40_in_that_frame_and_the_release_zeroes_them", async () => {
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: 804, clientY: 284 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: 804, clientY: 254 }));
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.DRAGGED, 0, -30]);
    setScroll(0, 40);
    clock.advance(1);
    expect(slots(rt, id), "the dragged liquid stays under the pointer (D80-1)").toEqual([Interaction.DRAGGED, 0, 10]);
    el.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0, clientX: 804, clientY: 254 }));
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.IDLE, 0, 0]);
  });

  // 5
  it("given_container_mode_when_the_container_scrolls_then_scroll_shift_gets_the_container_delta_and_the_canvas_sits_on_its_visible_window", async () => {
    const box = document.createElement("div");
    box.style.position = "relative";
    let top = 0;
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top });
    Object.defineProperty(box, "scrollLeft", { configurable: true, get: () => 0 });
    document.body.appendChild(box);
    const { rt, clock, order } = await start({ container: box });
    rt.observe(button(box));
    await flush();
    clock.advance(1);
    top = 90;
    setScroll(0, 500); // the page scrolls too: a container's liquid ignores it
    clock.advance(1);
    expect(shifts(order)).toHaveLength(1);
    const [dx, dy, ivx, ivy] = args(shifts(order)[0]);
    expect([dx, dy, ivx]).toEqual([0, 90, 0]);
    expect(ivy, "108 px/s uncapped; the cap per 1/60 s bites (D80-2)").toBeCloseTo(Math.min(90 * 60 * SCROLL_INERTIA, SCROLL_INERTIA_MAX_PX_S), 6);
    expect(rt.canvas.style.transform).toBe("translate(0px, 90px)");
    expect(rt.canvas.parentElement).toBe(box);
  });

  // 6
  it("given_the_loop_paused_while_the_page_scrolls_when_resumed_then_the_first_frame_shifts_by_the_whole_delta_with_zero_inertia", async () => {
    const { rt, clock, order } = await start();
    rt.observe(button());
    await flush();
    clock.advance(1);
    rt.pause();
    setScroll(0, 2000);
    clock.advance(3);
    expect(shifts(order), "no frames while paused").toEqual([]);
    rt.resume();
    clock.advance(1);
    expect(shifts(order), "W80 RF2: no delta is lost, no slosh on resume").toEqual(["scroll_shift:0:2000:0:0"]);
  });

  // 51 (W80.1 fix round 1, review I2)
  it("given_container_mode_when_the_canvas_is_remounted_by_a_device_loss_then_the_new_canvas_carries_the_container_transform_and_no_scroll_shift_replays", async () => {
    const gpu = installFakeGpuLifecycle(); // after the fake 2d, so it wraps it (device-lost.test.ts)
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const box = document.createElement("div");
      box.style.position = "relative";
      let top = 0;
      Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top });
      Object.defineProperty(box, "scrollLeft", { configurable: true, get: () => 0 });
      document.body.appendChild(box);
      const { rt, clock, order } = await start({ container: box, renderer: "webgpu" });
      rt.observe(button(box));
      await flush();
      clock.advance(1);
      top = 90;
      clock.advance(1);
      expect(shifts(order), "the container scroll shifted once").toHaveLength(1);
      expect(rt.canvas.style.transform).toBe("translate(0px, 90px)");
      const old = rt.canvas;
      expect(rt.activeRenderer).toBe("webgpu");
      await rt.simulateDeviceLoss();
      await flush();
      expect(rt.activeRenderer).toBe("canvas2d");
      expect(rt.canvas, "remounted").not.toBe(old);
      clock.advance(2);
      expect(rt.canvas.style.transform, "D80-1: the remount keeps the delta and re-applies the transform").toBe("translate(0px, 90px)");
      expect(shifts(order), "an unchanged scroll replays nothing and loses nothing").toHaveLength(1);
      top = 100;
      clock.advance(1);
      expect(args(shifts(order)[1]).slice(0, 2), "the next scroll is measured from 90").toEqual([0, 10]);
    } finally {
      gpu.restore();
    }
  });

  // 52 (W80.5, W80.3 review m1)
  it("given_container_mode_and_a_paused_loop_when_a_device_loss_remounts_the_canvas_then_the_new_canvas_carries_the_current_transform", async () => {
    const gpu = installFakeGpuLifecycle();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const box = document.createElement("div");
      box.style.position = "relative";
      let top = 0;
      Object.defineProperty(box, "scrollTop", { configurable: true, get: () => top });
      Object.defineProperty(box, "scrollLeft", { configurable: true, get: () => 0 });
      document.body.appendChild(box);
      const { rt, clock } = await start({ container: box, renderer: "webgpu" });
      rt.observe(button(box));
      await flush();
      clock.advance(1);
      top = 90;
      clock.advance(1);
      rt.pause();
      const old = rt.canvas;
      await rt.simulateDeviceLoss();
      await flush();
      expect(rt.activeRenderer).toBe("canvas2d");
      expect(rt.canvas, "remounted").not.toBe(old);
      expect(rt.canvas.style.transform, "no frame has run: the rebuild itself places the canvas").toBe("translate(0px, 90px)");
    } finally {
      gpu.restore();
    }
  });

  // 53 (W80.5, W80.3 review m3)
  it("given_a_scrolled_container_when_it_is_detached_and_reattached_at_the_same_scroll_then_neither_frame_shifts_the_liquid", async () => {
    const box = document.createElement("div");
    box.style.position = "relative";
    let top = 90;
    // A detached element reports scrollTop 0 (jsdom does not scroll, so the stand-in does).
    Object.defineProperty(box, "scrollTop", { configurable: true, get: () => (box.isConnected ? top : 0) });
    Object.defineProperty(box, "scrollLeft", { configurable: true, get: () => 0 });
    document.body.appendChild(box);
    const { rt, clock, order } = await start({ container: box });
    rt.observe(button(box));
    await flush();
    clock.advance(1);
    clock.advance(1);
    expect(shifts(order), "a steady scroll of 90 shifts nothing").toEqual([]);
    box.remove();
    clock.advance(1);
    expect(shifts(order), "the detach frame reads scrollTop 0: unusable, not a −90 scroll").toEqual([]);
    document.body.appendChild(box);
    clock.advance(1);
    expect(shifts(order), "reattached at 90: Δ 0 from the last good position").toEqual([]);
  });
});
