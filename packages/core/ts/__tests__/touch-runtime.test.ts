/**
 * @vitest-environment jsdom
 * W84 in the runtime (D84-1, D84-2, D84-5): a touch long-press through createFluidRuntime writes
 * DRAGGED and the finger's offset into slots 5–7, its touchmoves are prevented while it is live,
 * the click ending it is swallowed and a tap still splashes; `observe(el, { drag: false })` keeps
 * slots 5–7 idle for mouse and touch, captured once; destroy, unobserve and reduced motion during a
 * pending press leave no timer. Fake timers start after the runtime is up (the long-press is a real
 * setTimeout); jsdom has no pointer capture (drag-runtime.test.ts stand-ins).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { LONG_PRESS_MS } from "../src/drag-tracker";
import { ELEMENT_STRIDE, El, Interaction } from "../src/fluid-layout";
import { DRAG_ATTR } from "../src/stylesheet";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend, type SpyBackend } from "./_facade-helpers";
import { movingBackend } from "./_moving-backend";

let fake2d: FakeCanvasHandle;
const live: FluidRuntime[] = [];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
});
afterEach(() => {
  vi.useRealTimers();
  for (const rt of live.splice(0)) rt.destroy();
  fake2d.restore();
  vi.restoreAllMocks();
});

async function start(): Promise<{ rt: FluidRuntime; clock: ManualClock; sb: SpyBackend }> {
  const sb = spyBackend(movingBackend().backend);
  const clock = createManualClock();
  const rt = await createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, testBackend: sb.backend, clock, renderer: "canvas2d" });
  live.push(rt);
  return { rt, clock, sb };
}

/** The acceptance scene's "Merge" (734, 260, 140×48) with pointer-capture stand-ins. */
function button(): HTMLElement {
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
  document.body.appendChild(el);
  return el;
}

const TOUCH = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true } as const;
const MOUSE = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;
const pointer = (el: HTMLElement, type: string, x: number, y: number, init: PointerEventInit): void => {
  el.dispatchEvent(new PointerEvent(type, { ...init, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
};
const clickAt = (el: HTMLElement, x: number, y: number): void => {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }));
};
const cancelable = (el: HTMLElement, type: string): boolean => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
};

function slots(rt: FluidRuntime, id: number): number[] {
  const v = rt.bridge.elementView();
  const o = id * ELEMENT_STRIDE;
  return [v[o + El.INTERACTION], v[o + El.HOME_DX], v[o + El.HOME_DY]];
}
const splashes = (sb: SpyBackend): number => sb.calls.filter((c) => c.method === "splash").length;

type Listener = (e: { matches: boolean }) => void;

/** Reduced-motion media query stub (drag-runtime.test.ts pattern). */
function stubReducedMotionMedia(): { fire(matches: boolean): void; restore(): void } {
  const listeners = new Set<Listener>();
  const rm = {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  const other = { ...rm, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((q: string) => (q.includes("prefers-reduced-motion") ? rm : { ...other, media: q })),
  });
  return {
    fire(matches: boolean) {
      rm.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
    restore() {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original });
    },
  };
}

