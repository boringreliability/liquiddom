/**
 * @vitest-environment jsdom
 * W78.3 review fix round 1: a click swallow never outlives its gesture.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DragTracker } from "../src/drag-tracker";

const PTR = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true } as const;
const nextTask = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const click = (t: EventTarget, detail = 1): MouseEvent => {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  t.dispatchEvent(ev);
  return ev;
};

let tracker: DragTracker;
let el: HTMLElement;

function startDrag(): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { ...PTR, button: 0, buttons: 1, clientX: 0, clientY: 0 }));
  document.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 1, clientX: 0, clientY: 20 }));
  expect(tracker.active).not.toBeNull();
}

beforeEach(() => {
  document.body.replaceChildren();
  el = document.createElement("button");
  document.body.appendChild(el);
  tracker = new DragTracker({ reducedMotion: () => false }, document, window);
  tracker.attach(el);
});
afterEach(() => {
  tracker.destroy();
});

describe("W78.3 review: a stale click swallow clears", () => {
  it("given_a_cancel_by_a_move_with_the_button_up_when_a_keyboard_click_follows_then_it_passes_through", async () => {
    startDrag();
    document.dispatchEvent(new PointerEvent("pointermove", { ...PTR, button: -1, buttons: 0, clientX: 0, clientY: 25 }));
    expect(tracker.active).toBeNull();
    await nextTask();
    expect(click(el, 0).defaultPrevented).toBe(false);
  });

  it("given_a_blur_cancel_when_a_key_is_pressed_then_the_following_click_passes_through", () => {
    startDrag();
    window.dispatchEvent(new Event("blur"));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(click(el, 0).defaultPrevented).toBe(false);
  });

  it("given_a_cancelled_drag_when_another_pointer_releases_then_the_swallow_stays_for_the_own_click", async () => {
    startDrag();
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new PointerEvent("pointerup", { ...PTR, pointerId: 7, button: 0, buttons: 0 }));
    await nextTask();
    expect(click(el).defaultPrevented, "another pointer's pointerup does not end it").toBe(true);
  });
});
