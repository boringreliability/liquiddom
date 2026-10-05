/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PointerTracker,
  POINTER_IDLE_DECAY,
  POINTER_IDLE_MS,
  POINTER_MIN_DT_S,
  POINTER_SMOOTHING,
} from "../src/pointer-tracker";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock } from "../src/clock";
import { createTestBackend } from "./_fluid-test-backend";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const FRAME_MS = 1000 / 60;
const ORIGIN = { x: 0, y: 0 };

function stubRect(el: Element, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
}

function move(target: EventTarget, clientX: number, clientY: number, pointerType = "mouse"): void {
  target.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, pointerType, bubbles: true }));
}

describe("PointerTracker (W68, D68-4, D68-7)", () => {
  it("given_constants_when_read_then_match_D68_4", () => {
    expect(POINTER_SMOOTHING).toBe(0.5);
    expect(POINTER_IDLE_MS).toBe(120);
    expect(POINTER_IDLE_DECAY).toBe(0.8);
    expect(POINTER_MIN_DT_S).toBe(1 / 240);
  });

  it("given_two_samples_at_the_same_timestamp_when_moved_then_dt_floored_at_1_240_s", () => {
    const t = new PointerTracker();
    t.move(100, 0);
    t.sample(1000, ORIGIN);
    t.move(110, 0);
    expect(t.sample(1000, ORIGIN).vx).toBeCloseTo(1200, 6); // 0.5 · 10 px / (1/240 s)
  });

  it("given_velocity_built_up_when_blur_cancel_or_touch_up_then_next_move_first_sample_has_zero_velocity", () => {
    const t = new PointerTracker();
    const detach = t.attach(document, window);
    let now = 1000;
    const next = () => t.sample((now += FRAME_MS), ORIGIN);
    const fire: Array<[string, () => void]> = [
      ["blur", () => window.dispatchEvent(new Event("blur"))],
      ["pointercancel", () => document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }))],
      ["touch pointerup", () => document.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }))],
    ];
    let x = 100;
    for (const [name, end] of fire) {
      move(document, (x += 10), 0, "touch");
      next();
      move(document, (x += 10), 0, "touch");
      expect(next().vx, `${name}: velocity built`).toBeCloseTo(300, 6);
      end();
      expect(next().active, `${name}: inactive`).toBe(false);
      move(document, (x += 10), 0, "touch");
      expect(next(), `${name}: re-entry`).toMatchObject({ vx: 0, vy: 0, active: true });
    }
    detach();
  });

  it("given_no_pointer_events_when_sampled_then_inactive_and_zero_velocity", () => {
    const t = new PointerTracker();
    expect(t.sample(1000, ORIGIN)).toEqual({ x: 0, y: 0, vx: 0, vy: 0, active: false });
  });

  it("given_pointermove_events_one_frame_apart_when_sampled_then_buffer_space_position_and_smoothed_velocity", () => {
    const t = new PointerTracker();
    t.move(100, 50);
    expect(t.sample(1000, ORIGIN)).toEqual({ x: 100, y: 50, vx: 0, vy: 0, active: true });
    t.move(110, 50);
    const s1 = t.sample(1000 + FRAME_MS, ORIGIN);
    expect(s1.x).toBe(110);
    expect(s1.vx).toBeCloseTo(300, 6); // 0.5·0 + 0.5·600 px/s
    expect(s1.vy).toBe(0);
    t.move(120, 50);
    expect(t.sample(1000 + 2 * FRAME_MS, ORIGIN).vx).toBeCloseTo(450, 6); // 0.5·300 + 0.5·600
  });

  it("given_several_moves_within_one_frame_when_sampled_then_velocity_uses_net_displacement_over_frame_dt", () => {
    const t = new PointerTracker();
    t.move(100, 0);
    t.sample(1000, ORIGIN);
    t.move(103, 0);
    t.move(106, 0);
    t.move(110, 0);
    expect(t.sample(1000 + FRAME_MS, ORIGIN).vx).toBeCloseTo(300, 6);
  });

  it("given_container_offset_when_sampled_then_position_is_client_minus_offset", () => {
    const t = new PointerTracker();
    t.move(300, 200);
    const s = t.sample(1000, { x: 100, y: 50 });
    expect([s.x, s.y]).toEqual([200, 150]);
  });

  it("given_no_move_for_less_than_120ms_when_sampled_then_velocity_held_and_then_decays_by_0_8_per_frame", () => {
    const t = new PointerTracker();
    t.move(100, 0);
    t.sample(1000, ORIGIN);
    t.move(110, 0);
    t.sample(1000 + FRAME_MS, ORIGIN);
    t.move(120, 0);
    const t2 = 1000 + 2 * FRAME_MS;
    expect(t.sample(t2, ORIGIN).vx).toBeCloseTo(450, 6);
    for (let k = 1; k <= 7; k++) {
      expect(t.sample(t2 + k * FRAME_MS, ORIGIN).vx).toBeCloseTo(450, 6); // ≤ 116.7 ms: held
    }
    expect(t.sample(t2 + 8 * FRAME_MS, ORIGIN).vx).toBeCloseTo(360, 6); // 133 ms > 120 ms
    expect(t.sample(t2 + 9 * FRAME_MS, ORIGIN).vx).toBeCloseTo(288, 6);
  });

  it("given_leave_when_sampled_then_inactive_and_next_move_starts_from_zero_velocity", () => {
    const t = new PointerTracker();
    t.move(100, 0);
    t.sample(1000, ORIGIN);
    t.move(110, 0);
    t.sample(1000 + FRAME_MS, ORIGIN);
    t.leave();
    expect(t.sample(1000 + 2 * FRAME_MS, ORIGIN)).toEqual({ x: 0, y: 0, vx: 0, vy: 0, active: false });
    t.move(500, 0);
    const s = t.sample(1000 + 3 * FRAME_MS, ORIGIN);
    expect(s).toEqual({ x: 500, y: 0, vx: 0, vy: 0, active: true });
  });

  it("given_nonfinite_coordinates_when_moved_then_ignored", () => {
    const t = new PointerTracker();
    t.move(Number.NaN, 5);
    t.move(5, Number.POSITIVE_INFINITY);
    expect(t.sample(1000, ORIGIN).active).toBe(false);
  });

  it("given_attached_to_document_when_pointer_events_dispatched_then_tracker_follows_and_detach_removes_listeners", () => {
    const t = new PointerTracker();
    const detach = t.attach(document, window);
    let now = 1000;
    const next = () => t.sample((now += FRAME_MS), ORIGIN);

    move(document, 40, 30);
    expect(next()).toMatchObject({ x: 40, y: 30, active: true });
    // Moving between elements: pointerout with a non-null relatedTarget keeps the field on.
    document.body.dispatchEvent(new PointerEvent("pointerout", { relatedTarget: document.documentElement, bubbles: true }));
    expect(next()).toMatchObject({ x: 40, active: true });
    // Leaving the window: pointerout with relatedTarget null switches it off (D68-7 ruling).
    document.body.dispatchEvent(new PointerEvent("pointerout", { relatedTarget: null, bubbles: true }));
    expect(next().active).toBe(false);

    move(document, 41, 30);
    expect(next().active).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(next().active).toBe(false);

    move(document, 42, 30);
    next();
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(next().active).toBe(false);

    move(document, 43, 30, "touch");
    next();
    document.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
    expect(next().active).toBe(false);

    move(document, 44, 30);
    next();
    document.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", bubbles: true }));
    expect(next()).toMatchObject({ x: 44, active: true });

    detach();
    move(document, 99, 30);
    expect(next().x).toBe(44);
  });
});

