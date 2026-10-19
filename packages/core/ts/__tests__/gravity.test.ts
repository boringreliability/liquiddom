/**
 * @vitest-environment jsdom
 * Gravity (W46 API): accepted and validated; since W83 (D83-1 … D83-5) it reaches every tick as
 * the source's gravity (none 0, fixed normalize(vector) · strength, orientation the projected
 * device tilt), the core's low-pass is seeded whenever a gravity starts fresh, reduced motion hands
 * the core 0, and setGravity(partial) changes it at run time. requestOrientationPermission is kept.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { createManualClock } from "../src/clock";
import { freshBackend, resetDom, setupFacadeTestEnv, spyBackend, ticksOf, type SpyBackend } from "./_facade-helpers";

let instance: LiquidDOMInstance | null = null;
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  instance?.destroy();
  instance = null;
});

const base = { autoObserve: false, particles: 1024, maxElements: 4 } as const;
function dispatchOrientation(beta: number, gamma: number): void {
  const event = new Event("deviceorientation") as DeviceOrientationEvent;
  Object.defineProperty(event, "beta", { value: beta });
  Object.defineProperty(event, "gamma", { value: gamma });
  window.dispatchEvent(event);
}

/** W83: the core's gravity calls from call `from` on, in order: "seed:gx:gy" and "tick:gx:gy". */
function gravityCalls(sb: SpyBackend, from = 0): string[] {
  return sb.calls.slice(from).flatMap((c) => {
    if (c.method === "seed_gravity") return [`seed:${String(c.args[0])}:${String(c.args[1])}`];
    if (c.method === "tick") return [`tick:${String(c.args[6])}:${String(c.args[7])}`];
    return [];
  });
}

type MotionListener = (e: { matches: boolean }) => void;

