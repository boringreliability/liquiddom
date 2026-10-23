/**
 * @vitest-environment jsdom
 *
 * Ward 069, moved to the site in W86 (D86-5): schema 3. Material playground
 * state. Port of the W49 mechanism (localStorage + URL overrides +
 * Tweakpane-free state module) from LiquidPhysicsConfig to Material (spec §5
 * "playground ported to material"); W86 adds gravity and dragOff.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { presets, validateMaterial } from "liquiddom";
import { DEFAULT_MATERIAL } from "../../packages/core/ts/src/material"; // not public
import {
  PLAYGROUND_STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  PLAYGROUND_DEFAULT_MATERIAL,
  DEFAULT_PLAYGROUND_INIT,
  DEFAULT_PLAYGROUND_GRAVITY,
  PLAYGROUND_ELEMENT_IDS,
  loadPlaygroundState,
  savePlaygroundState,
  parseUrlParams,
  buildInitialState,
  detectPreset,
  applyMaterialChange,
  isValidMaterial,
  type PlaygroundState,
} from "../src/playground/state";

const V1_KEY = "liquiddom-playground-v1";
const V2_KEY = "liquiddom-playground-v2";

describe("W69: playground localStorage state (schema 3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("given_saved_v1_or_v2_state_when_loading_then_discarded_and_null", () => {
    expect(LEGACY_STORAGE_KEYS).toEqual([V1_KEY, V2_KEY]);
    localStorage.setItem(
      V1_KEY,
      JSON.stringify({ schema: 1, physics: { tension: 100 }, theme: { colorDefault: "#000", colorHover: "#fff" } }),
    );

    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(V1_KEY)).toBeNull();

    // A schema-2 payload under the v2 key is discarded, never migrated.
    localStorage.setItem(
      V2_KEY,
      JSON.stringify({
        schema: 2,
        material: { viscosity: 0.9, cohesion: 0.7, recovery: 1.6 },
        init: { particles: 4096, seed: 7, renderer: "canvas2d", forceReducedMotion: true },
      }),
    );
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBeNull();

    // A schema-1 payload stored under the v3 key is discarded too, never migrated.
    localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify({ schema: 1, physics: {}, theme: {} }));
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();

    // A schema-2 payload under the v3 key is discarded.
    localStorage.setItem(
      PLAYGROUND_STORAGE_KEY,
      JSON.stringify({
        schema: 2,
        material: { viscosity: 0.9, cohesion: 0.7, recovery: 1.6 },
        init: { particles: 4096, seed: 7, renderer: "canvas2d", forceReducedMotion: true },
      }),
    );
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();
  });

  it("given_valid_v3_state_when_loading_then_material_gravity_and_drag_restored", () => {
    expect(PLAYGROUND_ELEMENT_IDS).toContain("pill-b");
    // Baseline: nothing saved → defaults.
    const fresh = buildInitialState(null, {}, PLAYGROUND_DEFAULT_MATERIAL);
    expect(fresh).toEqual({
      schema: 3,
      material: { ...PLAYGROUND_DEFAULT_MATERIAL },
      init: { ...DEFAULT_PLAYGROUND_INIT },
      gravity: { ...DEFAULT_PLAYGROUND_GRAVITY },
      dragOff: [],
    });

    const saved: PlaygroundState = {
      schema: 3,
      material: { viscosity: 0.9, cohesion: 0.7, recovery: 1.6 },
      init: { particles: 4096, seed: 7, renderer: "canvas2d", forceReducedMotion: true },
      gravity: { source: "fixed", angle: 135, strength: 600 },
      dragOff: ["pill-b"],
    };
    expect(savePlaygroundState(saved)).toBe(true);

    const loaded = loadPlaygroundState();
    expect(loaded).toEqual(saved);
    expect(loaded).not.toBe(saved);

    const built = buildInitialState(loaded, {}, PLAYGROUND_DEFAULT_MATERIAL);
    expect(built.material).toEqual(saved.material);
    expect(built.init).toEqual(saved.init);
    expect(built.gravity).toEqual(saved.gravity);
    expect(built.dragOff).toEqual(saved.dragOff);
    expect(built.material).not.toBe(loaded?.material);

    // URL overrides win over the saved init; the material is untouched.
    const overridden = buildInitialState(loaded, { particles: 8192, renderer: "auto" }, PLAYGROUND_DEFAULT_MATERIAL);
    expect(overridden.init).toEqual({ particles: 8192, seed: 7, renderer: "auto", forceReducedMotion: true });
    expect(overridden.material).toEqual(saved.material);
  });

  it("given_corrupt_json_when_loading_then_null_and_entry_cleared", () => {
    localStorage.setItem(PLAYGROUND_STORAGE_KEY, "not json {{{");
    expect(loadPlaygroundState()).toBeNull();
    expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();
  });

  it("given_v3_payload_with_out_of_range_material_init_gravity_or_drag_when_loading_then_null_and_entry_cleared", () => {
    const good = {
      schema: 3,
      material: { viscosity: 0.5, cohesion: 0.5, recovery: 0.7 },
      init: { particles: 8000, seed: 1, renderer: "auto", forceReducedMotion: false },
      gravity: { source: "fixed", angle: 90, strength: 980 },
      dragOff: [] as string[],
    };
    const bad: unknown[] = [
      { ...good, material: { ...good.material, viscosity: 2 } },
      { ...good, material: { ...good.material, recovery: 0.1 } },
      { ...good, material: { viscosity: 0.5, cohesion: 0.5 } },
      { ...good, init: { ...good.init, particles: 100 } },
      { ...good, init: { ...good.init, particles: 1.5 } },
      { ...good, init: { ...good.init, seed: -1 } },
      { ...good, init: { ...good.init, renderer: "vulkan" } },
      { ...good, init: { ...good.init, forceReducedMotion: "yes" } },
      { ...good, gravity: { ...good.gravity, source: "sideways" } },
      { ...good, gravity: { ...good.gravity, angle: 360 } },
      { ...good, gravity: { ...good.gravity, strength: -1 } },
      { ...good, dragOff: ["nope"] },
      { schema: 3, material: good.material },
      [],
      42,
    ];
    for (const payload of bad) {
      localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
      expect(loadPlaygroundState(), JSON.stringify(payload)).toBeNull();
      expect(localStorage.getItem(PLAYGROUND_STORAGE_KEY)).toBeNull();
    }
  });

  it("given_material_bounds_when_checked_then_isValidMaterial_agrees_with_core_validateMaterial_and_defaults_match", () => {
    expect({ ...PLAYGROUND_DEFAULT_MATERIAL }).toEqual({ ...DEFAULT_MATERIAL });
    const probes: Array<Partial<Record<"viscosity" | "cohesion" | "recovery", number>>> = [
      {},
      { viscosity: 0 }, { viscosity: 1 }, { viscosity: -0.01 }, { viscosity: 1.01 }, { viscosity: Number.NaN },
      { cohesion: 0 }, { cohesion: 1 }, { cohesion: 1.5 }, { cohesion: Number.POSITIVE_INFINITY },
      { recovery: 0.2 }, { recovery: 3 }, { recovery: 0.19 }, { recovery: 3.01 },
    ];
    for (const probe of probes) {
      const candidate = { ...DEFAULT_MATERIAL, ...probe };
      let coreAccepts = true;
      try {
        validateMaterial(candidate);
      } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        coreAccepts = false;
      }
      expect(isValidMaterial(candidate), JSON.stringify(probe)).toBe(coreAccepts);
    }
  });
});

describe("W69: playground URL params", () => {
  let originalLocation: Location;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalLocation = window.location;
    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true });
    replaceStateSpy.mockRestore();
  });

  function setSearch(search: string, hash = ""): void {
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search, hash, pathname: "/playground.html" },
      writable: true,
      configurable: true,
    });
  }

  it("given_url_params_particles_seed_renderer_when_parsed_then_validated_and_stripped", () => {
    setSearch("?particles=4096&seed=42&renderer=canvas2d&forceReducedMotion=true");
    expect(parseUrlParams()).toEqual({ particles: 4096, seed: 42, renderer: "canvas2d", forceReducedMotion: true });
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/playground.html");
    replaceStateSpy.mockClear();

    // Bounds: D66-6 particles [256, 65536], seed u32.
    setSearch("?particles=65536&seed=4294967295&renderer=webgpu");
    expect(parseUrlParams()).toEqual({ particles: 65536, seed: 4294967295, renderer: "webgpu" });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    replaceStateSpy.mockClear();

    // Known keys present but every value invalid: defaults kept, query still stripped.
    for (const q of ["?particles=100&seed=-1&renderer=vulkan&forceReducedMotion=yes", "?particles=8000abc&seed=4294967296", "?particles=65537&seed=1.5"]) {
      setSearch(q);
      expect(parseUrlParams()).toEqual({});
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      replaceStateSpy.mockClear();
    }

    // Unknown keys only: address bar untouched.
    setSearch("?utm=1");
    expect(parseUrlParams()).toEqual({});
    expect(replaceStateSpy).not.toHaveBeenCalled();

    // Invalid value plus a hash: query stripped, hash kept.
    setSearch("?particles=abc", "#x");
    expect(parseUrlParams()).toEqual({});
    expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/playground.html#x");
    replaceStateSpy.mockClear();

    // A mix: invalid ones dropped, valid ones kept.
    setSearch("?particles=abc&seed=9");
    expect(parseUrlParams()).toEqual({ seed: 9 });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("W69: playground material bindings", () => {
  it("given_material_binding_change_when_applied_then_setMaterial_called_with_partial", () => {
    const instance = { setMaterial: vi.fn(), getMaterial: vi.fn(() => ({ ...DEFAULT_MATERIAL })) };
    const state = buildInitialState(null, {}, PLAYGROUND_DEFAULT_MATERIAL);
    state.material.viscosity = 0.8; // Tweakpane writes into the bound object before "change" fires

    expect(applyMaterialChange(instance, state, "viscosity")).toBe(true);
    expect(instance.setMaterial).toHaveBeenCalledTimes(1);
    expect(instance.setMaterial).toHaveBeenCalledWith({ viscosity: 0.8 });
    expect(instance.getMaterial).not.toHaveBeenCalled();
  });

  it("given_rejected_material_change_when_applied_then_state_reverted_to_instance_material", () => {
    const live = { viscosity: 0.5, cohesion: 0.5, recovery: 0.7 };
    const instance = {
      setMaterial: vi.fn(() => {
        throw new TypeError("viscosity must be in [0, 1]");
      }),
      getMaterial: vi.fn(() => ({ ...live })),
    };
    const state = buildInitialState(null, {}, PLAYGROUND_DEFAULT_MATERIAL);
    state.material.viscosity = 7;

    expect(applyMaterialChange(instance, state, "viscosity")).toBe(false);
    expect(state.material).toEqual(live);

    // Non-TypeError errors (e.g. destroyed instance) propagate.
    const destroyed = {
      setMaterial: vi.fn(() => {
        throw new Error("destroyed");
      }),
      getMaterial: vi.fn(),
    };
    expect(() => applyMaterialChange(destroyed, state, "cohesion")).toThrow("destroyed");
  });

  it("given_material_equal_to_a_preset_within_slider_rounding_when_detected_then_preset_name_else_custom", () => {
    expect(detectPreset({ ...presets.honey }, presets)).toBe("honey");
    expect(detectPreset({ ...presets.jelly }, presets)).toBe("jelly");
    expect(
      detectPreset(
        { viscosity: presets.water.viscosity + 0.001, cohesion: presets.water.cohesion, recovery: presets.water.recovery },
        presets,
      ),
    ).toBe("water");
    // The tolerance is 0.005 per field: pin both sides of it.
    const nearWater = (dv: number) => ({
      viscosity: presets.water.viscosity + dv,
      cohesion: presets.water.cohesion,
      recovery: presets.water.recovery,
    });
    expect(detectPreset(nearWater(0.0049), presets)).toBe("water");
    expect(detectPreset(nearWater(0.0051), presets)).toBe("custom");
    expect(detectPreset({ ...DEFAULT_MATERIAL }, presets)).toBe("custom");
    expect(detectPreset({ viscosity: 0.33, cohesion: 0.5, recovery: 0.7 }, presets)).toBe("custom");
  });
});