describe("runtime pointer wiring (W68)", () => {
  let fake: FakeCanvasHandle | null = null;
  let runtime: FluidRuntime | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    fake = installFakeCanvas2D();
  });

  afterEach(() => {
    runtime?.destroy();
    runtime = null;
    fake?.restore(); // W64: installFakeCanvas2D() returns a FakeCanvasHandle
    fake = null;
    vi.restoreAllMocks();
  });

  async function start(extra: Record<string, unknown> = {}) {
    const backend = createTestBackend();
    const tick = vi.spyOn(backend.FluidCore.prototype, "tick");
    const clock = createManualClock(1000);
    runtime = await createFluidRuntime({
      particles: 256,
      maxElements: 4,
      seed: 1,
      testBackend: backend,
      clock,
      ...extra,
    } as Parameters<typeof createFluidRuntime>[0]);
    const el = document.createElement("div");
    stubRect(el, 100, 100, 140, 48);
    (extra.container instanceof HTMLElement ? extra.container : document.body).appendChild(el);
    runtime.observe(el);
    clock.advance(1); // warm-up frame
    return { tick, clock };
  }

  function lastPointer(tick: { mock: { calls: unknown[][] } }) {
    const args = tick.mock.calls.at(-1);
    if (!args) throw new Error("tick was never called");
    return { px: args[1], py: args[2], pvx: args[3], pvy: args[4], active: args[5] };
  }

  it("given_pointermove_events_when_sampled_then_buffer_space_position_and_smoothed_velocity_passed_to_tick", async () => {
    const { tick, clock } = await start();
    move(document, 100, 50);
    clock.advance(1);
    expect(lastPointer(tick)).toEqual({ px: 100, py: 50, pvx: 0, pvy: 0, active: true });
    move(document, 110, 50);
    clock.advance(1);
    const p = lastPointer(tick);
    expect(p.px).toBe(110);
    expect(p.pvx as number).toBeCloseTo(300, 3);
    expect(p.active).toBe(true);
  });

  it("given_container_mode_when_sampled_then_pointer_container_relative", async () => {
    const container = document.createElement("div");
    stubRect(container, 100, 40, 800, 600);
    document.body.appendChild(container);
    const { tick, clock } = await start({ container });
    move(document, 300, 140);
    clock.advance(1);
    expect(lastPointer(tick)).toMatchObject({ px: 200, py: 100, active: true });
  });

  it("given_pointer_left_the_window_when_ticking_then_pointer_active_false", async () => {
    const { tick, clock } = await start();
    move(document, 100, 50);
    clock.advance(1);
    move(document, 110, 50);
    clock.advance(1);
    const before = lastPointer(tick);
    expect(before.active).toBe(true);
    expect(before.pvx as number).toBeCloseTo(300, 3);
    // moving between elements (non-null relatedTarget) must not deactivate
    document.body.dispatchEvent(new PointerEvent("pointerout", { relatedTarget: document.documentElement, bubbles: true }));
    clock.advance(1);
    expect(lastPointer(tick).active).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerout", { relatedTarget: null, bubbles: true }));
    clock.advance(1);
    expect(lastPointer(tick)).toEqual({ px: 0, py: 0, pvx: 0, pvy: 0, active: false });
  });

  // GUARD (passes at red: W67 never sends an active pointer). The paired RM off/on live flip is in reduced-motion-input.test.ts.
  it("given_reduced_motion_when_ticking_then_pointer_active_false", async () => {
    const { tick, clock } = await start({ forceReducedMotion: true });
    move(document, 100, 50);
    clock.advance(1);
    move(document, 120, 50);
    clock.advance(1);
    expect(lastPointer(tick)).toEqual({ px: 0, py: 0, pvx: 0, pvy: 0, active: false });
  });

  it("given_runtime_destroyed_when_inspected_then_document_and_window_pointer_listeners_removed", async () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    await start();
    runtime!.destroy();
    runtime = null;
    const check = (
      add: { mock: { calls: unknown[][] } },
      remove: { mock: { calls: unknown[][] } },
      types: string[],
    ) => {
      for (const type of types) {
        const added = add.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
        const removed = remove.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
        expect(added.length, `${type} listener attached`).toBeGreaterThan(0);
        for (const h of added) expect(removed, `${type} listener removed`).toContain(h);
      }
    };
    check(docAdd, docRemove, ["pointermove", "pointerout", "pointercancel", "pointerup"]);
    check(winAdd, winRemove, ["blur"]);
  });
});
