/**
 * @vitest-environment jsdom
 * Gravity (W46 API) during the fluid rewrite: accepted and validated, NO
 * effect until slice 6 (spec §6 "Interim state"). Effect tests are skipped
 * with a slice-6 reference; requestOrientationPermission is kept.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { createManualClock } from "../src/clock";
import { freshBackend, resetDom, setupFacadeTestEnv, spyBackend, ticksOf } from "./_facade-helpers";

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

describe("Gravity (interim, slices 1–5)", () => {
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

  it("given_gravity_option_when_create_then_accepted_but_tick_receives_zero_gravity", async () => {
    for (const gravity of [{ source: "fixed", vector: [50, 980] }, { source: "orientation", strength: 980 }, { source: "none" }] as const) {
      const sb = spyBackend();
      const clock = createManualClock();
      instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { ...gravity, vector: "vector" in gravity ? [...gravity.vector] as [number, number] : undefined } });
      dispatchOrientation(45, -45);
      clock.advance(3);
      const ticks = ticksOf(sb);
      expect(ticks.length).toBeGreaterThan(0);
      for (const args of ticks) {
        expect(args[6]).toBe(0);
        expect(args[7]).toBe(0);
      }
      instance.destroy();
      instance = null;
    }
  });

  it.skip("slice 6 ward: given_gravity_fixed_when_ticking_then_tick_receives_the_vector", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "fixed", vector: [50, 980] } });
    clock.advance(1);
    expect(ticksOf(sb).at(-1)!.slice(6, 8)).toEqual([50, 980]);
  });

  it.skip("slice 6 ward: given_orientation_event_when_ticking_then_beta_gamma_mapped_to_gx_gy", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "orientation", strength: 980 } });
    dispatchOrientation(45, -45);
    clock.advance(1);
    const args = ticksOf(sb).at(-1)!;
    expect(args[6]).toBeCloseTo(-490, 3);
    expect(args[7]).toBeCloseTo(490, 3);
  });

  it.skip("slice 6 ward: given_reduced_motion_when_ticking_then_gravity_clamped_to_zero", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, forceReducedMotion: true, gravity: { source: "fixed", vector: [0, 980] } });
    clock.advance(1);
    expect(ticksOf(sb).at(-1)!.slice(6, 8)).toEqual([0, 0]);
  });

  it.skip("slice 6 ward: given_orientation_source_when_destroyed_then_deviceorientation_listener_removed", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ ...base, testBackend: sb.backend, clock, gravity: { source: "orientation" } });
    instance.destroy();
    instance = null;
    dispatchOrientation(90, 90);
    clock.advance(1);
    expect(ticksOf(sb).length).toBeGreaterThanOrEqual(0);
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
