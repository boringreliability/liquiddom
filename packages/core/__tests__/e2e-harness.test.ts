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
  PORT,
  PROJECT_FILES,
  PROJECT_USE,
  WEBGPU_LAUNCH_ARGS,
  WEB_SERVER_COMMAND,
  projectsForSpec,
  webServerEnv,
} from "../../../e2e/projects";
import { summarize } from "../../../e2e/stats";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SPECS = readdirSync(resolve(ROOT, "e2e"))
  .filter((f) => f.endsWith(".spec.ts"))
  .sort();

function routedTo(project: string): string[] {
  return SPECS.filter((f) => projectsForSpec(resolve(ROOT, "e2e", f)).includes(project as never));
}

function isIgnored(path: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed (${r.status}): ${r.stderr}`);
  return r.status === 0;
}

describe("W65 e2e harness", () => {
  it("given_playwright_config_when_loaded_then_webgpu_project_matches_only_the_smoke_spec", () => {
    expect(SPECS).toContain("webgpu-smoke.spec.ts");
    expect(routedTo("webgpu")).toEqual(["webgpu-smoke.spec.ts"]);
  });

  it("given_e2e_spec_files_when_routed_then_canvas2d_runs_every_spec_except_smoke_and_perf", () => {
    const expected = SPECS.filter((f) => f !== "webgpu-smoke.spec.ts" && f !== "perf.spec.ts");
    expect(routedTo("canvas2d")).toEqual(expected);
    expect(expected).toEqual(
      expect.arrayContaining(["acceptance.spec.ts", "guard.spec.ts", "modes.spec.ts", "multi-instance.spec.ts"]),
    );
  });

  it("given_project_table_when_read_then_only_canvas2d_is_blocking_and_perf_runs_only_perf_spec", () => {
    expect(PROJECT_FILES.filter((p) => p.blocking).map((p) => p.name)).toEqual(["canvas2d"]);
    expect(routedTo("perf")).toEqual(["perf.spec.ts"]);
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
});
