/**
 * @vitest-environment jsdom
 *
 * Ward 049: Tweakpane Visual Playground — red phase tests.
 * Tests #1-#7 per ward-049.md spec §10.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LiquidDOM } from "../src/index";
import {
  loadPlaygroundState,
  parseUrlParams,
  PLAYGROUND_STORAGE_KEY,
} from "../../demo/scenes/playground-state";

// jsdom polyfills — match runtime-truth.test.ts pattern
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe("Ward 049: setPhysicsConfig / getPhysicsConfig", () => {
  // ── Test #1: partial update applies, untouched fields preserved ──
  it("setPhysicsConfig_applies_partial_update", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    instance.setPhysicsConfig({ tension: 200 });

    const cfg = instance.getPhysicsConfig();
    expect(cfg.tension).toBe(200);
    expect(cfg.damping).toBe(5); // unchanged default
    expect(cfg.substeps).toBe(1); // unchanged default
    expect(cfg.neighborSpringK).toBe(30); // unchanged default

    instance.destroy();
  });

  // ── Test #2: validation rejects invalid input atomically ──
  it("setPhysicsConfig_validates_input", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    const before = instance.getPhysicsConfig();
    // Baseline check (M2): ensure `before` captured the real default, not a
    // live reference. A buggy getPhysicsConfig that returns the internal
    // object would make this test vacuous without this assertion.
    expect(before.tension).toBe(100);

    // Negative tension → TypeError per validatePhysicsConfig
    expect(() => instance.setPhysicsConfig({ tension: -1 })).toThrow(TypeError);
    // Non-integer substeps → TypeError
    expect(() => instance.setPhysicsConfig({ substeps: 1.5 })).toThrow(TypeError);
    // Non-finite damping → TypeError
    expect(() => instance.setPhysicsConfig({ damping: Infinity })).toThrow(TypeError);

    // Atomicity: state must be unchanged after any failed call
    const after = instance.getPhysicsConfig();
    expect(after).toEqual(before);

    instance.destroy();
  });

  // ── Test #3: destroyed instance throws with descriptive errors ──
  it("setPhysicsConfig_on_destroyed_instance_throws", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    instance.destroy();

    expect(() => instance.setPhysicsConfig({ tension: 200 })).toThrow(
      "Cannot setPhysicsConfig on a destroyed LiquidDOM instance",
    );
    expect(() => instance.getPhysicsConfig()).toThrow(
      "Cannot getPhysicsConfig on a destroyed LiquidDOM instance",
    );
  });

  // ── Test #5: getPhysicsConfig returns a shallow copy ──
  it("getPhysicsConfig_returns_shallow_copy", async () => {
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });

    const cfg = instance.getPhysicsConfig();
    cfg.tension = 9999; // mutate the returned object

    // Internal state must be unchanged
    expect(instance.getPhysicsConfig().tension).toBe(100);

    instance.destroy();
  });
});

describe("Ward 049: localStorage state loader", () => {
  beforeEach(() => {
    localStorage.removeItem(PLAYGROUND_STORAGE_KEY);
  });

  // ── Test #4: corrupt localStorage data → defaults, no throw, entry cleared ──
  it("playground_localStorage_recovers_from_corrupt_data", () => {
    localStorage.setItem(PLAYGROUND_STORAGE_KEY, "not json {{{");

    const result = loadPlaygroundState();

    expect(result).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();
  });

  // ── Test #6: schema mismatch + structurally invalid → null + cleared ──
  it("localStorage_recovers_from_schema_mismatch_and_invalid_shape", () => {
    // Schema version too new
    localStorage.setItem(
      PLAYGROUND_STORAGE_KEY,
      JSON.stringify({ schema: 2, physics: {}, theme: {} }),
    );
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();

    // Right schema, missing required fields
    localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify({ schema: 1 }));
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();
  });
});

describe("Ward 049: URL param parser", () => {
  let originalLocation: Location;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalLocation = window.location;
    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  function setSearch(search: string) {
    // jsdom allows overwriting window.location via Object.defineProperty
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search, pathname: "/playground.html" },
      writable: true,
      configurable: true,
    });
  }

  // ── Test #7: per-field validation + history.replaceState side effect ──
  it("parseUrlParams_validates_per_field", () => {
    // Valid capacity only — other fields absent
    setSearch("?capacity=128");
    let result = parseUrlParams();
    expect(result.capacity).toBe(128);
    expect(result.forceReducedMotion).toBeUndefined();
    expect(result.preserveBackgrounds).toBeUndefined();
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/playground.html");

    replaceStateSpy.mockClear();

    replaceStateSpy.mockClear();

    // Invalid capacity (non-integer) ignored; valid boolean kept
    setSearch("?capacity=abc&forceReducedMotion=true");
    result = parseUrlParams();
    expect(result.capacity).toBeUndefined();
    expect(result.forceReducedMotion).toBe(true);
    expect(replaceStateSpy).toHaveBeenCalled(); // anyValid → true

    replaceStateSpy.mockClear();

    // All-invalid: history.replaceState must NOT be called
    setSearch("?forceReducedMotion=yes");
    result = parseUrlParams();
    expect(result.forceReducedMotion).toBeUndefined();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
