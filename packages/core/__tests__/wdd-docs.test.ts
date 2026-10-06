/**
 * Ward 063: North star and WDD rules — doc-lint for Epic 15 (fluid engine).
 *
 * Keeps the process documents that guard the fluid engine against scope drift
 * honest (spec §6 "WDD with an eye on the whole"):
 *  - `.wdd/NORTH-STAR.md` holds the canonical acceptance scene and slice matrix,
 *    and both stay identical to spec §6 — drift fails here.
 *  - Every fluid ward (W63–W69) is a flat `.wdd/wards/ward-0NN.md` that the wdd
 *    CLI resolves by bare number, with a `North star:` line and a gated
 *    `## Decisions` section.
 *  - A ward past `planned` must have every decision APPROVED/AMENDED with a Saga
 *    id that is also logged in NORTH-STAR.md: the direction gate (spec §6 rule 3).
 *
 * Pure file reads: no build, no WASM. Runs in the core vitest project; Node fs
 * works under jsdom.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From packages/core/__tests__/, three levels up is the workspace root.
const ROOT = resolve(__dirname, "../../..");
const WDD = resolve(ROOT, ".wdd");
const NORTH_STAR = resolve(WDD, "NORTH-STAR.md");
const PROJECT_MD = resolve(WDD, "PROJECT.md");
const WARD_TEMPLATE = resolve(WDD, "templates/ward.md");
const EPIC_15 = resolve(WDD, "epics/15-fluid-engine.md");
const EPIC_14 = resolve(WDD, "epics/14-public-site.md");
const CLAUDE_MD = resolve(ROOT, "CLAUDE.md");
const SPEC = resolve(ROOT, "docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md");

/**
 * Slice 1-2 fluid wards. Used ONLY to assert discovery finds at least these, so a
 * broken discovery cannot make the direction gate vacuous. Do not iterate over it.
 */
const EXPECTED_SLICE_1_2_WARDS = [63, 64, 65, 66, 67, 68, 69] as const;
/** Every `epic: "fluid-engine"` ward under .wdd/wards (flat files), so the gate follows new slices. */
const FLUID_WARDS = discoverFluidWards(resolve(WDD, "wards"));
const DROPPED_EPIC_14_WARDS = [63, 64, 65, 66, 67, 68] as const;
const WDD_STATUSES = ["planned", "red", "approved", "gold", "complete", "blocked"];
/** Statuses in which a ward's direction gate may still be open. */
const UNGATED_STATUSES = ["planned", "blocked"];
/** Same keys `wdd validate` requires (wdd/src/commands/validate.ts). */
const REQUIRED_FRONTMATTER_KEYS = ["ward", "name", "status", "epic", "layer", "dependencies"];
const REQUIRED_WARD_SECTIONS = [
  "## Scope",
  "## Inputs",
  "## Outputs",
  "## Decisions",
  "## Specification",
  "## Tests",
  "## Must NOT",
  "## Must DO",
  "## Manual Smoke Test",
  "## Verification",
];
const SAGA_ID = /dec_[0-9a-f]{8,}/;
const APPROVED_DECISION = /^Decision: (APPROVED|AMENDED) \d{4}-\d{2}-\d{2}\b.*\(saga dec_[0-9a-f]{8,}\)\s*$/;
const PENDING_DECISION = /^Decision: PENDING\s*$/;

function read(path: string): string {
  if (!existsSync(path)) throw new Error(`expected file to exist: ${path}`);
  return readFileSync(path, "utf-8");
}

function wardPath(n: number): string {
  return resolve(WDD, "wards", `ward-${String(n).padStart(3, "0")}.md`);
}

/**
 * Lines of a markdown section: everything after the exact `heading` line up to
 * the next heading of the same or a higher level. Fenced code is skipped over.
 */
function section(md: string, heading: string): string[] {
  const level = /^(#+)\s/.exec(heading)?.[1].length;
  if (level === undefined) throw new Error(`not a markdown heading: ${heading}`);
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === heading);
  if (start === -1) return [];
  const out: string[] = [];
  let inFence = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) inFence = !inFence;
    const m = /^(#+)\s/.exec(line);
    if (!inFence && m && m[1].length <= level) break;
    out.push(line);
  }
  return out;
}

