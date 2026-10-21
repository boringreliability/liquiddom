/**
 * @vitest-environment jsdom
 * W78 ward review (I1, M2): an assistive-tech or programmatic click (detail 0) is never swallowed by
 * a stale drag; a pointer's click (detail >= 1) still is; Escape cancels in the capture phase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DragTracker } from "../src/drag-tracker";

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;
const nextTask = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const click = (t: EventTarget, detail: number): MouseEvent => {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  t.dispatchEvent(ev);
  return ev;
};

let tracker: DragTracker;
let el: HTMLElement;
let onEnd: ReturnType<typeof vi.fn>;

function startDrag(): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: 0, clientY: 0 }));
  document.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: 0, clientY: 20 }));
  expect(tracker.active).not.toBeNull();
}

beforeEach(() => {
  document.body.replaceChildren();
  el = document.createElement("button");
  document.body.appendChild(el);
  onEnd = vi.fn();
  tracker = new DragTracker({ reducedMotion: () => false, onEnd }, document, window);
  tracker.attach(el);
});
afterEach(() => {
  tracker.destroy();
});

describe("W78 ward review I1: only a pointer's click is swallowed", () => {
  it("given_a_blur_cancel_whose_pointerup_never_arrives_when_el_click_is_called_then_the_click_passes_through", async () => {
    startDrag();
    window.dispatchEvent(new Event("blur")); // the release happens in another window
    await nextTask();
    const seen = vi.fn();
    el.addEventListener("click", seen);
    el.click(); // detail 0, like an AT default action
    expect(seen, "a programmatic click reaches the element").toHaveBeenCalledTimes(1);
    expect(click(el, 0).defaultPrevented, "a detail-0 click is not prevented").toBe(false);
  });

  it("given_a_blur_cancel_when_a_detail_0_click_comes_before_the_pointer_release_then_the_pointer_click_is_still_swallowed_once", () => {
    startDrag();
    window.dispatchEvent(new Event("blur"));
    expect(click(el, 0).defaultPrevented, "the detail-0 click passes").toBe(false);
    document.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0 }));
    expect(click(el, 1).defaultPrevented, "the cancelled press's own click is swallowed").toBe(true);
  });

  it("given_a_released_drag_when_the_pointer_click_follows_with_detail_1_then_it_is_swallowed", () => {
    startDrag();
    document.dispatchEvent(new PointerEvent("pointerup", { ...PTR, button: 0, buttons: 0 }));
    const seen = vi.fn();
    document.addEventListener("click", seen);
    try {
      expect(click(el, 1).defaultPrevented, "the drag's click is swallowed").toBe(true);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", seen);
    }
  });
});

describe("W78 ward review M2: Escape cancels in the capture phase", () => {
  it("given_an_active_drag_when_a_handler_on_the_target_stops_propagation_of_escape_then_the_drag_still_cancels", () => {
    startDrag();
    const stop = (e: Event): void => e.stopPropagation();
    el.addEventListener("keydown", stop);
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(tracker.active, "the drag is cancelled").toBeNull();
      expect(onEnd).toHaveBeenCalledWith(el, "cancel");
    } finally {
      el.removeEventListener("keydown", stop);
    }
  });
});
