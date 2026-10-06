---
ward: 69
revision: null
name: "Playground, splash scene, whole-picture check"
epic: "fluid-engine"
status: "complete"
dependencies: [68]
layer: "typescript"
estimated_tests: 26
created: "2026-10-03"
completed: "2026-10-06"
---
# Ward 069: Playground, splash scene, whole-picture check

North star: the whole picture after slice 2. Steps 1–4, 6 and 8 are recorded in canvas2d and given a status against the slice matrix, and slice 3 is planned only afterwards.

## Scope
- Port the Tweakpane playground (the W49 mechanism) to material parameters.
- Recreate a fluid splash scene.
- Run the first whole-picture check:
  - a recording of the acceptance scene, made with the RAF clock in canvas2d only (no WebGPU fluid renderer exists before slice 3; NORTH-STAR states this as a fact);
  - converted to a GIF and inspected with vision;
  - status per scene step against the matrix, plus the perf numbers from W65.

The next slice is planned only after Dennis has read this check.

## Inputs
- W64–W68 (complete slice 2), the W65 perf artifact and opt-level result.
- `.wdd/NORTH-STAR.md` matrix column S2, and the whole-picture rule.
- Carried into the whole-picture check (Dennis, 2026-10-06, saga dec_92684722): the three W67 gold observations, each decided with the playground in hand:
  - the DOM text has low contrast while the liquid is away (there is no liquid text yet);
  - the in-motion edges are furry because of the density renderer;
  - shake reads as sliding blobs more than as sloshing.
- Also carried:
  - a browser smoke test of the published `dist`, from the W66 ward review;
  - ring density when the area hint is off, from the W67 perf review.

## Outputs
- `demo/scenes/playground.{html,ts}` and `demo/scenes/playground-state.ts` (material, schema 2); `demo/scenes/splash.{html,ts}`; `demo/index.html` links.
- `packages/core/ts/__tests__/playground.test.ts`, `packages/core/__tests__/whole-picture-tooling.test.ts`, `e2e/scenes.spec.ts`, `e2e/record.spec.ts` (project `record`, not in CI), `e2e/dist.spec.ts` (project `dist`, blocking), `e2e/north-star.ts`.
- D69-6: the `examples/react/src/App.tsx` ready signal (`data-liquid-ready`), the root scripts `e2e:dist:build` and `e2e:dist`, the `dist` project in `e2e/projects.ts`, and the dist build and smoke steps in the CI `e2e` job.
- `scripts/webm-to-gif.mjs` (local ffmpeg).
- `.wdd/memory/whole-picture/slice-2.md` and `docs/superpowers/whole-picture/slice-2-canvas2d.gif`.
- One added test in `packages/core/__tests__/wdd-docs.test.ts`.

## Decisions
### D69-1: Playground storage v2
Proposal: storage key `liquiddom-playground-v2`; schema 2 = `{ schema: 2, material: { viscosity, cohesion, recovery }, init: { particles, seed, renderer, forceReducedMotion } }`; the v1 key is removed on every load and never migrated; URL params are validated one by one (`particles` integer in [256, 65536], `seed` u32, `renderer`, `forceReducedMotion`) and stripped; preset detection tolerance 0.005; a `setMaterial` `TypeError` reverts the setting to `getMaterial()`.
Consequence: old soft-body playground tweaks are lost on purpose; a rejected slider value snaps back instead of lingering.
Decision: APPROVED 2026-10-06 — playground v2: schema 2, v1 discarded, URL params validated and stripped, revert on TypeError (saga dec_4ef6c25e)

