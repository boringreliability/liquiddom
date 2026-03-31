import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FLOATS_PER_ENTITY = 8;

// We load the WASM module synchronously via initSync + raw bytes.
// This avoids needing a browser or fetch() in Node.
let wasm: typeof import("../../pkg/liquiddom.js");
let wasmMemory: WebAssembly.Memory;

beforeAll(async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const wasmPath = resolve(__dirname, "../../pkg/liquiddom_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);

  // Dynamic import to get the module with initSync
  const mod = await import("../../pkg/liquiddom.js");
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

  it("rust tick mutates memory", () => {
    const core = new wasm.LiquidCore(10);
    const ptr = core.ptr();
    const view = createView(ptr, 10);

    // Set up entity 0 with known values (width > 0 marks it as active)
    view[0] = 100.0; // x
    view[1] = 200.0; // y
    view[2] = 50.0; // width (must be non-zero for tick to process)

    // Verify initial state
    expect(view[6]).toBe(0); // custom_param_1 starts at 0

    // Call tick — Rust should mutate something to prove round-trip
    core.tick(16.0);

    // After tick, custom_param_1 (index 6) of entity 0 should be mutated
    // (The spec says: "tilføje 1.0 til custom_param_1 for at bevise at det virker")
    expect(view[6]).not.toBe(0);

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
