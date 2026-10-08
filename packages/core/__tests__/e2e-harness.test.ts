/** @vitest-environment node */
/**
 * W65 (C8, D65-2, D65-5, D65-7, D1): e2e harness invariants that need no browser.
 * playwright.config.ts is not imported here (it pulls in @playwright/test);
 * its project `use` overrides and web-server settings live in e2e/projects.ts
 * and the config is checked to wire exactly those exports.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_URL,
  DIST_EXAMPLE_ROOT,
  DIST_PORT,
  PORT,
  PROJECT_FILES,
  PROJECT_RENDERER,
  PROJECT_USE,
  SWIFTSHADER_RUNS_LIQUID,
  WEBGPU_HW_LAUNCH_ARGS,
  WEBGPU_LAUNCH_ARGS,
  WEB_SERVER_COMMAND,
  projectsForSpec,
  rendererForProject,
  webServerEnv,
} from "../../../e2e/projects";
import * as projectsNs from "../../../e2e/projects";
import { summarize } from "../../../e2e/stats";
import config from "../../../playwright.config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SPECS = readdirSync(resolve(ROOT, "e2e"))
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();

interface ProjectCfg {
  name: string;
  testMatch?: RegExp;
  testIgnore?: RegExp[];
  use?: { channel?: string; launchOptions?: { args?: string[] }; viewport?: { width: number; height: number } };
}
const cfg = config as unknown as {
  testDir?: string;
  snapshotPathTemplate?: string;
  use?: { baseURL?: string };
  webServer?: { command?: string; url?: string; reuseExistingServer?: boolean; env?: Record<string, string> };
  projects?: ProjectCfg[];
};
const cfgProjects = cfg.projects ?? [];

/** Specs the REAL playwright.config.ts routes to a project (testMatch/testIgnore as Playwright applies them). */
function configRoutedTo(project: string): string[] {
  const p = cfgProjects.find((x) => x.name === project);
  if (!p) throw new Error(`playwright.config.ts has no project ${project}`);
  return SPECS.filter((f) => {
    const file = resolve(ROOT, "e2e", f);
    const match = p.testMatch ?? /\.spec\.ts$/;
    return match.test(file) && !(p.testIgnore ?? []).some((re) => re.test(file));
  });
}

function routedTo(project: string): string[] {
  return SPECS.filter((f) => projectsForSpec(resolve(ROOT, "e2e", f)).includes(project as never));
}

