/**
 * @vitest-environment jsdom
 * W80 (D80-1, D80-2): the scroll tracker (scroll-tracker.ts). Body mode reads the window's
 * scrollX/scrollY, container mode the container's scrollLeft/scrollTop; the first sample and the
 * first after reset() give 0; the inertia is Δ · 60 · SCROLL_INERTIA, capped, 0 without elapsed time
 * or under reduced motion; dragDx/dragDy is what a live press adds to its offset; placeCanvas keeps
 * a container's canvas on its visible window. jsdom does not scroll, so the tests set the positions.
 */
import { describe, expect, it } from "vitest";
import { SCROLL_INERTIA, SCROLL_INERTIA_MAX_PX_S, ScrollTracker } from "../src/scroll-tracker";

const DT = 1 / 60;
const ZERO = { x: 0, y: 0 } as const;

function fakeWindow(x = 0, y = 0): Window & { scrollX: number; scrollY: number } {
  return { scrollX: x, scrollY: y } as unknown as Window & { scrollX: number; scrollY: number };
}

/** A container whose scroll position the test sets (jsdom keeps scrollTop at 0). */
function container(): HTMLElement & { scrollLeft: number; scrollTop: number } {
  const el = document.createElement("div");
  let left = 0;
  let top = 0;
  Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => (left = v) });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
  document.body.appendChild(el);
  return el;
}

const plain = <T extends object>(s: T): T => ({ ...s });

