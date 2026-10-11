/**
 * @vitest-environment jsdom
 * W78 in the runtime (D78-1 … D78-6): the drag tracker, the registry slots, the swallowed click
 * and the Canvas2D label class wired through createFluidRuntime; the cancel paths (unobserve,
 * destroy, reduced motion, Escape, a lost device, a detached element) and a second instance on one
 * element (README Review Focus 4, 5). The test backend does not simulate DRAGGED, so
 * `_moving-backend.ts` holds restAlpha below 1 where the engine would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime, type FluidRuntime } from "../src/runtime";
import { createManualClock, type ManualClock } from "../src/clock";
import { ELEMENT_STRIDE, El, Interaction } from "../src/fluid-layout";
import { AWAY_CLASS, HALO_CLASS, TEXT_CLASS } from "../src/stylesheet";
import { fakeAtlasCanvas, installRangeRects, oneLinePerNode } from "./_fake-atlas";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { mockRect, resetDom, setupFacadeTestEnv, spyBackend, type SpyBackend } from "./_facade-helpers";
import { installFakeGpuLifecycle, type LifecycleGpu } from "./_fake-gpu";
import { movingBackend, type MovingBackend } from "./_moving-backend";

let fake2d: FakeCanvasHandle;
let gpu: LifecycleGpu | null = null;
let restoreRects: () => void = () => {};
const live: FluidRuntime[] = [];
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDom();
  fake2d = installFakeCanvas2D();
  setupFacadeTestEnv();
  // W74's atlas (WebGPU tests) reads line boxes through Range.getClientRects (missing in jsdom).
  restoreRects = installRangeRects(
    oneLinePerNode((node) => {
      const r = (node.parentElement as HTMLElement).getBoundingClientRect();
      return { left: r.left + 20, top: r.top + 12 };
    }),
  );
});
afterEach(() => {
  for (const rt of live.splice(0)) rt.destroy();
  restoreRects();
  gpu?.restore();
  gpu = null;
  fake2d.restore();
  vi.restoreAllMocks();
});

interface Started {
  rt: FluidRuntime;
  clock: ManualClock;
  moving: MovingBackend;
  sb: SpyBackend;
}

async function start(renderer: "canvas2d" | "webgpu" = "canvas2d", moving: MovingBackend = movingBackend()): Promise<Started> {
  if (renderer === "webgpu" && gpu === null) gpu = installFakeGpuLifecycle();
  const sb = spyBackend(moving.backend);
  const clock = createManualClock();
  const rt = await createFluidRuntime({
    particles: 256,
    maxElements: 4,
    seed: 1,
    testBackend: sb.backend,
    clock,
    renderer,
    textAtlasCanvas: fakeAtlasCanvas().create,
  });
  live.push(rt);
  return { rt, clock, moving, sb };
}

/** The acceptance scene's "Merge" (734, 260, 140×48) with pointer-capture stand-ins (jsdom has none). */
function button(label = "Merge"): HTMLElement {
  const el = document.createElement("button");
  el.textContent = label;
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

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;

/** A mouse press at (x, y) on `el`, then one move by (dx, dy). */
function press(el: HTMLElement, x: number, y: number, dx: number, dy: number): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: x, clientY: y }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: x + dx, clientY: y + dy }));
}

/** pointerup and the click a browser fires after it (same task). */
function release(el: HTMLElement, x: number, y: number): void {
  el.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0, clientX: x, clientY: y }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }));
}

function slots(rt: FluidRuntime, id: number): number[] {
  const v = rt.bridge.elementView();
  const o = id * ELEMENT_STRIDE;
  return [v[o + El.INTERACTION], v[o + El.HOME_DX], v[o + El.HOME_DY]];
}

const splashes = (sb: SpyBackend): number => sb.calls.filter((c) => c.method === "splash").length;
const away = (el: HTMLElement): boolean => el.classList.contains(AWAY_CLASS);

type Listener = (e: { matches: boolean }) => void;