/** W83: a prefers-reduced-motion query the test can flip (every other query never matches). */
function stubReducedMotion(initial: boolean): { fire(matches: boolean): void; restore(): void } {
  const listeners = new Set<MotionListener>();
  const rm = {
    matches: initial,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_t: string, cb: MotionListener) => listeners.add(cb),
    removeEventListener: (_t: string, cb: MotionListener) => listeners.delete(cb),
    addListener: (cb: MotionListener) => listeners.add(cb),
    removeListener: (cb: MotionListener) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  const other = { ...rm, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((q: string) => (q.includes("prefers-reduced-motion") ? rm : { ...other, media: q })),
  });
  return {
    fire(matches: boolean) {
      rm.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
    restore() {
      if (original) Object.defineProperty(window, "matchMedia", original);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}

describe("Gravity (W46 API, W83 high-pass)", () => {
  it("given_gravity_fixed_vector_when_create_then_accepted", async () => {
    instance = await LiquidDOM.create({ ...base, testBackend: freshBackend(), gravity: { source: "fixed", vector: [50, 980] } });
    expect(instance.requestOrientationPermission).toBeDefined();
  });

  it("given_gravity_source_none_default_when_create_then_no_throw", async () => {
    instance = await LiquidDOM.create({ ...base, testBackend: freshBackend() });
    expect(instance).toBeDefined();
  });

  it("given_gravity_fixed_without_vector_when_create_then_no_throw", async () => {
    instance = await LiquidDOM.create({ ...base, testBackend: freshBackend(), gravity: { source: "fixed" } });
    expect(instance).toBeDefined();
  });

  it("given_invalid_gravity_when_create_then_TypeError", async () => {
    await expect(LiquidDOM.create({ ...base, testBackend: freshBackend(), gravity: { source: "sideways" as "none" } })).rejects.toBeInstanceOf(TypeError);
  });

  // W83 red: approved-test change (D83-1, D83-4): fixed and orientation reach tick since W83, so
  // this test keeps only `none`: its low-pass is seeded with (0, 0) once, before the first tick,
  // and every tick gets zero gravity, also after an orientation event.
  it("given_gravity_none_when_ticking_then_the_low_pass_is_seeded_with_zero_once_and_every_tick_receives_zero_gravity_even_after_an_orientation_event", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const add = vi.spyOn(window, "addEventListener");
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "none" } });
    dispatchOrientation(45, -45);
    clock.advance(3);
    const listened = add.mock.calls.filter((c) => c[0] === "deviceorientation").length;
    add.mockRestore();
    expect(listened, "source none adds no orientation listener").toBe(0);
    const calls = gravityCalls(sb);
    expect(calls[0]).toBe("seed:0:0");
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.slice(1).every((c) => c === "tick:0:0"), calls.join(" ")).toBe(true);
  });

  // W83 red: approved-test change (D83-3, D83-4): fixed gravity is normalize(vector) · strength (was the
  // raw vector), and the core's low-pass is seeded with it before the first tick, so it starts at rest.
  it("given_gravity_fixed_when_created_then_the_low_pass_is_seeded_with_normalize_vector_times_strength_before_the_first_tick_and_every_tick_receives_it", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [50, 980] } });
    clock.advance(2);
    const len = Math.hypot(50, 980);
    const calls = gravityCalls(sb);
    const args = (c: string): number[] => c.split(":").slice(1).map(Number);
    expect(calls[0]!.startsWith("seed:")).toBe(true);
    const seed = args(calls[0]!);
    expect(seed[0]!).toBeCloseTo((50 / len) * 980, 9);
    expect(seed[1]!).toBeCloseTo((980 / len) * 980, 9);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls.slice(1)) {
      expect(c.startsWith("tick:"), calls.join(" ")).toBe(true);
      const t = args(c);
      expect(Object.is(t[0], seed[0]) && Object.is(t[1], seed[1]), `tick args equal the seed args: ${c}`).toBe(true);
    }
  });

  // W83 red: approved-test change (D83-5): β 45, γ −45 maps to (−490, 692.96) by the approved projection
  // (py = sin β; the skipped W46 test expected 490), and the first reading seeds the low-pass.
  it("given_orientation_event_when_ticking_then_beta_gamma_mapped_to_gx_gy_and_the_first_reading_seeds", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "orientation", strength: 980 } });
    clock.advance(1);
    const n = sb.calls.length;
    dispatchOrientation(45, -45);
    clock.advance(1);
    expect(gravityCalls(sb, n).map((c) => c.split(":")[0])).toEqual(["seed", "tick"]);
    const args = ticksOf(sb).at(-1)!;
    expect(args[6]).toBeCloseTo(-490, 3);
    expect(args[7]).toBeCloseTo(980 * Math.SQRT1_2, 3);
  });

  // W83 red: approved-test change: un-skipped (the slice-6 ward is W83); the body is unchanged.
  it("given_reduced_motion_when_ticking_then_gravity_clamped_to_zero", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, forceReducedMotion: true, gravity: { source: "fixed", vector: [0, 980] } });
    clock.advance(1);
    expect(ticksOf(sb).at(-1)!.slice(6, 8)).toEqual([0, 0]);
  });

  // W83 red: approved-test change: un-skipped (the slice-6 ward is W83); the body is unchanged.
  it("given_orientation_source_when_destroyed_then_deviceorientation_listener_removed", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const spy = vi.spyOn(window, "removeEventListener");
    try {
      instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "orientation" } });
      instance.destroy();
      instance = null;
      expect(spy.mock.calls.map((c) => c[0])).toContain("deviceorientation");
    } finally {
      spy.mockRestore();
    }
  });

  it("requestOrientationPermission_handles_unsupported_jsdom_default", async () => {
    instance = await LiquidDOM.create({ ...base, testBackend: freshBackend() });
    expect(await instance.requestOrientationPermission()).toBe(true);
  });

  it("requestOrientationPermission_handles_unsupported_explicit_stub", async () => {
    const w = window as unknown as { DeviceOrientationEvent?: unknown };
    const original = w.DeviceOrientationEvent;
    w.DeviceOrientationEvent = function MockDOE() {} as unknown as typeof DeviceOrientationEvent;
    try {
      instance = await LiquidDOM.create({ ...base, testBackend: freshBackend() });
      expect(await instance.requestOrientationPermission()).toBe(true);
    } finally {
      w.DeviceOrientationEvent = original;
    }
  });

  it("requestOrientationPermission_handles_ios_grant_and_deny", async () => {
    const w = window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } };
    const original = w.DeviceOrientationEvent;
    try {
      for (const [impl, expected] of [
        [() => Promise.resolve("granted"), true],
        [() => Promise.resolve("denied"), false],
        [() => Promise.reject(new Error("user gesture required")), false],
      ] as const) {
        w.DeviceOrientationEvent = { requestPermission: impl } as never;
        instance = await LiquidDOM.create({ ...base, testBackend: freshBackend() });
        expect(await instance.requestOrientationPermission()).toBe(expected);
        instance.destroy();
        instance = null;
      }
    } finally {
      w.DeviceOrientationEvent = original;
    }
  });
});

