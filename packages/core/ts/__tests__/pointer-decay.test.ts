/**
 * W84 (D84-3): the pointer's idle decay per unit of time. `v ← v · 0.8^e`, `e = Δt · 0.06`
 * (Δt the runtime clock's ms since the previous sample), `e` snapped to exactly 1 when
 * `|e − 1| < 1e-9`: the manual clock's accumulated 1/60 s frames decay by exactly 0.8 (every W68
 * number and baseline unchanged), and 120 Hz has the same idle tail in wall time as 60 Hz (closes
 * D68-4's limitation). The 120 ms hold before it is unchanged.
 */
import { describe, expect, it } from "vitest";
import { IDLE_DECAY_SNAP, POINTER_IDLE_DECAY, PointerTracker, idleDecay } from "../src/pointer-tracker";

const FRAME_MS = 1000 / 60;
const ORIGIN = { x: 0, y: 0 };

/** 300 px/s built at t = 1/60 s (both rates sample that move at the same time), then 1 s of idle frames at `hz`; vx at every 60 Hz frame time. */
function idleTail(hz: 60 | 120): number[] {
  const t = new PointerTracker();
  const dt = 1000 / hz;
  let now = 0;
  t.move(0, 0);
  t.sample(now, ORIGIN);
  t.move(10, 0);
  now = FRAME_MS;
  expect(t.sample(now, ORIGIN).vx).toBe(300);
  const per = hz / 60;
  const out: number[] = [];
  for (let k = 1; k <= 60 * per; k++) {
    now += dt; // the manual clock accumulates (clock.ts)
    const vx = t.sample(now, ORIGIN).vx;
    if (k % per === 0) out.push(vx);
  }
  return out;
}

describe("W84: pointer decay per time (D84-3)", () => {
  // 15
  it("given_the_manual_clocks_accumulated_1_60_s_frames_when_the_pointer_idles_then_every_frame_decays_by_exactly_0_8_bit_identical_to_W68", () => {
    expect(POINTER_IDLE_DECAY).toBe(0.8);
    expect(idleDecay(FRAME_MS)).toBe(0.8);
    let now = 0;
    let off = 0;
    for (let k = 0; k < 100_000; k++) {
      const next = now + FRAME_MS;
      if (idleDecay(next - now) !== 0.8) off += 1;
      now = next;
    }
    expect(off, "frames whose decay is not exactly 0.8 (W84.0 Q3: 99 993 of 100 000 without the snap)").toBe(0);
    const t = new PointerTracker();
    now = 0;
    t.move(0, 0);
    t.sample(now, ORIGIN);
    t.move(10, 0);
    let prev = t.sample((now += FRAME_MS), ORIGIN).vx;
    let decayed = 0;
    for (let k = 0; k < 2000; k++) {
      const vx = t.sample((now += FRAME_MS), ORIGIN).vx;
      if (vx !== prev) {
        expect(vx, `idle frame ${k}`).toBe(prev * 0.8);
        decayed += 1;
      }
      prev = vx;
    }
    expect(decayed, "every frame after the 120 ms hold").toBe(1993);
  });

  // 16
  it("given_120_hz_frames_when_the_pointer_idles_then_its_velocity_tail_equals_60_hz_in_wall_time", () => {
    const hz60 = idleTail(60);
    const hz120 = idleTail(120);
    expect(hz120).toHaveLength(hz60.length);
    for (let i = 0; i < hz60.length; i++) {
      const a = hz60[i]!;
      const b = hz120[i]!;
      expect(Math.abs(b / a - 1), `${Math.round((i + 2) * FRAME_MS)} ms: 120 Hz ${b} vs 60 Hz ${a}`).toBeLessThan(1e-9);
    }
    expect(hz60[27]!, "it still decays: below 1 % after 350 ms of decay (483 ms)").toBeLessThan(3);
  });

  // 17
  it("given_frame_lengths_when_idleDecay_then_0_8_per_1_60_s_snapped_within_1e_9_and_no_decay_for_a_zero_negative_or_non_finite_frame", () => {
    expect(IDLE_DECAY_SNAP).toBe(1e-9);
    expect(idleDecay(1000 / 120)).toBeCloseTo(Math.sqrt(0.8), 15);
    expect(idleDecay(1000 / 30)).toBeCloseTo(0.64, 15);
    expect(idleDecay(FRAME_MS * (1 + 5e-10)), "within the snap").toBe(0.8);
    expect(idleDecay(FRAME_MS * (1 + 5e-9)), "outside the snap").not.toBe(0.8);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(idleDecay(bad), String(bad)).toBe(1);
  });
});