### D69-2: Recording pipeline
Proposal: a local-only Playwright `record` project (`video: "on"` via W65's `PROJECT_USE`, `blocking: false`), Chromium 1280×800, `deviceScaleFactor` 1, seed 1, the RAF clock (`?clock=manual` would freeze the video), canvas2d only (no WebGPU fluid renderer before slice 3); re-form budgets read from `.wdd/NORTH-STAR.md` through `e2e/north-star.ts`; `scripts/webm-to-gif.mjs` with local ffmpeg (640 px, 12 fps, ≤ 10 MiB) → `docs/superpowers/whole-picture/slice-2-canvas2d.gif`; report `.wdd/memory/whole-picture/slice-2.md`.
Consequence: the recording cannot be reproduced in CI and its frames are wall-clock, not bit-identical; step timings carry ±50 ms.
Decision: APPROVED 2026-10-06 — local record project (video on, RAF clock, canvas2d only), budgets read from NORTH-STAR, webm-to-gif via local ffmpeg (saga dec_1858b12e)

### D69-3: Splash scene layout
Proposal: three focusable liquid buttons with per-element `ElementOptions` (Thin viscosity 0.1 / recovery 0.4 s, Medium 0.5 / 0.7 s, Thick 0.9 / 1.2 s), a non-focusable pointer-only "pool" card, and non-liquid controls (strength slider 0–2, "Splash all", "Shake"); `autoObserve: false` because auto-observe cannot pass element options.
Consequence: no area hint, so cell size 8 px (about 147k px² observed, under the 256k warning); click and keyboard splashes are strength 1, other strengths come only from the controls.
Decision: APPROVED 2026-10-06 — splash scene: Thin/Medium/Thick drops with per-element viscosity/recovery, pointer-only pool, strength/Splash all/Shake controls (saga dec_d116cb2e)

### D69-4: Whole-picture gate semantics
Proposal: the report test checks structure and honesty, not that everything is green: every step S2 expects as ✅ is observed ✅ or ❌ (never ⏳), every row has evidence, steps 3 and 6 quote the NORTH-STAR re-form budget, and the GIF is a real GIF of at most 10 MiB.
Consequence: W69 can reach gold with a ❌ scene step; the ❌ is an open point and Dennis decides whether slice 3 or a fix ward comes next.
Decision: APPROVED 2026-10-06 — whole-picture gate checks structure and honesty; a ❌ step does not block gold (saga dec_ea35ba46)

### D69-5: Carried observations go into the report
Proposal: the slice-2 report has a `## Carried` section with one row per carried item — DOM text contrast while the liquid is away, furry in-motion edges (density renderer), shake reads as sliding blobs, pointer-bulge strength (drag 6.0), material preset tuning, ring density when the area hint is off — each with evidence (GIF frames or playground values) and a concrete recommendation; W69 makes no engine change.
Consequence: W69 keeps its no-new-engine-behaviour rule; at gold Dennis picks what is tuned and whether it happens in a fix ward before slice 3 or inside slice 3.
Decision: APPROVED 2026-10-06 — report + recommendation per carried item, no engine change in W69 (saga dec_035bc206)

### D69-6: Published-dist browser smoke in CI
Proposal: a blocking Playwright `dist` spec: build core (clean → tsc → copy-wasm) and `examples/react`, serve the example with `vite preview`, and assert `create()` resolves, `canvas.liquid-canvas` exists and no console error or pageerror occurs; the CI e2e job gains the core build step.
Consequence: the `./wasm/` rewrite and the runtime `.wasm` fetch from the published `dist` are verified in a real browser on every CI run (W66 ward-review carry).
Decision: APPROVED 2026-10-06 — blocking dist smoke in CI with a core build step (saga dec_6de03f81)

## Specification
- **Playground:** Tweakpane bindings for viscosity, cohesion and recovery call `setMaterial(partial)`. A preset dropdown offers water, honey and jelly. The init folder (particles, seed, renderer, forceReducedMotion) re-creates the instance. URL params `?particles&seed&renderer` are validated and then stripped.
- **Splash scene:** D69-3: Thin/Medium/Thick drops with per-element viscosity and recovery, a pointer-only pool card, and strength / Splash all / Shake controls. Click and keyboard splash; no console error.
- **Dist smoke (D69-6):** a blocking Playwright `dist` spec loads the built `examples/react` against the published core `dist` in a real browser.
- **`slice-2.md` structure:**
  - the date;
  - a link to the GIF;
  - a table `| Step | Scene step | Expected S2 | Observed | Evidence |` for steps 1–8 (5 cells per row; Observed starts with ✅, ⏳ or ❌; every row has evidence; steps 3 and 6 quote the NORTH-STAR re-form budget);
  - a `## Carried` section (D69-5): one row per carried item with evidence and a recommendation;
  - perf: p95 tick per step and RAF p95 from W65;
  - open issues;
  - a recommendation for slice 3, which Dennis decides.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_saved_v1_state_when_loading_then_discarded_and_null | D69-1 (playground.test.ts) |
| 2 | given_valid_v2_state_when_loading_then_material_restored | D69-1 |
| 3 | given_corrupt_json_when_loading_then_null_and_entry_cleared | D69-1 |
| 4 | given_v2_payload_with_out_of_range_material_or_init_when_loading_then_null_and_entry_cleared | D69-1 |
| 5 | given_material_bounds_when_checked_then_isValidMaterial_agrees_with_core_validateMaterial_and_defaults_match | D69-1 bounds = core |
| 6 | given_url_params_particles_seed_renderer_when_parsed_then_validated_and_stripped | URL params |
| 7 | given_material_binding_change_when_applied_then_setMaterial_called_with_partial | binding |
| 8 | given_rejected_material_change_when_applied_then_state_reverted_to_instance_material | D69-1 revert |
| 9 | given_material_equal_to_a_preset_within_slider_rounding_when_detected_then_preset_name_else_custom | presets |
| 10 | given_input_and_output_when_building_ffmpeg_args_then_single_pass_palette_filter_with_width_fps_and_infinite_loop | D69-2 GIF (whole-picture-tooling.test.ts) |
| 11 | given_manifest_json_when_resolving_input_then_video_path_is_read_from_manifest | D69-2 GIF |
| 12 | given_cli_args_when_parsed_then_defaults_640px_12fps_and_bad_flags_throw | D69-2 GIF |
| 13 | given_ci_workflow_when_read_then_record_project_is_never_run_in_ci | D69-2 not in CI |
| 14 | given_root_package_when_read_then_whole_picture_script_records_in_the_record_project_then_converts_to_gif | npm script |
| 15 | given_a_scene_step_line_when_parsed_then_the_first_bold_seconds_value_is_the_budget_and_missing_budgets_throw | budgets parser |
| 16 | given_north_star_scene_steps_when_parsed_then_reform_budgets_follow_the_d67_1_outcome | D67-1 option 1: splash and shake 3 s |
| 17 | given_e2e_spec_files_when_routed_then_canvas2d_runs_every_spec_except_smoke_perf_record_and_dist | routing (e2e-harness.test.ts, renamed W65 test) |
| 18 | given_project_table_when_read_then_canvas2d_and_dist_are_blocking_and_perf_runs_only_perf_spec | D69-6 blocking (renamed W65 test) |
| 19 | given_e2e_spec_files_when_routed_then_record_project_runs_only_the_record_spec_and_is_not_blocking | D69-2 routing |
| 20 | given_e2e_spec_files_when_routed_then_dist_project_runs_only_the_dist_spec_on_its_own_port_and_is_blocking | D69-6 routing + npm scripts |
| 21 | given_ci_yml_when_parsed_then_dist_smoke_is_blocking_and_runs_after_the_pkg_download_and_the_dist_build | D69-6 CI (ci-workflow.test.ts) |
| 22 | given the splash scene when buttons are clicked and keyboard-activated then no console error and every element re-forms to restAlpha 1 | D69-3 (scenes.spec.ts) |
| 23 | given the playground when the honey preset is applied and the page reloaded then no console error and the material is restored from liquiddom-playground-v2 | playground (scenes.spec.ts) |
| 24 | given the React example built against the published core dist when served by vite preview then create() resolves, canvas.liquid-canvas exists, the wasm is fetched and no console error occurs | D69-6 (dist.spec.ts, project `dist`) |
| 25 | whole picture – slice 2 – acceptance steps 1-4 and 6 recorded in canvas2d | recording (record.spec.ts, project `record`) |
| 26 | given_whole_picture_slice_2_when_read_then_it_has_status_per_scene_step_against_north_star_and_links_the_gif | D69-4 + D69-5 Carried (wdd-docs.test.ts) |

## Must NOT
- Record with `?clock=manual`.
- Claim a WebGPU result: the slice-2 check is canvas2d only.
- Start planning slice 3 before Dennis has read `slice-2.md`.

## Must DO
- Gate D69-1 … D69-6 before `wdd ward status 69 red`, and log them in NORTH-STAR.
- Reconcile this Tests table in the red commit.
- Inspect the GIF with vision before writing any status.

## Manual Smoke Test
### Setup
`npm run build && npx playwright install chromium`

### Steps
1. Run: `npm run dev`, then open `/scenes/playground.html`.
   Verify: the sliders change the feel live, and the presets switch it. Take a screenshot and inspect it with vision.
2. Run: `npx playwright test e2e/scenes.spec.ts --project=canvas2d`
   Expected: pass.
3. Run: `npx playwright test e2e/record.spec.ts --project=record`
   Verify: a `.webm` is written under `test-results/`.
4. Run: `node scripts/webm-to-gif.mjs <path-to-webm> docs/superpowers/whole-picture/slice-2-canvas2d.gif`
   Verify: the GIF plays steps 1–4 and 6. Inspect it with vision.

### Pass criteria
- [ ] The GIF is inspected with vision, and `slice-2.md` has a status for every step.
- [ ] `npm run verify` is green.

## Verification
`npm run verify` is green, `slice-2.md` and the GIF are committed, and Dennis has read the whole-picture check before any slice-3 planning starts.

## Gold notes

**Whole picture after slice 2.** Report: `.wdd/memory/whole-picture/slice-2.md`. GIF: `docs/superpowers/whole-picture/slice-2-canvas2d.gif` (863 341 B, 23 s, canvas2d only, RAF clock, seed 1).
- Scene steps:
  - Step 1 idle ✅.
  - Step 2 pointer sweep ❌: motion yes (no holes, 2 % swell), experience no; the bulge is not readable.
  - Step 3 splash ✅: re-form 2451 ms of 3000.
  - Step 4 keyboard splash ✅: 2496 ms, with the focus ring visible.
  - Step 5 ⏳ (slice 5).
  - Step 6 shake ❌: motion yes (re-form 2179 ms), experience no; intact blobs slide instead of sloshing.
  - Step 7 ⏳ (slice 6).
  - Step 8 modes ✅, by tests; not in the recording, which is an open point.
- Per D69-4, a ❌ does not block gold. Dennis decides what comes before slice 3.
- Carried (D69-5): six rows, each with evidence and a recommendation:
  - text halo, via a stylesheet rule and not an inline style (D66-3);
  - furry edges: inside slice 3;
  - shake impulse shape plus `SHAKE_STIFFNESS_CAP`;
  - pointer drag: try 12–24;
  - honey preset retune;
  - ring density: slice 6.
- New finding: the Canvas2D restAlpha cross-fade dips to ~151/255 at restAlpha 0.58. The fix is full density weight while restAlpha < 1.

**Delivered:**
- Playground v2 (D69-1).
- Splash scene: Thin/Medium/Thick and the pool; per-element options are read back from the runtime (D69-3).
- Record and GIF tooling (D69-2): the record spec now saves the video to a stable path, fixed in 90ce484.
- Blocking dist smoke in CI (D69-6): the React example runs against the published core `dist` in a real browser, with wasm served as `application/wasm`.

**Vision (controller):**
- Splash scene and playground at rest.
- Water, honey and shake probes.
- The dist example: two crisp liquid pills.
- Acceptance frames: splash peak (C-shaped jets with a ring of droplets) and shake peak (blobs displaced, focus ring over the empty Split).

**Reviews:**
- Every task was reviewed.
- The green-range review found 7 minors, all fixed.
- The whole-ward review found:
  - the halo recommendation broke D66-3;
  - the cross-fade "max" option would change nothing;
  - steps 2/6 were marked ✅ against their own observations;
  - the shake rotation term was rigid;
  - the CI dist-build order;
  - two weak scenes tests.

  All are fixed in 1669f8e.
- Controller fixes: the wdd-docs absolute import path, and the record-path open point.
- A W69.1 URL test changed by ruling: an all-invalid query is now stripped.

**Verification:** cargo 143 passed + 1 ignored, vitest 420 passed + 4 skipped, clippy clean, canvas2d 26 passed, dist 1 passed. Perf on M4 Pro: tick p95 3.56 ms, RAF p95 3.63 ms.
