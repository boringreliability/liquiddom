/**
 * @vitest-environment jsdom
 * W66 T4: every 0.2 export, member and option is accounted for (spec §5 "Old
 * to new", completed by B10), the soft-body sources are gone, and the
 * changeset documents the breaking changes (B9, E).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as liquiddom from "../src/index";
import { LiquidDOM, type LiquidDOMInstance, type LiquidOptions } from "../src/index";
import { createManualClock } from "../src/clock";
import { addLiquid, freshBackend, instanceTracker, resetDom, setupFacadeTestEnv } from "./_facade-helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const tracker = instanceTracker();
beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});
afterEach(() => tracker.destroyAll());

type Fate = { kind: "kept" } | { kind: "removed"; note: string } | { kind: "renamed"; to: string };
const kept: Fate = { kind: "kept" };
const removed = (note: string): Fate => ({ kind: "removed", note });
const renamed = (to: string): Fate => ({ kind: "renamed", to });

/** Every member of the 0.2 LiquidDOMInstance (index.ts:231-305 at softbody-final). */
const OLD_INSTANCE_MEMBERS: Readonly<Record<string, Fate>> = {
  capacity: renamed("elementCapacity"),
  isPaused: kept,
  isReducedMotion: removed("D66-5"),
  isScrolling: removed("D66-5"),
  isScrollSnapping: removed("W55 lerp retired"),
  pointerActive: removed("D66-5"),
  pointerX: removed("no public pointer state"),
  pointerY: removed("no public pointer state"),
  preserveBackgrounds: removed("D8"),
  activeRenderer: kept,
  getBuffer: removed("no public buffer"),
  observe: kept,
  unobserve: kept,
  grow: removed("fixed pool"),
  tween: removed("targets follow the rect"),
  impulse: removed("→ splash() (W67)"),
  pause: kept,
  resume: kept,
  autoDiscover: kept,
  stopAutoDiscover: kept,
  destroy: kept,
  setPhysicsConfig: removed("→ setMaterial() in W68"),
  getPhysicsConfig: removed("→ getMaterial() in W68"),
  refreshTheme: renamed("refresh"),
  refreshShadow: renamed("refresh"),
  spawnDroplet: removed("droplets are ordinary particles"),
  despawnDroplet: removed("droplets are ordinary particles"),
  setBackgroundTexture: removed("refraction retired"),
  requestOrientationPermission: kept,
};

/** Every 0.2 LiquidOptions key (index.ts:68-132 at softbody-final), with a value that type-checked in 0.2. */
const OLD_OPTIONS: ReadonlyArray<[string, unknown, Fate]> = [
  ["capacity", 8, renamed("maxElements")],
  ["physics", {}, renamed("material")],
  ["colorDefault", "rgb(0, 0, 0)", removed("computed style")],
  ["colorHover", "rgb(0, 0, 0)", removed("computed style")],
  ["colorSource", "computed", removed("computed style")],
  ["theme", {}, removed("fusion/refraction retired")],
  ["preserveBackgrounds", true, removed("D8")],
  ["snapDurationMs", 150, removed("W55 retired")],
  ["canvasZIndex", 0, removed("D7")],
  ["maxDt", 50, removed("Rust clamps 100 ms")],
  ["autoObserve", false, kept],
  ["forceReducedMotion", false, kept],
  ["renderer", "canvas2d", kept],
  ["silentFallback", true, kept],
  ["gravity", { source: "none" }, kept],
];

const OLD_RUNTIME_EXPORTS: Readonly<Record<string, Fate>> = {
  LiquidDOM: kept,
  WebGPUUnavailableError: kept,
  presets: kept, // W68 D68-6 (A2): same name, material-shaped (water/honey/jelly); old values asserted gone below
  validatePhysicsConfig: renamed("validateMaterial"),
};

async function create(extra: LiquidOptions = {}): Promise<LiquidDOMInstance> {
  return tracker.track(await LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 4, ...extra }));
}

