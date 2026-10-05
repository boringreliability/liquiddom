/** @vitest-environment node */
/**
 * W64: port of docs/superpowers/specs/assets/w61-rca/race3fix.mjs (spec §0,
 * W61 root cause). Two creates started in the same task must share ONE
 * WebAssembly instantiation. This file owns its own module graph because
 * the wasm-bindgen glue keeps module-global state. Needs `npm run build:wasm`
 * first (plan resolution D4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENT_STRIDE } from "../src/fluid-layout";
import { createWasmLoader, type WasmImporter } from "../src/wasm-loader";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../pkg");

describe("W64 multi-instance single-flight (real wasm)", () => {
  it("given_two_creates_started_in_one_task_with_gated_init_when_both_resolve_then_one_instantiation_same_memory_and_both_cores_tick_without_throwing", async () => {
    const bytes = readFileSync(resolve(PKG, "liquiddom_bg.wasm"));
    const origStreaming = WebAssembly.instantiateStreaming;
    const origInstantiate = WebAssembly.instantiate;
    let instantiations = 0;
    WebAssembly.instantiateStreaming = ((...args: Parameters<typeof origStreaming>) => {
      instantiations += 1;
      return origStreaming(...args);
    }) as typeof origStreaming;
    WebAssembly.instantiate = ((...args: unknown[]) => {
      instantiations += 1;
      return (origInstantiate as (...a: unknown[]) => unknown)(...args);
    }) as typeof origInstantiate;
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const response = () => new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
      const importer = (() => import("../../../../pkg/liquiddom.js")) as unknown as WasmImporter;
      const load = createWasmLoader(importer, () => ({ module_or_path: gate.then(response) }));
      const pA = load(); // two LiquidDOM.create() calls in the same task
      const pB = load();
      setTimeout(release, 0);
      const [A, B] = await Promise.all([pA, pB]);
      expect(instantiations).toBe(1);
      expect(A).toBe(B);
      expect(A.memory).toBe(B.memory);

      const cores = [new A.FluidCore(512, 8, 1280, 800, 0, 0, 1), new B.FluidCore(1024, 16, 1280, 800, 0, 0, 2)];
      for (const core of cores) {
        const v = new Float32Array(A.memory.buffer, core.elements_ptr(), core.element_capacity() * ELEMENT_STRIDE);
        v.set([100, 100, 140, 48, 24, 0, 0, 0, NaN, NaN], 0);
        v.set([300, 100, 140, 48, 24, 0, 0, 0, NaN, NaN], ELEMENT_STRIDE);
        core.redistribute();
      }
      for (let f = 0; f < 5; f++) {
        for (const core of [cores[1], cores[0]]) {
          expect(() => core.tick(1 / 60, 0, 0, 0, 0, false, 0, 0)).not.toThrow();
        }
      }
      for (const core of cores) {
        expect(core.active_particles()).toBe(core.particle_capacity());
        core.free();
      }
    } finally {
      WebAssembly.instantiateStreaming = origStreaming;
      WebAssembly.instantiate = origInstantiate;
    }
  });
});