/** Ordered-list items (`1. …`) in their original text. */
function numberedItems(lines: string[]): string[] {
  return lines.filter((l) => /^\d+\. \S/.test(l)).map((l) => l.trimEnd());
}

/** Table rows normalised to `|cell|cell|` (cells trimmed), separator rows included. */
function tableRows(lines: string[]): string[] {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) => l.split("|").map((cell) => cell.trim()).join("|"));
}

function parseScalar(raw: string): unknown {
  if (raw === "" || raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => parseScalar(item.trim()));
  }
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

/** Mirrors the wdd CLI's minimal frontmatter parser (wdd/src/frontmatter.ts). */
function frontmatter(md: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md);
  if (!m) return {};
  const out: Record<string, unknown> = {};
  for (const rawLine of m[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    out[line.slice(0, colon).trim()] = parseScalar(line.slice(colon + 1).trim());
  }
  return out;
}

interface DecisionBlock {
  id: string;
  decisionLines: string[];
}

/** `### D<NN+>-<k>: …` items of `## Decisions` and the `Decision:` lines inside each. */
function decisionBlocks(md: string): DecisionBlock[] {
  const blocks: DecisionBlock[] = [];
  let current: DecisionBlock | undefined;
  for (const line of section(md, "## Decisions")) {
    const head = /^### (D\d{2,}-\d+)\b/.exec(line);
    if (head) {
      current = { id: head[1], decisionLines: [] };
      blocks.push(current);
      continue;
    }
    if (current && line.startsWith("Decision:")) current.decisionLines.push(line.trim());
  }
  return blocks;
}

function isGated(md: string): boolean {
  return !UNGATED_STATUSES.includes(String(frontmatter(md).status));
}

/**
 * Ward numbers of every flat `ward-NNN.md` in `wardsDir` whose frontmatter says
 * `epic: "fluid-engine"`, ascending. Scoped subdirectories are not scanned.
 */
