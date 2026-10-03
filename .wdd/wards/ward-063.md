---
ward: 63
revision: null
name: "North star and WDD rules (docs)"
epic: "fluid-engine"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 27
created: "2026-10-03"
completed: null
---
# Ward 063: North star and WDD rules (docs)

North star: none directly — this ward creates `.wdd/NORTH-STAR.md` (scene steps 1–8 and the slice matrix) and the rules that make every later ward name the steps it moves.

## Scope
The project's goal ("WASM/WGPU-driven fluid dynamics on web elements via hidden canvas, preserving a11y", PROJECT.md) was lost once already: Epic 02 never wrote a Goal, and W6/W7 silently built mass-spring soft bodies that 55 wards then grew on. Before any fluid-engine code, W63 makes the goal and the drift guard concrete: the canonical acceptance scene and slice matrix in `.wdd/NORTH-STAR.md`, a `North star:` line and a gated `## Decisions` section in every ward spec, Epic 15 with its Goal, the seven fluid ward files W63–W69 (`planned`, flat) so `wdd ward status` works, the CLAUDE.md rules (including the deviation from `/ward-new`), and the spec amendments found while verifying the plan. A vitest doc-lint test locks all of it, including a mechanical form of the direction gate.

## Inputs
- Spec `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` §0 (north star, decision log D1–D8) and §6 (scene, matrix, WDD rules), already amended by commit `6963d7d` (B2 grid, B14 flags, versioning).
- The slices 1–2 implementation plan in `docs/superpowers/plans/`, with its interface contract and resolutions (slice-2 re-slicing, B1–B15, C1–C8, D1–D6).
- wdd CLI v0.4.0 behaviour: a bare id resolves the flat `ward-NNN.md` first; `wdd ward create` writes `.wdd/wards/<epic>/ward-001.md` and ignores `.wdd/templates/ward.md`; `wdd validate` requires `.wdd/reviews/`.

## Outputs
- `.wdd/NORTH-STAR.md`: experiences, acceptance scene, the 8 steps, slice matrix, slices and wards, WDD rules, whole-picture schedule, decision log.
- `.wdd/templates/ward.md` with `North star:` and `## Decisions`.
- `.wdd/epics/15-fluid-engine.md`; Epic 14 rows 63–68 marked `dropped`; CONTEXT.md pointing at Epic 15.
- `.wdd/wards/ward-063.md` … `ward-069.md`, then a regenerated `.wdd/PROGRESS.md`.
- A link from `.wdd/PROJECT.md`, a link from spec §6, and the spec's remaining amendments.
- `CLAUDE.md`: the north-star and direction-gate rules, the flat-ward deviation note, and a "Fluid engine (in progress, Epic 15)" architecture note.
- `.wdd/reviews/.gitkeep`.
- `packages/core/__tests__/wdd-docs.test.ts` (27 tests). W69 later adds one more.

## Decisions
### D63-1: Fluid ward files are hand-created flat files
Proposal: hand-create `.wdd/wards/ward-063.md` … `ward-069.md` from `.wdd/templates/ward.md`, address them by bare number (`wdd ward status 64 red`), never run `wdd ward create --epic fluid-engine`, and add `.wdd/reviews/.gitkeep` so `wdd validate` passes.
Consequence: deviates from the `/ward-new` skill, and CLAUDE.md records the deviation. The alternative (scoped `fluid-engine-001…007` in a subdirectory) keeps the CLI flow but breaks global W-numbering, and a bare `wdd ward status 1` would then hit legacy W1.
Decision: APPROVED 2026-10-03 — flat hand-created ward files 063–069, addressed by bare number (saga dec_e6607da2)

### D63-2: Epic 15 is hand-created with its Goal
Proposal: `.wdd/epics/15-fluid-engine.md` with `epic: "fluid-engine"` and `number: 15`, its Goal written before any ward goes red. Not `wdd epic create`, which writes `fluid-engine.md` without the `NN-` prefix the other 14 epics use.
Consequence: one more hand-made WDD file. The doc-lint test checks that the Goal is not a placeholder.
Decision: APPROVED 2026-10-03 — Epic 15 hand-created as 15-fluid-engine.md with its Goal (saga dec_855f5b43)

### D63-3: Epic 14's unbuilt wards 63–68 are dropped
Proposal: mark Epic 14 rows 63 (WebGPU shape smoothness), 64 (compositing polish), 65 (Try-it-now + publish 0.2.0-rc.1), 66 (device.lost rebuild), 67 (demo migration) and 68 (site polish) as `dropped`, and reuse 63–69 for the fluid engine.
Consequence: those soft-body and site plans are not built. device.lost returns in fluid slice 3, the site rebuild in slice 6, and publishing becomes `0.3.0-alpha.x` (W66). No ward files existed for them.
Decision: APPROVED 2026-10-03 — Epic 14 unbuilt 63–68 dropped, numbers reused (saga dec_ba0f700a)

