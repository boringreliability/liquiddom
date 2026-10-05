/**
 * W64: single-flight WASM init + loud failure (spec §2 "Robustness"; the W61
 * root cause is in spec §0). jsdom: the runtime cases use the shared fake
 * canvas and test backend (plan resolution A6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFluidRuntime } from "../src/runtime";
import {
  createWasmLoader,
  LiquidWasmLoadError,
  type FluidCoreCtor,
  type WasmImporter,
} from "../src/wasm-loader";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";
import { createTestBackend } from "./_fluid-test-backend";

function fakeModule() {
  const memory = { buffer: new ArrayBuffer(16) };
  const FluidCore = class {} as unknown as FluidCoreCtor;
  const init = vi.fn(async (_arg?: unknown) => ({ memory }));
  return { mod: { default: init, FluidCore }, init, memory };
}

describe("W64 single-flight WASM loader", () => {
  it("given_two_concurrent_loads_when_awaited_then_importer_and_init_run_once_and_return_same_backend", async () => {
    const { mod, init, memory } = fakeModule();
    const importer = vi.fn(async () => mod);
    const load = createWasmLoader(importer as unknown as WasmImporter);
    const [a, b] = await Promise.all([load(), load()]);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.memory).toBe(memory);
    expect(a.FluidCore).toBe(mod.FluidCore);
    await expect(load()).resolves.toBe(a);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("given_init_rejects_when_loading_then_rejects_with_LiquidWasmLoadError_carrying_cause", async () => {
    const boom = new Error("CompileError: bad magic number");
    const { mod } = fakeModule();
    mod.default = vi.fn(async () => {
      throw boom;
    });
    const load = createWasmLoader((async () => mod) as unknown as WasmImporter);
    const err = await load().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LiquidWasmLoadError);
    expect((err as LiquidWasmLoadError).name).toBe("LiquidWasmLoadError");
    expect((err as LiquidWasmLoadError).cause).toBe(boom);
    expect((err as Error).message).toMatch(/\[liquiddom\].*liquiddom_bg\.wasm/);
  });

  it("given_previous_load_rejected_when_loading_again_then_retries_and_succeeds", async () => {
    const { mod } = fakeModule();
    const importer = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(mod);
    const load = createWasmLoader(importer as unknown as WasmImporter);
    await expect(load()).rejects.toBeInstanceOf(LiquidWasmLoadError);
    await expect(load()).resolves.toMatchObject({ FluidCore: mod.FluidCore });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("given_glue_without_FluidCore_when_loading_then_rejects_naming_the_rebuild", async () => {
    const load = createWasmLoader((async () => ({
      default: async () => ({ memory: { buffer: new ArrayBuffer(8) } }),
    })) as unknown as WasmImporter);
    await expect(load()).rejects.toThrow(/FluidCore.*npm run build:wasm/);
  });
});

describe("W64 createFluidRuntime over the loader", () => {
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

  it("given_Promise_all_of_two_createFluidRuntime_with_gated_loader_when_resolved_then_one_init_and_shared_memory", async () => {
    const backend = createTestBackend();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const init = vi.fn(async () => {
      await gate;
      return { memory: backend.memory };
    });
    const importer = vi.fn(async () => ({ default: init, FluidCore: backend.FluidCore }));
    const loader = createWasmLoader(importer as unknown as WasmImporter);
    const both = Promise.all([
      createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, loader }),
      createFluidRuntime({ particles: 512, maxElements: 4, seed: 2, loader }),
    ]);
    release();
    const [a, b] = await both;
    expect(importer).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(backend.cores).toHaveLength(2);
    expect(a.bridge.dynamicView().buffer).toBe(b.bridge.dynamicView().buffer);
    a.destroy();
    b.destroy();
  });

  it("given_wasm_load_failure_when_createFluidRuntime_then_rejects_and_no_canvas_remains", async () => {
    const loader = createWasmLoader((async () => {
      throw new Error("404 liquiddom.js");
    }) as unknown as WasmImporter);
    await expect(createFluidRuntime({ particles: 256, maxElements: 4, seed: 1, loader })).rejects.toBeInstanceOf(
      LiquidWasmLoadError,
    );
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("given_default_loader_in_jsdom_when_createFluidRuntime_then_rejects_with_LiquidWasmLoadError", async () => {
    // No testBackend: the real glue imports, but fetching the .wasm under
    // jsdom fails. Silent mock mode is gone, so create() must reject.
    await expect(createFluidRuntime({ particles: 256, maxElements: 4, seed: 1 })).rejects.toBeInstanceOf(
      LiquidWasmLoadError,
    );
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  }, 20_000);
});