function discoverFluidWards(wardsDir: string): number[] {
  return readdirSync(wardsDir)
    .map((name) => /^ward-(\d{3})\.md$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => frontmatter(read(resolve(wardsDir, m[0]))).epic === "fluid-engine")
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * Direction gate (spec §6 rule 3), pure: a ward past `planned` must have every
 * decision APPROVED/AMENDED with a saga id. Returns one message per violation.
 */
function gateViolations(wardText: string, wardNo: number): string[] {
  if (!isGated(wardText)) return [];
  const status = String(frontmatter(wardText).status);
  return decisionBlocks(wardText)
    .filter((block) => !APPROVED_DECISION.test(block.decisionLines[0] ?? ""))
    .map((block) => `ward ${wardNo} is ${status} but ${block.id} has not passed the direction gate`);
}

describe("W63 north star (.wdd/NORTH-STAR.md)", () => {
  it("given_north_star_when_read_then_vision_is_written_as_experiences", () => {
    const ns = read(NORTH_STAR);
    expect(ns).toContain(
      "WASM/WGPU-driven **fluid dynamics** on web elements via hidden canvas, preserving a11y",
    );
    const experiences = section(ns, "## Experiences");
    const bullets = experiences.filter((l) => /^- \*\*[^*]+\*\*/.test(l));
    expect(bullets.length).toBeGreaterThanOrEqual(8);
    const text = experiences.join("\n").toLowerCase();
    for (const word of ["splash", "merge", "re-form", "text", "focus", "reduced motion", "pointer"]) {
      expect(text, `experiences mention "${word}"`).toContain(word);
    }
  });

  it("given_north_star_when_read_then_it_contains_all_8_acceptance_scene_steps_from_spec_section_6", () => {
    const specSteps = numberedItems(section(read(SPEC), "### The acceptance scene"));
    expect(specSteps).toHaveLength(8);
    const northStarSteps = numberedItems(section(read(NORTH_STAR), "### Scene steps"));
    expect(northStarSteps).toEqual(specSteps);
  });

  it("given_north_star_when_read_then_slice_matrix_rows_equal_spec_matrix", () => {
    const specRows = tableRows(section(read(SPEC), "### The acceptance scene"));
    expect(specRows).toHaveLength(10); // header + separator + 8 steps
    expect(tableRows(section(read(NORTH_STAR), "### Slice matrix"))).toEqual(specRows);
  });

  it("given_north_star_when_read_then_scene_page_buttons_seed_and_viewport_are_fixed", () => {
    const page = section(read(NORTH_STAR), "### Page").join("\n");
    for (const s of ["demo/scenes/acceptance.html", '"Splash"', '"Split"', '"Merge"', "1280×800", "seed"]) {
      expect(page).toContain(s);
    }
  });

  it("given_north_star_when_read_then_whole_picture_checks_follow_slices_2_4_6_with_slice_2_canvas2d_only", () => {
    const checks = section(read(NORTH_STAR), "## Whole-picture checks").join("\n").toLowerCase();
    for (const s of ["slice 2", "slice 4", "slice 6", "canvas2d only", ".wdd/memory/whole-picture/"]) {
      expect(checks).toContain(s);
    }
  });

  it("given_north_star_when_read_then_design_decisions_equal_spec_decision_log", () => {
    const specLog = tableRows(section(read(SPEC), "### Decision log"));
    expect(specLog).toHaveLength(10); // header + separator + D1..D8
    expect(tableRows(section(read(NORTH_STAR), "### Design decisions (spec §0)"))).toEqual(specLog);
  });

  it("given_gated_fluid_ward_when_checked_then_each_decision_is_in_the_north_star_plan_log_with_its_saga_id", () => {
    const log = tableRows(section(read(NORTH_STAR), "### Plan decisions (direction gates)"));
    expect(log.length).toBeGreaterThanOrEqual(2); // header + separator at least
    for (const n of FLUID_WARDS) {
      const md = read(wardPath(n));
      if (!isGated(md)) continue;
      for (const block of decisionBlocks(md)) {
        const saga = SAGA_ID.exec(block.decisionLines[0] ?? "")?.[0];
        expect(saga, `${block.id}: Decision line carries no saga id`).toBeDefined();
        const row = log.find((r) => r.startsWith(`|${block.id}|`));
        expect(row, `${block.id}: missing from the NORTH-STAR plan decision log`).toBeDefined();
        expect(row).toContain(saga);
      }
    }
  });
});

describe("W63 links to the north star", () => {
  it("given_project_md_when_read_then_it_links_to_north_star", () => {
    expect(read(PROJECT_MD)).toMatch(/\]\(NORTH-STAR\.md\)/);
  });

  it("given_fluid_spec_when_read_then_section_6_names_north_star_as_canonical_with_a_working_link", () => {
    const scene = section(read(SPEC), "### The acceptance scene").join("\n");
    expect(scene).toContain("[`.wdd/NORTH-STAR.md`](../../../.wdd/NORTH-STAR.md) is **canonical**");
    expect(existsSync(resolve(dirname(SPEC), "../../../.wdd/NORTH-STAR.md"))).toBe(true);
  });
});

describe("W63 spec amendments (B2, B14, versioning, whole picture)", () => {
  it("given_fluid_spec_when_read_then_dynamic_view_has_7_fields_with_flags_and_static_view_has_3", () => {
    const ffi = section(read(SPEC), "### FFI contract").join("\n");
    expect(ffi).toContain("SoA `x, y, f00, f01, f10, f11, flags` (7 floats per particle)");
    expect(ffi).toContain("particleCapacity·7·4");
    expect(ffi).toContain("SoA `home, rest_u, rest_v`. TS reads it only when");
    expect(ffi).not.toContain("n_active·24");
  });

  it("given_fluid_spec_when_read_then_grid_reallocation_is_deferred_to_slice_6_and_area_overflow_only_warns", () => {
    const spec = read(SPEC);
    expect(spec).toContain("max(screen.width, innerWidth) × max(screen.height, innerHeight)");
    expect(spec).toContain("A resize beyond that is clamped to the walls in slices 1–5");
    expect(spec).toContain("there is no reallocation before slice 6");
    expect(spec).not.toContain("the coarser cell size (8 px) is used");
    expect(spec).not.toContain("Warning plus coarser cells");
  });

  it("given_fluid_spec_when_read_then_versioning_hand_sets_0_3_0_alpha_0_and_targets_0_3_0_alpha_1", () => {
    const retirement = section(read(SPEC), "## 1. What the retirement means").join("\n");
    expect(retirement).toContain("hand-set to `0.3.0-alpha.0`");
    expect(retirement).toContain("`^0.3.0-alpha.0`");
    expect(retirement).toContain("onlyUpdatePeerDependentsWhenOutOfRange: true");
    expect(retirement).toContain("giving `0.3.0-alpha.1`");
  });

  it("given_fluid_spec_when_read_then_whole_picture_check_records_only_renderers_that_exist_in_the_slice", () => {
    const rules = section(read(SPEC), "### WDD with an eye on the whole").join("\n");
    expect(rules).toContain("in every renderer that exists at that slice");
    expect(rules).toContain("after slice 2 that is Canvas2D only");
    expect(rules).not.toContain("in both renderers");
  });
});