describe("W83 setGravity and the gravity sources (D83-3 … D83-5)", () => {
  it("given_fixed_gravity_when_setGravity_changes_the_vector_then_the_next_ticks_receive_the_new_gravity_without_a_seed", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [0, 1] } });
    clock.advance(1);
    const n = sb.calls.length;
    instance.setGravity({ vector: [1, 0] });
    clock.advance(2);
    expect(gravityCalls(sb, n), "a change within the source acts (D83-1)").toEqual(["tick:980:0", "tick:980:0"]);
    const m = sb.calls.length;
    instance.setGravity({ source: "fixed", vector: [1, 0] }); // same source: no seed
    clock.advance(1);
    expect(gravityCalls(sb, m), "restating the source is not a switch").toEqual(["tick:980:0"]);
  });

  it("given_a_source_switch_when_setGravity_then_the_low_pass_is_seeded_before_the_next_tick_and_the_orientation_listener_follows_the_source", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const orientationListeners = (spy: typeof add): unknown[] =>
      spy.mock.calls.filter((c) => c[0] === "deviceorientation").map((c) => c[1]);
    try {
      instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [0, 1] } });
      clock.advance(1);
      expect(orientationListeners(add), "fixed: no listener").toEqual([]);
      let n = sb.calls.length;
      instance.setGravity({ source: "none" });
      clock.advance(1);
      expect(gravityCalls(sb, n)).toEqual(["seed:0:0", "tick:0:0"]);
      instance.setGravity({ source: "orientation" });
      expect(orientationListeners(add)).toHaveLength(1);
      n = sb.calls.length;
      clock.advance(1);
      expect(gravityCalls(sb, n), "no reading yet: no gravity, seeded").toEqual(["seed:0:0", "tick:0:0"]);
      instance.setGravity({ source: "fixed" });
      expect(orientationListeners(remove), "the same listener is removed").toEqual(orientationListeners(add));
      n = sb.calls.length;
      clock.advance(1);
      expect(gravityCalls(sb, n), "back to fixed (0, 1) · 980: seeded, so it starts at rest").toEqual(["seed:0:980", "tick:0:980"]);
      instance.setGravity({ source: "orientation" });
      instance.destroy();
      instance = null;
      expect(orientationListeners(add)).toHaveLength(2);
      expect(orientationListeners(remove), "destroy removes the second listener too").toEqual(orientationListeners(add));
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it("given_an_invalid_partial_when_setGravity_then_a_TypeError_names_the_problem_the_gravity_is_unchanged_and_after_destroy_it_throws_Error", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [0, 1] } });
    clock.advance(1);
    const n = sb.calls.length;
    const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
      [null, /setGravity.*object/],
      [{ tilt: 1 }, /unknown gravity option "tilt"/],
      [{ source: "sideways" }, /gravity\.source/],
      [{ vector: [1, Number.NaN] }, /gravity\.vector/],
      [{ strength: -1 }, /gravity\.strength/],
      [{ vector: [1, 0], strength: -1 }, /gravity\.strength/], // the valid half is not applied either
    ];
    for (const [bad, message] of cases) {
      expect(() => instance!.setGravity(bad as never), String(message)).toThrow(TypeError);
      expect(() => instance!.setGravity(bad as never)).toThrow(message);
    }
    clock.advance(1);
    expect(gravityCalls(sb, n), "state unchanged: fixed (0, 980), no seed").toEqual(["tick:0:980"]);
    const destroyed = instance;
    destroyed.destroy();
    instance = null;
    expect(() => destroyed.setGravity({ vector: [1, 0] })).toThrow(/destroyed/);
    expect(() => destroyed.setGravity({ vector: [1, 0] })).not.toThrow(TypeError);
  });

  it("given_a_partial_with_a_getter_when_setGravity_then_the_value_is_read_once", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [0, 1] } });
    let reads = 0;
    const partial = {
      get vector(): [number, number] {
        reads += 1;
        return reads === 1 ? [1, 0] : [0, -1];
      },
    };
    instance.setGravity(partial);
    clock.advance(1);
    expect(reads).toBe(1);
    expect(ticksOf(sb).at(-1)!.slice(6, 8)).toEqual([980, 0]);
  });

  it("given_reduced_motion_when_it_ends_then_the_low_pass_is_seeded_with_the_gravity_before_the_first_tick_with_motion", async () => {
    const media = stubReducedMotion(true);
    try {
      const sb = spyBackend();
      const clock = createManualClock();
      instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [0, 1] } });
      clock.advance(2);
      const reduced = gravityCalls(sb);
      expect(reduced.length).toBeGreaterThan(0);
      expect(reduced.every((c) => c === "tick:0:0"), `under reduced motion: ${reduced.join(" ")}`).toBe(true);
      const n = sb.calls.length;
      media.fire(false);
      clock.advance(1);
      expect(gravityCalls(sb, n)).toEqual(["seed:0:980", "tick:0:980"]);
    } finally {
      media.restore();
    }
  });

  it("given_orientation_source_when_the_first_reading_arrives_then_it_seeds_and_a_later_tilt_beyond_the_dead_band_acts_without_a_seed", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "orientation", strength: 980 } });
    clock.advance(1);
    let n = sb.calls.length;
    dispatchOrientation(90, 0); // portrait upright
    clock.advance(1);
    expect(gravityCalls(sb, n)).toEqual(["seed:0:980", "tick:0:980"]);
    n = sb.calls.length;
    dispatchOrientation(60, 0); // tilted back by 30°
    clock.advance(1);
    const calls = gravityCalls(sb, n);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startsWith("tick:0:")).toBe(true);
    expect(ticksOf(sb).at(-1)![7]).toBeCloseTo(980 * Math.sin(Math.PI / 3), 6);
    // A strength change is a change within the source: no seed, and still the one listener.
    const add = vi.spyOn(window, "addEventListener");
    n = sb.calls.length;
    instance.setGravity({ strength: 500 });
    clock.advance(1);
    const after = gravityCalls(sb, n);
    const added = add.mock.calls.filter((c) => c[0] === "deviceorientation").length;
    add.mockRestore();
    expect(after).toHaveLength(1);
    expect(after[0]!.startsWith("tick:")).toBe(true);
    expect(added, "no second listener").toBe(0);
    expect(ticksOf(sb).at(-1)![7]).toBeCloseTo(500 * Math.sin(Math.PI / 3), 6);
  });
});
