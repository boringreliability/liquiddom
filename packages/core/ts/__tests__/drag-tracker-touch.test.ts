/**
 * @vitest-environment jsdom
 * W84 (D84-1, D84-2, D84-5): the touch long-press and the opt-out in drag-tracker.ts. A primary
 * touch press on a draggable observed element starts a real 350 ms timer (fake timers here); more
 * than 8 px of the finger's own motion, pointerup, pointercancel, blur, Escape, detach, cancel(),
 * a detached element and destroy end it. When it fires the press drags at the finger's offset
 * (0, 0) plus the scroll since the down point. One non-passive touchmove listener per draggable
 * element prevents the browser's scroll only while a touch drag is live; contextmenu is prevented
 * only while a touch press is live. `attach(el, false)` (observe(el, { drag: false })) claims the
 * press and drags nothing. jsdom has no pointer capture: each element gets capture spies
 * (drag-tracker.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD_PX, DragTracker, LONG_PRESS_MS, TOUCH_SLOP_PX, type DragEnd } from "../src/drag-tracker";

type Captured = HTMLElement & { capture: { set: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } };

function observed(tag: "button" | "article" = "button", parent: HTMLElement = document.body): Captured {
  const el = document.createElement(tag) as Captured;
  let held: number | null = null;
  const set = vi.fn((id: number) => {
    held = id;
  });
  const release = vi.fn((id: number) => {
    if (held === id) held = null;
  });
  Object.assign(el, {
    setPointerCapture: set,
    releasePointerCapture: release,
    hasPointerCapture: (id: number) => held === id,
    capture: { set, release },
  });
  parent.appendChild(el);
  return el;
}

const TOUCH = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true } as const;
const SECOND = { ...TOUCH, pointerId: 8, isPrimary: false } as const;
const MOUSE = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;
const PEN = { ...MOUSE, pointerId: 2, pointerType: "pen" } as const;

const down = (t: EventTarget, x: number, y: number, init: PointerEventInit = TOUCH): boolean =>
  t.dispatchEvent(new PointerEvent("pointerdown", { ...init, button: 0, buttons: 1, clientX: x, clientY: y }));
const move = (t: EventTarget, x: number, y: number, init: PointerEventInit = TOUCH): boolean =>
  t.dispatchEvent(new PointerEvent("pointermove", { ...init, button: -1, buttons: 1, clientX: x, clientY: y }));
const up = (t: EventTarget, x: number, y: number, init: PointerEventInit = TOUCH): boolean =>
  t.dispatchEvent(new PointerEvent("pointerup", { ...init, button: 0, buttons: 0, clientX: x, clientY: y }));
const fire = (t: EventTarget, type: string): Event => {
  const ev = type === "contextmenu" ? new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 }) : new Event(type, { bubbles: true, cancelable: true });
  t.dispatchEvent(ev);
  return ev;
};
const click = (t: EventTarget): MouseEvent => {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  t.dispatchEvent(ev);
  return ev;
};
const touchmoveCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter((c) => c[0] === "touchmove");

let tracker: DragTracker;
let ends: Array<[HTMLElement, DragEnd]>;
let rm: { on: boolean };
const make = (): DragTracker => new DragTracker({ reducedMotion: () => rm.on, onEnd: (el, how) => ends.push([el, how]) }, document, window);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  ends = [];
  rm = { on: false };
  tracker = make();
});
afterEach(() => {
  tracker.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("W84: the touch long-press (D84-1)", () => {
  // 1
  it("given_the_approved_decisions_when_reading_the_touch_constants_then_350_ms_and_8_px_and_the_mouse_threshold_stays_4_px", () => {
    expect(LONG_PRESS_MS).toBe(350);
    expect(TOUCH_SLOP_PX).toBe(8);
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  // 2
  it("given_a_primary_touch_press_held_still_when_350_ms_pass_then_it_drags_at_offset_0_0_and_captures_and_at_349_ms_it_is_still_pending", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(tracker.pressed, "a pending press").toBe(el);
    expect(tracker.active).toBeNull();
    expect(el.capture.set, "no capture before the fire").not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: 0 });
    expect(el.capture.set).toHaveBeenCalledWith(7);
    move(el, 100, -70);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: -120 });
    up(el, 100, -70);
    expect(tracker.active).toBeNull();
    expect(ends).toEqual([[el, "release"]]);
  });

  // 3
  it("given_a_pending_touch_press_when_the_finger_moves_exactly_8_px_then_it_stays_pending_and_past_8_px_it_ends_without_a_drag_a_capture_or_onEnd", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    move(el, 108, 50); // exactly 8 px: not more than the slop
    expect(tracker.pressed).toBe(el);
    move(el, 106, 56); // 8.49 px
    expect(tracker.pressed, "a swipe: the press ends and the page scrolls").toBeNull();
    expect(vi.getTimerCount(), "the timer went with the press").toBe(0);
    vi.advanceTimersByTime(1000);
    expect(tracker.active).toBeNull();
    expect(el.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });

  // 4
  it("given_a_finger_that_drifts_6_px_before_the_fire_when_the_long_press_fires_then_the_offset_is_0_0_and_later_moves_count_from_where_it_rested", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    move(el, 106, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tracker.active, "the liquid does not jump by the slop").toMatchObject({ el, dx: 0, dy: 0 });
    move(el, 116, 30);
    expect(tracker.active).toMatchObject({ el, dx: 10, dy: -20 });
  });

  // 5 (W84 Review Focus 1)
  it("given_a_pending_touch_press_when_it_ends_by_any_path_then_no_timer_is_left_and_nothing_drags_later", () => {
    const paths: Array<[string, (el: Captured) => void]> = [
      ["pointerup (a tap)", (el) => up(el, 100, 50)],
      ["pointercancel", (el) => el.dispatchEvent(new PointerEvent("pointercancel", TOUCH))],
      ["window blur", () => window.dispatchEvent(new Event("blur"))],
      ["Escape", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
      ["a move past 8 px", (el) => move(el, 100, 59)],
      ["detach (unobserve)", (el) => tracker.detach(el)],
      ["cancel() (reduced motion, a lost device, a failed frame)", () => tracker.cancel()],
      ["the element left the document", (el) => {
        el.remove();
        tracker.frame();
      }],
      ["destroy", () => tracker.destroy()],
    ];
    for (const [name, endIt] of paths) {
      tracker.destroy();
      document.body.replaceChildren();
      tracker = make();
      const el = observed();
      tracker.attach(el);
      down(el, 100, 50);
      expect(vi.getTimerCount(), `${name}: the long-press timer runs`).toBe(1);
      endIt(el);
      expect(tracker.pressed, name).toBeNull();
      expect(vi.getTimerCount(), `${name}: no timer survives its press`).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(tracker.active, name).toBeNull();
      expect(el.capture.set, name).not.toHaveBeenCalled();
    }
    expect(ends, "a press that never dragged reports no end").toEqual([]);
  });

  // 6
  it("given_reduced_motion_when_a_touch_press_starts_or_it_switches_on_before_the_fire_then_nothing_drags", () => {
    const el = observed();
    tracker.attach(el);
    rm.on = true;
    down(el, 100, 50);
    expect(tracker.pressed).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    up(el, 100, 50);
    rm.on = false;
    down(el, 100, 50, { ...TOUCH, pointerId: 9 });
    rm.on = true; // the media query flipped before the runtime's cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tracker.active).toBeNull();
    expect(tracker.pressed).toBeNull();
    expect(el.capture.set).not.toHaveBeenCalled();
  });

  // 7
  it("given_a_tap_when_released_before_the_fire_then_its_click_passes_and_the_click_ending_a_touch_drag_is_swallowed_once", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    vi.advanceTimersByTime(100);
    up(el, 100, 50);
    expect(click(el).defaultPrevented, "a tap stays a click").toBe(false);
    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    move(el, 100, 20);
    up(el, 100, 20);
    expect(click(el).defaultPrevented, "the click ending a touch drag is swallowed (W78)").toBe(true);
    vi.advanceTimersByTime(1);
    expect(click(el).defaultPrevented, "a click in a later task passes").toBe(false);
  });

  // 8 (W84 Review Focus 2)
  it("given_a_second_finger_when_it_presses_alone_or_during_a_pending_or_dragging_touch_press_then_it_starts_nothing_and_never_disturbs_the_first", () => {
    const el = observed();
    const other = observed();
    tracker.attach(el);
    tracker.attach(other);
    down(other, 300, 50, SECOND);
    expect(tracker.pressed, "a non-primary touch never starts a press").toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    up(other, 300, 50, SECOND);
    down(el, 100, 50);
    down(other, 300, 50, SECOND);
    move(other, 340, 90, SECOND); // far past 8 px, but another pointer
    expect(tracker.pressed).toBe(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: 0 });
    move(other, 400, 200, SECOND);
    up(other, 400, 200, SECOND);
    other.dispatchEvent(new PointerEvent("pointercancel", SECOND));
    expect(tracker.active, "the second finger never disturbs the drag").toMatchObject({ el, dx: 0, dy: 0 });
    move(el, 100, 30);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: -20 });
    expect(other.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });

  // 9
  it("given_a_pending_touch_press_when_the_page_scrolls_50_px_then_the_press_lives_and_the_drag_starts_at_offset_0_50", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    tracker.scrolled(0, 50); // W80: the runtime hands the scroll that moved the pressed element
    expect(tracker.pressed, "a scroll alone never ends the press").toBe(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: 50 });
    move(el, 100, 40);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: 40 });
  });

  // 10 (W84 Review Focus 5)
  it("given_a_draggable_element_when_attached_then_one_non_passive_touchmove_listener_prevents_only_while_a_touch_drag_is_live_and_detach_removes_it", () => {
    const el = observed();
    const add = vi.spyOn(el, "addEventListener");
    const remove = vi.spyOn(el, "removeEventListener");
    tracker.attach(el);
    const adds = touchmoveCalls(add);
    expect(adds, "one touchmove listener from observe() (W84.0 Q1 (a))").toHaveLength(1);
    expect(adds[0]![2]).toEqual({ passive: false });
    expect(fire(el, "touchmove").defaultPrevented, "no press").toBe(false);
    down(el, 100, 50);
    expect(fire(el, "touchmove").defaultPrevented, "pending: a swipe before the fire scrolls").toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire(el, "touchmove").defaultPrevented, "a live touch drag").toBe(true);
    expect(fire(el.appendChild(document.createElement("span")), "touchmove").defaultPrevented, "from a child, bubbling").toBe(true);
    up(el, 100, 50);
    expect(fire(el, "touchmove").defaultPrevented, "released").toBe(false);
    vi.advanceTimersByTime(1);
    down(el, 100, 50, MOUSE);
    move(el, 130, 50, MOUSE);
    expect(tracker.active?.el, "precondition: a mouse drag").toBe(el);
    expect(fire(el, "touchmove").defaultPrevented, "a mouse drag never prevents a touchmove").toBe(false);
    up(el, 130, 50, MOUSE);
    tracker.detach(el);
    const removes = touchmoveCalls(remove);
    expect(removes).toHaveLength(1);
    expect(removes[0]![1], "the same function").toBe(adds[0]![1]);
  });

  // 11 (W84 Review Focus 5)
  it("given_a_draggable_and_an_opted_out_element_when_attached_and_destroyed_then_only_the_draggable_one_carried_a_touchmove_listener_and_destroy_removed_it", () => {
    const a = observed();
    const b = observed();
    const addA = vi.spyOn(a, "addEventListener");
    const addB = vi.spyOn(b, "addEventListener");
    const removeA = vi.spyOn(a, "removeEventListener");
    tracker.attach(a);
    tracker.attach(b, false);
    expect(touchmoveCalls(addA)).toHaveLength(1);
    expect(touchmoveCalls(addB), "drag: false adds none (D84-1)").toHaveLength(0);
    tracker.destroy();
    expect(touchmoveCalls(removeA)).toHaveLength(1);
    expect(touchmoveCalls(removeA)[0]![1]).toBe(touchmoveCalls(addA)[0]![1]);
  });

  // 12 (W84 Review Focus 4)
  it("given_contextmenu_when_a_touch_press_is_live_then_it_is_prevented_and_a_desktop_right_click_a_mouse_press_an_opted_out_element_or_no_press_are_untouched", () => {
    const el = observed();
    const off = observed();
    tracker.attach(el);
    tracker.attach(off, false);
    expect(fire(el, "contextmenu").defaultPrevented, "no press: a desktop right-click").toBe(false);
    down(el, 100, 50, MOUSE);
    expect(fire(el, "contextmenu").defaultPrevented, "a mouse press").toBe(false);
    up(el, 100, 50, MOUSE);
    down(el, 100, 50);
    expect(fire(el, "contextmenu").defaultPrevented, "a pending touch press (Android opens its menu at ≈ 500 ms)").toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire(el, "contextmenu").defaultPrevented, "a live touch drag").toBe(true);
    up(el, 100, 50);
    expect(fire(el, "contextmenu").defaultPrevented, "released").toBe(false);
    vi.advanceTimersByTime(1);
    down(off, 300, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire(off, "contextmenu").defaultPrevented, "drag: false keeps the browser's menu (D84-2)").toBe(false);
    up(off, 300, 50);
  });

  // 13 (W84 Review Focus 3)
  it("given_an_opted_out_element_inside_a_draggable_one_when_pressed_by_touch_mouse_or_pen_then_nothing_drags_and_the_outer_one_gets_no_press", () => {
    const card = observed("article");
    const inner = observed("button", card);
    tracker.attach(card);
    tracker.attach(inner, false);
    down(inner, 10, 10);
    expect(tracker.pressed, "touch: the innermost observed element decides (D67-9)").toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    up(inner, 10, 10);
    for (const init of [MOUSE, PEN]) {
      down(inner, 10, 10, init);
      expect(tracker.pressed, init.pointerType).toBeNull();
      expect(fire(document, "selectstart").defaultPrevented, `${init.pointerType}: no live press, selection untouched`).toBe(false);
      move(inner, 10, 60, init);
      expect(tracker.active, init.pointerType).toBeNull();
      up(inner, 10, 60, init);
    }
    expect(card.capture.set).not.toHaveBeenCalled();
    expect(inner.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
    down(card, 200, 100, MOUSE); // control: a press on the card itself drags the card
    move(card, 200, 140, MOUSE);
    expect(tracker.active?.el).toBe(card);
  });

  // 14
  it("given_a_touch_drag_started_on_a_child_when_the_child_loses_its_implicit_capture_then_the_drag_stays_and_the_elements_own_lostpointercapture_cancels", () => {
    const card = observed("article");
    const heading = card.appendChild(document.createElement("h2"));
    tracker.attach(card);
    down(heading, 10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tracker.active?.el).toBe(card);
    heading.dispatchEvent(new PointerEvent("lostpointercapture", TOUCH)); // bubbles to the card
    expect(tracker.active?.el, "the finger's implicit capture moved from the heading to the card").toBe(card);
    card.dispatchEvent(new PointerEvent("lostpointercapture", TOUCH));
    expect(tracker.active).toBeNull();
    expect(ends).toEqual([[card, "cancel"]]);
  });

  // 33 (W84 ward review I1, Dennis 2026-10-21, saga dec_6c3e126e)
  it("given_a_slow_tap_held_past_the_fire_when_lifted_within_8_px_and_no_scroll_then_its_click_passes_and_a_drag_that_moved_or_scrolled_still_swallows_it", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS + 400);
    expect(tracker.active, "the hold picked the liquid up").toMatchObject({ el, dx: 0, dy: 0 });
    up(el, 100, 50);
    expect(ends).toEqual([[el, "release"]]);
    expect(click(el).defaultPrevented, "a slow tap stays a click").toBe(false);

    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    move(el, 100 + TOUCH_SLOP_PX, 50);
    up(el, 100 + TOUCH_SLOP_PX, 50);
    expect(click(el).defaultPrevented, "a drift of exactly 8 px after the fire is still a tap").toBe(false);

    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    move(el, 100, 20);
    move(el, 100, 50);
    up(el, 100, 50);
    expect(click(el).defaultPrevented, "a drag that went 30 px away and came back is a drag: swallowed").toBe(true);
    vi.advanceTimersByTime(1);

    down(el, 100, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    tracker.scrolled(0, 20);
    up(el, 100, 50);
    expect(click(el).defaultPrevented, "a drag the page scrolled under is a drag: swallowed").toBe(true);
  });
});