describe("W84 runtime: touch and opt-out (D84-1, D84-2, D84-5)", () => {
  // 22
  it("given_a_touch_long_press_on_an_observed_element_when_frames_run_then_slots_5_7_carry_dragged_and_the_finger_offset_its_touchmoves_are_prevented_and_the_release_swallows_the_click", async () => {
    const { rt, clock, sb } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    vi.useFakeTimers();
    pointer(el, "pointerdown", 804, 284, TOUCH);
    clock.advance(1);
    expect(slots(rt, id), "pending: not a drag yet").toEqual([Interaction.IDLE, 0, 0]);
    expect(cancelable(el, "touchmove"), "pending: the browser may still scroll").toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.DRAGGED, 0, 0]);
    expect(cancelable(el, "touchmove"), "a live touch drag keeps the page still").toBe(true);
    expect(cancelable(el, "contextmenu"), "no long-press menu (D84-5)").toBe(true);
    pointer(el, "pointermove", 804, 164, TOUCH);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.DRAGGED, 0, -120]);
    pointer(el, "pointerup", 804, 164, TOUCH);
    clickAt(el, 804, 164);
    expect(splashes(sb), "the click ending a touch drag is swallowed").toBe(0);
    clock.advance(1);
    expect(slots(rt, id), "released: idle in the next frame").toEqual([Interaction.IDLE, 0, 0]);
  });

  // 23
  it("given_a_touch_tap_when_released_before_350_ms_then_its_click_splashes_once_and_no_slot_changes", async () => {
    const { rt, clock, sb } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    vi.useFakeTimers();
    pointer(el, "pointerdown", 804, 284, TOUCH);
    vi.advanceTimersByTime(80);
    pointer(el, "pointerup", 804, 284, TOUCH);
    clickAt(el, 804, 284);
    expect(splashes(sb), "a tap is a click (D84-1)").toBe(1);
    vi.advanceTimersByTime(1000);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.IDLE, 0, 0]);
  });

  // 24
  it("given_observe_with_drag_false_when_pressed_by_mouse_or_touch_then_slots_stay_idle_the_click_splashes_the_menu_stays_and_a_later_observe_cannot_change_it", async () => {
    const { rt, clock, sb } = await start();
    const el = button();
    const id = rt.observe(el, { drag: false });
    expect(rt.observe(el, { drag: true }), "captured once, like viscosity").toBe(id);
    expect(el.getAttribute(DRAG_ATTR), "the callout rule skips it (D84-5)").toBe("off");
    await flush();
    vi.useFakeTimers();
    pointer(el, "pointerdown", 804, 284, MOUSE);
    pointer(el, "pointermove", 804, 224, MOUSE);
    clock.advance(1);
    expect(slots(rt, id), "no mouse drag").toEqual([Interaction.IDLE, 0, 0]);
    pointer(el, "pointerup", 804, 224, MOUSE);
    clickAt(el, 804, 224);
    expect(splashes(sb), "its click is a click").toBe(1);
    pointer(el, "pointerdown", 804, 284, TOUCH);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    clock.advance(1);
    expect(slots(rt, id), "no touch drag").toEqual([Interaction.IDLE, 0, 0]);
    expect(cancelable(el, "touchmove"), "the browser scrolls").toBe(false);
    expect(cancelable(el, "contextmenu"), "the browser's long-press menu stays").toBe(false);
    pointer(el, "pointerup", 804, 284, TOUCH);
  });

  // 25 (W84 Review Focus 1)
  it("given_a_pending_touch_press_when_the_instance_is_destroyed_the_element_is_unobserved_or_reduced_motion_switches_on_then_no_timer_is_left_and_no_frame_drags", async () => {
    for (const how of ["destroy", "unobserve", "reduced motion"] as const) {
      const media = stubReducedMotionMedia();
      try {
        const { rt, clock } = await start();
        const el = button();
        const id = rt.observe(el);
        await flush();
        vi.useFakeTimers();
        pointer(el, "pointerdown", 804, 284, TOUCH);
        expect(vi.getTimerCount(), `${how}: the long-press timer runs`).toBe(1);
        if (how === "destroy") rt.destroy();
        else if (how === "unobserve") rt.unobserve(el);
        else media.fire(true);
        expect(vi.getTimerCount(), `${how}: no timer survives`).toBe(0);
        vi.advanceTimersByTime(1000);
        if (how === "reduced motion") {
          clock.advance(1);
          expect(slots(rt, id), how).toEqual([Interaction.IDLE, 0, 0]);
        }
        if (how !== "destroy") expect(cancelable(el, "touchmove"), `${how}: no drag keeps the page still`).toBe(false);
        vi.useRealTimers();
        el.remove();
      } finally {
        media.restore();
      }
    }
  });
});
