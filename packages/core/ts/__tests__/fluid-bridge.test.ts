/** W64: FluidBridge is the sole owner of pointers and views (spec §1/§2, D64-7). */
import { describe, expect, it } from "vitest";
import { FluidBridge } from "../src/fluid-bridge";
import { DYNAMIC_FIELDS, ELEMENT_STRIDE, STATE_STRIDE, STATIC_FIELDS } from "../src/fluid-layout";
import { createTestBackend, type TestBackendOptions } from "./_fluid-test-backend";

function setup(opts?: TestBackendOptions) {
  const backend = createTestBackend(opts);
  const core = new backend.FluidCore(256, 4, 1280, 800, 0, 0, 1);
  return { backend, core, bridge: new FluidBridge(backend, core) };
}

describe("W64 FluidBridge", () => {
  it("given_bridge_when_dynamicView_called_twice_then_two_distinct_views_over_current_buffer", () => {
    const { backend, core, bridge } = setup();
    const a = bridge.dynamicView();
    const b = bridge.dynamicView();
    expect(a).not.toBe(b);
    expect(a.buffer).toBe(backend.memory.buffer);
    expect(b.buffer).toBe(backend.memory.buffer);
    expect(a.length).toBe(256 * DYNAMIC_FIELDS);
    expect(a.byteOffset).toBe(core.dynamic_ptr());
  });

  it("given_unchanged_generation_when_staticView_called_then_same_cached_view", () => {
    const { bridge } = setup();
    const a = bridge.staticView();
    expect(bridge.syncGeneration()).toBe(false);
    expect(bridge.staticView()).toBe(a);
    expect(a.length).toBe(256 * STATIC_FIELDS);
  });

  it("given_generation_bumped_when_syncGeneration_then_true_and_staticView_fresh", () => {
    const { core, bridge } = setup();
    const before = bridge.staticView();
    core.redistribute();
    expect(bridge.syncGeneration()).toBe(true);
    expect(bridge.generation).toBe(1);
    const after = bridge.staticView();
    expect(after).not.toBe(before);
    expect(bridge.syncGeneration()).toBe(false);
    expect(bridge.staticView()).toBe(after);
  });

  it("given_memory_buffer_replaced_when_elementView_called_then_view_rebound", () => {
    const { backend, bridge } = setup();
    const before = bridge.elementView();
    const stateBefore = bridge.stateView();
    const staticBefore = bridge.staticView();
    before[0] = 42;
    backend.grow(1 << 20);
    expect(bridge.isStale()).toBe(true);
    const after = bridge.elementView();
    // The old views are detached now: compare identities, never their contents.
    expect(after === before).toBe(false);
    expect(after.buffer).toBe(backend.memory.buffer);
    expect(after[0]).toBe(42);
    expect(after.length).toBe(4 * ELEMENT_STRIDE);
    expect(bridge.isStale()).toBe(false);
    expect(bridge.stateView() === stateBefore).toBe(false);
    expect(bridge.stateView().length).toBe(4 * STATE_STRIDE);
    expect(bridge.staticView() === staticBefore).toBe(false);
  });

  it("given_core_with_mismatched_stride_when_constructing_bridge_then_throws", () => {
    for (const key of ["element", "state", "dynamic", "static"] as const) {
      const backend = createTestBackend({ strides: { [key]: 99 } });
      const core = new backend.FluidCore(256, 4, 1280, 800, 0, 0, 1);
      expect(() => new FluidBridge(backend, core), key).toThrow(/FFI stride mismatch/);
    }
  });

  it("given_dynamicByteRange_when_read_then_it_spans_particleCapacity_times_7_floats", () => {
    const { backend, core, bridge } = setup();
    expect(bridge.dynamicByteRange()).toEqual({
      buffer: backend.memory.buffer,
      byteOffset: core.dynamic_ptr(),
      byteLength: 256 * 7 * 4,
    });
  });
});
