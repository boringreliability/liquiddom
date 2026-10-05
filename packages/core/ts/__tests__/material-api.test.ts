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

  it("given_destroyed_instance_when_setMaterial_or_getMaterial_then_Error", async () => {
    const { inst: i } = await create();
    i.destroy();
    inst = null;
    expect(() => i.setMaterial({ viscosity: 0.2 })).toThrow(Error);
    expect(() => i.getMaterial()).toThrow(Error);
  });
});
