import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOATS_PER_ENTITY } from "../src/phantom-observer";

// We load the WASM module synchronously via initSync + raw bytes.
// This avoids needing a browser or fetch() in Node.
let wasm: typeof import("../../../../pkg/liquiddom.js");
let wasmMemory: WebAssembly.Memory;

beforeAll(async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const wasmPath = resolve(__dirname, "../../../../pkg/liquiddom_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);

  // Dynamic import to get the module with initSync
  const mod = await import("../../../../pkg/liquiddom.js");
  const exports = mod.initSync({ module: wasmBytes });
  wasmMemory = exports.memory;
  wasm = mod;
});

/** Helper: create a Float32Array view into WASM memory at the given pointer */
function createView(
  ptr: number,
  capacity: number,
): Float32Array {
  return new Float32Array(
    wasmMemory.buffer,
    ptr,
    capacity * FLOATS_PER_ENTITY,
  );
}

describe("FFI Integration", () => {
  it("wasm core initialization", () => {
    const core = new wasm.LiquidCore(100);
    const ptr = core.ptr();

    expect(ptr).toBeGreaterThan(0);
    expect(core.capacity()).toBe(100);

    // Pointer should be within WASM memory bounds
    expect(ptr).toBeLessThan(wasmMemory.buffer.byteLength);

    // Create a view and verify it's zero-initialized
    const view = createView(ptr, 100);
    for (let i = 0; i < 10; i++) {
      expect(view[i]).toBe(0);
    }

    core.free();
  });

  it("ts writes are visible via shared memory", () => {
    const core = new wasm.LiquidCore(10);
    const ptr = core.ptr();
    const view = createView(ptr, 10);

    // Simulate what PhantomObserver.sync() does:
    // Write bounding rect for entity 0
    view[0] = 42.0; // x
    view[1] = 99.0; // y
    view[2] = 200.0; // width
    view[3] = 100.0; // height

    // Write bounding rect for entity 3
    const offset3 = 3 * FLOATS_PER_ENTITY;
    view[offset3] = 10.0;
    view[offset3 + 1] = 20.0;

    // Read back through the same view — verifies shared memory works
    expect(view[0]).toBe(42.0);
    expect(view[1]).toBe(99.0);
    expect(view[offset3]).toBe(10.0);
    expect(view[offset3 + 1]).toBe(20.0);

    // Also verify via a fresh view (same memory, different JS object)
    const view2 = createView(ptr, 10);
    expect(view2[0]).toBe(42.0);
    expect(view2[1]).toBe(99.0);

    core.free();
  });

  it("rust tick mutates memory via physics", () => {
    const core = new wasm.LiquidCore(10);
    const ptr = core.ptr();
    const view = createView(ptr, 10);

    // Set up entity 0 with known values (width > 0 marks it as active)
    view[0] = 100.0; // x
    view[1] = 200.0; // y
    view[2] = 50.0; // width
    view[3] = 30.0; // height

    // tick creates an EntityBody and runs physics
    core.tick(16.0, 0, 0, false, 100.0, 5.0, 1, 100.0, 5000.0, 30.0, 0, 0, 1e9, 1e9, 0);

    // particle_data should now have non-zero values for entity 0
    const particlePtr = core.particle_ptr();
    expect(particlePtr).toBeGreaterThan(0);

    // 16 particles × 2 floats = 32 floats per body
    const particleView = new Float32Array(wasmMemory.buffer, particlePtr, 32);

    // After physics, particles should have positions (not all zeros)
    let hasNonZero = false;
    for (let i = 0; i < 32; i++) {
      if (particleView[i] !== 0) {
        hasNonZero = true;
        break;
      }
    }
    expect(hasNonZero).toBe(true);

    core.free();
  });

  it("buffer grow reestablishes view", () => {
    const core = new wasm.LiquidCore(4);
    const ptrBefore = core.ptr();
    const viewBefore = createView(ptrBefore, 4);

    // Write data before grow
    viewBefore[0] = 777.0;
    viewBefore[1] = 888.0;

    // Grow the buffer
    core.grow(20);
    expect(core.capacity()).toBe(20);

    // The old view may be detached — get a fresh pointer and view
    const ptrAfter = core.ptr();
    const viewAfter = createView(ptrAfter, 20);

    // Old data must survive the grow
    expect(viewAfter[0]).toBe(777.0);
    expect(viewAfter[1]).toBe(888.0);

    // New slots should be zero-initialized
    const lastEntityOffset = 19 * FLOATS_PER_ENTITY;
    expect(viewAfter[lastEntityOffset]).toBe(0);

    core.free();
  });
});

