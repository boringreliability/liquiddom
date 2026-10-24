---
ward: 87
revision: null
name: "Whole picture (slice 6)"
epic: "fluid-engine"
status: "approved"
dependencies: [86]
layer: "typescript"
estimated_tests: 0
created: "2026-10-24"
completed: null
---
# Ward 087: Whole picture (slice 6)

North star: all steps — the closing whole-picture check of slice 6 in both renderers: a status per scene step and renderer against the S6 column (step 5 drag and step 7 scroll recorded for the first time), plus the live site landing, from recordings inspected with vision.

## Scope
Last ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §10). The acceptance scene is recorded in Canvas2D and WebGPU with all eight steps (W76 recorded 1–4, 6 and 8; steps 5 and 7 landed in slices 5 and 6), and the site landing replaces W76's one-screen demo landing as the foreign page. The report `.wdd/memory/whole-picture/slice-6.md` gives a status per step and renderer against the matrix, inspected with vision. Epic 15's completion criteria are reviewed; the CI criterion "webgpu blocking after 10 green runs" and publishing `0.3.0-alpha.x` (and the fate of `0.2.0-rc.0`) are put to Dennis as decisions, never executed by AI.

Out of scope: any engine or API change (a finding becomes a later ward), glow and shadow (the ward after W87), executing a publish or moving a dist-tag.

## Inputs
- The slice design §10; NORTH-STAR's scene, steps and S6 column; the earlier checks `.wdd/memory/whole-picture/slice-2.md`, `slice-4.md` (W76, the template).
- `e2e/record.spec.ts` (projects `record`, `record-webgpu`; steps 1–4, 6, 8 and the W76 landing scene), `scripts/webm-to-gif.mjs`, `npm run whole-picture`; the step 5 and 7 drivers in `e2e/acceptance.spec.ts`, `e2e/scroll.spec.ts`, `e2e/webgpu-robust.spec.ts`.
- The site (`site/dist`, W86) and its selectors (`section[data-chapter]`, `[data-hero]`, `#shake-all`, `.run-card`, `#splash-both`).
- npm state on 2026-10-24: `liquiddom` and `@liquiddom/react` have one version, `0.2.0-rc.0` (soft-body), tagged `latest`; no `alpha` tag exists, so the live site's `npm install liquiddom@alpha` fails today.

## Outputs
- `docs/superpowers/whole-picture/slice-6-*.gif`, `.wdd/memory/whole-picture/slice-6.md`.
- An updated `record.spec.ts` and `whole-picture` script.
- Dennis' decisions on the WebGPU CI criterion and on publishing, recorded.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). -->
### D87-1: Whole picture after slice 6: both renderers, all eight steps
Proposal: the W76 template in Canvas2D and WebGPU (hardware adapter, local), now with step 5 (drag "Merge" into the card, hold, separate, re-form) and step 7 (scroll 300 px and back), driven with the same pointer and scroll paths as the acceptance specs, on the RAF clock; the report `slice-6.md` with a status per step and renderer against the S6 column, timings from the manifest, frame references and stills, inspected with vision; GIFs `slice-6-canvas2d.gif`, `slice-6-webgpu.gif`; the `whole-picture` script writes the slice-6 names.
Consequence: the recording grows by two segments (about 15 s per renderer); steps 5 and 7 are seen in a video for the first time, so a visual finding there is possible and becomes a later ward, not a W87 fix.
Decision: APPROVED 2026-10-24 — the W76 template in both renderers with all eight steps (5 drag and 7 scroll recorded), slice-6.md per step and renderer from vision, slice-6-*.gif; findings become later wards (saga dec_8fc2bdda)

