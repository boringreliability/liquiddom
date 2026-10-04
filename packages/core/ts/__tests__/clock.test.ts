/**
 * W65 (D65-1): FrameClock seam. The manual clock gives the runtime fixed,
 * deterministic frames for Playwright visual tests and vitest.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createManualClock, rafClock, DEFAULT_FRAME_MS } from "../src/clock";

describe("W65 clock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("given_manual_clock_when_advance_3_then_callbacks_run_3_times_with_fixed_dt", () => {
    const clock = createManualClock(1000);
    const seen: number[] = [];
    const loop = (tMs: number): void => {
      seen.push(tMs);
      clock.request(loop);
    };
    clock.request(loop);
    clock.advance(3);
    expect(seen).toHaveLength(3);
    expect(DEFAULT_FRAME_MS).toBeCloseTo(1000 / 60, 12);
    expect(seen[0]).toBeCloseTo(1000 + DEFAULT_FRAME_MS, 9);
    expect(seen[1] - seen[0]).toBeCloseTo(DEFAULT_FRAME_MS, 9);
    expect(seen[2] - seen[1]).toBeCloseTo(DEFAULT_FRAME_MS, 9);
    expect(clock.now()).toBeCloseTo(1000 + 3 * DEFAULT_FRAME_MS, 9);
  });

  it("given_manual_clock_when_cancelled_then_callback_not_run", () => {
    const clock = createManualClock();
    const cb = vi.fn();
    const handle = clock.request(cb);
    clock.cancel(handle);
    clock.advance(2);
    expect(cb).not.toHaveBeenCalled();
  });

  it("given_callback_cancelled_by_an_earlier_callback_in_the_same_frame_when_advancing_then_it_does_not_run", () => {
    const clock = createManualClock();
    const second = vi.fn();
    let secondHandle = 0;
    clock.request(() => clock.cancel(secondHandle));
    secondHandle = clock.request(second);
    clock.advance(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("given_callback_requested_during_a_frame_when_advancing_one_frame_then_it_runs_on_the_next_frame", () => {
    const clock = createManualClock();
    const late = vi.fn();
    clock.request(() => {
      clock.request(late);
    });
    clock.advance(1);
    expect(late).not.toHaveBeenCalled();
    clock.advance(1);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(clock.now());
  });

  it("given_explicit_dt_when_advancing_then_timestamps_step_by_that_dt", () => {
    const clock = createManualClock(0);
    const seen: number[] = [];
    const loop = (tMs: number): void => {
      seen.push(tMs);
      clock.request(loop);
    };
    clock.request(loop);
    clock.advance(2, 10);
    expect(seen).toEqual([10, 20]);
  });

  it("given_invalid_frames_or_dt_or_start_when_used_then_TypeError", () => {
    const clock = createManualClock();
    expect(() => clock.advance(-1)).toThrow(TypeError);
    expect(() => clock.advance(1.5)).toThrow(TypeError);
    expect(() => clock.advance(Number.NaN)).toThrow(TypeError);
    expect(() => clock.advance(1, -1)).toThrow(TypeError);
    expect(() => clock.advance(1, Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => createManualClock(Number.NaN)).toThrow(TypeError);
  });

  it("given_rafClock_when_request_and_cancel_then_delegates_to_requestAnimationFrame", () => {
    const raf = vi.fn(() => 7);
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    const cb = (): void => {};
    expect(rafClock.request(cb)).toBe(7);
    expect(raf).toHaveBeenCalledWith(cb);
    rafClock.cancel(7);
    expect(caf).toHaveBeenCalledWith(7);
    expect(typeof rafClock.now()).toBe("number");
  });
});