### D63-4: Slice 2 is re-sliced vertically
Proposal: W67 "Splash and shake, end to end" (full MPM dynamics, stiffness, re-form and restAlpha, splash and shake in Rust, public `splash()`/`shake()`, click and keyboard splash, Playwright steps 3, 4 and 6). W68 "Pointer, hover and material" (soft pointer field, hover swell, `setMaterial`/`getMaterial`, presets, reduced-motion input gating, Playwright step 2). W69 unchanged.
Consequence: replaces the skeleton's split of W67 as Rust only and W68 as TS only, which violated spec §6 rule 2 because W67 had nothing visible in the scene. The pointer field moves from W67 to W68, and decision ids are renumbered per ward.
Decision: APPROVED 2026-10-03 — slice 2 re-sliced vertically (W67 splash/shake, W68 pointer/hover/material) (saga dec_e3b8a07c)

### D63-5: Spec amendments from plan verification
Proposal: accept commit `6963d7d`, which covers:
- B2: the grid is sized at create to `max(screen, inner)` plus a margin, reallocation is deferred to slice 6, and the grid uses a dirty region.
- B14: `flags` move into the dynamic view (7 floats); the static view holds 3.
- Versioning: hand-set `0.3.0-alpha.0`, `onlyUpdatePeerDependentsWhenOutOfRange`, then `0.3.0-alpha.1`.

Then apply the remaining edits:
- The density-overflow bullet and the §7 risk row no longer promise a switch to coarser cells.
- §6 rule 4 records only the renderers a slice has (slice 2: Canvas2D only).
- §6 links to NORTH-STAR.md.

Consequence: the spec and the plan agree, and W69's canvas2d-only recording is a stated fact rather than a deviation.
Decision: APPROVED 2026-10-03 — accept 6963d7d plus the remaining spec edits (saga dec_c0218e5d)

### D63-6: The direction gate is enforced by a test
Proposal: mark each decision PENDING before the gate. After the gate, write Decision: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when Dennis changed it, plus a row in the NORTH-STAR "Plan decisions" log. `wdd-docs.test.ts` fails if any fluid ward past `planned` still has a PENDING or saga-less line.
Consequence: moving a ward to `red` before its gate turns `npm test` red. The gate itself stays a chat conversation with Dennis; the test only checks that it happened and was logged.
Decision: APPROVED 2026-10-03 — direction gate enforced by wdd-docs.test.ts (saga dec_98e30762)

## Specification
1. NORTH-STAR.md has these sections:
   - `## Experiences`: at least 8 bullets, each starting with a bold label.
   - `## Acceptance scene`, containing `### Page`, `### Scene steps` (a verbatim copy of the spec §6 steps) and `### Slice matrix` (a verbatim copy of the spec table).
   - `## Slices and wards`
   - `## How wards use this file`
   - `## Whole-picture checks`
   - `## Decision log`, containing `### Design decisions (spec §0)` (a verbatim copy of the spec table) and `### Plan decisions (direction gates)` with columns `| # | Decision | Ward | Saga |`.

   The scene steps and the matrix change only together with spec §6, in the same commit. The test fails on drift.
2. Every fluid ward file has:
   - frontmatter keys `ward, revision, name, epic ("fluid-engine"), status, dependencies, layer, estimated_tests, created, completed`, with `dependencies` containing the previous fluid ward;
   - the title `# Ward 0NN: <name>`, followed by a `North star:` line;
   - the sections Scope, Inputs, Outputs, Decisions, Specification, Tests, Must NOT, Must DO, Manual Smoke Test and Verification.

   Each decision item is `### D<NN>-<k>: <name>` with `Proposal:`, `Consequence:` and exactly one `Decision:` line.
