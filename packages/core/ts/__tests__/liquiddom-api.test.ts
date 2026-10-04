/**
 * @vitest-environment jsdom
 * W66 T3: the public LiquidDOM facade (spec §5) over the internal runtime.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as liquiddom from "../src/index";
import { LiquidDOM, LiquidWasmLoadError } from "../src/index";
import { createManualClock } from "../src/clock";
import { El } from "../src/fluid-layout";
import {
  addLiquid, elementSlots, freedOf, freshBackend, instanceTracker, mockRect, resetDom,
  restoreVisibility, setupFacadeTestEnv, setVisibility, spyBackend, ticksOf,
} from "./_facade-helpers";

const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  tracker.destroyAll();
  restoreVisibility();
});

async function create(opts: Parameters<typeof LiquidDOM.create>[0] = {}) {
  return tracker.track(
    await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 8, ...opts }),
  );
}
const isLiquid = (el: HTMLElement) => el.classList.contains("liquid-element");

describe("W66 T3: create and capacities", () => {
  it("given_testBackend_when_create_then_instance_with_particleCapacity_and_elementCapacity", async () => {
    const inst = await create({ particles: 2048, maxElements: 6 });
    expect(inst.particleCapacity).toBe(2048);
    expect(inst.elementCapacity).toBe(6);
    expect(inst.isPaused).toBe(false);
    expect(inst.activeRenderer).toBe("canvas2d");
    for (const m of ["observe", "unobserve", "refresh", "pause", "resume", "destroy", "requestOrientationPermission", "autoDiscover", "stopAutoDiscover"]) {
      expect(typeof (inst as unknown as Record<string, unknown>)[m], m).toBe("function");
    }
    expect(document.querySelectorAll("canvas.liquid-canvas")).toHaveLength(1);
  });

  it("given_wasm_load_failure_without_testBackend_when_create_then_rejects_LiquidWasmLoadError", async () => {
    // jsdom cannot fetch the .wasm (file: URL), so the real loader rejects. No mock mode any more.
    await expect(LiquidDOM.create({ autoObserve: false })).rejects.toBeInstanceOf(LiquidWasmLoadError);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("given_root_index_when_imported_then_export_keys_equal_whitelist", () => {
    expect(Object.keys(liquiddom).sort()).toEqual(["LiquidDOM", "LiquidWasmLoadError", "WebGPUUnavailableError", "validateMaterial"]);
  });
});

describe("W66 T3: observe", () => {
  it("given_maxElements_reached_when_observe_then_RangeError", async () => {
    const inst = await create({ maxElements: 2 });
    const [a, b, c] = [addLiquid("button", [0, 0, 100, 40], document.body, false), addLiquid("button", [0, 50, 100, 40], document.body, false), addLiquid("button", [0, 100, 100, 40], document.body, false)];
    const idA = inst.observe(a!);
    inst.observe(b!);
    expect(() => inst.observe(c!)).toThrow(RangeError);
    expect(inst.observe(a!)).toBe(idA); // idempotent even when full
  });

  it("given_observe_with_out_of_range_element_options_when_called_then_TypeError_and_valid_options_reach_slots_8_9", async () => {
    const sb = spyBackend();
    const inst = await create({ testBackend: sb.backend });
    const el = addLiquid("button", [0, 0, 100, 40], document.body, false);
    expect(() => inst.observe(el, { viscosity: 2 })).toThrow(TypeError);
    expect(() => inst.observe(el, { recovery: 0 })).toThrow(TypeError);
    expect(() => inst.observe(document as unknown as HTMLElement)).toThrow(TypeError);
    expect(isLiquid(el)).toBe(false);
    const id = inst.observe(el, { viscosity: 0.25, recovery: 1.5 });
    const slots = elementSlots(sb, sb.cores[0]!, id);
    expect(slots[El.VISCOSITY]).toBe(0.25);
    expect(slots[El.RECOVERY]).toBe(1.5);
  });

  it("given_refresh_on_unobserved_element_when_called_then_noop", async () => {
    const inst = await create();
    expect(() => inst.refresh(document.createElement("div"))).not.toThrow();
  });
});

describe("W66 T3: autoObserve and autoDiscover", () => {
  it("given_autoObserve_when_create_then_data_liquid_elements_observed", async () => {
    const a = addLiquid("button", [0, 0, 100, 40]);
    const b = addLiquid("div", [0, 100, 300, 200]);
    const plain = addLiquid("button", [0, 400, 100, 40], document.body, false);
    await create({ autoObserve: true });
    expect([isLiquid(a), isLiquid(b), isLiquid(plain)]).toEqual([true, true, false]);
  });

  it("given_autoObserve_candidates_when_create_then_area_hint_comes_from_their_rects_B5", async () => {
    // D66-13: ctor arg 4 is areaHintPx2 (7-arg FluidCoreCtor).
    addLiquid("button", [0, 0, 100, 40]);
    addLiquid("div", [0, 100, 200, 100]);
    const sb = spyBackend();
    await create({ testBackend: sb.backend, autoObserve: true });
    expect(sb.ctorArgs[0]![4]).toBeCloseTo(24000, 3);
    const sb2 = spyBackend();
    await create({ testBackend: sb2.backend, autoObserve: false });
    expect(sb2.ctorArgs[0]![4]).toBe(0);
    const sb3 = spyBackend();
    await create({ testBackend: sb3.backend, autoObserve: true }); // no candidates in the DOM
    expect(sb3.ctorArgs[0]![4]).toBe(0);
  });

  it("given_seed_and_material_options_when_create_then_reach_the_core_D66_7_D66_14", async () => {
    const sb = spyBackend();
    await create({ testBackend: sb.backend, seed: 42, material: { cohesion: 0.9 } });
    expect(sb.ctorArgs[0]![6]).toBe(42); // 7th ctor arg is the seed
    const sets = sb.calls.filter((c) => c.method === "set_material").map((c) => c.args);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.at(-1)).toEqual([0.5, 0.9, 0.7]); // full resolved triple: viscosity, cohesion, recovery
  });

  it("given_maxElements_1_and_autoDiscover_when_two_data_liquid_added_then_one_warn_and_extra_skipped_D66_10", async () => {
    const inst = await create({ maxElements: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      inst.autoDiscover();
      const a = addLiquid("button", [0, 0, 100, 40]);
      const b = addLiquid("button", [0, 60, 100, 40]);
      await vi.waitFor(() => expect([isLiquid(a), isLiquid(b)]).toEqual([true, false]));
      await new Promise((r) => setTimeout(r, 0));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/maxElements/);
    } finally {
      warn.mockRestore();
    }
  });

  it("given_more_data_liquid_elements_than_maxElements_when_create_then_extra_skipped_with_one_warn", async () => {
    const els = [0, 1, 2, 3].map((i) => addLiquid("button", [0, i * 50, 100, 40]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await create({ autoObserve: true, maxElements: 2 });
      expect(els.map(isLiquid)).toEqual([true, true, false, false]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/maxElements/);
    } finally {
      warn.mockRestore();
    }
  });

  it("given_autoDiscover_when_data_liquid_node_added_or_removed_then_observed_or_unobserved", async () => {
    const inst = await create();
    inst.autoDiscover();
    const direct = addLiquid("button", [0, 0, 100, 40]);
    const wrapper = document.createElement("div");
    const nested = addLiquid("div", [0, 100, 100, 40], wrapper);
    document.body.appendChild(wrapper);
    await vi.waitFor(() => expect([isLiquid(direct), isLiquid(nested)]).toEqual([true, true]));
    direct.remove();
    wrapper.remove();
    await vi.waitFor(() => expect([isLiquid(direct), isLiquid(nested)]).toEqual([false, false]));
  });

  it("given_stopAutoDiscover_when_nodes_added_then_not_observed", async () => {
    const inst = await create();
    inst.autoDiscover();
    const first = addLiquid("button", [0, 0, 100, 40]);
    await vi.waitFor(() => expect(isLiquid(first)).toBe(true)); // positive control: the observer works
    inst.stopAutoDiscover();
    const second = addLiquid("button", [0, 60, 100, 40]);
    await new Promise((r) => setTimeout(r, 0));
    expect(isLiquid(second)).toBe(false);
  });

  it("given_container_option_when_create_then_canvas_inside_container_and_autoObserve_scoped_to_it", async () => {
    const container = document.createElement("section");
    mockRect(container, 100, 100, 600, 400);
    document.body.appendChild(container);
    const inside = addLiquid("button", [120, 120, 100, 40], container);
    const outside = addLiquid("button", [0, 0, 100, 40]);
    await create({ container, autoObserve: true });
    expect(document.querySelector("canvas")!.parentElement).toBe(container);
    expect([isLiquid(inside), isLiquid(outside)]).toEqual([true, false]);
  });
});

describe("W66 T3: pause, visibility, destroy", () => {
  it("given_pause_when_called_then_no_frames_and_isPaused_true_and_resume_restarts", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const inst = await create({ testBackend: sb.backend, clock });
    clock.advance(3);
    const c1 = ticksOf(sb).length;
    expect(c1).toBeGreaterThanOrEqual(3);
    inst.pause();
    expect(inst.isPaused).toBe(true);
    clock.advance(5);
    expect(ticksOf(sb)).toHaveLength(c1);
    inst.resume();
    expect(inst.isPaused).toBe(false);
    clock.advance(2);
    expect(ticksOf(sb)).toHaveLength(c1 + 2);
  });

  it("given_hidden_tab_when_visibilitychange_then_paused_and_resumed", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const inst = await create({ testBackend: sb.backend, clock });
    clock.advance(1);
    const c1 = ticksOf(sb).length;
    setVisibility("hidden");
    expect(inst.isPaused).toBe(true);
    clock.advance(4);
    expect(ticksOf(sb)).toHaveLength(c1);
    setVisibility("visible");
    expect(inst.isPaused).toBe(false);
    clock.advance(2);
    expect(ticksOf(sb)).toHaveLength(c1 + 2);
  });

  it("given_user_pause_when_tab_becomes_visible_again_then_stays_paused_D66_12", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const inst = await create({ testBackend: sb.backend, clock });
    inst.pause();
    setVisibility("hidden");
    setVisibility("visible");
    expect(inst.isPaused).toBe(true);
    const c1 = ticksOf(sb).length;
    clock.advance(3);
    expect(ticksOf(sb)).toHaveLength(c1);
  });

  it("given_destroy_when_called_twice_then_idempotent_and_methods_throw_after", async () => {
    const sb = spyBackend();
    const el = addLiquid("button", [0, 0, 100, 40]);
    const inst = await LiquidDOM.create({ testBackend: sb.backend, particles: 1024, maxElements: 4 });
    expect(isLiquid(el)).toBe(true);
    inst.destroy();
    expect(() => inst.destroy()).not.toThrow();
    expect(freedOf(sb)).toHaveLength(1);
    expect(document.querySelector("canvas")).toBeNull();
    expect(isLiquid(el)).toBe(false);
    const after: Array<[string, () => unknown]> = [
      ["observe", () => inst.observe(el)],
      ["refresh", () => inst.refresh(el)],
      ["pause", () => inst.pause()],
      ["resume", () => inst.resume()],
      ["autoDiscover", () => inst.autoDiscover()],
      ["stopAutoDiscover", () => inst.stopAutoDiscover()],
    ];
    for (const [name, call] of after) expect(call, name).toThrow(/destroyed/);
    expect(() => inst.unobserve(el)).not.toThrow();
    await expect(inst.requestOrientationPermission()).rejects.toThrow(/destroyed/);
    expect(typeof inst.isPaused).toBe("boolean");
    expect(inst.particleCapacity).toBe(1024);
    expect(inst.activeRenderer).toBe("canvas2d");
    expect(inst.elementCapacity).toBe(4);
  });
});