### D87-2: The site landing as the foreign page
Proposal: the live-quality site landing (built `site/dist`, served by the record spec itself with Vite's `preview()` on its own port) replaces W76's one-screen demo landing segment: arrival splash, hover and a splash in chapter 2, a drag merge in chapter 4, "Shake all" in chapter 3, a fast scroll to the parked chapter 6 cards, "Splash both" in chapter 7, scroll back to the top; recorded in both renderers into separate GIFs `slice-6-site-canvas2d.gif`, `slice-6-site-webgpu.gif` (the acceptance GIFs stay comparable with slice 4). `demo/scenes/landing.html` and its smoke spec stay.
Consequence: `record.spec.ts` needs the site built first (`npm run e2e:site:build` inside `whole-picture`); the site recording is a report section, gated only on "every instance at rest at the end" like W76's landing.
Decision: APPROVED 2026-10-24 — the built site landing served by the record spec, its own GIFs slice-6-site-*.gif; the demo landing scene and its smoke stay (saga dec_e894a8d5)

### D87-3: Epic 15's CI criterion for WebGPU
Proposal: the completion criterion "`webgpu` blocking once it has 10 green runs in a row" cannot be met as written: SwiftShader does not run the liquid (W71.0 fallback B), so CI only has a soft adapter smoke. Amend it to "WebGPU is verified locally on Metal (`e2e:webgpu-hw`) at every ward's gold; the CI SwiftShader smoke stays soft", and record the reason; the alternative is to keep the criterion open until CI has a GPU runner.
Consequence: (amend) epic 15 can close on its other criteria; (keep open) the epic stays open with no ward that can close it.
Decision: APPROVED 2026-10-24 — amend: WebGPU verified locally on Metal (e2e:webgpu-hw) at every ward's gold; the CI SwiftShader smoke stays soft (saga dec_52664d92)

### D87-4: Publishing 0.3 and the fate of 0.2.0-rc.0 (Dennis executes)
Proposal: present, never execute: (a) publish the fixed group as `0.3.0-alpha.x` under the `alpha` dist-tag (`npm run version`, tag `v*`, `release.yml` runs `changeset publish` in pre mode), so the site's install line works, and move `latest` to it (`npm dist-tag add`), since `0.2.0-rc.0` was never stable and its soft-body API no longer matches any doc; (b) deprecate `0.2.0-rc.0` with "the soft-body engine is retired; use 0.3"; (c) or publish under `alpha` only and leave `latest` on 0.2 until a 0.3 release.
Consequence: (a)+(b) `npm install liquiddom` and the site's command both give the fluid engine; (c) keeps `latest` on an API the docs no longer describe. Either way the live site's `npm install liquiddom@alpha` fails until something is published.
Decision: APPROVED 2026-10-24 — (a)+(b): Dennis publishes 0.3.0-alpha.x under alpha, moves latest to it and deprecates 0.2.0-rc.0; AI never executes them (saga dec_675c178a)

## Specification
Baseline at `e137d45` (W86 complete; the site live): cargo `245 passed; 0 failed; 1 ignored`; vitest `862 passed (862)`, 88 files; Playwright `--list` canvas2d 101 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2 / site 7.

The implementation follows part 2 of `docs/superpowers/plans/2026-10-13-fluid-slice-6/W87.md`: `e2e/record.spec.ts` gains step 5 (drag "Merge" into the card, DRAGGED asserted mid-hold) and step 7 (three wheel notches to 300 px and back, `scrollY` asserted, `minRestDuringScroll` recorded) in the acceptance video, and a site test per renderer (its own Vite preview on :4177, its own video, manifest and GIF; skipped without `site/dist`), placed before the acceptance loop so the W76 pin holds. `npm run whole-picture` builds the site and writes `slice-6-{canvas2d,webgpu}.gif` and `slice-6-site-{canvas2d,webgpu}.gif`. The report is `.wdd/memory/whole-picture/slice-6.md`.

After W87: vitest `870 passed (870)`, 88 files; `--list` record 4, record-webgpu 4, the others unchanged.

## Tests

Files: `packages/core/__tests__/whole-picture-tooling.test.ts`, `packages/core/__tests__/wdd-docs.test.ts`. Rows 1 and 2 change approved tests in place (pending Dennis' approval at red, 2026-10-24).

| # | Test (file: name) | Verifies | Red (measured) | Gold |
|---|---|---|---|---|
| 1 | whole-picture-tooling (changed, i): given_root_package_when_read_then_whole_picture_script_builds_the_site_records_both_renderers_then_converts_to_the_slice_6_gifs | D87-1/2 | ❌ assertion: the script is still the slice-4 string | ✅ |
| 2 | whole-picture-tooling (changed, ii): the W70 test's test-name template reads "steps 1-8" | D87-1 | ❌ assertion: the spec still declares "steps 1-4, 6 and 8" | ✅ |
| 3 | whole-picture-tooling: given_record_spec_when_read_then_step_5_drags_merge_into_the_card_between_step_4_and_step_6 | D87-1 | ❌ assertion: no `// Step 5 (S6, W87)` marker (indexOf -1) | ✅ |
| 4 | whole-picture-tooling: given_record_spec_when_read_then_step_7_scrolls_300_px_and_back_between_step_6_and_the_s4_step_8 | D87-1 | ❌ assertion: no `// Step 7 (S6, W87)` marker (indexOf -1) | ✅ |
| 5 | whole-picture-tooling: given_record_spec_when_read_then_the_site_is_recorded_per_renderer_into_its_own_manifest | D87-2 | ❌ assertion: no `const RECORD_SITE_PORT = 4177;` | ✅ |
| 6 | whole-picture-tooling: given_north_star_when_parsed_then_the_step_5_drag_budget_is_3_s | D87-1 | ✅ (NORTH-STAR has it) | ✅ |
| (pin) | whole-picture-tooling W76 D76-2, unchanged | resolution 5 | ✅ | ✅ (the site block before the acceptance loop) |
| 7 | wdd-docs: given_slice_6_report_when_read_then_headings_and_eight_scene_step_rows | D87-1 | ❌ assertion: missing `.wdd/memory/whole-picture/slice-6.md` | ✅ |
| 8 | wdd-docs: given_slice_6_report_when_read_then_every_step_row_cites_an_observation_and_steps_3_to_7_a_time | D87-1 | ❌ assertion: missing slice-6.md | ✅ |
| 9 | wdd-docs: given_slice_6_report_when_read_then_the_site_section_cites_frames_and_the_epic_and_release_sections_cite_d87_3_and_d87_4 | D87-2/3/4 | ❌ assertion: missing slice-6.md | ✅ |
| 10 | wdd-docs: given_slice_6_gifs_when_read_then_four_gif89a_files_under_10_mib | D87-1/2 | ❌ assertion: missing `slice-6-canvas2d.gif` | ✅ |

Red run: whole-picture-tooling 16 tests, 5 failed (rows 1–5); wdd-docs 39 tests, 4 failed (rows 7–10); row 6 and every pre-existing test pass.

## Must NOT
- Change the engine or any public API; fix a liquid finding inside W87 (it becomes a later ward).
- Publish, move a dist-tag or deprecate a version (Dennis' calls).
- Move a Linux baseline; commit stills (GIFs only, as W76).

## Must DO
- Inspect every recording with vision before reporting a step's status.
- Record the decisions Dennis takes on D87-3 and D87-4.

## Manual Smoke Test
### Setup
Nothing to start: the four GIFs are in `docs/superpowers/whole-picture/`.

### Steps
1. Open `slice-6-canvas2d.gif` and `slice-6-webgpu.gif` and watch steps 1–8 (the order of the report's step table): the drag of "Merge" into the card and back (step 5) and the scroll to 300 px and back (step 7) are new.
2. Open `slice-6-site-canvas2d.gif` and `slice-6-site-webgpu.gif`: the arrival, the hint shake at about 4 s, chapters 2, 3, 4, 6 and 7, back to the top.
3. Read `.wdd/memory/whole-picture/slice-6.md` (step table, Site, Epic 15, Release).

### Pass criteria
- [ ] Every step reads as the report describes it in both renderers.
- [ ] The release steps (D87-4) are the ones Dennis wants to run.

## Verification
`npm run whole-picture` (both renderers, both GIFs per renderer), vision of every segment, the report against NORTH-STAR's S6 column; `npm run verify` and `npm run e2e:canvas2d` unchanged.
