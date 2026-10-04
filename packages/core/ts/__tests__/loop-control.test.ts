/**
 * @vitest-environment jsdom
 * W66: LoopController drives runtime.frame through a FrameClock (W65) with
 * independent user-pause and hidden-tab pause (D66-12).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createManualClock } from "../src/clock";
import { LoopController } from "../src/loop-control";
import { restoreVisibility, setVisibility } from "./_facade-helpers";

afterEach(restoreVisibility);

function harness() {
  const clock = createManualClock();
  const frames: number[] = [];
  const loop = new LoopController(clock, (t) => frames.push(t), document);
  return { clock, frames, loop };
}

describe("W66: LoopController", () => {
  it("given_started_loop_when_clock_advances_3_then_onFrame_runs_3_times", () => {
    const { clock, frames, loop } = harness();
    clock.advance(3);
    expect(frames).toHaveLength(0); // not started yet
    loop.start();
    clock.advance(3);
    expect(frames).toHaveLength(3);
    expect(loop.isPaused).toBe(false);
    loop.destroy();
  });

  it("given_paused_when_advancing_then_no_frames_and_resume_restarts", () => {
    const { clock, frames, loop } = harness();
    loop.start();
    clock.advance(2);
    loop.pause();
    expect(loop.isPaused).toBe(true);
    clock.advance(5);
    expect(frames).toHaveLength(2);
    loop.resume();
    clock.advance(2);
    expect(frames).toHaveLength(4);
    loop.destroy();
  });

  it("given_hidden_document_when_visibilitychange_then_paused_until_visible", () => {
    const { clock, frames, loop } = harness();
    loop.start();
    setVisibility("hidden");
    expect(loop.isPaused).toBe(true);
    clock.advance(4);
    expect(frames).toHaveLength(0);
    setVisibility("visible");
    expect(loop.isPaused).toBe(false);
    clock.advance(1);
    expect(frames).toHaveLength(1);
    loop.destroy();
  });

  it("given_user_paused_when_tab_becomes_visible_then_still_paused", () => {
    const { clock, frames, loop } = harness();
    loop.start();
    loop.pause();
    setVisibility("hidden");
    setVisibility("visible");
    expect(loop.isPaused).toBe(true);
    clock.advance(3);
    expect(frames).toHaveLength(0);
    loop.destroy();
  });

  it("given_pause_then_hidden_then_resume_while_hidden_when_advancing_then_still_paused_until_visible_D66_12", () => {
    const { clock, frames, loop } = harness();
    loop.start();
    loop.pause();
    setVisibility("hidden");
    loop.resume(); // user resume must not override the hidden-tab pause
    expect(loop.isPaused).toBe(true);
    clock.advance(4);
    expect(frames).toHaveLength(0);
    setVisibility("visible");
    expect(loop.isPaused).toBe(false);
    clock.advance(2);
    expect(frames).toHaveLength(2);
    loop.destroy();
  });

  it("given_destroyed_when_advancing_then_no_frames_listener_removed_and_idempotent", () => {
    const { clock, frames, loop } = harness();
    loop.start();
    loop.destroy();
    loop.destroy();
    clock.advance(3);
    setVisibility("hidden");
    setVisibility("visible");
    loop.resume();
    clock.advance(3);
    expect(frames).toHaveLength(0);
  });

  it("fix2_given_paused_to_running_when_resumed_then_onResume_fires_once_per_transition", () => {
    const clock = createManualClock();
    let n = 0;
    const loop = new LoopController(clock, () => undefined, document, () => n++);
    loop.start();
    clock.advance(2);
    expect(n).toBe(0);
    loop.pause();
    loop.resume();
    expect(n).toBe(1);
    loop.resume();
    expect(n).toBe(1);
    loop.destroy();
  });
});
