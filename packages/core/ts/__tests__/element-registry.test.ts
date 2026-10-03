/** W64: element slots, buffer writes and microtask batching. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMicrotaskBatcher, ElementRegistry } from "../src/element-registry";
import { FluidBridge } from "../src/fluid-bridge";
import { El, ELEMENT_STRIDE } from "../src/fluid-layout";
import { createTestBackend } from "./_fluid-test-backend";

type Box = { x: number; y: number; w: number; h: number };
type TestEl = HTMLElement & { box: Box };

function el(box: Box, style: Record<string, string> = {}): TestEl {
  const node = document.createElement("div") as TestEl;
  node.box = box;
  Object.assign(node.style, {
    backgroundColor: "rgb(47, 111, 222)",
    color: "rgb(255, 255, 255)",
    borderRadius: "24px",
    ...style,
  });
  node.getBoundingClientRect = () =>
    ({
      x: node.box.x,
      y: node.box.y,
      left: node.box.x,
      top: node.box.y,
      width: node.box.w,
      height: node.box.h,
      right: node.box.x + node.box.w,
      bottom: node.box.y + node.box.h,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(node);
  return node;
}

function setup(maxElements = 4, offset = { x: 0, y: 0 }) {
  const backend = createTestBackend();
  const core = new backend.FluidCore(256, maxElements, 1280, 800, 0, 0, 1);
  const bridge = new FluidBridge(backend, core);
  const schedule = vi.fn();
  const registry = new ElementRegistry(bridge, { coordOffset: () => offset, scheduleRedistribute: schedule });
  return { bridge, registry, schedule };
}

const slotOf = (bridge: FluidBridge, id: number): number[] =>
  Array.from(bridge.elementView().subarray(id * ELEMENT_STRIDE, (id + 1) * ELEMENT_STRIDE));
const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  document.body.replaceChildren();
});

describe("W64 ElementRegistry", () => {
  it("given_element_when_observed_then_slot_id_returned_and_rect_radius_written", () => {
    const { bridge, registry, schedule } = setup();
    const id = registry.observe(el({ x: 10, y: 20, w: 140, h: 48 }));
    expect(id).toBe(0);
    expect(slotOf(bridge, 0).slice(0, 8)).toEqual([10, 20, 140, 48, 24, 0, 0, 0]);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("given_same_element_when_observed_twice_then_same_id", () => {
    const { registry, schedule } = setup();
    const a = el({ x: 0, y: 0, w: 10, h: 10 });
    expect(registry.observe(a)).toBe(0);
    expect(registry.observe(a)).toBe(0);
    expect(registry.size).toBe(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("given_full_registry_when_observing_then_throws_RangeError", () => {
    const { registry } = setup(2);
    registry.observe(el({ x: 0, y: 0, w: 10, h: 10 }));
    registry.observe(el({ x: 20, y: 0, w: 10, h: 10 }));
    expect(() => registry.observe(el({ x: 40, y: 0, w: 10, h: 10 }))).toThrow(RangeError);
    expect(() => registry.observe(el({ x: 40, y: 0, w: 10, h: 10 }))).toThrow(/maxElements/);
  });

  it("given_freed_slot_when_observing_new_element_then_lowest_free_slot_reused", () => {
    const { registry } = setup();
    const els = [0, 1, 2].map((i) => el({ x: i * 20, y: 0, w: 10, h: 10 }));
    els.forEach((e) => registry.observe(e));
    registry.unobserve(els[1]);
    expect(registry.observe(el({ x: 99, y: 0, w: 10, h: 10 }))).toBe(1);
    expect(registry.observe(el({ x: 99, y: 20, w: 10, h: 10 }))).toBe(3);
  });

  it("given_three_observes_in_one_task_when_microtasks_flush_then_redistribute_called_once", async () => {
    const backend = createTestBackend();
    const bridge = new FluidBridge(backend, new backend.FluidCore(256, 8, 1280, 800, 0, 0, 1));
    const run = vi.fn();
    const batcher = createMicrotaskBatcher(run);
    const registry = new ElementRegistry(bridge, {
      coordOffset: () => ({ x: 0, y: 0 }),
      scheduleRedistribute: () => batcher.schedule(),
    });
    [0, 1, 2].forEach((i) => registry.observe(el({ x: i * 20, y: 0, w: 10, h: 10 })));
    expect(run).not.toHaveBeenCalled();
    expect(batcher.pending).toBe(true);
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
    registry.observe(el({ x: 90, y: 0, w: 10, h: 10 }));
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2);
    batcher.cancel();
    registry.observe(el({ x: 120, y: 0, w: 10, h: 10 }));
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("given_container_offset_when_syncing_then_rect_written_container_relative", () => {
    const { bridge, registry } = setup(4, { x: 100, y: 50 });
    const a = el({ x: 130, y: 80, w: 50, h: 40 });
    registry.observe(a);
    expect(slotOf(bridge, 0).slice(0, 2)).toEqual([30, 30]);
    a.box = { x: 140, y: 90, w: 50, h: 40 };
    registry.sync();
    expect(slotOf(bridge, 0).slice(0, 4)).toEqual([40, 40, 50, 40]);
  });

  it("given_element_options_when_observed_then_slots_8_9_written_else_NaN", () => {
    const { bridge, registry } = setup();
    registry.observe(el({ x: 0, y: 0, w: 10, h: 10 }), { viscosity: 0.25, recovery: 1.5 });
    registry.observe(el({ x: 20, y: 0, w: 10, h: 10 }));
    expect(slotOf(bridge, 0)[El.VISCOSITY]).toBe(0.25);
    expect(slotOf(bridge, 0)[El.RECOVERY]).toBe(1.5);
    expect(slotOf(bridge, 1)[El.VISCOSITY]).toBeNaN();
    expect(slotOf(bridge, 1)[El.RECOVERY]).toBeNaN();
  });

  it("given_unobserve_when_called_then_slot_w_zero_and_redistribute_scheduled", () => {
    const { bridge, registry, schedule } = setup();
    const a = el({ x: 10, y: 20, w: 140, h: 48 });
    registry.observe(a);
    schedule.mockClear();
    registry.unobserve(a);
    expect(slotOf(bridge, 0)[El.W]).toBe(0);
    expect(slotOf(bridge, 0).every((v) => v === 0)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(registry.has(a)).toBe(false);
    expect(registry.idOf(a)).toBeUndefined();
    registry.unobserve(a);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("given_percent_radius_when_element_resizes_then_radius_recomputed_on_sync", () => {
    const { bridge, registry } = setup();
    const a = el({ x: 0, y: 0, w: 140, h: 48 }, { borderRadius: "50%" });
    registry.observe(a);
    expect(slotOf(bridge, 0)[El.RADIUS]).toBe(24);
    a.box = { x: 0, y: 0, w: 100, h: 20 };
    registry.sync();
    expect(slotOf(bridge, 0)[El.RADIUS]).toBe(10);
  });

  it("given_stylesheet_that_clears_colors_under_liquid_element_when_observed_before_the_class_then_record_keeps_pre_class_colors_through_sync", () => {
    const style = document.createElement("style");
    style.textContent =
      ".card{background-color:rgb(47, 111, 222);color:rgb(255, 255, 255)}" +
      ".card.liquid-element{background:transparent;color:transparent}";
    document.head.appendChild(style);
    try {
      const { registry } = setup();
      const a = el({ x: 0, y: 0, w: 10, h: 10 }, { backgroundColor: "", color: "" });
      a.className = "card";
      const id = registry.observe(a);
      expect(registry.get(id)?.background).toEqual([47, 111, 222, 1]);
      expect(registry.get(id)?.text).toEqual([255, 255, 255, 1]);
      a.classList.add("liquid-element"); // what the adapter does AFTER observe()
      registry.sync();
      expect(registry.get(id)?.background).toEqual([47, 111, 222, 1]);
      expect(registry.get(id)?.text).toEqual([255, 255, 255, 1]);
    } finally {
      style.remove();
    }
  });

  it("given_element_with_background_when_observed_then_record_carries_snapshotted_colors", () => {
    const { registry } = setup();
    const id = registry.observe(el({ x: 0, y: 0, w: 10, h: 10 }));
    expect(registry.get(id)?.background).toEqual([47, 111, 222, 1]);
    expect(registry.get(id)?.text).toEqual([255, 255, 255, 1]);
  });
});
