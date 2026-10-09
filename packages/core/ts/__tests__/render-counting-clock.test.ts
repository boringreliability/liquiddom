/**
 * @vitest-environment jsdom
 * W71 ward-review M3: demo/render-counting-clock.ts. `advance(n)` returns how many frames the
 * LoopController actually ran, so the scenes' pixels() keeps the last snapshot when none ran
 * (paused, hidden tab, failed frame), not only for advance(0).
 */
import { describe, expect, it } from "vitest";
import { createManualClock } from "../src/clock";
import { LoopController } from "../src/loop-control";
import { createRenderCountingClock } from "../../../../demo/render-counting-clock";

function setup(onFrame: (loop: LoopController) => void = () => {}) {
  const clock = createRenderCountingClock(createManualClock(0));
  let frames = 0;
  const loop: LoopController = new LoopController(clock, () => {
    frames += 1;
    onFrame(loop);
  });
  loop.start();
  return { clock, loop, frames: () => frames };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("W71 ward-review M3: render-counting clock", () => {
  it("given_a_running_loop_when_advance_n_then_it_returns_n_and_advance_0_returns_0", () => {
    const { clock, frames } = setup();
    expect(clock.advance(3)).toBe(3);
    expect(frames()).toBe(3);
    expect(clock.advance(0)).toBe(0);
    expect(clock.now()).toBeCloseTo(50, 6);
  });

  it("given_a_user_paused_loop_when_advance_n_then_it_returns_0_and_after_resume_it_counts_again", () => {
    const { clock, loop, frames } = setup();
    clock.advance(1);
    loop.pause();
    expect(clock.advance(4)).toBe(0);
    expect(frames()).toBe(1);
    loop.resume();
    expect(clock.advance(2)).toBe(2);
  });

  it("given_a_hidden_tab_when_advance_n_then_it_returns_0", () => {
    try {
      const { clock } = setup();
      setHidden(true);
      expect(clock.advance(3)).toBe(0);
      setHidden(false);
      expect(clock.advance(1)).toBe(1);
    } finally {
      setHidden(false);
    }
  });

  it("given_a_frame_that_fails_and_destroys_the_loop_like_the_runtime_when_advance_then_that_frame_and_later_ones_do_not_count", () => {
    let fail = false;
    const { clock, frames } = setup((loop) => {
      if (fail) loop.destroy(); // runtime.ts: a throwing frame sets failed and destroys the loop
    });
    expect(clock.advance(2)).toBe(2);
    fail = true;
    expect(clock.advance(3)).toBe(0);
    expect(frames()).toBe(3);
  });
});