describe("W63 ward template (.wdd/templates/ward.md)", () => {
  it("given_ward_template_when_read_then_it_has_a_north_star_line", () => {
    const lines = read(WARD_TEMPLATE).split("\n");
    expect(lines.some((l) => l.startsWith("North star: "))).toBe(true);
  });

  it("given_ward_template_when_read_then_it_has_a_decision_line", () => {
    const decisions = section(read(WARD_TEMPLATE), "## Decisions");
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((l) => PENDING_DECISION.test(l))).toBe(true);
    expect(decisions.join("\n")).toContain("saga_record_decision");
  });
});

describe("W63 epics", () => {
  it("given_epic_15_when_read_then_goal_is_written_and_wards_63_to_69_listed", () => {
    const md = read(EPIC_15);
    const fm = frontmatter(md);
    expect(fm.epic).toBe("fluid-engine");
    expect(fm.number).toBe(15);
    const goal = section(md, "## Goal").join("\n").trim();
    expect(goal.length).toBeGreaterThan(300);
    expect(goal).not.toMatch(/\{[^}]*\}/); // no template placeholder (the Epic 02 lesson)
    expect(goal).toContain("fluid dynamics");
    expect(goal).toContain("NORTH-STAR.md");
    const rows = tableRows(section(md, "## Wards"));
    for (const n of FLUID_WARDS) {
      expect(rows.some((r) => r.startsWith(`|${n}|`)), `epic 15 lists ward ${n}`).toBe(true);
    }
  });

  it("given_epic_14_when_read_then_its_unbuilt_wards_63_to_68_are_marked_dropped", () => {
    const rows = tableRows(read(EPIC_14).split("\n")).map((r) => r.replace(/\*/g, ""));
    for (const n of DROPPED_EPIC_14_WARDS) {
      const row = rows.find((r) => r.startsWith(`|${n}|`));
      expect(row, `epic 14 row ${n}`).toBeDefined();
      expect(row).toMatch(/\|dropped\|$/);
    }
  });
});