3. A ward's Tests table lists the planned test names. The red step reconciles the table with the names actually written, in the same commit as the tests.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_north_star_when_read_then_vision_is_written_as_experiences | quote of PROJECT.md goal, ≥ 8 experience bullets with the key experiences |
| 2 | given_north_star_when_read_then_it_contains_all_8_acceptance_scene_steps_from_spec_section_6 | steps identical to spec §6 |
| 3 | given_north_star_when_read_then_slice_matrix_rows_equal_spec_matrix | matrix identical to spec §6 |
| 4 | given_north_star_when_read_then_scene_page_buttons_seed_and_viewport_are_fixed | page, Splash/Split/Merge, seed, 1280×800 |
| 5 | given_north_star_when_read_then_whole_picture_checks_follow_slices_2_4_6_with_slice_2_canvas2d_only | schedule and artefact path |
| 6 | given_north_star_when_read_then_design_decisions_equal_spec_decision_log | D1–D8 with their Saga ids |
| 7 | given_gated_fluid_ward_when_checked_then_each_decision_is_in_the_north_star_plan_log_with_its_saga_id | gated decisions are logged |
| 8 | given_project_md_when_read_then_it_links_to_north_star | PROJECT.md link |
| 9 | given_fluid_spec_when_read_then_section_6_names_north_star_as_canonical_with_a_working_link | spec link resolves |
| 10 | given_fluid_spec_when_read_then_dynamic_view_has_7_fields_with_flags_and_static_view_has_3 | B14 amendment (6963d7d) |
| 11 | given_fluid_spec_when_read_then_grid_reallocation_is_deferred_to_slice_6_and_area_overflow_only_warns | B2 amendment and residual |
| 12 | given_fluid_spec_when_read_then_versioning_hand_sets_0_3_0_alpha_0_and_targets_0_3_0_alpha_1 | versioning amendment (6963d7d) |
| 13 | given_fluid_spec_when_read_then_whole_picture_check_records_only_renderers_that_exist_in_the_slice | §6 rule 4 amendment |
| 14 | given_ward_template_when_read_then_it_has_a_north_star_line | template |
| 15 | given_ward_template_when_read_then_it_has_a_decision_line | template |
| 16 | given_epic_15_when_read_then_goal_is_written_and_wards_63_to_69_listed | epic |
| 17 | given_epic_14_when_read_then_its_unbuilt_wards_63_to_68_are_marked_dropped | no double-booked numbers |
| 18 | given_fluid_wards_63_to_69_when_read_then_each_is_a_flat_file_with_valid_wdd_frontmatter | wdd-resolvable |
| 19 | given_wards_dir_when_listed_then_no_scoped_fluid_engine_dir_exists | id-collision guard |
| 20 | given_fluid_ward_files_when_read_then_each_has_the_title_and_mandatory_wdd_sections | ward structure |
| 21 | given_fluid_ward_files_when_read_then_each_has_a_north_star_line_naming_scene_steps | North star line |
| 22 | given_fluid_ward_files_when_read_then_every_decision_item_has_exactly_one_decision_line | Decision format |
| 23 | given_fluid_ward_past_planned_when_read_then_every_decision_is_approved_with_a_saga_id | direction gate before red |
| 24 | given_claude_md_when_read_then_wdd_section_requires_north_star_and_decision_lines_before_red | CLAUDE.md WDD rules |
| 25 | given_claude_md_when_read_then_wdd_section_notes_the_flat_ward_file_deviation_from_ward_new | deviation note |
| 26 | given_claude_md_when_read_then_architecture_marks_fluid_engine_in_progress_with_FluidCore_and_strides | architecture note |
| 27 | given_wdd_dir_when_listed_then_reviews_dir_exists_so_wdd_validate_passes | `wdd validate` green |

## Must NOT
- Edit code under `src/`, `packages/*/ts/src/` or `packages/*/src/`, or any existing test.
- Create `.wdd/wards/fluid-engine/`, or run `wdd ward create` / `wdd epic create` for this epic.
- Hand-edit a ward's `status:` after creating it (use `wdd ward status`), or run `wdd complete`.
- Change the scene steps or slice matrix in NORTH-STAR.md without making the same change in spec §6.
- Mark a decision APPROVED without Dennis' answer in chat and a `saga_record_decision` id.

## Must DO
- Gate D63-1 … D63-6 before `wdd ward status 63 red`.
- Keep the ward files consistent with the plan's interface contract as amended by the resolutions (strides 10/4/7/3; the 7-argument `FluidCore` constructor; slice 2 re-sliced).
- Run `wdd progress` and `wdd validate` after creating the ward files.
- Get a code-review pass on the diff before presenting gold.

## Manual Smoke Test
### Setup
`test -d node_modules || npm ci`

### Steps
1. Run: `npx vitest run packages/core/__tests__/wdd-docs.test.ts`
   Expected: `Tests  27 passed (27)`
2. Run: `wdd validate`
   Expected: no `ERROR:` lines. Stale-backlog warnings are acceptable.
3. Run: `wdd graph`
   Verify: wards 63 → 64 → 65 → 66 → 67 → 68 → 69 appear as a chain, and 66 also depends on 62.
4. Run: `wdd ready`
   Verify: 63 is listed (no dependencies), and 64–69 are not.

### Pass criteria
- [ ] All 27 doc-lint tests are green, and `npm run verify` is green.
- [ ] `wdd validate` reports no errors.
- [ ] NORTH-STAR.md reads as experiences, and the scene and matrix are identical to spec §6.

## Verification
`npm run verify` is green, `wdd validate` reports no errors, and Dennis has read NORTH-STAR.md and ward-064 … ward-069 at gold.
