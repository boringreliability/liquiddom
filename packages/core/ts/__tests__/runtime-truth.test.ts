/**
 * @vitest-environment jsdom
 * Runtime truth (W35 idea, W66 content): catches "green but not true at runtime".
 * Requires `npm run build` (dist + pkg) first, like workspace-publish.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LiquidDOM, type LiquidDOMInstance } from "../src/index";
import { createManualClock } from "../src/clock";
import { resetDom, setupFacadeTestEnv, spyBackend, ticksOf } from "./_facade-helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, "../..");
const ROOT = resolve(CORE, "../..");
let instance: LiquidDOMInstance | null = null;
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe("Runtime truth (W66)", () => {
  it("given_npm_pack_when_dry_run_then_tarball_ships_wasm_binary_and_wasm_loader_but_no_soft_body_files", () => {
    if (!existsSync(resolve(CORE, "dist/wasm/liquiddom_bg.wasm"))) throw new Error("run `npm run build` first");
    const raw = execFileSync("npm", ["pack", "--json", "--dry-run"], { cwd: CORE, encoding: "utf-8" });
    const paths = (JSON.parse(raw) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    expect(paths).toContain("dist/wasm/liquiddom_bg.wasm");
    expect(paths).toContain("dist/wasm-loader.js");
    for (const gone of ["dist/phantom-observer.js", "dist/wasm-bridge.js", "dist/box-shadow.js", "dist/renderers/renderer.js", "dist/renderers/canvas2d-renderer.js"]) {
      expect(paths).not.toContain(gone);
    }
  });

  it("given_root_export_when_imported_then_internals_are_not_leaked", async () => {
    const keys = Object.keys(await import("../src/index"));
    for (const internal of ["createFluidRuntime", "FluidBridge", "ElementRegistry", "LoopController", "runtimeOf", "bindRuntime", "resolveOptions", "selectRenderer", "PhantomObserver", "WasmBridge", "validatePhysicsConfig"]) {
      expect(keys, internal).not.toContain(internal);
    }
  });

  it("given_pkg_glue_when_read_then_FluidCore_exported_and_LiquidCore_gone", () => {
    const dts = readFileSync(resolve(ROOT, "pkg/liquiddom.d.ts"), "utf-8");
    expect(dts).toMatch(/export class FluidCore\b/);
    expect(dts).not.toMatch(/export class LiquidCore\b/);
  });

  it("given_public_create_with_testBackend_when_manual_frames_advance_then_core_tick_receives_raw_dt_in_seconds", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    instance = await LiquidDOM.create({ testBackend: sb.backend, clock, autoObserve: false, particles: 1024, maxElements: 4 });
    clock.advance(4);
    const ticks = ticksOf(sb);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.at(-1)![0]).toBeCloseTo(1 / 60, 5);
  });
});
