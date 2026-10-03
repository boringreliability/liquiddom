/**
 * W64: the W61 root-cause regression on the DEFAULT path. `loadFluidWasm` is a
 * module-level single flight: two concurrent calls run the glue import and its
 * init once. The glue specifier is mocked exactly as `wasm-loader.ts` imports it
 * (`../../../../pkg/liquiddom.js` from packages/core/ts/src; the test file sits
 * at the same depth in packages/core/ts/__tests__, so the specifier is identical).
 * This file owns its module graph: the loader state is module-global.
 */
import { describe, expect, it, vi } from "vitest";

const glue = vi.hoisted(() => {
  const memory = { buffer: new ArrayBuffer(16) };
  class FluidCore {}
  return { memory, FluidCore, factoryRuns: 0, init: undefined as unknown as ReturnType<typeof vi.fn> };
});

vi.mock("../../../../pkg/liquiddom.js", () => {
  glue.factoryRuns += 1;
  glue.init = vi.fn(async () => {
    await Promise.resolve();
    return { memory: glue.memory };
  });
  return { default: glue.init, FluidCore: glue.FluidCore };
});

import { loadFluidWasm } from "../src/wasm-loader";

describe("W64 default-path single flight (mocked glue)", () => {
  it("given_two_concurrent_loadFluidWasm_calls_when_awaited_then_glue_imported_once_init_once_and_same_backend", async () => {
    const [a, b] = await Promise.all([loadFluidWasm(), loadFluidWasm()]);
    expect(glue.factoryRuns).toBe(1);
    expect(glue.init).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.memory).toBe(glue.memory);
    expect(a.FluidCore).toBe(glue.FluidCore);
    await expect(loadFluidWasm()).resolves.toBe(a);
    expect(glue.init).toHaveBeenCalledTimes(1);
  });
});
