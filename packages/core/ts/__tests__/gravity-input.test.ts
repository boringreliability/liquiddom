/**
 * @vitest-environment jsdom
 * W83 (D83-3, D83-5): the gravity helpers of gravity.ts — the fixed vector, the orientation
 * projection and its sign table (W83.0 Q3), the screen angle, and the 2° dead band.
 */
import { describe, it, expect } from "vitest";
import { GravityInput, fixedGravity, orientationGravity, screenAngle } from "../src/gravity";

function orient(win: EventTarget, beta: number, gamma: number): void {
  const event = new Event("deviceorientation");
  Object.defineProperty(event, "beta", { value: beta });
  Object.defineProperty(event, "gamma", { value: gamma });
  win.dispatchEvent(event);
}

describe("W83 gravity helpers (D83-3, D83-5)", () => {
  it("given_a_fixed_vector_and_strength_when_fixedGravity_then_normalize_vector_times_strength_and_a_zero_vector_or_strength_is_no_gravity", () => {
    expect(fixedGravity([3, 4], 10)).toEqual([6, 8]);
    expect(fixedGravity([0, 980], 980)).toEqual([0, 980]);
    expect(fixedGravity([0, 1], 600)).toEqual([0, 600]);
    const len = Math.hypot(50, 980);
    const [gx, gy] = fixedGravity([50, 980], 980);
    expect(gx).toBeCloseTo((50 / len) * 980, 9);
    expect(gy).toBeCloseTo((980 / len) * 980, 9);
    expect(fixedGravity([0, 0], 980)).toEqual([0, 0]);
    expect(fixedGravity([0, 2], 0)).toEqual([0, 0]);
  });

  it("given_device_orientation_poses_when_orientationGravity_then_the_W83_0_sign_table_holds_and_a_flat_phone_feels_none", () => {
    const S = 980;
    const rad = Math.PI / 180;
    const cases: ReadonlyArray<readonly [string, number, number, number, readonly [number, number]]> = [
      ["portrait upright", 90, 0, 0, [0, 980]],
      ["portrait tilted back", 60, 0, 0, [0, 980 * Math.sin(60 * rad)]],
      ["flat on a table", 0, 0, 0, [0, 0]],
      ["flat, right edge down", 0, 30, 0, [490, 0]],
      ["flat, top edge up", 30, 0, 0, [0, 490]],
      ["landscape, top to the left", 0, -90, 90, [0, 980]],
      ["landscape, top to the right (angle 270)", 0, 90, 270, [0, 980]],
      ["landscape, top to the right (angle -90)", 0, 90, -90, [0, 980]],
      ["portrait upside down", -90, 0, 180, [0, 980]],
      ["the W46 test pose", 45, -45, 0, [-490, 980 * Math.SQRT1_2]],
      // dy·sin θ ≠ 0: px = cosβ·sinγ, py = sinβ, gx = s(px cosθ + py sinθ), gy = s(−px sinθ + py cosθ)
      ["landscape 90, tilted (β 30, γ −60)", 30, -60, 90, [490, 980 * Math.cos(30 * rad) * Math.sin(60 * rad)]],
      ["landscape 270, tilted (β 30, γ 60)", 30, 60, 270, [-490, 735]],
      ["landscape -90, tilted (β 30, γ 60)", 30, 60, -90, [-490, 735]],
      ["upside down, lateral (β -60, γ 30)", -60, 30, 180, [-245, 980 * Math.sin(60 * rad)]],
    ];
    for (const [name, beta, gamma, angle, [ex, ey]] of cases) {
      const [gx, gy] = orientationGravity(beta, gamma, angle, S);
      expect(gx, `${name}: gx`).toBeCloseTo(ex, 6);
      expect(gy, `${name}: gy`).toBeCloseTo(ey, 6);
    }
  });

  it("given_screen_orientation_angle_or_window_orientation_when_screenAngle_then_they_are_read_in_that_order_and_anything_else_is_0", () => {
    const win = (v: object): Window => v as unknown as Window;
    expect(screenAngle(win({ screen: { orientation: { angle: 90 } } }))).toBe(90);
    expect(screenAngle(win({ screen: {}, orientation: -90 }))).toBe(-90);
    expect(screenAngle(win({ screen: { orientation: { angle: Number.NaN } }, orientation: 180 }))).toBe(180);
    expect(screenAngle(win({ screen: {} }))).toBe(0);
    expect(screenAngle(win({}))).toBe(0);
  });

  it("given_an_orientation_source_when_readings_arrive_then_the_first_seeds_noise_within_2_degrees_is_held_and_a_larger_tilt_acts_without_a_seed", () => {
    const win = Object.assign(new EventTarget(), { screen: { orientation: { angle: 0 } } }) as unknown as Window;
    const input = new GravityInput(win, { source: "orientation", vector: [0, 0], strength: 980 });
    expect(input.sample(false), "create() seeds; no reading yet").toEqual({ gx: 0, gy: 0, seed: true });
    expect(input.sample(false)).toEqual({ gx: 0, gy: 0, seed: false });
    orient(win, 0, 0); // flat on a table: the first reading seeds
    expect(input.sample(false)).toEqual({ gx: 0, gy: 0, seed: true });
    for (const [b, g] of [[0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [-0.4, -0.3]] as const) {
      orient(win, b, g);
      expect(input.sample(false), `sensor noise (${b}, ${g}) stays bit-quiet`).toEqual({ gx: 0, gy: 0, seed: false });
    }
    for (const g of [1.5, 1.9]) {
      orient(win, 0, g); // measured against the held direction, not the last reading
      expect(input.sample(false), `${g}° from the held direction stays bit-quiet`).toEqual({ gx: 0, gy: 0, seed: false });
    }
    orient(win, 0, 3); // 3° turns the held direction past the 2° band
    const s = input.sample(false);
    expect(s.seed).toBe(false);
    expect(s.gx).toBeCloseTo(980 * Math.sin((3 * Math.PI) / 180), 6);
    expect(s.gy).toBeCloseTo(0, 6);
    expect(input.sample(true), "reduced motion: no gravity").toEqual({ gx: 0, gy: 0, seed: false });
    expect(input.sample(false).seed, "reduced motion ended: seed").toBe(true);
    input.destroy();
    // Just past the band acts, without a seed (a second input, so the held direction starts at flat).
    const fresh = new GravityInput(win, { source: "orientation", vector: [0, 0], strength: 980 });
    fresh.sample(false);
    orient(win, 0, 0);
    expect(fresh.sample(false).seed).toBe(true);
    orient(win, 0, 1.5);
    orient(win, 0, 1.9);
    expect(fresh.sample(false)).toEqual({ gx: 0, gy: 0, seed: false });
    orient(win, 0, 2.1);
    const past = fresh.sample(false);
    expect(past.seed).toBe(false);
    expect(past.gx, "2.1° acts").toBeCloseTo(980 * Math.sin((2.1 * Math.PI) / 180), 6);
    fresh.destroy();
    orient(win, 60, 0);
    expect(input.sample(false).gx, "destroyed: the listener is gone").toBeCloseTo(980 * Math.sin((3 * Math.PI) / 180), 6);
  });
});