describe("W63 fluid ward files (.wdd/wards/ward-063…069.md)", () => {
  it("given_fluid_wards_63_to_69_when_read_then_each_is_a_flat_file_with_valid_wdd_frontmatter", () => {
    for (const n of FLUID_WARDS) {
      const fm = frontmatter(read(wardPath(n)));
      for (const key of REQUIRED_FRONTMATTER_KEYS) {
        expect(fm, `ward ${n} frontmatter key ${key}`).toHaveProperty(key);
      }
      expect(fm.ward).toBe(n);
      expect(fm.epic).toBe("fluid-engine");
      expect(WDD_STATUSES).toContain(fm.status);
      expect(typeof fm.layer).toBe("string");
      expect(Array.isArray(fm.dependencies)).toBe(true);
      if (n > 63) expect(fm.dependencies, `ward ${n} depends on ward ${n - 1}`).toContain(n - 1);
    }
  });

  it("given_wards_dir_when_listed_then_no_scoped_fluid_engine_dir_exists", () => {
    expect(existsSync(resolve(WDD, "wards/fluid-engine"))).toBe(false);
  });

  it("given_fluid_ward_files_when_read_then_each_has_the_title_and_mandatory_wdd_sections", () => {
    for (const n of FLUID_WARDS) {
      const lines = read(wardPath(n)).split("\n").map((l) => l.trimEnd());
      expect(
        lines.some((l) => l.startsWith(`# Ward ${String(n).padStart(3, "0")}: `)),
        `ward ${n} title`,
      ).toBe(true);
      for (const heading of REQUIRED_WARD_SECTIONS) {
        expect(lines, `ward ${n} has ${heading}`).toContain(heading);
      }
    }
  });

  it("given_fluid_ward_files_when_read_then_each_has_a_north_star_line_naming_scene_steps", () => {
    for (const n of FLUID_WARDS) {
      const line = read(wardPath(n)).split("\n").find((l) => l.startsWith("North star: "));
      expect(line, `ward ${n} North star line`).toBeDefined();
      expect(line).toMatch(/\b(step|steps|none)\b/i);
    }
  });

  it("given_fluid_ward_files_when_read_then_every_decision_item_has_exactly_one_decision_line", () => {
    for (const n of FLUID_WARDS) {
      const blocks = decisionBlocks(read(wardPath(n)));
      expect(blocks.length, `ward ${n} has decision items`).toBeGreaterThan(0);
      const ids = blocks.map((b) => b.id);
      expect(new Set(ids).size, `ward ${n} decision ids unique`).toBe(ids.length);
      for (const block of blocks) {
        expect(block.id.startsWith(`D${n}-`), `${block.id} belongs to ward ${n}`).toBe(true);
        expect(block.decisionLines, `${block.id} has one Decision line`).toHaveLength(1);
        const line = block.decisionLines[0] ?? "";
        expect(
          PENDING_DECISION.test(line) || APPROVED_DECISION.test(line),
          `${block.id}: malformed "${line}"`,
        ).toBe(true);
      }
    }
  });

  it("given_fluid_ward_past_planned_when_read_then_every_decision_is_approved_with_a_saga_id", () => {
    for (const n of FLUID_WARDS) {
      expect(gateViolations(read(wardPath(n)), n), `ward ${n} direction gate`).toEqual([]);
    }
  });
});

describe("W63 CLAUDE.md", () => {
  it("given_claude_md_when_read_then_wdd_section_requires_north_star_and_decision_lines_before_red", () => {
    const wdd = section(read(CLAUDE_MD), "## WDD (Ward-Driven Development) workflow").join("\n");
    for (const s of [
      ".wdd/NORTH-STAR.md",
      "North star:",
      "Decision:",
      "saga_record_decision",
      "cannot move to `red`",
      "Vertical slices",
      "Whole-picture check",
    ]) {
      expect(wdd).toContain(s);
    }
  });

  it("given_claude_md_when_read_then_wdd_section_notes_the_flat_ward_file_deviation_from_ward_new", () => {
    const wdd = section(read(CLAUDE_MD), "## WDD (Ward-Driven Development) workflow").join("\n");
    for (const s of ["ward-063.md", "wdd ward create", "deviates from the `/ward-new` skill", ".wdd/wards/fluid-engine/"]) {
      expect(wdd).toContain(s);
    }
  });

  it("given_claude_md_when_read_then_architecture_marks_fluid_engine_in_progress_with_FluidCore_and_strides", () => {
    // W63 test 26, updated by W66 in the same commit as the CLAUDE.md rewrite (W63.7):
    // the fluid-engine summary stays; every soft-body section is gone.
    const md = read(CLAUDE_MD);
    const architecture = md.indexOf("## Architecture (high-level)");
    const fluid = md.indexOf("### Fluid engine (in progress, Epic 15)");
    const constraints = md.indexOf("## Project-specific constraints");
    expect(architecture).toBeGreaterThan(-1);
    expect(fluid).toBeGreaterThan(architecture);
    expect(fluid).toBeLessThan(constraints);
    const note = section(md, "### Fluid engine (in progress, Epic 15)").join("\n");
    for (const s of [
      "FluidCore",
      "FluidBridge",
      "ELEMENT_STRIDE = 10",
      "STATE_STRIDE = 4",
      "DYNAMIC_FIELDS = 7",
      "STATIC_FIELDS = 3",
      "retired as of W66",
      "softbody-final",
      ".wdd/NORTH-STAR.md",
    ]) {
      expect(note, s).toContain(s);
    }
    for (const gone of ["### The Rule of Two", "PhantomObserver", "FLOATS_PER_ENTITY", "## Public site", "liquid_type` dispatch", "WasmBridge`"]) {
      expect(md, gone).not.toContain(gone);
    }
  });
});