describe("W66 T4: old → new mapping", () => {
  it("given_old_instance_members_when_inspected_then_each_fate_holds", async () => {
    const inst = (await create()) as unknown as Record<string, unknown>;
    for (const [name, fate] of Object.entries(OLD_INSTANCE_MEMBERS)) {
      if (fate.kind === "kept") expect(name in inst, name).toBe(true);
      if (fate.kind === "removed") expect(name in inst, `${name} (${fate.note})`).toBe(false);
      if (fate.kind === "renamed") {
        expect(name in inst, name).toBe(false);
        expect(fate.to in inst, fate.to).toBe(true);
      }
    }
    expect("particleCapacity" in inst).toBe(true);
  });

  it("given_instance_when_inspected_then_grow_tween_impulse_spawnDroplet_despawnDroplet_setPhysicsConfig_getPhysicsConfig_refreshTheme_refreshShadow_setBackgroundTexture_getBuffer_pointerX_pointerY_preserveBackgrounds_isScrollSnapping_capacity_absent", async () => {
    const inst = (await create()) as unknown as Record<string, unknown>;
    for (const name of ["grow", "tween", "impulse", "spawnDroplet", "despawnDroplet", "setPhysicsConfig", "getPhysicsConfig", "refreshTheme", "refreshShadow", "setBackgroundTexture", "getBuffer", "pointerX", "pointerY", "preserveBackgrounds", "isScrollSnapping", "capacity"]) {
      expect(name in inst, name).toBe(false);
    }
  });

  it("given_instance_when_inspected_then_isReducedMotion_isScrolling_pointerActive_absent_D66_5", async () => {
    const inst = (await create()) as unknown as Record<string, unknown>;
    for (const name of ["isReducedMotion", "isScrolling", "pointerActive"]) expect(name in inst, name).toBe(false);
  });

  it("given_observe_with_number_when_called_then_TypeError_mentioning_liquidType_removed", async () => {
    const inst = await create();
    const el = addLiquid("button", [0, 0, 100, 40], document.body, false);
    expect(() => inst.observe(el, 3 as never)).toThrow(TypeError);
    expect(() => inst.observe(el, 3 as never)).toThrow(/liquidType.*removed/);
    expect(el.classList.contains("liquid-element")).toBe(false);
  });

  it("given_old_options_when_create_then_removed_ones_reject_TypeError_naming_replacement_and_kept_ones_are_accepted", async () => {
    for (const [key, value, fate] of OLD_OPTIONS) {
      const attempt = LiquidDOM.create({ testBackend: freshBackend(), autoObserve: false, particles: 1024, maxElements: 4, [key]: value } as LiquidOptions);
      if (fate.kind === "kept") {
        tracker.track(await attempt);
      } else {
        const err = await attempt.then(() => null, (e: unknown) => e);
        expect(err, key).toBeInstanceOf(TypeError);
        expect((err as Error).message, key).toContain(`"${key}"`);
        if (fate.kind === "renamed") expect((err as Error).message, key).toContain(fate.to);
      }
    }
  });

  it("given_old_runtime_exports_when_imported_then_each_fate_holds", () => {
    const mod = liquiddom as unknown as Record<string, unknown>;
    for (const [name, fate] of Object.entries(OLD_RUNTIME_EXPORTS)) {
      if (fate.kind === "kept") expect(name in mod, name).toBe(true);
      if (fate.kind === "renamed") {
        expect(name in mod, name).toBe(false);
        expect(fate.to in mod, fate.to).toBe(true);
      }
    }
  });

  it("given_index_when_imported_then_validatePhysicsConfig_absent_and_old_physics_presets_gone", () => {
    const mod = liquiddom as unknown as Record<string, unknown>;
    expect("validatePhysicsConfig" in mod).toBe(false);
    // A2: W68 re-adds `presets` with MATERIAL values; here only the old physics shape must be gone.
    const presets = mod.presets as Record<string, Record<string, unknown>> | undefined;
    if (presets !== undefined) {
      expect(presets).not.toHaveProperty("goo");
      expect(presets).not.toHaveProperty("firm");
      for (const p of Object.values(presets)) {
        for (const physicsKey of ["tension", "damping", "repulsionRadius", "repulsionStrength", "substeps", "neighborSpringK"]) {
          expect(p).not.toHaveProperty(physicsKey);
        }
      }
    }
  });

  it("given_no_listener_when_running_then_no_liquiddom_instance_panic_event", async () => {
    const seen: Event[] = [];
    const onPanic = (e: Event) => seen.push(e);
    window.addEventListener("liquiddom:instance-panic", onPanic);
    try {
      const clock = createManualClock();
      const container = document.createElement("section");
      document.body.appendChild(container);
      container.addEventListener("liquiddom:instance-panic", onPanic);
      addLiquid("button", [0, 0, 100, 40], container);
      await create({ clock, container, autoObserve: true });
      clock.advance(30);
      expect(seen).toHaveLength(0);
      const SRC = resolve(ROOT, "packages/core/ts/src");
      for (const rel of (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"))) {
        expect(readFileSync(resolve(SRC, rel), "utf-8"), rel).not.toContain("liquiddom:instance-panic");
      }
    } finally {
      window.removeEventListener("liquiddom:instance-panic", onPanic);
    }
  });

  it("given_api_migration_type_fixture_when_tsc_checks_it_then_exit_code_0", () => {
    // D66-11. Needs `npm run build` (all three dist/*.d.ts). Unused @ts-expect-error = failure.
    execFileSync("npx", ["tsc", "--noEmit", "-p", resolve(ROOT, "__fixtures__/api-migration-types/tsconfig.json")], {
      cwd: ROOT, encoding: "utf-8", stdio: "pipe",
    });
  }, 120_000);
});

describe("W66 T4: retirement and release notes", () => {
  it("given_soft_body_sources_when_checked_then_deleted_and_lib_rs_declares_only_fluid", () => {
    for (const rel of ["src/api.rs", "src/buffer.rs", "src/entity.rs", "src/math.rs", "src/physics.rs",
      "packages/core/ts/src/phantom-observer.ts", "packages/core/ts/src/wasm-bridge.ts", "packages/core/ts/src/box-shadow.ts"]) {
      expect(existsSync(resolve(ROOT, rel)), rel).toBe(false);
    }
    const lib = readFileSync(resolve(ROOT, "src/lib.rs"), "utf-8");
    expect(lib.match(/^\s*pub mod \w+;/gm)).toEqual(["pub mod fluid;"]);
  });

  it("given_retired_demo_scenes_when_checked_then_deleted_and_acceptance_scene_kept", () => {
    // W69 recreates playground.{html,ts} + playground-state.ts on the material API (spec §5).
    for (const name of ["dragable-cards", "fusion", "refraction", "scroll-hero", "splash-buttons", "tilt-bowl"]) {
      expect(existsSync(resolve(ROOT, `demo/scenes/${name}.html`)), name).toBe(false);
      expect(existsSync(resolve(ROOT, `demo/scenes/${name}.ts`)), name).toBe(false);
    }
    expect(existsSync(resolve(ROOT, "demo/main.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "demo/scenes/acceptance.html"))).toBe(true);
    expect(existsSync(resolve(ROOT, "demo/scenes/stress.html"))).toBe(true);
  });

  it("given_changeset_when_read_then_SplashOptions_shape_change_colour_regression_and_removed_api_are_documented_B9_E", () => {
    const md = readFileSync(resolve(ROOT, ".changeset/fluid-engine-alpha.md"), "utf-8");
    for (const pkg of ['"liquiddom": minor', '"@liquiddom/react": minor', '"@liquiddom/vue": minor']) expect(md).toContain(pkg);
    expect(md).toMatch(/SplashOptions/);
    expect(md).toMatch(/threshold/);
    expect(md).toMatch(/strength/);
    expect(md).toMatch(/MutationObserver/);
    expect(md).toContain("refresh(el)");
    expect(md).toMatch(/pause\(\)/); // D66-12: pause() semantics changed (regression 2)
    expect(md).toMatch(/visib|hidden/i);
    for (const name of Object.keys(OLD_INSTANCE_MEMBERS).filter((n) => OLD_INSTANCE_MEMBERS[n]!.kind !== "kept")) {
      expect(md, name).toContain(name);
    }
  });
});

describe("presets migration (W68, resolution A2)", () => {
  it("given_presets_when_imported_then_material_presets_water_honey_jelly_replace_the_old_physics_presets", () => {
    const mod = liquiddom as unknown as Record<string, unknown>;
    const p = mod.presets as Record<string, Record<string, unknown>>;
    expect(Object.keys(p).sort()).toEqual(["honey", "jelly", "water"]);
    expect(p).not.toHaveProperty("goo");
    expect(p).not.toHaveProperty("firm");
    for (const preset of Object.values(p)) {
      expect(Object.keys(preset).sort()).toEqual(["cohesion", "recovery", "viscosity"]);
      for (const old of ["tension", "damping", "repulsionRadius", "repulsionStrength", "substeps", "neighborSpringK"]) {
        expect(preset).not.toHaveProperty(old);
      }
    }
  });

  it("given_old_physics_shaped_config_when_setMaterial_then_TypeError_naming_the_key_and_the_material_fields", async () => {
    const inst = await create();
    expect(() => inst.setMaterial({ tension: 80, damping: 4 } as never)).toThrow(TypeError);
    expect(() => inst.setMaterial({ tension: 80 } as never)).toThrow(/tension.*viscosity, cohesion, recovery/s);
  });
});
