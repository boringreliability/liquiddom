/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, presets, validateMaterial, type LiquidDOMInstance } from "../src/index";
import { createManualClock } from "../src/clock";
import { createTestBackend } from "./_fluid-test-backend";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe("material API (W68, D68-1, D68-9)", () => {
  let fake: FakeCanvasHandle | null = null;
  let inst: LiquidDOMInstance | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    fake = installFakeCanvas2D();
  });
  afterEach(() => {
    inst?.destroy();
    inst = null;
    fake?.restore(); // W64: installFakeCanvas2D() returns a FakeCanvasHandle
    fake = null;
    vi.restoreAllMocks();
  });

  async function create(extra: Record<string, unknown> = {}) {
    const backend = createTestBackend();
    const setMaterial = vi.spyOn(backend.FluidCore.prototype, "set_material");
    inst = await LiquidDOM.create({
      testBackend: backend,
      clock: createManualClock(),
      autoObserve: false,
      particles: 256,
      maxElements: 4,
      seed: 1,
      ...extra,
    } as Parameters<typeof LiquidDOM.create>[0]);
    return { inst, setMaterial };
  }

  it("given_create_with_material_when_started_then_set_material_called_once_with_resolved_values", async () => {
    const { setMaterial } = await create({ material: { viscosity: 0.2 } });
    expect(setMaterial.mock.calls).toEqual([[0.2, 0.5, 0.7]]);
  });

  it("given_setMaterial_partial_when_called_then_merged_validated_and_set_material_called_with_merged_values", async () => {
    const { inst, setMaterial } = await create();
    setMaterial.mockClear();
    inst.setMaterial({ cohesion: 0.8 });
    expect(setMaterial.mock.calls).toEqual([[0.5, 0.8, 0.7]]);
    expect(inst.getMaterial()).toEqual({ viscosity: 0.5, cohesion: 0.8, recovery: 0.7 });
    inst.setMaterial({ recovery: 2 });
    expect(inst.getMaterial()).toEqual({ viscosity: 0.5, cohesion: 0.8, recovery: 2 });
  });

  it("given_invalid_partial_when_setMaterial_then_TypeError_and_state_unchanged", async () => {
    const { inst, setMaterial } = await create();
    setMaterial.mockClear();
    const before = inst.getMaterial();
    const bad = [
      { viscosity: 1.5 },
      { viscosity: -0.01 },
      { cohesion: Number.NaN },
      { recovery: 0.1 },
      { recovery: 3.5 },
      { viscosity: 0.3, cohesion: 2 }, // atomic: viscosity must not stick
    ];
    for (const partial of bad) {
      expect(() => inst.setMaterial(partial), JSON.stringify(partial)).toThrow(TypeError);
    }
    expect(inst.getMaterial()).toEqual(before);
    expect(setMaterial).not.toHaveBeenCalled();
  });

  it("given_unknown_key_or_non_object_when_setMaterial_then_TypeError", async () => {
    const { inst } = await create();
    expect(() => inst.setMaterial({ tension: 80 } as never)).toThrow(/tension/);
    for (const v of [null, 5, "water", []]) {
      expect(() => inst.setMaterial(v as never), String(v)).toThrow(TypeError);
    }
  });

  it("given_getMaterial_when_result_mutated_then_internal_state_unchanged", async () => {
    const { inst } = await create();
    const m = inst.getMaterial();
    m.viscosity = 0.99;
    expect(inst.getMaterial().viscosity).toBe(0.5);
  });

  it("given_presets_when_read_then_water_honey_jelly_frozen_and_valid", () => {
    expect(Object.keys(presets).sort()).toEqual(["honey", "jelly", "water"]);
    expect(Object.isFrozen(presets)).toBe(true);
    expect(presets.water).toEqual({ viscosity: 0.15, cohesion: 0.3, recovery: 0.5 });
    expect(presets.honey).toEqual({ viscosity: 0.9, cohesion: 0.7, recovery: 1.6 });
    expect(presets.jelly).toEqual({ viscosity: 0.6, cohesion: 0.85, recovery: 0.4 });
    for (const p of Object.values(presets)) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(() => validateMaterial(p)).not.toThrow();
    }
  });

  it("given_preset_when_passed_to_setMaterial_or_create_then_core_receives_its_values", async () => {
    const first = await create({ material: presets.water });
    expect(first.setMaterial.mock.calls).toEqual([[0.15, 0.3, 0.5]]);
    first.setMaterial.mockClear();
    first.inst.setMaterial(presets.honey);
    expect(first.setMaterial.mock.calls).toEqual([[0.9, 0.7, 1.6]]);
    expect(first.inst.getMaterial()).toEqual(presets.honey);
  });

  it("given_destroyed_instance_when_setMaterial_or_getMaterial_then_destroyed_Error_not_TypeError", async () => {
    const { inst: i } = await create();
    // positive control: the methods exist and work before destroy (otherwise "not a function" would pass vacuously)
    expect(typeof i.setMaterial).toBe("function");
    expect(typeof i.getMaterial).toBe("function");
    expect(i.getMaterial()).toEqual({ viscosity: 0.5, cohesion: 0.5, recovery: 0.7 });
    i.destroy();
    inst = null;
    for (const [method, call] of [
      ["setMaterial", () => i.setMaterial({ viscosity: 0.2 })],
      ["getMaterial", () => i.getMaterial()],
    ] as const) {
      expect(call, method).toThrow(new RegExp(`${method}\\(\\) called on a destroyed instance`));
      let err: unknown;
      try {
        call();
      } catch (e) {
        err = e;
      }
      expect(err, method).toBeInstanceOf(Error);
      expect(err, method).not.toBeInstanceOf(TypeError);
    }
  });

  // W68 green review: the partial is snapshotted once, so a getter cannot validate one value and merge another.
  it("given_getter_valid_on_first_read_and_invalid_after_when_setMaterial_then_one_consistent_result_matching_the_core", async () => {
    const { inst, setMaterial } = await create();
    setMaterial.mockClear();
    let reads = 0;
    const partial = {
      get viscosity(): number {
        reads += 1;
        return reads === 1 ? 0.3 : 5; // 5 is out of range
      },
    };
    // The snapshot reads the getter once (0.3, valid), so validation and merge see the same value.
    expect(() => inst.setMaterial(partial)).not.toThrow();
    expect(reads, "the getter is read exactly once").toBe(1);
    const got = inst.getMaterial();
    expect(got).toEqual({ viscosity: 0.3, cohesion: 0.5, recovery: 0.7 });
    expect(setMaterial.mock.calls).toEqual([[got.viscosity, got.cohesion, got.recovery]]);
  });

  it("given_unknown_key_beside_a_getter_when_setMaterial_then_TypeError_names_the_key_without_reading_it", async () => {
    const { inst, setMaterial } = await create();
    setMaterial.mockClear();
    let unknownReads = 0;
    const partial = {
      viscosity: 0.3,
      get tension(): number {
        unknownReads += 1;
        return 1;
      },
    };
    expect(() => inst.setMaterial(partial as never)).toThrow(/unknown material key "tension"/);
    expect(unknownReads).toBe(0);
    expect(setMaterial).not.toHaveBeenCalled();
  });
});
