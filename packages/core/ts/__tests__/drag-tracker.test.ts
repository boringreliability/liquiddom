/**
 * @vitest-environment jsdom
 * W78 (D78-2, D78-6): the drag gesture (drag-tracker.ts). Mouse and pen, primary button and
 * pointer only; the drag starts past 4 px and only then captures the pointer; the click that ends
 * a drag is swallowed once; pointercancel, blur, Escape, lostpointercapture, a lost release,
 * detach, cancel(), destroy and a detached element cancel; reduced motion ignores the gesture.
 * jsdom has PointerEvent but no pointer capture, so each element gets capture spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD_PX, DragTracker, type DragEnd } from "../src/drag-tracker";

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

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;
const down = (t: EventTarget, x: number, y: number, init: PointerEventInit = {}): boolean =>
  t.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: x, clientY: y, ...init }));
const move = (x: number, y: number, init: PointerEventInit = {}): boolean =>
  document.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: x, clientY: y, ...init }));
const up = (t: EventTarget, x: number, y: number, init: PointerEventInit = {}): boolean =>
  t.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0, clientX: x, clientY: y, ...init }));
const click = (t: EventTarget): MouseEvent => {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  t.dispatchEvent(ev);
  return ev;
};
const nextTask = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

let tracker: DragTracker;
let ends: Array<[HTMLElement, DragEnd]>;
let rm: { on: boolean };

beforeEach(() => {
  document.body.replaceChildren();
  ends = [];
  rm = { on: false };
  tracker = new DragTracker({ reducedMotion: () => rm.on, onEnd: (el, how) => ends.push([el, how]) }, document, window);
});
afterEach(() => {
  tracker.destroy();
});

describe("W78: DragTracker (D78-2, D78-6)", () => {
  // 1
  it("given_a_mouse_press_when_moved_up_to_4_px_then_no_drag_and_past_4_px_the_drag_starts_with_dx_dy_from_the_down_point_and_only_then_captures", () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    move(104, 50); // exactly 4 px: not more than the threshold
    expect(tracker.active).toBeNull();
    expect(el.capture.set, "no capture before the threshold (a plain click keeps its targets)").not.toHaveBeenCalled();
    move(103, 53); // 4.24 px
    expect(tracker.active).toMatchObject({ el, dx: 3, dy: 3 });
    expect(el.capture.set).toHaveBeenCalledWith(1);
    move(80, 70);
    expect(tracker.active).toMatchObject({ el, dx: -20, dy: 20 });
  });

  // 2
  // W84 red: approved-test change (D84-1): touch drags only after a long-press; a touch press that moves first never does.
  it("given_a_pen_press_when_moved_past_the_threshold_then_it_drags_and_a_touch_press_that_moves_before_the_long_press_never_drags", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 0, 0, { pointerType: "pen" });
    move(10, 0, { pointerType: "pen" });
    expect(tracker.active?.el).toBe(el);
    up(el, 10, 0, { pointerType: "pen" });
    down(el, 0, 0, { pointerType: "touch", pointerId: 2 });
    move(30, 0, { pointerType: "touch", pointerId: 2 });
    expect(tracker.active, "a touch press that moves 30 px before the long-press is a scroll (D84-1)").toBeNull();
    expect(el.capture.set).toHaveBeenCalledTimes(1);
  });

  // 3 (README Review Focus 3)
  it("given_the_right_or_middle_button_or_a_non_primary_pointer_when_pressed_and_moved_then_no_drag", () => {
    const el = observed();
    tracker.attach(el);
    const inits: PointerEventInit[] = [
      { button: 2, buttons: 2 },
      { button: 1, buttons: 4 },
      { isPrimary: false, pointerId: 5 },
    ];
    for (const init of inits) {
      down(el, 0, 0, init);
      move(30, 0, init);
      up(el, 30, 0, init);
      expect(tracker.active, JSON.stringify(init)).toBeNull();
    }
    expect(el.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });

  // 4 (README Review Focus 1)
  it("given_a_press_on_a_child_of_the_observed_element_when_moved_past_the_threshold_then_the_observed_element_is_dragged_and_captured", () => {
    const card = observed("article");
    const heading = card.appendChild(document.createElement("h2"));
    tracker.attach(card);
    down(heading, 10, 10);
    move(10, 30);
    expect(tracker.active).toMatchObject({ el: card, dx: 0, dy: 20 });
    expect(card.capture.set).toHaveBeenCalledWith(1);
  });

  // 5 (README Review Focus 1)
  it("given_nested_observed_elements_when_the_inner_one_is_pressed_then_only_the_inner_one_drags", () => {
    const card = observed("article");
    const inner = observed("button", card);
    tracker.attach(card);
    tracker.attach(inner);
    down(inner, 0, 0);
    move(0, 12);
    expect(tracker.active?.el).toBe(inner);
    expect(card.capture.set).not.toHaveBeenCalled();
  });

  // 6
  it("given_a_drag_past_the_threshold_when_released_then_the_next_click_is_swallowed_once_and_a_click_in_a_later_task_passes", async () => {
    const el = observed();
    tracker.attach(el);
    const seen = vi.fn();
    el.addEventListener("click", seen);
    document.addEventListener("click", seen);
    try {
      down(el, 0, 0);
      move(20, 0);
      up(el, 20, 0);
      expect(ends).toEqual([[el, "release"]]);
      expect(tracker.active).toBeNull();
      const swallowed = click(el);
      expect(seen, "neither the element nor the document sees it (D78-6)").not.toHaveBeenCalled();
      expect(swallowed.defaultPrevented).toBe(true);
      const second = click(el); // swallowed once only
      expect(seen).toHaveBeenCalledTimes(2);
      expect(second.defaultPrevented).toBe(false);
      await nextTask();
      click(el);
      expect(seen).toHaveBeenCalledTimes(4);
    } finally {
      document.removeEventListener("click", seen);
    }
  });

  // 7
  it("given_a_press_that_never_crosses_the_threshold_when_released_then_its_click_passes_and_nothing_is_captured_or_ended", () => {
    const el = observed();
    tracker.attach(el);
    const seen = vi.fn();
    el.addEventListener("click", seen);
    down(el, 0, 0);
    move(2, 2);
    up(el, 2, 2);
    const ev = click(el);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    expect(el.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });

  // 8 (README Review Focus 2)
  it("given_an_active_drag_when_pointercancel_blur_escape_or_lostpointercapture_then_it_cancels_and_later_moves_do_not_restart_it", async () => {
    const el = observed();
    tracker.attach(el);
    const cancels: Array<[string, () => void]> = [
      ["pointercancel", () => document.dispatchEvent(new PointerEvent("pointercancel", { ...PTR }))],
      ["blur", () => window.dispatchEvent(new Event("blur"))],
      ["Escape", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
      ["lostpointercapture", () => el.dispatchEvent(new PointerEvent("lostpointercapture", { ...PTR }))],
    ];
    for (const [name, cancel] of cancels) {
      ends.length = 0;
      down(el, 0, 0);
      move(0, 10);
      expect(tracker.active, `${name}: dragging`).not.toBeNull();
      cancel();
      expect(tracker.active, `${name}: cancelled`).toBeNull();
      expect(ends, name).toEqual([[el, "cancel"]]);
      move(0, 40);
      expect(tracker.active, `${name}: no restart without a new press`).toBeNull();
      up(el, 0, 40);
      // D78-6: the swallow outlives the cancel and lasts until that press's pointerup (the click follows it).
      expect(click(el).defaultPrevented, `${name}: the click after the cancelled drag's pointerup is swallowed`).toBe(true);
      await nextTask();
      expect(click(el).defaultPrevented, `${name}: a click in a later task passes`).toBe(false);
    }
  });

  // 9 (README Review Focus 2)
  it("given_an_active_drag_when_the_pointer_is_released_outside_the_window_then_the_document_pointerup_releases_it_and_a_lost_release_cancels", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 10, 10);
    move(-40, -60);
    expect(tracker.active).toMatchObject({ dx: -50, dy: -70 });
    up(document, -40, -60);
    expect(ends).toEqual([[el, "release"]]);
    expect(tracker.active).toBeNull();
    // The release went elsewhere: the next move of that pointer shows the primary button up.
    down(el, 0, 0);
    move(0, 20);
    move(0, 25, { buttons: 0 });
    expect(tracker.active).toBeNull();
    expect(ends.at(-1)).toEqual([el, "cancel"]);
  });

  // 10
  it("given_reduced_motion_when_pressed_and_moved_then_no_drag_no_capture_and_the_click_passes", () => {
    rm.on = true;
    const el = observed();
    tracker.attach(el);
    const seen = vi.fn();
    el.addEventListener("click", seen);
    down(el, 0, 0);
    move(30, 0);
    up(el, 30, 0);
    click(el);
    expect(tracker.active).toBeNull();
    expect(el.capture.set).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(ends).toEqual([]);
  });

  // 11 (README Review Focus 5)
  it("given_an_active_drag_when_detach_cancel_or_destroy_then_it_cancels_and_a_detached_or_destroyed_tracker_ignores_presses", () => {
    const a = observed();
    const b = observed();
    tracker.attach(a);
    tracker.attach(b);
    down(a, 0, 0);
    move(0, 10);
    tracker.detach(a); // unobserve()
    expect(ends).toEqual([[a, "cancel"]]);
    down(a, 0, 0);
    move(0, 10);
    expect(tracker.active, "a detached element no longer drags").toBeNull();
    up(a, 0, 10);
    down(b, 0, 0);
    move(0, 10);
    tracker.cancel(); // reduced motion switched on, a lost device, a failed frame
    expect(ends.at(-1)).toEqual([b, "cancel"]);
    up(b, 0, 10);
    down(b, 0, 0);
    move(0, 10);
    tracker.destroy();
    expect(ends.at(-1)).toEqual([b, "cancel"]);
    expect(ends).toHaveLength(3);
    down(b, 0, 0);
    move(0, 30);
    expect(tracker.active).toBeNull();
    tracker.destroy(); // idempotent
  });

  // 12
  it("given_an_active_drag_when_the_element_leaves_the_document_then_frame_cancels_it", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 0, 0);
    move(0, 10);
    tracker.frame();
    expect(tracker.active, "still connected").not.toBeNull();
    el.remove();
    tracker.frame();
    expect(tracker.active).toBeNull();
    expect(ends).toEqual([[el, "cancel"]]);
  });

  // 13
  it("given_a_live_press_when_selectstart_or_dragstart_fires_then_its_default_is_prevented_and_without_a_press_it_is_not", () => {
    const el = observed();
    tracker.attach(el);
    const outside = document.body.appendChild(document.createElement("p"));
    const fire = (type: string, target: EventTarget = el): boolean => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire("selectstart"), "no press: untouched").toBe(false);
    down(el, 0, 0);
    expect(fire("selectstart"), "a press on an observed element starts no text selection (D78-2)").toBe(true);
    expect(fire("dragstart"), "nor a native drag").toBe(true);
    expect(fire("selectstart", document), "a selection starting on the document while the press is live").toBe(true);
    expect(fire("selectstart", outside), "a selection starting outside the observed elements while the press is live").toBe(true);
    up(el, 0, 0);
    expect(fire("selectstart"), "the press ended: untouched").toBe(false);
    expect(fire("selectstart", document), "the press ended: the document is untouched").toBe(false);
    expect(fire("selectstart", outside), "the press ended: outside is untouched").toBe(false);
  });

  // 15 (README Review Focus 5, red-review fix)
  it("given_a_released_drag_with_its_click_still_pending_when_the_element_is_detached_then_the_click_in_the_same_task_passes_through", () => {
    const el = observed();
    tracker.attach(el);
    const seen = vi.fn();
    el.addEventListener("click", seen);
    down(el, 0, 0);
    move(20, 0);
    up(el, 20, 0);
    expect(ends).toEqual([[el, "release"]]);
    tracker.detach(el); // unobserve() between pointerup and the click
    const ev = click(el);
    expect(ev.defaultPrevented, "a detached element's click is no longer swallowed").toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // 14
  it("given_an_active_drag_when_a_second_pointer_presses_another_element_then_the_first_drag_is_unchanged", () => {
    const a = observed();
    const b = observed();
    tracker.attach(a);
    tracker.attach(b);
    down(a, 0, 0);
    move(0, 10);
    const pen = { pointerId: 2, pointerType: "pen" } as const;
    down(b, 50, 50, pen);
    move(90, 90, pen);
    up(b, 90, 90, pen);
    expect(tracker.active).toMatchObject({ el: a, dx: 0, dy: 10 });
    expect(b.capture.set).not.toHaveBeenCalled();
    expect(ends).toEqual([]);
  });
});

describe("W80: a scroll during a press (D80-1)", () => {
  // 15
  it("given_an_active_drag_when_the_page_scrolls_40_px_then_the_offset_grows_by_40_and_later_moves_keep_it", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    move(100, 60);
    expect(tracker.active).toMatchObject({ el, dx: 0, dy: 10 });
    tracker.scrolled(0, 40);
    expect(tracker.active, "the element moved up 40 px under a still pointer").toMatchObject({ el, dx: 0, dy: 50 });
    move(110, 60);
    expect(tracker.active, "pointer offset + scroll").toMatchObject({ el, dx: 10, dy: 50 });
    tracker.scrolled(Number.NaN, 5);
    expect(tracker.active, "a non-finite delta is ignored").toMatchObject({ dx: 10, dy: 50 });
  });

  // 16
  it("given_a_press_below_the_threshold_when_the_page_scrolls_40_px_then_no_drag_starts_and_the_drag_that_starts_later_includes_the_scroll", () => {
    const el = observed();
    tracker.attach(el);
    down(el, 100, 50);
    move(101, 51);
    tracker.scrolled(0, 40);
    expect(tracker.active, "W80 RF1: a scroll alone never starts a drag").toBeNull();
    expect(el.capture.set).not.toHaveBeenCalled();
    move(106, 51); // 6.1 px of pointer motion: the drag starts
    expect(tracker.active).toMatchObject({ el, dx: 6, dy: 41 });
    up(el, 106, 51);
    expect(ends).toEqual([[el, "release"]]);
    down(el, 0, 0, { pointerId: 3 });
    move(0, 10, { pointerId: 3 });
    expect(tracker.active, "a new press starts without the old scroll").toMatchObject({ dx: 0, dy: 10 });
  });

  // 17
  it("given_no_press_when_the_page_scrolls_then_nothing_changes", () => {
    const el = observed();
    tracker.attach(el);
    tracker.scrolled(0, 40);
    expect(tracker.active).toBeNull();
    down(el, 0, 0);
    move(0, 10);
    expect(tracker.active).toMatchObject({ dx: 0, dy: 10 });
  });
});
