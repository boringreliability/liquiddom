/** @vitest-environment node */
/**
 * W65 (D65-3, D65-6, D65-7, C1, D1, D2): shape of the CI e2e jobs in
 * .github/workflows/ci.yml, parsed with `yaml` (explicit devDependency).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
}
interface Job {
  needs?: string | string[];
  if?: string;
  "timeout-minutes"?: number;
  container?: string | { image?: string; options?: string };
  steps?: Step[];
}
interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, Job>;
}

const ci = parse(readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")) as Workflow;
const rootPkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
};
const OPTIONS_OF = (j: { container?: string | { options?: string } }): string =>
  typeof j.container === "object" ? (j.container.options ?? "") : "";

function job(name: string): Job {
  const j = ci.jobs?.[name];
  if (!j) throw new Error(`ci.yml has no job "${name}"`);
  return j;
}
function needsOf(j: Job): string[] {
  if (j.needs === undefined) return [];
  return Array.isArray(j.needs) ? j.needs : [j.needs];
}
function imageOf(j: Job): string | undefined {
  return typeof j.container === "string" ? j.container : j.container?.image;
}
function stepsOf(j: Job): Step[] {
  return j.steps ?? [];
}
function runSteps(j: Job, needle: string): Step[] {
  return stepsOf(j).filter((s) => typeof s.run === "string" && s.run.includes(needle));
}
function stepIndex(j: Job, pred: (s: Step) => boolean): number {
  return stepsOf(j).findIndex(pred);
}
function pinnedPlaywright(): string {
  const v = rootPkg.devDependencies?.["@playwright/test"];
  if (!v) throw new Error("@playwright/test is not a root devDependency");
  return v;
}
function isUpload(s: Step, name: string): boolean {
  return typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@") && s.with?.name === name;
}
const RUNS_UNLESS_CANCELLED = /always\(\)|!cancelled\(\)/;

describe("W65 CI e2e workflow", () => {
  it("given_ci_yml_when_parsed_then_e2e_job_needs_test_and_uses_playwright_image_matching_the_exact_devDependency_version", () => {
    const pin = pinnedPlaywright();
    expect(pin).toBe("1.63.0");
    expect(rootPkg.devDependencies?.yaml).toBe("^2.9.1");
    expect(pin, "D65-6: exact pin, no range").toMatch(/^\d+\.\d+\.\d+$/);
    const e2e = job("e2e");
    expect(needsOf(e2e)).toContain("test");
    expect(imageOf(e2e)).toBe(`mcr.microsoft.com/playwright:v${pin}-noble`);
    expect(e2e["timeout-minutes"]).toBe(25);
    expect(OPTIONS_OF(e2e)).toContain("--ipc=host");
    expect(e2e.if ?? "", "e2e is skipped on manual baseline runs").toContain("!= 'workflow_dispatch'");
  });

  it("given_ci_yml_when_parsed_then_canvas2d_step_is_blocking_and_webgpu_step_continue_on_error", () => {
    const e2e = job("e2e");
    const c2d = runSteps(e2e, "--project=canvas2d");
    expect(c2d).toHaveLength(1);
    expect(c2d[0]["continue-on-error"] ?? false).toBe(false);
    const gpu = runSteps(e2e, "--project=webgpu");
    expect(gpu).toHaveLength(1);
    expect(gpu[0]["continue-on-error"]).toBe(true);
    expect(gpu[0]["timeout-minutes"]).toBe(5);
    expect(gpu[0].if ?? "").toMatch(RUNS_UNLESS_CANCELLED);
  });

  it("given_ci_yml_when_parsed_then_pkg_artifact_is_uploaded_by_test_and_downloaded_by_e2e", () => {
    const test = job("test");
    const up = stepIndex(test, (s) => isUpload(s, "wasm-pkg"));
    expect(up, "test job uploads wasm-pkg").toBeGreaterThanOrEqual(0);
    const upload = stepsOf(test)[up];
    expect(String(upload.with?.path)).toMatch(/^pkg\/?$/);
    expect(upload.if ?? "").toContain("matrix.node == 22");
    const build = stepIndex(test, (s) => s.run === "npm run build");
    expect(build).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(build);

    const e2e = job("e2e");
    const down = stepIndex(
      e2e,
      (s) => typeof s.uses === "string" && s.uses.startsWith("actions/download-artifact@") && s.with?.name === "wasm-pkg",
    );
    expect(down, "e2e downloads wasm-pkg").toBeGreaterThanOrEqual(0);
    expect(stepsOf(e2e)[down].with?.path).toBe("pkg");
    const c2d = stepIndex(e2e, (s) => typeof s.run === "string" && s.run.includes("--project=canvas2d"));
    expect(down).toBeLessThan(c2d);
    const install = stepIndex(e2e, (s) => typeof s.run === "string" && s.run.startsWith("npm ci"));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(c2d);
  });

  it("given_ci_yml_when_parsed_then_perf_step_is_non_blocking_and_its_json_is_uploaded", () => {
    const e2e = job("e2e");
    const perf = runSteps(e2e, "--project=perf");
    expect(perf).toHaveLength(1);
    expect(perf[0]["continue-on-error"]).toBe(true);
    expect(perf[0]["timeout-minutes"]).toBe(5);
    const upload = stepsOf(e2e).find((s) => isUpload(s, "perf-canvas2d"));
    expect(upload, "perf-canvas2d artifact").toBeDefined();
    expect(String(upload?.with?.path)).toContain("perf-canvas2d.json");
    expect(upload?.if ?? "").toMatch(RUNS_UNLESS_CANCELLED);
  });

  it("given_ci_yml_when_parsed_then_e2e_update_baselines_job_is_workflow_dispatch_and_uploads_baselines", () => {
    expect(Object.keys(ci.on ?? {})).toContain("workflow_dispatch");
    const jb = job("e2e-update-baselines");
    expect(jb.if ?? "").toContain("github.event_name == 'workflow_dispatch'");
    expect(needsOf(jb)).toContain("test");
    expect(imageOf(jb)).toBe(`mcr.microsoft.com/playwright:v${pinnedPlaywright()}-noble`);
    expect(OPTIONS_OF(jb)).toContain("--ipc=host");
    const update = runSteps(jb, "--update-snapshots");
    expect(update).toHaveLength(1);
    expect(update[0].run).toContain("--project=canvas2d");
    const upload = stepsOf(jb).find((s) => isUpload(s, "e2e-baselines"));
    expect(upload).toBeDefined();
    expect(String(upload?.with?.path)).toContain("e2e/__screenshots__");
    expect(upload?.if ?? "").toMatch(RUNS_UNLESS_CANCELLED);
  });
});

describe("W69 CI dist smoke (D69-6)", () => {
  it("given_ci_yml_when_parsed_then_dist_smoke_is_blocking_and_runs_after_the_pkg_download_and_the_dist_build", () => {
    const e2e = job("e2e");
    const down = stepIndex(
      e2e,
      (s) => typeof s.uses === "string" && s.uses.startsWith("actions/download-artifact@") && s.with?.name === "wasm-pkg",
    );
    expect(down, "e2e downloads wasm-pkg").toBeGreaterThanOrEqual(0);
    // Core (clean → tsc → copy-wasm needs pkg/), the React adapter, then the example without its wasm-pack prebuild.
    const build = stepIndex(e2e, (s) => s.run === "npm run e2e:dist:build");
    expect(build, "e2e builds the published dist after the pkg/ download").toBeGreaterThan(down);
    const dist = runSteps(e2e, "--project=dist");
    expect(dist).toHaveLength(1);
    expect(dist[0].run).toBe("npx playwright test --project=dist");
    expect(dist[0]["continue-on-error"] ?? false, "D69-6: the dist smoke is blocking").toBe(false);
    expect(dist[0].env?.E2E_SUITE).toBe("dist");
    expect(stepsOf(e2e).indexOf(dist[0])).toBeGreaterThan(build);
  });
});