function isIgnored(path: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed (${r.status}): ${r.stderr}`);
  return r.status === 0;
}

describe("W65 e2e harness", () => {
  it("given_playwright_config_when_loaded_then_webgpu_project_matches_the_acceptance_the_liquid_and_the_smoke_specs_W71", () => {
    // W71 (D71-2): steps 1–3 run under renderer=webgpu; webgpu-liquid.spec.ts holds the shader and colour checks.
    expect(SPECS).toEqual(expect.arrayContaining(["acceptance.spec.ts", "webgpu-liquid.spec.ts", "webgpu-smoke.spec.ts"]));
    // W72 red: approved-test change (Dennis approves at W72 red): the robust spec is routed to webgpu only when SWIFTSHADER_RUNS_LIQUID
    expect(routedTo("webgpu")).toEqual(["acceptance.spec.ts", "webgpu-liquid.spec.ts", ...(projectsNs.SWIFTSHADER_RUNS_LIQUID ? ["webgpu-robust.spec.ts"] : []), "webgpu-smoke.spec.ts"]);
    // Proven on the REAL config object, not only the helper.
    expect(configRoutedTo("webgpu")).toEqual(["acceptance.spec.ts", "webgpu-liquid.spec.ts", ...(projectsNs.SWIFTSHADER_RUNS_LIQUID ? ["webgpu-robust.spec.ts"] : []), "webgpu-smoke.spec.ts"]);
  });

  it("given_e2e_spec_files_when_routed_then_canvas2d_runs_every_spec_except_smoke_webgpu_liquid_perf_record_and_dist", () => {
    // W72 red: approved-test change (Dennis approves at W72 red): webgpu-robust.spec.ts joins the exclusions
    const expected = SPECS.filter(
      (f) => !["webgpu-smoke.spec.ts", "webgpu-liquid.spec.ts", "webgpu-robust.spec.ts", "perf.spec.ts", "record.spec.ts", "dist.spec.ts"].includes(f),
    );
    expect(routedTo("canvas2d")).toEqual(expected);
    expect(expected).toEqual(
      expect.arrayContaining(["acceptance.spec.ts", "guard.spec.ts", "modes.spec.ts", "multi-instance.spec.ts"]),
    );
  });

  it("given_project_table_when_read_then_canvas2d_and_dist_are_blocking_and_perf_runs_only_perf_spec", () => {
    // W69 (D69-6): the published-dist smoke is blocking as well.
    expect(PROJECT_FILES.filter((p) => p.blocking).map((p) => p.name)).toEqual(["canvas2d", "dist"]);
    expect(routedTo("perf")).toEqual(["perf.spec.ts"]);
    expect(configRoutedTo("perf")).toEqual(["perf.spec.ts"]);
    expect(configRoutedTo("canvas2d")).toEqual(routedTo("canvas2d"));
    expect(cfgProjects.map((p) => p.name)).toEqual(PROJECT_FILES.map((p) => p.name));
  });

  it("given_e2e_spec_files_when_routed_then_record_project_runs_only_the_record_spec_and_is_not_blocking", () => {
    // W69 (D69-2): the whole-picture recording is local-only.
    expect(SPECS).toContain("record.spec.ts");
    expect(routedTo("record")).toEqual(["record.spec.ts"]);
    expect(PROJECT_FILES.find((p) => p.name === "record")?.blocking).toBe(false);
    // Video only in the record project (useFor() in playwright.config.ts maps it to use.video).
    expect(PROJECT_USE.record.video).toBe("on");
    expect(PROJECT_USE.canvas2d.video).toBeUndefined();
  });

  it("given_e2e_spec_files_when_routed_then_dist_project_runs_only_the_dist_spec_on_its_own_port_and_is_blocking", () => {
    // W69 (D69-6): the spec serves examples/react/dist itself (Vite preview API).
    expect(SPECS).toContain("dist.spec.ts");
    expect(routedTo("dist")).toEqual(["dist.spec.ts"]);
    expect(configRoutedTo("dist")).toEqual(["dist.spec.ts"]);
    expect(PROJECT_FILES.find((p) => p.name === "dist")?.blocking).toBe(true);
    expect(PROJECT_USE.dist.video).toBeUndefined();
    // 4173 is the demo server (D65-2) and Vite preview's default, so the dist port is explicit.
    expect(DIST_PORT).toBe(4174);
    expect(DIST_PORT).not.toBe(PORT);
    expect(DIST_EXAMPLE_ROOT).toBe("examples/react");
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    // --ignore-scripts skips the example's prebuild (wasm-pack is not in the Playwright CI image).
    expect(pkg.scripts["e2e:dist:build"]).toBe(
      "npm run build -w liquiddom && npm run build -w @liquiddom/react && npm run build -w liquiddom-react-example --ignore-scripts",
    );
    expect(pkg.scripts["e2e:dist"]).toBe("npm run e2e:dist:build && playwright test --project=dist");
  });

  it("given_webgpu_launch_args_when_read_then_they_equal_the_spec_swiftshader_flags", () => {
    expect([...WEBGPU_LAUNCH_ARGS]).toEqual([
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--use-webgpu-adapter=swiftshader",
    ]);
  });

  it("given_playwright_config_when_loaded_then_webgpu_runs_new_headless_chromium_and_web_server_has_BROWSER_none_and_strictPort", () => {
    // D65-5: new headless (channel "chromium"); the default headless-shell has no WebGPU.
    expect(PROJECT_USE.webgpu.channel).toBe("chromium");
    expect(PROJECT_USE.webgpu.launchArgs).toBe(WEBGPU_LAUNCH_ARGS);
    expect(PROJECT_USE.canvas2d.channel).toBeUndefined();
    expect(PROJECT_USE.perf.channel).toBeUndefined();
    // D65-2: fixed port, fail fast instead of drifting; BROWSER=none defeats `server.open: true`.
    expect(PORT).toBe(4173);
    expect(BASE_URL).toBe("http://localhost:4173");
    expect(WEB_SERVER_COMMAND).toBe("npx vite --config demo/vite.config.ts demo --port 4173 --strictPort");
    expect(webServerEnv({ BROWSER: "open", PATH: "/usr/bin", DROPPED: undefined })).toEqual({
      BROWSER: "none",
      PATH: "/usr/bin",
    });
    const config = readFileSync(resolve(ROOT, "playwright.config.ts"), "utf8");
    for (const wiring of [
      "command: WEB_SERVER_COMMAND",
      "env: webServerEnv(process.env)",
      "url: `${BASE_URL}/scenes/acceptance.html`",
      "use: useFor(p.name)",
    ]) {
      expect(config, `playwright.config.ts wires ${wiring}`).toContain(wiring);
    }
  });

  it("given_real_playwright_config_when_loaded_then_it_applies_the_D65_settings", () => {
    expect(cfg.testDir).toBe("e2e");
    expect(cfg.snapshotPathTemplate).toBe("e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}");
    expect(cfg.use?.baseURL).toBe(BASE_URL);
    expect(cfg.webServer?.command).toBe(WEB_SERVER_COMMAND);
    expect(cfg.webServer?.url).toBe(`${BASE_URL}/scenes/acceptance.html`);
    expect(cfg.webServer?.reuseExistingServer).toBe(!process.env.CI);
    expect(cfg.webServer?.env?.BROWSER).toBe("none");
    for (const p of cfgProjects) {
      expect(p.use?.viewport, `${p.name} viewport`).toEqual({ width: 1280, height: 800 });
      expect(p.use?.channel, `${p.name} channel`).toBe(PROJECT_USE[p.name as keyof typeof PROJECT_USE].channel);
      const args = PROJECT_USE[p.name as keyof typeof PROJECT_USE].launchArgs;
      expect(p.use?.launchOptions?.args, `${p.name} launch args`).toEqual(args ? [...args] : undefined);
    }
  });

  it("given_samples_when_summarized_then_nearest_rank_p50_p95_mean_and_max", () => {
    const s = summarize(Array.from({ length: 100 }, (_, i) => 100 - i));
    expect(s).toEqual({ n: 100, mean: 50.5, p50: 50, p95: 95, max: 100 });
    expect(summarize([3])).toEqual({ n: 1, mean: 3, p50: 3, p95: 3, max: 3 });
    expect(() => summarize([])).toThrow(RangeError);
  });

  it("given_gitignore_when_checked_then_baselines_are_tracked_even_when_named_w_star_and_reports_are_ignored", () => {
    expect(isIgnored("e2e/__screenshots__/webgpu-smoke.spec.ts/webgpu-frame-webgpu-linux.png")).toBe(false);
    expect(isIgnored("e2e/__screenshots__/acceptance.spec.ts/acceptance-step1-canvas2d-linux.png")).toBe(false);
    expect(isIgnored("test-results/canvas2d/acceptance/w65-step1.png")).toBe(true);
    expect(isIgnored("playwright-report/canvas2d/index.html")).toBe(true);
    expect(isIgnored("w65-step1.png")).toBe(true);
  });

  it("given_e2e_docker_script_when_read_then_it_pins_platform_linux_amd64", () => {
    const sh = readFileSync(resolve(ROOT, "scripts/e2e-docker.sh"), "utf8");
    expect(sh).toContain("--platform linux/amd64");
    expect(sh).toContain("mcr.microsoft.com/playwright:v${PW_VERSION}-noble");
    expect(sh).toMatch(/devDependencies\[['"]@playwright\/test['"]\]/);
    expect(sh).toContain("--exclude=node_modules");
  });

  it("given_project_renderer_map_when_read_then_only_the_webgpu_project_renders_webgpu_and_an_unknown_project_throws_W71", () => {
    // W72 red: approved-test change (Dennis approves at W72 red): W72 adds record-webgpu
    expect(PROJECT_RENDERER).toEqual({ canvas2d: "canvas2d", webgpu: "webgpu", "webgpu-hw": "webgpu", perf: "canvas2d", record: "canvas2d", dist: "canvas2d", "record-webgpu": "webgpu" });
    for (const p of PROJECT_FILES) expect(rendererForProject(p.name)).toBe(PROJECT_RENDERER[p.name]);
    expect(() => rendererForProject("chromium")).toThrow(/unknown Playwright project/);
  });

  it("given_the_webgpu_hw_project_when_read_then_it_runs_the_webgpu_specs_on_the_hardware_adapter_locally_and_the_spike_constant_matches_ci_W71", () => {
    // W71 (D71-1): local Metal runs use the webgpu-hw project; SWIFTSHADER_RUNS_LIQUID is the W71.0 answer, defined once.
    expect([...WEBGPU_HW_LAUNCH_ARGS]).toEqual(["--enable-unsafe-webgpu"]);
    // W72 red: approved-test change (Dennis approves at W72 red): toEqual → toMatchObject (W72.5 may add headless: false)
    expect(PROJECT_USE["webgpu-hw"]).toMatchObject({ channel: "chromium", launchArgs: WEBGPU_HW_LAUNCH_ARGS });
    expect(PROJECT_FILES.find((p) => p.name === "webgpu-hw")?.blocking).toBe(false);
    // W72 red: approved-test change (Dennis approves at W72 red)
    expect(routedTo("webgpu-hw")).toEqual(expect.arrayContaining(routedTo("webgpu"))); // W72 adds the robust spec and the webgpu perf test
    expect(configRoutedTo("webgpu-hw")).toEqual(routedTo("webgpu-hw"));
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["e2e:webgpu-hw"]).toBe("playwright test --project=webgpu-hw");
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toMatch(/webgpu-hw/);
    expect(typeof SWIFTSHADER_RUNS_LIQUID).toBe("boolean");
    const webgpuRun = SWIFTSHADER_RUNS_LIQUID
      ? "run: npx playwright test --project=webgpu\n"
      : "run: npx playwright test --project=webgpu e2e/webgpu-smoke.spec.ts\n";
    expect(ci, "the CI webgpu step follows the W71.0 answer").toContain(webgpuRun);
  });

  it("given_local_hardware_projects_when_read_then_webgpu_hw_and_record_webgpu_are_local_only_and_the_robust_spec_is_routed_by_the_spike_answer", () => {
    // W71's webgpu-hw and W72's record-webgpu: WebGPU on the machine's own adapter (Metal on Dennis' Mac); never in CI.
    const hwArgs = projectsNs.WEBGPU_HW_LAUNCH_ARGS;
    expect(hwArgs, "WEBGPU_HW_LAUNCH_ARGS is exported").toBeDefined();
    expect(hwArgs).toContain("--enable-unsafe-webgpu");
    expect(hwArgs.some((a: string) => /swiftshader/i.test(a))).toBe(false);
    const use = PROJECT_USE as unknown as Record<string, { channel?: string; launchArgs?: readonly string[]; video?: string }>;
    for (const name of ["webgpu-hw", "record-webgpu"]) {
      expect(PROJECT_FILES.find((p) => p.name === (name as never))?.blocking, name).toBe(false);
      expect(use[name]?.channel, name).toBe("chromium");
      expect(use[name]?.launchArgs, name).toBe(hwArgs);
    }
    expect(use["record-webgpu"]?.video).toBe("on");
    expect(routedTo("record-webgpu")).toEqual(["record.spec.ts"]);
    expect(routedTo("webgpu-hw")).toEqual(expect.arrayContaining(["perf.spec.ts", "webgpu-robust.spec.ts", "webgpu-smoke.spec.ts"]));
    expect(routedTo("webgpu-hw")).not.toContain("record.spec.ts");
    expect(routedTo("canvas2d")).not.toContain("webgpu-robust.spec.ts");
    expect(routedTo("webgpu").includes("webgpu-robust.spec.ts")).toBe(projectsNs.SWIFTSHADER_RUNS_LIQUID);
    expect(configRoutedTo("webgpu-hw")).toEqual(routedTo("webgpu-hw"));
    expect(configRoutedTo("webgpu")).toEqual(routedTo("webgpu"));
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toMatch(/webgpu-hw|record-webgpu/);
  });

  it("given_a_cold_vite_server_when_the_suite_starts_then_global_setup_warms_the_acceptance_scene_and_retries_only_a_navigation_race", () => {
    // W71 gold notes: on a cold server the first test once failed with "Execution context was destroyed"
    // (Vite's dependency optimiser reloaded the page). Harness fix, no decision: a best-effort warm-up.
    expect((config as unknown as { globalSetup?: string }).globalSetup).toBe("./e2e/global-setup.ts");
    expect(projectsNs.WARMUP_PATH).toBe("/scenes/acceptance.html?test=1&seed=1&renderer=canvas2d&clock=manual");
    expect(projectsNs.WARMUP_ATTEMPTS).toBe(3);
    expect(projectsNs.WARMUP_SETTLE_MS).toBe(1_000);
    const race = projectsNs.isNavigationRace;
    expect(typeof race, "isNavigationRace is exported").toBe("function");
    expect(race("page.evaluate: Execution context was destroyed, most likely because of a navigation")).toBe(true);
    expect(race("page.waitForFunction: Frame was detached")).toBe(true);
    expect(race("page.goto: net::ERR_ABORTED at http://localhost:4173/scenes/acceptance.html")).toBe(true);
    expect(race("page.waitForFunction: Timeout 30000ms exceeded.")).toBe(false);
    expect(race("[acceptance] scene failed to start")).toBe(false);
    const setup = readFileSync(resolve(ROOT, "e2e/global-setup.ts"), "utf8");
    for (const name of ["WARMUP_PATH", "WARMUP_ATTEMPTS", "WARMUP_SETTLE_MS", "isNavigationRace", "BASE_URL"]) {
      expect(setup, `global-setup.ts uses ${name} from ./projects`).toContain(name);
    }
    expect(setup, "a failed warm-up only warns; the tests report real problems").toContain("console.warn(");
  });
});