/** Reduced-motion media query stub (text-runtime.test.ts pattern). */
function stubReducedMotionMedia(initial: boolean): { fire(matches: boolean): void; restore(): void } {
  const listeners = new Set<Listener>();
  const rm = {
    matches: initial,
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

describe("W78 runtime: drag the liquid (D78-1 … D78-6)", () => {
  // 1
  it("given_a_mouse_drag_on_an_observed_element_when_frames_run_then_slots_5_7_carry_dragged_and_the_offset_and_the_release_zeroes_them_in_the_next_frame", async () => {
    const { rt, clock } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, -164, 146);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.DRAGGED, -164, 146]);
    release(el, 640, 430);
    clock.advance(1);
    expect(slots(rt, id), "released: idle, no offset, in the next frame").toEqual([Interaction.IDLE, 0, 0]);
  });

  // 2
  it("given_a_drag_released_on_its_element_when_the_click_follows_then_the_core_does_not_splash_and_a_click_in_a_later_task_splashes", async () => {
    const { rt, sb } = await start();
    const el = button();
    rt.observe(el);
    await flush();
    press(el, 804, 284, 0, 20);
    release(el, 804, 304);
    expect(splashes(sb), "the click that ends a drag is swallowed (D78-6)").toBe(0);
    await flush();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 804, clientY: 284 }));
    expect(splashes(sb), "a later click splashes").toBe(1);
  });

  // 3
  it("given_a_press_that_moves_3_px_when_released_then_its_click_splashes_once_and_no_slot_changes", async () => {
    const { rt, clock, sb } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 3, 0);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([Interaction.IDLE, 0, 0]);
    release(el, 807, 284);
    expect(splashes(sb), "below the threshold a press stays a click (D78-2)").toBe(1);
  });

  // 4
  it("given_canvas2d_and_a_drag_when_frames_run_then_liquid_away_is_on_while_dragged_kept_after_release_until_restAlpha_1_with_no_halo_meanwhile", async () => {
    const { rt, clock, moving } = await start("canvas2d");
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -150);
    moving.setRestAlpha(id, 0); // the engine: a dragged element never rests (D78-5)
    clock.advance(1);
    expect(
      [away(el), el.classList.contains(HALO_CLASS), el.classList.contains(TEXT_CLASS)],
      "dragged: label hidden, no halo, never liquid-text under Canvas2D",
    ).toEqual([true, false, false]);
    release(el, 804, 134);
    clock.advance(1);
    expect([away(el), el.classList.contains(HALO_CLASS)], "released, crawling home").toEqual([true, false]);
    moving.setRestAlpha(id, 0.6);
    clock.advance(1);
    expect(away(el), "still not at rest").toBe(true);
    moving.setRestAlpha(id, null); // at rest: restAlpha 1
    clock.advance(1);
    expect([away(el), el.classList.contains(HALO_CLASS)], "at rest: the DOM label is back").toEqual([false, false]);
  });

  // 5
  it("given_webgpu_and_a_drag_when_frames_run_then_no_liquid_away_is_ever_set", async () => {
    const { rt, clock, moving } = await start("webgpu");
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1); // W74: the first render uploads the atlas page ...
    await flush(); // ... confirmed once its error scope resolves
    press(el, 804, 284, 0, -150);
    moving.setRestAlpha(id, 0);
    for (let f = 0; f < 3; f++) {
      clock.advance(1);
      expect(away(el), `frame ${f}`).toBe(false);
    }
    expect(el.classList.contains(TEXT_CLASS), "WebGPU carries the label on the liquid (W74)").toBe(true);
    release(el, 804, 134);
  });

  // 6 (README Review Focus 5)
  it("given_a_drag_when_the_element_is_unobserved_mid_drag_then_its_slots_are_zeroed_liquid_away_is_gone_and_it_does_not_resume_after_re_observe", async () => {
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -40);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(away(el), "precondition: dragged under Canvas2D").toBe(true);
    rt.unobserve(el);
    expect(away(el), "unobserve restores the element (no liquid-away)").toBe(false);
    expect(slots(rt, id)).toEqual([0, 0, 0]);
    const again = rt.observe(el);
    await flush();
    el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, buttons: 1, clientX: 804, clientY: 200 }));
    clock.advance(1);
    expect(slots(rt, again)[0], "the old press is gone").not.toBe(Interaction.DRAGGED);
  });

  // 7
  it("given_a_drag_when_destroyed_then_liquid_away_is_gone_and_later_pointer_events_are_ignored", async () => {
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -40);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(away(el), "precondition").toBe(true);
    rt.destroy();
    expect(away(el)).toBe(false);
    expect(() => {
      press(el, 804, 284, 0, -80);
      release(el, 804, 204);
    }).not.toThrow();
    expect(away(el)).toBe(false);
  });

  // 8
  it("given_a_drag_when_reduced_motion_switches_on_then_the_drag_cancels_liquid_away_goes_at_once_and_slots_are_0_next_frame", async () => {
    const media = stubReducedMotionMedia(false);
    try {
      const { rt, clock, moving } = await start();
      const el = button();
      const id = rt.observe(el);
      await flush();
      press(el, 804, 284, 0, -40);
      moving.setRestAlpha(id, 0);
      clock.advance(1);
      expect(away(el), "precondition").toBe(true);
      media.fire(true);
      expect(away(el), "removed by the media listener, without a frame").toBe(false);
      clock.advance(1);
      expect(slots(rt, id)).toEqual([0, 0, 0]);
      media.fire(false);
      el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, buttons: 1, clientX: 804, clientY: 150 }));
      clock.advance(1);
      expect(slots(rt, id)[0], "the cancelled press does not resume").not.toBe(Interaction.DRAGGED);
    } finally {
      media.restore();
    }
  });

  // 9 (README Review Focus 4)
  it("given_two_instances_observing_one_element_when_it_is_dragged_and_released_then_both_write_dragged_the_click_never_splashes_and_liquid_away_stays_until_both_let_go", async () => {
    const shared = movingBackend();
    const one = await start("canvas2d", shared);
    const two = await start("canvas2d", shared);
    const el = button();
    const id1 = one.rt.observe(el);
    const id2 = two.rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -60);
    shared.setRestAlpha(id1, 0);
    shared.setRestAlpha(id2, 0);
    one.clock.advance(1);
    two.clock.advance(1);
    expect(slots(one.rt, id1)).toEqual([Interaction.DRAGGED, 0, -60]);
    expect(slots(two.rt, id2)).toEqual([Interaction.DRAGGED, 0, -60]);
    expect(away(el)).toBe(true);
    release(el, 804, 224);
    expect(splashes(one.sb) + splashes(two.sb), "one click, swallowed for both instances").toBe(0);
    one.rt.destroy();
    expect(away(el), "the other instance still holds the label").toBe(true);
    shared.setRestAlpha(id2, null);
    two.clock.advance(1);
    expect(away(el), "both let go").toBe(false);
  });

  // 10
  it("given_a_drag_cancelled_by_escape_when_frames_run_then_liquid_away_goes_at_once_and_the_halo_takes_over_while_the_liquid_crawls_home", async () => {
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -60);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(away(el), "precondition").toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(away(el), "a cancel shows the DOM label at once (slice design §4)").toBe(false);
    clock.advance(1);
    expect(slots(rt, id)).toEqual([0, 0, 0]);
    expect(el.classList.contains(HALO_CLASS), "still moving under Canvas2D: the W75 halo").toBe(true);
  });

  // 11
  it("given_reduced_motion_when_an_element_is_pressed_and_moved_then_slots_stay_0_nothing_is_captured_and_the_click_reaches_the_gated_splash_path", async () => {
    const media = stubReducedMotionMedia(true);
    try {
      const { rt, clock, sb } = await start();
      const el = button();
      const capture = vi.spyOn(el, "setPointerCapture");
      const id = rt.observe(el);
      await flush();
      press(el, 804, 284, 0, -60);
      clock.advance(1);
      expect(slots(rt, id)).toEqual([0, 0, 0]);
      expect(capture).not.toHaveBeenCalled();
      const seen = vi.fn();
      document.addEventListener("click", seen, { once: true });
      release(el, 804, 224);
      expect(seen, "the click is not swallowed").toHaveBeenCalledTimes(1);
      expect(splashes(sb), "reduced motion gates the splash itself (D68-5)").toBe(0);
      expect(away(el)).toBe(false);
    } finally {
      media.restore();
    }
  });

  // 12
  it("given_a_drag_under_webgpu_when_the_device_is_lost_then_the_drag_cancels_and_the_canvas2d_rebuild_shows_no_liquid_away", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rt, clock, moving } = await start("webgpu");
    const el = button();
    const id = rt.observe(el);
    await flush();
    clock.advance(1);
    await flush();
    press(el, 804, 284, 0, -60);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(slots(rt, id)[0], "precondition: dragging").toBe(Interaction.DRAGGED);
    gpu!.lose("unknown", "gpu reset");
    await vi.waitFor(() => expect(rt.activeRenderer).toBe("canvas2d"));
    await flush();
    clock.advance(1);
    expect(slots(rt, id)).toEqual([0, 0, 0]);
    expect(away(el), "the cancelled drag leaves no label class under Canvas2D").toBe(false);
  });

  // 14 (red-review fix)
  it("given_a_canvas2d_drag_with_liquid_away_when_a_frame_throws_then_the_drag_cancels_liquid_away_is_gone_and_a_later_move_does_not_drag_and_exactly_one_console_error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rt, clock, moving, sb } = await start("canvas2d");
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -60);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(away(el), "precondition: dragged under Canvas2D").toBe(true);
    (sb.cores[0] as unknown as { tick: () => never }).tick = () => {
      throw new Error("tick failed");
    };
    clock.advance(1); // the first frame that throws stops the instance for good
    expect(error).toHaveBeenCalledTimes(1);
    expect(away(el), "a failed frame clears the label class").toBe(false);
    el.dispatchEvent(new PointerEvent("pointermove", { ...PTR, buttons: 1, clientX: 804, clientY: 150 }));
    clock.advance(1);
    expect(slots(rt, id)[0], "the cancelled press does not resume").not.toBe(Interaction.DRAGGED);
    expect(away(el)).toBe(false);
    expect(error, "still exactly one console.error").toHaveBeenCalledTimes(1);
  });

  // 15 (README Review Focus 5, red-review fix; guard at red: no tracker, nothing is swallowed)
  it("given_a_released_drag_whose_click_is_still_pending_when_the_element_is_unobserved_then_the_click_in_the_same_task_passes_through", async () => {
    const { rt } = await start();
    const el = button();
    rt.observe(el);
    await flush();
    press(el, 804, 284, 0, 20);
    el.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0, clientX: 804, clientY: 304 }));
    rt.unobserve(el);
    const seen = vi.fn();
    document.addEventListener("click", seen, { once: true });
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 804, clientY: 304 });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented, "unobserve drops the pending swallow").toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // 13
  it("given_a_drag_when_the_dragged_element_leaves_the_document_then_the_next_frame_cancels_it_and_zeroes_its_slots", async () => {
    const { rt, clock, moving } = await start();
    const el = button();
    const id = rt.observe(el);
    await flush();
    press(el, 804, 284, 0, -60);
    moving.setRestAlpha(id, 0);
    clock.advance(1);
    expect(slots(rt, id)[0], "precondition: dragging").toBe(Interaction.DRAGGED);
    el.remove();
    clock.advance(1);
    expect(slots(rt, id)).toEqual([0, 0, 0]);
    expect(away(el)).toBe(false);
  });
});
