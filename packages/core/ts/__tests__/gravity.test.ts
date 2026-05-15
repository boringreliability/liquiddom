/**
 * @vitest-environment jsdom
 *
 * Ward 046: Device Orientation Gravity Vector — TS tests T4-T10.
 * Spec at `.wdd/wards/ward-046.md` r2.
 *
 * Tests T1-T3 are Rust-side in `src/api.rs::tests`.
 *
 * jsdom note: WASM does not load, so `core.tick` is never invoked. These
 * tests verify the public-API contract (options accepted, listeners
 * attached/removed, permission helper). The numeric gx/gy that would flow
 * into `tick()` are covered by the Rust tests T1-T3.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/** Dispatch a `deviceorientation` event with the given `beta` / `gamma`. */
function dispatchOrientation(beta: number, gamma: number): void {
  const event = new Event("deviceorientation") as DeviceOrientationEvent;
  Object.defineProperty(event, "beta", { value: beta, configurable: true });
  Object.defineProperty(event, "gamma", { value: gamma, configurable: true });
  window.dispatchEvent(event);
}

describe("Ward 046: Gravity TS API", () => {
  let instance: LiquidDOMInstance | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    if (instance) {
      instance.destroy();
      instance = null;
    }
  });

  // ── T4: source: 'fixed' is accepted without throwing ──
  it("gravity_fixed_vector_initializes_correctly", async () => {
    instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      gravity: { source: "fixed", vector: [50, 980] },
    });
    expect(instance.requestOrientationPermission).toBeDefined();
  });

  // ── T5: source: 'none' (default) is a valid construction ──
  it("gravity_source_none_default_no_throw", async () => {
    instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    expect(instance).toBeDefined();
  });

  // ── T6: orientation event dispatches without error ──
  // The gx/gy values produced by beta/gamma → gravityX/gravityY mapping are
  // closed-over locals; the assertion that they reach `tick()` lives in the
  // Rust tests. Here we just ensure dispatching the event doesn't blow up.
  it("gravity_orientation_beta_gamma_mapping", async () => {
    instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      gravity: { source: "orientation", strength: 980 },
    });
    dispatchOrientation(30, 45);
    expect(instance).toBeDefined();
  });

  // ── T6b: orientation listener IS attached when source is 'orientation' ──
  it("gravity_orientation_attaches_window_listener", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      gravity: { source: "orientation", strength: 980 },
    });

    const orientationCalls = addSpy.mock.calls.filter(
      (call) => call[0] === "deviceorientation",
    );
    expect(orientationCalls.length).toBeGreaterThan(0);
    addSpy.mockRestore();
  });

  // ── T7: reduced-motion clamps gravity (verified indirectly via no throw) ──
  it("gravity_reduced_motion_clamps_to_zero", async () => {
    instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      forceReducedMotion: true,
      gravity: { source: "fixed", vector: [100, 100] },
    });
    expect(instance.isReducedMotion).toBe(true);
    // The clamp is in the RAF loop: `gx = reducedMotion ? 0 : gravityX`.
    // jsdom doesn't run the RAF loop with WASM, so we verify the option
    // structure is accepted and isReducedMotion is reflected.
  });

  // ── T8a: requestOrientationPermission returns true when API unavailable ──
  it("requestOrientationPermission_handles_unsupported_jsdom_default", async () => {
    instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    // jsdom default: window.DeviceOrientationEvent is undefined.
    const result = await instance.requestOrientationPermission();
    expect(result).toBe(true);
  });

  // ── T8b: requestOrientationPermission returns true when API exists but no requestPermission ──
  it("requestOrientationPermission_handles_unsupported_explicit_stub", async () => {
    const w = window as unknown as { DeviceOrientationEvent?: unknown };
    const original = w.DeviceOrientationEvent;
    w.DeviceOrientationEvent = function MockDOE() {} as unknown as typeof DeviceOrientationEvent;
    try {
      instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
      const result = await instance.requestOrientationPermission();
      expect(result).toBe(true);
    } finally {
      w.DeviceOrientationEvent = original;
    }
  });

  // ── T8c: iOS-style grant returns true; iOS-style deny returns false ──
  it("requestOrientationPermission_handles_ios_grant_and_deny", async () => {
    const w = window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    };
    const original = w.DeviceOrientationEvent;
    try {
      // GRANT
      w.DeviceOrientationEvent = {
        requestPermission: () => Promise.resolve("granted"),
      } as unknown as typeof DeviceOrientationEvent;
      instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
      expect(await instance.requestOrientationPermission()).toBe(true);
      instance.destroy();

      // DENY
      w.DeviceOrientationEvent = {
        requestPermission: () => Promise.resolve("denied"),
      } as unknown as typeof DeviceOrientationEvent;
      instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
      expect(await instance.requestOrientationPermission()).toBe(false);
      instance.destroy();

      // THROW → caught as deny
      w.DeviceOrientationEvent = {
        requestPermission: () => Promise.reject(new Error("user gesture required")),
      } as unknown as typeof DeviceOrientationEvent;
      instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
      expect(await instance.requestOrientationPermission()).toBe(false);
    } finally {
      w.DeviceOrientationEvent = original;
    }
  });

  // ── T9: destroy() removes the orientation listener ──
  it("gravity_orientation_listener_removed_on_destroy", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const localInstance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      gravity: { source: "orientation" },
    });
    localInstance.destroy();
    instance = null;

    const orientationRemovals = removeSpy.mock.calls.filter(
      (call) => call[0] === "deviceorientation",
    );
    expect(orientationRemovals.length).toBeGreaterThan(0);
    removeSpy.mockRestore();
  });

  // ── T10: source: 'fixed' without vector is treated as [0, 0] ──
  it("gravity_fixed_without_vector_is_zero_no_throw", async () => {
    // No vector field. Should not throw, gravity initializes to (0, 0).
    instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      gravity: { source: "fixed" },
    });
    expect(instance).toBeDefined();
  });
});
