/**
 * @vitest-environment jsdom
 * W66 T1: option resolution and validation (D66-1, D66-6, D66-7, D66-8, D66-14, C3, C4, B13).
 */
import { describe, it, expect } from "vitest";
import { OPTION_KEYS, REMOVED_OPTIONS, resolveOptions, validateElementOptions, type LiquidOptions } from "../src/options";
import { DEFAULT_MATERIAL, validateMaterial } from "../src/material";
import { freshBackend } from "./_facade-helpers";

function typeErrorOf(fn: () => unknown): TypeError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TypeError);
    return err as TypeError;
  }
  throw new Error("expected a TypeError, nothing was thrown");
}

describe("W66 T1: resolveOptions", () => {
  it("given_no_options_when_resolved_then_defaults_8000_particles_32_elements_auto_material_defaults_gravity_none", () => {
    for (const r of [resolveOptions(), resolveOptions({})]) {
      expect(r.particles).toBe(8000);
      expect(r.maxElements).toBe(32);
      expect(r.renderer).toBe("auto");
      expect(r.material).toEqual({ viscosity: 0.5, cohesion: 0.5, recovery: 0.7 });
      expect(r.material).not.toBe(DEFAULT_MATERIAL); // D66-14: a fresh, complete Material
      expect(r.gravity).toEqual({ source: "none", vector: [0, 0], strength: 980 });
      expect(r.autoObserve).toBe(true);
      expect(r.forceReducedMotion).toBe(false);
      expect(r.silentFallback).toBe(false);
      expect(Number.isInteger(r.seed)).toBe(true);
      expect(r.seed).toBeGreaterThanOrEqual(0);
      expect(r.seed).toBeLessThanOrEqual(0xffff_ffff);
      expect(r.container).toBeUndefined();
      expect(r.testBackend).toBeUndefined();
      expect(r.loader).toBeUndefined();
      expect(r.clock).toBeUndefined();
    }
  });

  it("given_seed_omitted_when_resolved_repeatedly_then_each_seed_is_a_u32_and_not_all_equal", () => {
    const seeds = Array.from({ length: 6 }, () => resolveOptions().seed);
    for (const s of seeds) expect(s >>> 0).toBe(s);
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("given_explicit_seed_when_resolved_then_kept_and_invalid_seed_TypeError", () => {
    expect(resolveOptions({ seed: 0 }).seed).toBe(0);
    expect(resolveOptions({ seed: 0xffff_ffff }).seed).toBe(0xffff_ffff);
    for (const bad of [-1, 1.5, 2 ** 32, Number.NaN, "1"]) {
      expect(typeErrorOf(() => resolveOptions({ seed: bad as number })).message).toMatch(/seed/);
    }
  });

  it("given_non_integer_or_out_of_range_particles_or_maxElements_when_resolved_then_TypeError", () => {
    expect(resolveOptions({ particles: 256 }).particles).toBe(256);
    expect(resolveOptions({ particles: 65536 }).particles).toBe(65536);
    expect(resolveOptions({ maxElements: 1 }).maxElements).toBe(1);
    expect(resolveOptions({ maxElements: 256 }).maxElements).toBe(256);
    for (const bad of [255, 65537, 1000.5, Number.NaN, Number.POSITIVE_INFINITY, "8000"]) {
      expect(typeErrorOf(() => resolveOptions({ particles: bad as number })).message).toMatch(/particles.*\[256, 65536\]/);
    }
    for (const bad of [0, 257, 2.5, Number.NaN, "32"]) {
      expect(typeErrorOf(() => resolveOptions({ maxElements: bad as number })).message).toMatch(/maxElements.*\[1, 256\]/);
    }
  });

  it("given_removed_option_capacity_physics_colorDefault_colorHover_colorSource_theme_refraction_preserveBackgrounds_snapDurationMs_canvasZIndex_maxDt_when_resolved_then_TypeError_naming_replacement", () => {
    const expectations: Record<string, RegExp> = {
      capacity: /maxElements/,
      physics: /material/,
      colorDefault: /background-color/,
      colorHover: /background-color/,
      colorSource: /background-color/,
      theme: /computed style/,
      refraction: /shaders/,
      preserveBackgrounds: /D8/,
      snapDurationMs: /scroll/,
      canvasZIndex: /stylesheet/,
      maxDt: /100 ms/,
    };
    expect(Object.keys(REMOVED_OPTIONS).sort()).toEqual(Object.keys(expectations).sort());
    for (const [key, hint] of Object.entries(expectations)) {
      const err = typeErrorOf(() => resolveOptions({ [key]: 1 } as unknown as LiquidOptions));
      expect(err.message, key).toContain(`"${key}"`);
      expect(err.message, key).toMatch(/removed in 0\.3/);
      expect(err.message, key).toMatch(hint);
    }
  });

  it("given_unknown_option_when_resolved_then_TypeError", () => {
    const err = typeErrorOf(() => resolveOptions({ foo: 1 } as unknown as LiquidOptions));
    expect(err.message).toContain('"foo"');
    expect(err.message).toContain("maxElements");
    for (const bad of [null, 3, "x", []]) {
      typeErrorOf(() => resolveOptions(bad as unknown as LiquidOptions));
    }
  });

  it("given_material_out_of_range_or_nan_when_resolved_then_TypeError", () => {
    const bad: unknown[] = [
      { viscosity: -0.01 }, { viscosity: 1.01 }, { cohesion: Number.NaN }, { recovery: 0.19 },
      { recovery: 3.01 }, { recovery: Number.POSITIVE_INFINITY }, { viscosity: "0.5" }, { stiffness: 1 }, 7,
    ];
    for (const m of bad) {
      expect(typeErrorOf(() => resolveOptions({ material: m as LiquidOptions["material"] })).message).toMatch(/material/);
    }
    expect(resolveOptions({ material: { viscosity: 0, cohesion: 1, recovery: 0.2 } }).material).toEqual({ viscosity: 0, cohesion: 1, recovery: 0.2 });
    expect(resolveOptions({ material: { cohesion: 0.9 } }).material).toEqual({ viscosity: 0.5, cohesion: 0.9, recovery: 0.7 });
    expect(resolveOptions({ material: { recovery: 3 } }).material.recovery).toBe(3);
  });

  it("given_gravity_options_when_resolved_then_validated_and_accepted", () => {
    expect(resolveOptions({ gravity: { source: "fixed", vector: [5, 980] } }).gravity).toEqual({ source: "fixed", vector: [5, 980], strength: 980 });
    expect(resolveOptions({ gravity: { source: "orientation", strength: 600 } }).gravity).toEqual({ source: "orientation", vector: [0, 0], strength: 600 });
    expect(resolveOptions({ gravity: { source: "fixed" } }).gravity.vector).toEqual([0, 0]);
    const bad: unknown[] = [
      { source: "moon" }, {}, { source: "fixed", vector: [1] }, { source: "fixed", vector: [Number.NaN, 0] },
      { source: "fixed", vector: "down" }, { source: "orientation", strength: -1 }, { source: "none", tilt: 1 }, 5,
    ];
    for (const g of bad) {
      expect(typeErrorOf(() => resolveOptions({ gravity: g as LiquidOptions["gravity"] })).message).toMatch(/gravity/);
    }
  });

  it("given_renderer_option_when_resolved_then_only_auto_webgpu_canvas2d_accepted", () => {
    for (const r of ["auto", "webgpu", "canvas2d"] as const) expect(resolveOptions({ renderer: r }).renderer).toBe(r);
    expect(typeErrorOf(() => resolveOptions({ renderer: "webgl" as "auto" })).message).toMatch(/renderer/);
  });

  it("given_boolean_options_when_non_boolean_then_TypeError_and_silentFallback_is_validated_only", () => {
    expect(typeErrorOf(() => resolveOptions({ autoObserve: "yes" as unknown as boolean })).message).toMatch(/autoObserve/);
    expect(typeErrorOf(() => resolveOptions({ forceReducedMotion: 1 as unknown as boolean })).message).toMatch(/forceReducedMotion/);
    expect(typeErrorOf(() => resolveOptions({ silentFallback: "true" as unknown as boolean })).message).toMatch(/silentFallback/);
    // B13: in slices 1–2 nothing reads silentFallback (no fallback log exists); it is only validated.
    expect(resolveOptions({ silentFallback: true }).silentFallback).toBe(true);
    expect(resolveOptions({ autoObserve: false, forceReducedMotion: true }).forceReducedMotion).toBe(true);
  });

  it("given_container_testBackend_loader_or_clock_of_wrong_shape_when_resolved_then_TypeError", () => {
    const div = document.createElement("div");
    expect(resolveOptions({ container: div }).container).toBe(div);
    expect(typeErrorOf(() => resolveOptions({ container: {} as HTMLElement })).message).toMatch(/container/);
    const backend = freshBackend();
    expect(resolveOptions({ testBackend: backend }).testBackend).toBe(backend);
    expect(typeErrorOf(() => resolveOptions({ testBackend: {} as never })).message).toMatch(/testBackend/);
    const loader = async () => backend;
    expect(resolveOptions({ loader }).loader).toBe(loader);
    expect(typeErrorOf(() => resolveOptions({ loader: 5 as never })).message).toMatch(/loader/);
    expect(typeErrorOf(() => resolveOptions({ clock: { now: () => 0 } as never })).message).toMatch(/clock/);
  });

  it("given_option_whitelist_when_read_then_equals_spec_section_5_plus_internal_hooks", () => {
    expect([...OPTION_KEYS].sort()).toEqual(
      ["particles", "maxElements", "container", "renderer", "material", "gravity", "seed", "autoObserve",
        "forceReducedMotion", "silentFallback", "testBackend", "loader", "clock", "webgpuT0Scale"].sort(),
    );
  });

  it("given_webgpuT0Scale_internal_option_when_resolved_then_undefined_by_default_0_5_0_75_and_1_accepted_and_others_TypeError_D71_4", () => {
    expect(resolveOptions({}).webgpuT0Scale).toBeUndefined();
    for (const s of [0.5, 0.75, 1]) expect(resolveOptions({ webgpuT0Scale: s }).webgpuT0Scale).toBe(s);
    for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
      expect(typeErrorOf(() => resolveOptions({ webgpuT0Scale: bad as number })).message).toMatch(/webgpuT0Scale/);
    }
  });
});

describe("W66 T1 (D66-8): validateMaterial (@internal)", () => {
  it("given_valid_partial_when_validated_then_no_throw_and_input_not_mutated", () => {
    const partial = { viscosity: 0.25, recovery: 1.5 };
    expect(() => validateMaterial(partial)).not.toThrow();
    expect(() => validateMaterial({})).not.toThrow();
    expect(() => validateMaterial({ cohesion: undefined })).not.toThrow();
    expect(partial).toEqual({ viscosity: 0.25, recovery: 1.5 });
  });

  it("given_non_object_or_unknown_key_when_validated_then_TypeError", () => {
    typeErrorOf(() => validateMaterial(null as never));
    typeErrorOf(() => validateMaterial([] as never));
    expect(typeErrorOf(() => validateMaterial({ tension: 80 } as never)).message).toContain('"tension"');
    expect(typeErrorOf(() => validateMaterial({ viscosity: 2 })).message).toMatch(/viscosity.*\[0, 1\]/);
  });
});

describe("W66 T1 (C3): validateElementOptions", () => {
  it("given_element_options_out_of_range_nan_or_unknown_when_validated_then_TypeError", () => {
    for (const ok of [undefined, {}, { viscosity: 0 }, { viscosity: 1, recovery: 3 }, { recovery: 0.2 }, { viscosity: undefined }]) {
      expect(() => validateElementOptions(ok)).not.toThrow();
    }
    for (const bad of [{ viscosity: 2 }, { viscosity: Number.NaN }, { recovery: 0.1 }, { recovery: 4 }, { foo: 1 }, "x", null]) {
      typeErrorOf(() => validateElementOptions(bad));
    }
    expect(typeErrorOf(() => validateElementOptions({ liquidType: 3 })).message).toMatch(/liquidType.*removed/);
    expect(typeErrorOf(() => validateElementOptions(3)).message).toMatch(/liquidType.*removed/);
  });
});
