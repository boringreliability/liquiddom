/**
 * W89 (D89-6): Canvas2D's mixing report — enter fast at the entry threshold, release only after
 * MIX_RELEASE_FRAMES frames under the lower exit threshold, off at once when not eligible.
 */
import { describe, expect, it } from "vitest";
import {
  MIX_ENTER_CELLS,
  MIX_ENTER_FADE,
  MIX_EXIT_CELLS,
  MIX_EXIT_FADE,
  MIX_RELEASE_FRAMES,
  MixReport,
} from "../src/renderers/mix-report";

/** A report with slot `id` on (one frame at the entry threshold). */
function onReport(id = 0): MixReport {
  const r = new MixReport();
  expect(r.step(id, true, MIX_ENTER_CELLS, MIX_ENTER_CELLS), "precondition: on").toBe(true);
  return r;
}

describe("W89 mixing report (D89-6)", () => {
  it("given_the_thresholds_when_read_then_the_exit_is_lower_than_the_entry_and_the_release_takes_10_frames_D89_6", () => {
    expect(MIX_RELEASE_FRAMES).toBe(10);
    expect(MIX_EXIT_FADE).toBeLessThan(MIX_ENTER_FADE);
    expect(MIX_EXIT_CELLS).toBeLessThanOrEqual(MIX_ENTER_CELLS);
    expect(MIX_EXIT_CELLS).toBeGreaterThanOrEqual(1);
  });

  it("given_entry_cells_below_and_at_the_threshold_when_stepped_then_off_then_on_in_that_same_step", () => {
    const r = new MixReport();
    expect(r.on(0), "never stepped").toBe(false);
    expect(r.step(0, true, MIX_ENTER_CELLS - 1, 99), "exit cells alone never enter").toBe(false);
    expect(r.on(0)).toBe(false);
    expect(r.step(0, true, MIX_ENTER_CELLS, MIX_ENTER_CELLS)).toBe(true);
    expect(r.on(0)).toBe(true);
  });

  it("given_on_when_the_exit_cells_stay_below_the_exit_threshold_then_off_only_in_the_10th_frame_and_a_frame_at_the_exit_threshold_restarts_the_count", () => {
    const r = onReport();
    for (let f = 1; f < MIX_RELEASE_FRAMES; f++) expect(r.step(0, true, 0, MIX_EXIT_CELLS - 1), `quiet frame ${f}`).toBe(true);
    expect(r.step(0, true, 0, 0), "the 10th quiet frame releases").toBe(false);
    const s = onReport();
    for (let f = 1; f <= 5; f++) s.step(0, true, 0, 0);
    expect(s.step(0, true, 0, MIX_EXIT_CELLS), "back at the exit threshold: held").toBe(true);
    for (let f = 1; f < MIX_RELEASE_FRAMES; f++) expect(s.step(0, true, 0, 0), `quiet frame ${f} after the restart`).toBe(true);
    expect(s.step(0, true, 0, 0)).toBe(false);
  });

  it("given_on_when_the_slot_stops_being_eligible_then_off_at_once_and_it_needs_the_entry_threshold_again", () => {
    const r = onReport();
    expect(r.step(0, false, MIX_ENTER_CELLS, MIX_ENTER_CELLS), "at rest, away or reduced motion: off at once").toBe(false);
    expect(r.on(0)).toBe(false);
    expect(r.step(0, true, 0, MIX_EXIT_CELLS), "the exit threshold does not re-enter").toBe(false);
    expect(r.step(0, true, MIX_ENTER_CELLS, MIX_ENTER_CELLS)).toBe(true);
  });

  it("given_two_slots_when_one_releases_or_reset_runs_then_each_slot_keeps_its_own_state_and_reset_turns_all_off", () => {
    const r = new MixReport();
    r.step(2, true, MIX_ENTER_CELLS, MIX_ENTER_CELLS);
    r.step(255, true, MIX_ENTER_CELLS, MIX_ENTER_CELLS);
    expect(r.step(2, false, 0, 0)).toBe(false);
    expect([r.on(2), r.on(255), r.on(7)]).toEqual([false, true, false]);
    r.reset();
    expect(r.on(255)).toBe(false);
  });
});