describe("W80: ScrollTracker (D80-1, D80-2)", () => {
  // 1
  it("given_a_new_tracker_when_the_first_frame_samples_a_scrolled_page_then_delta_and_inertia_are_0", () => {
    const win = fakeWindow(0, 500);
    const t = new ScrollTracker(win);
    expect(plain(t.sample(DT, ZERO, false))).toEqual({ dx: 0, dy: 0, ivx: 0, ivy: 0, dragDx: 0, dragDy: 0 });
    expect(plain(t.sample(DT, ZERO, false)), "no scroll since: still 0").toEqual({ dx: 0, dy: 0, ivx: 0, ivy: 0, dragDx: 0, dragDy: 0 });
  });

  // 2
  it("given_body_mode_when_scrollY_grows_by_1_px_then_delta_is_1_and_the_inertia_is_delta_times_60_times_SCROLL_INERTIA_downwards", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = 1;
    const s = plain(t.sample(DT, ZERO, false));
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(1);
    expect(s.ivx).toBe(0);
    expect(s.ivy, "scrolling down: the liquid lags below its home (ivy > 0)").toBeCloseTo(60 * SCROLL_INERTIA, 9);
    expect([s.dragDx, s.dragDy], "body mode: the drag offset grows by the scroll").toEqual([0, 1]);
  });

  // 3
  it("given_a_fast_diagonal_scroll_when_sampled_then_the_inertia_is_capped_at_SCROLL_INERTIA_MAX_PX_S_with_its_direction", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollX = 300;
    win.scrollY = 400;
    const s = t.sample(DT, ZERO, false);
    expect([s.dx, s.dy]).toEqual([300, 400]);
    expect(Math.hypot(s.ivx, s.ivy)).toBeCloseTo(SCROLL_INERTIA_MAX_PX_S, 6);
    expect(s.ivx / s.ivy).toBeCloseTo(0.75, 9);
    // D80-2 (gate): the cap is per 1/60 s; a long frame counts up to the core's 100 ms clamp.
    win.scrollX = 600;
    win.scrollY = 800;
    const l = t.sample(0.25, ZERO, false);
    expect(Math.hypot(l.ivx, l.ivy), "a 250 ms frame caps at 100 ms worth").toBeCloseTo(SCROLL_INERTIA_MAX_PX_S * 0.1 * 60, 6);
    expect(l.ivx / l.ivy).toBeCloseTo(0.75, 9);
  });

  // 4
  it("given_the_same_scroll_at_60_hz_and_at_120_hz_when_sampled_then_the_summed_inertia_is_the_same", () => {
    const sum = (px: number, frames: number, dt: number): number => {
      const win = fakeWindow();
      const t = new ScrollTracker(win);
      t.sample(dt, ZERO, false);
      let total = 0;
      for (let f = 1; f <= frames; f++) {
        win.scrollY = (px * f) / frames;
        total += t.sample(dt, ZERO, false).ivy;
      }
      return total;
    };
    expect(sum(60, 120, 1 / 120), "60 px in 1 s: the total impulse does not depend on the frame rate").toBeCloseTo(sum(60, 60, 1 / 60), 6);
    // D80-2 amended at the gate: 1800 px in 1 s is 30 px per 1/60 s, where the cap bites at both rates.
    expect(sum(1800, 60, 1 / 60), "the cap bites at 60 Hz").toBeCloseTo(60 * SCROLL_INERTIA_MAX_PX_S, 6);
    expect(sum(1800, 120, 1 / 120), "the cap is per 1/60 s: 120 Hz adds the same total impulse").toBeCloseTo(sum(1800, 60, 1 / 60), 6);
  });

  // 5
  it("given_container_mode_when_the_container_and_the_page_scroll_then_delta_reads_only_the_container_and_dragDelta_subtracts_the_offset_change", () => {
    const box = container();
    const t = new ScrollTracker(fakeWindow(), box);
    t.sample(DT, { x: 80, y: 40 }, false);
    box.scrollTop = 25;
    const a = plain(t.sample(DT, { x: 80, y: 40 }, false));
    expect([a.dx, a.dy, a.dragDx, a.dragDy]).toEqual([0, 25, 0, 25]);
    // The page around the container scrolls 100 px: the container's padding box moves up by 100 in
    // client px, its content does not move inside it, so nothing shifts; a press under a still
    // pointer moved +100 in buffer space relative to its element.
    const b = plain(t.sample(DT, { x: 80, y: -60 }, false));
    expect([b.dx, b.dy, b.ivx, b.ivy], "a page scroll does not shift a container's liquid").toEqual([0, 0, 0, 0]);
    expect([b.dragDx, b.dragDy], "W80 RF3: the dragged liquid follows the pointer").toEqual([0, 100]);
  });

  // 6
  it("given_reduced_motion_or_a_frame_without_elapsed_time_when_the_page_scrolls_then_the_delta_is_kept_and_the_inertia_is_0", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = 30;
    expect(plain(t.sample(DT, ZERO, true))).toMatchObject({ dy: 30, ivx: 0, ivy: 0 });
    win.scrollY = 2030; // scrolled while the loop was paused: the resumed frame has dt 0
    expect(plain(t.sample(0, ZERO, false)), "the whole delta shifts, with no slosh").toMatchObject({ dy: 2000, ivx: 0, ivy: 0 });
    win.scrollY = 2040;
    expect(t.sample(Number.NaN, ZERO, false).ivy).toBe(0);
  });

  // 7
  it("given_two_scrolls_between_frames_when_sampled_then_one_delta_is_their_sum", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = 120; // scroll event 1
    win.scrollY = 90; //  scroll event 2, same frame
    expect(t.sample(DT, ZERO, false).dy, "W80 RF2: the frame reads the position, not the events").toBe(90);
  });

  // 8
  it("given_overscroll_with_a_negative_scroll_position_when_sampled_then_the_negative_delta_is_kept", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = -40; // rubber band at the top (Safari)
    const a = plain(t.sample(DT, ZERO, false));
    expect([a.dy, a.dragDy], "W80 RF5: the DOM moved down 40 px; the liquid follows").toEqual([-40, -40]);
    expect(a.ivy).toBeLessThan(0);
    win.scrollY = 0;
    expect(t.sample(DT, ZERO, false).dy).toBe(40);
  });

  // 9
  it("given_a_non_finite_scroll_position_when_sampled_then_the_frame_gives_0_and_the_last_good_position_is_kept", () => {
    const win = fakeWindow(0, 10);
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = Number.NaN;
    expect(plain(t.sample(DT, ZERO, false))).toEqual({ dx: 0, dy: 0, ivx: 0, ivy: 0, dragDx: 0, dragDy: 0 });
    win.scrollY = 25;
    expect(t.sample(DT, ZERO, false).dy, "measured from the last good position (10)").toBe(15);
  });

  // 10
  it("given_reset_when_the_next_frame_samples_then_delta_is_0", () => {
    const win = fakeWindow();
    const t = new ScrollTracker(win);
    t.sample(DT, ZERO, false);
    win.scrollY = 50;
    t.reset();
    expect(t.sample(DT, ZERO, false).dy).toBe(0);
    win.scrollY = 55;
    expect(t.sample(DT, ZERO, false).dy).toBe(5);
  });

  // 11
  it("given_container_mode_when_placeCanvas_runs_then_the_canvas_is_translated_by_the_container_scroll_written_only_on_change_and_a_new_canvas_gets_it", () => {
    const box = container();
    const t = new ScrollTracker(fakeWindow(), box);
    const canvas = document.createElement("canvas");
    // Counts style writes: an own `style` object shadows HTMLElement.prototype.style on this canvas.
    let writes = 0;
    let transform = "";
    Object.defineProperty(canvas, "style", {
      configurable: true,
      value: {
        get transform() {
          return transform;
        },
        set transform(v: string) {
          writes += 1;
          transform = v;
        },
      },
    });
    t.placeCanvas(canvas);
    expect(canvas.style.transform, "not scrolled: no transform").toBe("");
    box.scrollTop = 120;
    box.scrollLeft = 8;
    t.placeCanvas(canvas);
    expect(canvas.style.transform).toBe("translate(8px, 120px)");
    const before = writes;
    t.placeCanvas(canvas);
    expect(writes, "unchanged scroll: no style write").toBe(before);
    const remounted = document.createElement("canvas");
    t.placeCanvas(remounted);
    expect(remounted.style.transform, "a remounted canvas gets the transform on its first frame").toBe("translate(8px, 120px)");
    box.scrollTop = 0;
    box.scrollLeft = 0;
    t.placeCanvas(remounted);
    expect(remounted.style.transform).toBe("");
  });

  // 12
  it("given_body_mode_when_placeCanvas_runs_then_the_fixed_canvas_is_never_restyled", () => {
    const win = fakeWindow(0, 300);
    const t = new ScrollTracker(win);
    const canvas = document.createElement("canvas");
    t.placeCanvas(canvas);
    expect(canvas.getAttribute("style")).toBeNull();
  });
});
