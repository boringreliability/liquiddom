/**
 * W64: with no `loader` and no `testBackend`, `createFluidRuntime` must use the
 * module-level `loadFluidWasm` (the shared single flight), not its own loader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { createTestBackend } from "./_fluid-test-backend";

const spies = vi.hoisted(() => ({ loadFluidWasm: vi.fn() }));

vi.mock("../src/wasm-loader", async (importActual) => {
  const actual = await importActual<typeof import("../src/wasm-loader")>();
  return { ...actual, loadFluidWasm: spies.loadFluidWasm };
});

import { createFluidRuntime } from "../src/runtime";

let fake: FakeCanvasHandle;

beforeEach(() => {
  fake = installFakeCanvas2D();
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  fake.restore();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("W64 default loader wiring", () => {
  it("given_no_loader_and_no_testBackend_when_two_runtimes_are_created_then_each_awaits_the_module_level_loadFluidWasm", async () => {
    const backend = createTestBackend();
    spies.loadFluidWasm.mockResolvedValue(backend);
    const [a, b] = await Promise.all([
      createFluidRuntime({ particles: 256, maxElements: 4, seed: 1 }),
      createFluidRuntime({ particles: 256, maxElements: 4, seed: 2 }),
    ]);
    expect(spies.loadFluidWasm).toHaveBeenCalledTimes(2);
    expect(backend.cores).toHaveLength(2);
    a.destroy();
    b.destroy();
  });
});
