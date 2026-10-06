/**
 * @vitest-environment node
 *
 * Ward 069: whole-picture tooling. The webm→GIF converter is pure apart from
 * its CLI entry; the record project must never run in CI (D69-2); re-form
 * budgets come from the canonical scene (NORTH-STAR.md), never from constants.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFfmpegArgs,
  parseArgs,
  resolveInput,
  DEFAULT_WIDTH,
  DEFAULT_FPS,
  MAX_GIF_BYTES,
} from "../../../scripts/webm-to-gif.mjs";
import { reformBudgetMs } from "../../../e2e/north-star";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("W69: scripts/webm-to-gif.mjs", () => {
  it("given_input_and_output_when_building_ffmpeg_args_then_single_pass_palette_filter_with_width_fps_and_infinite_loop", () => {
    const args = buildFfmpegArgs({ input: "in.webm", output: "out.gif", width: 640, fps: 12 });
    expect(args.slice(0, 6)).toEqual(["-hide_banner", "-loglevel", "error", "-y", "-i", "in.webm"]);
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toBe(
      "fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    );
    expect(args.slice(-3)).toEqual(["-loop", "0", "out.gif"]);
  });

  it("given_manifest_json_when_resolving_input_then_video_path_is_read_from_manifest", () => {
    const read = vi.fn((p: string) => {
      expect(p).toBe("test-results/whole-picture/manifest.json");
      return JSON.stringify({ video: "/abs/test-results/x/video.webm" });
    });
    expect(resolveInput("test-results/whole-picture/manifest.json", read)).toBe("/abs/test-results/x/video.webm");
    expect(read).toHaveBeenCalledTimes(1);

    const untouched = vi.fn();
    expect(resolveInput("clip.webm", untouched)).toBe("clip.webm");
    expect(untouched).not.toHaveBeenCalled();

    expect(() => resolveInput("m.json", () => JSON.stringify({ video: "" }))).toThrow(/no "video" path/);
    expect(() => resolveInput("m.json", () => JSON.stringify({}))).toThrow(/no "video" path/);
  });

  it("given_cli_args_when_parsed_then_defaults_640px_12fps_and_bad_flags_throw", () => {
    expect(DEFAULT_WIDTH).toBe(640);
    expect(DEFAULT_FPS).toBe(12);
    expect(MAX_GIF_BYTES).toBe(10 * 1024 * 1024);
    expect(parseArgs(["a.webm", "b.gif"])).toEqual({ input: "a.webm", output: "b.gif", width: 640, fps: 12 });
    expect(parseArgs(["a.webm", "b.gif", "--fps", "8", "--width", "480"])).toEqual({
      input: "a.webm",
      output: "b.gif",
      width: 480,
      fps: 8,
    });
    expect(() => parseArgs(["a.webm"])).toThrow(/usage/);
    expect(() => parseArgs(["a.webm", "b.gif", "c.gif"])).toThrow(/usage/);
    expect(() => parseArgs(["a.webm", "b.gif", "--fps", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["a.webm", "b.gif", "--width"])).toThrow(/positive integer/);
    expect(() => parseArgs(["a.webm", "b.gif", "--width", "6.5"])).toThrow(/positive integer/);
  });

  it("given_ci_workflow_when_read_then_record_project_is_never_run_in_ci", () => {
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toMatch(/--project[= ]record\b/);
    expect(ci).not.toMatch(/record\.spec/);
    expect(ci).not.toMatch(/whole-picture/);
    // A bare `playwright test` would run every project, record included.
    const runs = ci.split("\n").filter((l) => /playwright test/.test(l));
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) {
      expect(line.trim(), "every CI Playwright invocation names a non-record project").toMatch(
        /--project[= ](canvas2d|webgpu|perf|dist)\b/,
      );
    }
  });

  it("given_root_package_when_read_then_whole_picture_script_records_in_the_record_project_then_converts_to_gif", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["whole-picture"]).toBe(
      "playwright test e2e/record.spec.ts --project=record && node scripts/webm-to-gif.mjs test-results/whole-picture/manifest.json docs/superpowers/whole-picture/slice-2-canvas2d.gif",
    );
  });
});

describe("W69: e2e/north-star.ts (re-form budgets from the canonical scene)", () => {
  it("given_a_scene_step_line_when_parsed_then_the_first_bold_seconds_value_is_the_budget_and_missing_budgets_throw", () => {
    const md = [
      "# North star",
      "### Scene steps",
      "1. Idle for 2 s: crisp edges.",
      "3. Click \"Splash\": jets and fingers. **[WebGPU]** the text tears with the liquid. Re-form within **3 s** (`restAlpha = 1`; amended in W67, D67-1).",
      "6. Shake: everything sloshes and re-forms within **3 s**.",
      "### Slice matrix",
      "3. not a scene step",
    ].join("\n");
    expect(reformBudgetMs(md, 3)).toBe(3_000);
    expect(reformBudgetMs(md, 6)).toBe(3_000);
    expect(reformBudgetMs(md.replace("**3 s**", "**1.5 s**"), 3)).toBe(1_500);
    const wrapped = ["### Scene steps", "3. Click \"Splash\": jets and fingers.", "   Re-form within **2 s** (wrapped line).", "4. Next step."].join("\n");
    expect(reformBudgetMs(wrapped, 3)).toBe(2_000);
    expect(() => reformBudgetMs(wrapped, 4)).toThrow(/no re-form budget/);
    expect(() => reformBudgetMs(md, 1)).toThrow(/no re-form budget/);
    expect(() => reformBudgetMs(md, 7)).toThrow(/scene step 7 not found/);
    expect(() => reformBudgetMs("# nothing here", 3)).toThrow(/no scene steps list/);
  });

  it("given_north_star_scene_steps_when_parsed_then_reform_budgets_follow_the_d67_1_outcome", () => {
    const northStar = readFileSync(resolve(ROOT, ".wdd/NORTH-STAR.md"), "utf8");
    const spec = readFileSync(resolve(ROOT, "docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md"), "utf8");
    const splash = reformBudgetMs(northStar, 3);
    // D67-1 is settled as option 1 (saga dec_fe306ff0): the splash re-form budget is 3 s.
    expect(splash, "NORTH-STAR step 3 budget (D67-1 option 1)").toBe(3_000);
    expect(reformBudgetMs(spec, 3), "spec §6 step 3 agrees with NORTH-STAR").toBe(splash);
    expect(reformBudgetMs(northStar, 6)).toBe(3_000);
    expect(reformBudgetMs(spec, 6)).toBe(3_000);
  });
});

describe("W70: e2e/record.spec.ts records step 8 (D70-6)", () => {
  it("given_the_record_spec_when_read_then_a_reduced_motion_segment_on_rm_1_clicks_and_shakes_after_step_6_and_reports_step_8", () => {
    const spec = readFileSync(resolve(ROOT, "e2e/record.spec.ts"), "utf8");
    expect(spec).toContain("const RM_SCENE_URL = `${SCENE_URL}&rm=1`;");
    expect(spec).toContain('test("whole picture – slice 2 – acceptance steps 1-4, 6 and 8 recorded in canvas2d"');
    const s6 = spec.indexOf("// Step 6");
    const s8 = spec.indexOf("// Step 8");
    const close = spec.indexOf("await page.close();");
    expect(s6, "the step-6 segment").toBeGreaterThan(0);
    expect(s8, "the step-8 segment follows step 6").toBeGreaterThan(s6);
    expect(close, "and is recorded before the page closes").toBeGreaterThan(s8);
    const seg = spec.slice(s8, close);
    expect(seg).toContain("page.goto(RM_SCENE_URL)");
    expect(seg).toMatch(/\.click\(\)/);
    expect(seg).toMatch(/\.shake\(\)/);
    expect(seg).toContain('"step8-rm-idle"');
    expect(seg).toContain('"step8-rm-after-click-and-shake"');
    expect(seg).toMatch(/step: 8,/);
    expect(seg, "no motion is asserted, not only reported").toMatch(/expect\(moved8/);
  });
});