// ── Ward 8: Physics FFI Bridge tests ──

const PARTICLES_PER_BODY = 16;
const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2; // x,y per particle

describe("Physics FFI Bridge", () => {
  it("tick creates bodies on demand", () => {
    const core = new wasm.LiquidCore(10);
    const ptr = core.ptr();
    const view = createView(ptr, 10);

    // Entity 0 is inactive (width = 0)
    // Entity 2 is active
    const offset2 = 2 * FLOATS_PER_ENTITY;
    view[offset2] = 50.0; // x
    view[offset2 + 1] = 60.0; // y
    view[offset2 + 2] = 120.0; // width
    view[offset2 + 3] = 80.0; // height

    core.tick(16.0, 0, 0, false, 100.0, 5.0, 1, 100.0, 5000.0, 30.0, 0, 0, 1e9, 1e9, 0);

    // Entity 2's particles should be populated
    const particlePtr = core.particle_ptr();
    const allParticles = new Float32Array(
      wasmMemory.buffer,
      particlePtr,
      10 * PARTICLE_FLOATS_PER_BODY,
    );

    // Entity 0 (inactive) — particle data should be all zeros
    let entity0HasData = false;
    for (let i = 0; i < PARTICLE_FLOATS_PER_BODY; i++) {
      if (allParticles[i] !== 0) {
        entity0HasData = true;
        break;
      }
    }
    expect(entity0HasData).toBe(false);

    // Entity 2 (active) — particle data should have values
    const e2Offset = 2 * PARTICLE_FLOATS_PER_BODY;
    let entity2HasData = false;
    for (let i = 0; i < PARTICLE_FLOATS_PER_BODY; i++) {
      if (allParticles[e2Offset + i] !== 0) {
        entity2HasData = true;
        break;
      }
    }
    expect(entity2HasData).toBe(true);

    core.free();
  });

  it("tick updates particle data with valid coordinates", () => {
    const core = new wasm.LiquidCore(10);
    const ptr = core.ptr();
    const view = createView(ptr, 10);

    // Place entity 0 at (100, 200) with size 80x60
    view[0] = 100.0;
    view[1] = 200.0;
    view[2] = 80.0;
    view[3] = 60.0;

    // Run several ticks so particles converge toward target
    for (let i = 0; i < 60; i++) {
      core.tick(16.0, 0, 0, false, 100.0, 5.0, 1, 100.0, 5000.0, 30.0, 0, 0, 1e9, 1e9, 0);
    }

    // Read particle data
    const particlePtr = core.particle_ptr();
    const particles = new Float32Array(
      wasmMemory.buffer,
      particlePtr,
      PARTICLE_FLOATS_PER_BODY,
    );

    // After many ticks, particles should have converged near the element's position.
    // First particle's rest is (0,0) relative, so global target = (100, 200).
    // Allow generous tolerance since Euler integration oscillates.
    const p0x = particles[0];
    const p0y = particles[1];
    expect(p0x).toBeGreaterThan(50); // Should be near 100
    expect(p0x).toBeLessThan(150);
    expect(p0y).toBeGreaterThan(150); // Should be near 200
    expect(p0y).toBeLessThan(250);

    core.free();
  });

  it("grow resizes physics structures", () => {
    const core = new wasm.LiquidCore(4);

    // Write an active entity
    const view = createView(core.ptr(), 4);
    view[0] = 10.0;
    view[1] = 20.0;
    view[2] = 50.0;
    view[3] = 50.0;

    core.tick(16.0, 0, 0, false, 100.0, 5.0, 1, 100.0, 5000.0, 30.0, 0, 0, 1e9, 1e9, 0);

    // Grow
    core.grow(20);
    expect(core.capacity()).toBe(20);

    // particle_ptr should be valid and cover 20 bodies
    const particlePtr = core.particle_ptr();
    expect(particlePtr).toBeGreaterThan(0);

    const allParticles = new Float32Array(
      wasmMemory.buffer,
      particlePtr,
      20 * PARTICLE_FLOATS_PER_BODY,
    );

    // New slots (entity 19) should be zero
    const lastOffset = 19 * PARTICLE_FLOATS_PER_BODY;
    expect(allParticles[lastOffset]).toBe(0);
    expect(allParticles[lastOffset + 1]).toBe(0);

    core.free();
  });
});