describe("W63 wdd validate prerequisites", () => {
  it("given_wdd_dir_when_listed_then_reviews_dir_exists_so_wdd_validate_passes", () => {
    expect(existsSync(resolve(WDD, "reviews/.gitkeep"))).toBe(true);
  });
});

describe("W63 direction gate discovery", () => {
  it("given_wards_dir_when_scanned_then_fluid_engine_wards_include_63_to_69", () => {
    const found = discoverFluidWards(resolve(WDD, "wards"));
    for (const n of EXPECTED_SLICE_1_2_WARDS) {
      expect(found, `discovery finds ward ${n}`).toContain(n);
    }
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });

  it("given_hypothetical_ward_070_past_planned_with_pending_decision_when_gated_then_violation_reported", () => {
    const fixture = [
      "---",
      "ward: 70",
      'name: "Fixture"',
      'epic: "fluid-engine"',
      'status: "red"',
      "---",
      "# Ward 070: Fixture",
      "",
      "## Decisions",
      "",
      "### D70-1: X",
      "Decision: PENDING",
      "",
      "## Specification",
      "",
    ].join("\n");
    const violations = gateViolations(fixture, 70);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("D70-1");
  });

  it("given_hypothetical_ward_100_with_approved_decision_when_gated_then_no_violation", () => {
    const fixture = [
      "---",
      "ward: 100",
      'name: "Fixture"',
      'epic: "fluid-engine"',
      'status: "red"',
      "---",
      "# Ward 100: Fixture",
      "",
      "## Decisions",
      "",
      "### D100-1: X",
      "Decision: APPROVED 2026-10-03 — x (saga dec_0123abcd)",
      "",
      "## Specification",
      "",
    ].join("\n");
    expect(gateViolations(fixture, 100)).toEqual([]);
  });
});

describe("W69: whole-picture check after slice 2", () => {
  it("given_whole_picture_slice_2_when_read_then_it_has_status_per_scene_step_against_north_star_and_links_the_gif", async () => {
    const reportPath = resolve(ROOT, ".wdd/memory/whole-picture/slice-2.md");
    expect(existsSync(reportPath), "missing .wdd/memory/whole-picture/slice-2.md").toBe(true);
    const report = readFileSync(reportPath, "utf8");
    const lines = report.split("\n");
    // Variable specifier: a literal path would fail vite import analysis for the whole file while e2e/north-star.ts is missing.
    const northStarModule = "../../../e2e/north-star";
    const { reformBudgetMs } = (await import(/* @vite-ignore */ northStarModule)) as typeof import("../../../e2e/north-star");

    // | Step | Scene step | Expected S2 | Observed | Evidence |
    // Rows are searched only inside "## Scene steps" (other sections may hold numbered tables).
    const stepsStart = lines.findIndex((l) => l.trim() === "## Scene steps");
    expect(stepsStart, "missing ## Scene steps").toBeGreaterThanOrEqual(0);
    const stepsEnd = lines.findIndex((l, i) => i > stepsStart && /^## /.test(l));
    const stepLines = lines.slice(stepsStart + 1, stepsEnd === -1 ? lines.length : stepsEnd);
    function rowCells(step: string): string[] {
      const row = stepLines.find((l) => new RegExp(`^\\|\\s*${step}\\s*\\|`).test(l));
      expect(row, `no table row for scene step ${step}`).toBeDefined();
      return (row ?? "").split("|").slice(1, -1).map((c) => c.trim());
    }

    // The S2 column of the slice matrix, verbatim from spec §6 (= NORTH-STAR.md, W63 asserts equality).
    const expectedS2: Record<string, string> = {
      "1": "✅ C",
      "2": "✅ C",
      "3": "✅ C (no text)",
      "4": "✅",
      "5": "⏳",
      "6": "✅",
      "7": "⏳",
      "8": "✅",
    };
    for (const [step, expected] of Object.entries(expectedS2)) {
      const cells = rowCells(step);
      expect(cells, `step ${step} row must have 5 cells`).toHaveLength(5);
      expect(cells[2], `step ${step} expected-S2 cell`).toBe(expected);
      const observed = cells[3] ?? "";
      expect(["✅", "❌", "⏳"], `step ${step} observed status token`).toContain(observed.split(" ")[0]);
      if (expected.startsWith("✅")) {
        expect(observed.startsWith("⏳"), `step ${step} is expected in S2: observe ✅ or ❌, never ⏳`).toBe(false);
      }
      expect((cells[4] ?? "").length, `step ${step} needs evidence`).toBeGreaterThan(0);
      if (expected.startsWith("✅")) {
        // Concrete evidence: a screenshot name, a frame reference or a measured time, never prose alone.
        expect(cells[4], `step ${step} evidence must be concrete (s2-stepN shot, frame, or a time)`).toMatch(
          /s2-step\d|frame|\d+(\.\d+)?\s*(ms|s)\b/,
        );
      }
    }
    // Steps 3, 4 and 6 are re-form steps: the evidence carries the measured re-form time in ms.
    for (const step of ["3", "4", "6"]) {
      expect(rowCells(step)[4], `step ${step} evidence needs a measured re-form time in ms`).toMatch(/\b\d{2,5}\s*ms\b/);
    }

    // Steps 3 and 6 quote the re-form budget NORTH-STAR holds after D67-1 (never a stale 1.5 s).
    const northStar = read(NORTH_STAR);
    for (const step of [3, 6]) {
      const seconds = String(reformBudgetMs(northStar, step) / 1000);
      expect(rowCells(String(step))[1], `step ${step} scene-step cell quotes the NORTH-STAR budget`).toContain(
        `within ${seconds} s`,
      );
    }

    expect(report).toContain("NORTH-STAR.md");
    expect(report).toContain("docs/superpowers/whole-picture/slice-2-canvas2d.gif");
    expect(report).toMatch(/canvas2d only/i);
    for (const heading of ["## Renderers", "## Scene steps", "## Carried", "## Perf", "## Drift check", "## Open points for slice 3"]) {
      expect(report, `missing heading ${heading}`).toContain(heading);
    }

    // D69-5: one row per carried item, | Item | Evidence | Recommendation |, inside ## Carried.
    const carriedStart = lines.findIndex((l) => l.trim() === "## Carried");
    const carriedEnd = lines.findIndex((l, i) => i > carriedStart && /^## /.test(l));
    const carried = lines.slice(carriedStart + 1, carriedEnd === -1 ? lines.length : carriedEnd);
    const CARRIED_ITEMS = [
      "DOM text contrast while the liquid is away",
      "Furry in-motion edges (density renderer)",
      "Shake reads as sliding blobs",
      "Pointer-bulge strength (drag 6.0)",
      "Material preset tuning",
      "Ring density when the area hint is off",
    ];
    // Exactly the six D69-5 data rows (header and separator excluded).
    const carriedData = carried.filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l) && !/^\|\s*Item\s*\|/.test(l));
    expect(carriedData, "## Carried must hold exactly 6 data rows").toHaveLength(6);
    for (const item of CARRIED_ITEMS) {
      const rows = carried.filter((l) => l.startsWith(`| ${item} |`));
      expect(rows, `## Carried needs exactly one row for "${item}"`).toHaveLength(1);
      const cells = (rows[0] ?? "").split("|").slice(1, -1).map((c) => c.trim());
      expect(cells, `"${item}" row must have 3 cells`).toHaveLength(3);
      expect((cells[1] ?? "").length, `"${item}" needs evidence`).toBeGreaterThan(0);
      expect(cells[1], `"${item}" evidence must reference a frame, a value or a probe`).toMatch(/\d|frame|playground|probe/i);
      expect((cells[2] ?? "").length, `"${item}" needs a recommendation`).toBeGreaterThan(0);
    }
    expect(report, "unfilled «…» tokens left in the report").not.toContain("«");

    // ## Perf must carry at least one measured number with a unit.
    const perfStart = lines.findIndex((l) => l.trim() === "## Perf");
    const perfEnd = lines.findIndex((l, i) => i > perfStart && /^## /.test(l));
    const perf = lines.slice(perfStart + 1, perfEnd === -1 ? lines.length : perfEnd).join("\n");
    expect(perf, "## Perf needs at least one number in ms").toMatch(/\d+(\.\d+)?\s*ms\b/);

    const gifPath = resolve(ROOT, "docs/superpowers/whole-picture/slice-2-canvas2d.gif");
    expect(existsSync(gifPath), "missing GIF").toBe(true);
    const gif = readFileSync(gifPath);
    expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(gif.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});