// ── Ward 15: WasmBridge tests ──

import { WasmBridge } from "../src/wasm-bridge";
import { PhantomObserver } from "../src/phantom-observer";

describe("WasmBridge", () => {
  it("creates valid views", () => {
    const core = new wasm.LiquidCore(10);
    const bridge = new WasmBridge(wasmMemory, core, 10);

    const entityView = bridge.entityView();
    expect(entityView).toBeInstanceOf(Float32Array);
    expect(entityView.length).toBe(10 * FLOATS_PER_ENTITY);

    const particleView = bridge.particleView();
    expect(particleView).toBeInstanceOf(Float32Array);
    expect(particleView.length).toBe(10 * PARTICLES_PER_BODY * 2);

    expect(bridge.capacity).toBe(10);

    core.free();
  });

  it("rebinds after grow", () => {
    const core = new wasm.LiquidCore(4);
    const bridge = new WasmBridge(wasmMemory, core, 4);

    const viewBefore = bridge.entityView();
    expect(viewBefore.length).toBe(4 * FLOATS_PER_ENTITY);

    // Write data before grow
    viewBefore[0] = 42.0;

    // Grow via core
    core.grow(20);
    bridge.rebind(20);

    const viewAfter = bridge.entityView();
    expect(viewAfter.length).toBe(20 * FLOATS_PER_ENTITY);
    expect(bridge.capacity).toBe(20);

    // Old data survives
    expect(viewAfter[0]).toBe(42.0);

    core.free();
  });

  it("detects stale views after buffer change", () => {
    const core = new wasm.LiquidCore(4);
    const bridge = new WasmBridge(wasmMemory, core, 4);

    expect(bridge.isStale()).toBe(false);

    // Capture buffer ref before grow
    const bufferBefore = wasmMemory.buffer;

    // Grow significantly to increase chance of buffer relocation
    core.grow(10000);

    if (wasmMemory.buffer !== bufferBefore) {
      // Buffer was relocated — bridge MUST detect staleness
      expect(bridge.isStale()).toBe(true);
    }
    // Either way, rebind resolves it
    bridge.rebind(10000);
    expect(bridge.isStale()).toBe(false);
    expect(bridge.capacity).toBe(10000);

    core.free();
  });

  it("PhantomObserver works with bridge-provided views", () => {
    const core = new wasm.LiquidCore(10);
    const bridge = new WasmBridge(wasmMemory, core, 10);

    // Construct observer with views from bridge (not raw pointers)
    const observer = new PhantomObserver(10, {
      entityView: bridge.entityView(),
      particleView: bridge.particleView(),
    });

    // Mock element
    const el = {
      getBoundingClientRect: () => ({
        x: 50, y: 60, width: 200, height: 100,
        top: 60, left: 50, right: 250, bottom: 160,
        toJSON: () => {},
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;

    const id = observer.observe(el);
    expect(id).toBe(0);

    observer.sync();

    // Verify data landed in bridge's entity view (same underlying memory)
    const view = bridge.entityView();
    expect(view[0]).toBe(50); // x
    expect(view[1]).toBe(60); // y
    expect(view[2]).toBe(200); // width
    expect(view[3]).toBe(100); // height

    core.free();
  });

  // ── Ward 016: Capacity alignment ──

  it("Rust and TS capacity aligned after grow", () => {
    const core = new wasm.LiquidCore(4);
    const bridge = new WasmBridge(wasmMemory, core, 4);

    expect(bridge.capacity).toBe(4);
    expect(core.capacity()).toBe(4);

    // Coordinated grow
    core.grow(32);
    bridge.rebind(32);

    expect(bridge.capacity).toBe(32);
    expect(core.capacity()).toBe(32);
    expect(bridge.entityView().length).toBe(32 * FLOATS_PER_ENTITY);

    core.free();
  });
});
