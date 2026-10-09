---
ward: 76
revision: null
name: "Whole picture after slice 4"
epic: "fluid-engine"
status: "planned"
dependencies: [75]
layer: "typescript"
estimated_tests: 3
created: "2026-10-10"
completed: null
---
# Ward 076: Whole picture after slice 4

North star: all steps — the first whole-picture check in both renderers: a status per scene step and renderer against the S4 column (step 3 "✅ W with text", step 8 "+ forced-colors ✅", steps 5 and 7 ⏳), from a recording inspected with vision.

## Scope
Spec §6.4 and NORTH-STAR require a whole-picture check after slice 4, in every renderer that exists (canvas2d and webgpu). This ward records the acceptance scene in both renderers (Canvas2D in the `record` project, WebGPU on the hardware adapter in `record-webgpu`), inspects the recordings with vision, and writes `.wdd/memory/whole-picture/slice-4.md` on W69's template: per-step status per renderer, a `## Text` section on the liquid text and the Canvas2D halo, the carried items with evidence and one recommendation each, perf for both renderers, a drift check, open points and a recommendation. The recording gains two segments for what slice 4 added: a gentle card splash that shows the liquid text (step 3b) and forced colours switched on live mid-splash (S4 step 8). `npm run whole-picture` is generalised to both renderers and the slice-4 GIFs.

Out of scope: any engine, renderer or runtime change (findings become Carried rows or open points; Dennis decides the follow-up); planning slice 5 (only after Dennis' review of the report); CI changes (the recording never runs in CI).

## Inputs
- W69 template: `e2e/record.spec.ts`, `scripts/webm-to-gif.mjs`, `.wdd/memory/whole-picture/slice-2.md` and `slice-2-addendum.md`, the W69/W70 report tests in `wdd-docs.test.ts` and `whole-picture-tooling.test.ts`, D69-4 (a ❌ does not block gold) and D69-5 (carried items: evidence + recommendation).
- W72: the `record-webgpu` project and `npm run record:w72` (both renderers, slice-3 GIFs), `perf-webgpu.json`, the device.lost and step 4/6/8 WebGPU tests.
- W74/W75: liquid text, the `liquid-text` toggle, the halo, forced colours/print with `liquid-text` active, their gold notes and CONTEXT limitations.
- Carried: honey preset re-form 279–292 frames (W73, CONTEXT), Canvas2D splats w == 0 particles (W71 M1/W72 m4), the shake profile varies along x only (W70/W73), pointer decay per frame (D68-4), the `runtime-truth.test.ts` flake (W72), DOM text contrast while the liquid is away (slice-2 Carried, D72-5; W74 liquid text and W75 halo address it, W76 checks what remains).

## Outputs
- `package.json` `whole-picture`: `record` + `record-webgpu` → `docs/superpowers/whole-picture/slice-4-canvas2d.gif` and `slice-4-webgpu.gif`.
- `e2e/record.spec.ts`: step 3b (card text) and the S4 step-8 forced-colours segment in both renderers.
- `.wdd/NORTH-STAR.md`: the "Slice 4" whole-picture row names W76 and both GIFs.
- `.wdd/memory/whole-picture/slice-4.md` and the two GIFs.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D76-1: Whole picture after slice 4: both renderers, W69 template
Proposal: `npm run whole-picture` records the `record` (canvas2d) and `record-webgpu` (Metal, local only) projects and converts both videos to `docs/superpowers/whole-picture/slice-4-canvas2d.gif` and `slice-4-webgpu.gif`; `record:w72` stays as the slice-3 record. `e2e/record.spec.ts` gains, in both renderers from the same template, step 3b (an API splash on the card at strength 0.5 with a shot at 250 ms and a timed re-form) and an S4 step-8 segment (click Splash, after 150 ms switch forced colours on live, assert the canvas is hidden and the DOM text is not transparent, shot, switch off, time the re-form). The report `.wdd/memory/whole-picture/slice-4.md` follows W69's template with one status column per renderer (`| Step | Scene step | Expected S4 | Canvas2D | WebGPU | Evidence |`), a `## Text` section, six Carried rows (honey re-form, Canvas2D w == 0 particles, x-only shake profile, per-frame pointer decay, the runtime-truth flake, DOM-text contrast), perf for both renderers, a drift check, `## Open points for slice 5` and a recommendation. D69-4 holds: a ❌ does not block gold. Honesty rule: every ✅ cites an observation (a shot, a GIF frame or a GIF time), not only a test; `wdd-docs.test.ts` pins the structure.
Consequence: one approved-test change at red (W69's pin of the `whole-picture` script becomes the two-renderer, slice-4 string); the W69/W70/W72 recording pins stay. The recording needs Dennis' Mac (Metal) and ffmpeg and takes about a minute per renderer; it never runs in CI. Re-running `npm run whole-picture` after slice 4 overwrites the slice-4 GIFs, not the slice-2/3 ones. The forced-colours segment adds an assertion inside the recording, so a step-8 regression fails the recording run in that renderer (the report then says ❌). Slice 5 is planned only after Dennis' review of the report.
Decision: PENDING

## Specification
Plan: `docs/superpowers/plans/2026-10-10-fluid-slice-4/W76.md`. Slice design: `docs/superpowers/specs/2026-10-10-liquiddom-slice-4-liquid-text-design.md` §5, §6 (D76-1); spec §6 "WDD with an eye on the whole", item 4; NORTH-STAR "Whole-picture checks".
- **Recording:** RAF clock, 1280×800, DPR 1, seed 1, video per project (W69/W72 `PROJECT_USE`); shots `s2-*` (canvas2d, W69 prefix kept) and `webgpu-*`; manifests `manifest.json` and `manifest-webgpu.json`; videos in `tmp/whole-picture/`.
- **Status rules:** ✅ only if the step's e2e tests pass in that renderer's project, the re-form (steps 3, 4, 6) is within the NORTH-STAR budget, and vision shows the behaviour; otherwise ❌ with a reason. Steps 5 and 7 are ⏳ (slices 5, 6).
- **Evidence collection:** canvas2d, webgpu-hw, webgpu (smoke) and dist runs; cargo scenario tests (re-form frames with F in the rest criterion, D74-2); perf in both renderers (`perf-canvas2d.json`, `perf-webgpu.json`) and W74's F-cost numbers; drift greps (soft-body names, DOM writes in renderers, `pkg/` imports); one read-only probe per Carried item.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | whole-picture-tooling: given_root_package_when_read_then_whole_picture_script_records_both_renderers_then_converts_to_the_slice_4_gifs | D76-1 script (approved-test change of W69's pin) |
| 2 | whole-picture-tooling: given_the_record_spec_when_read_then_it_records_a_card_text_splash_after_step_3_and_a_live_forced_colours_switch_before_reduced_motion_in_both_renderers | D76-1 recording segments |
| 3 | wdd-docs: given_whole_picture_slice_4_when_read_then_it_has_per_renderer_status_against_the_s4_column_carried_rows_perf_and_both_gifs | D76-1 report structure and honesty rule |

## Must NOT
- Change engine, renderer, runtime or test assertions to make a step pass; a failing step is ❌ in the report (D69-4).
- Mark a step ✅ on a test result alone; every ✅ cites a shot, a GIF frame or a GIF time.
- Run the recording in CI, overwrite the slice-2/slice-3 GIFs, or record WebGPU on SwiftShader.
- Plan slice 5 before Dennis has reviewed the report.

## Must DO
- Record both renderers with the same template and inspect every key shot and the GIF frames with vision.
- Give each Carried row evidence (probe, frame or number) and one recommendation that names where it lands.
- Report perf for both renderers and the drift check.
- STOP at gold and present the report, both GIFs and every ❌ first.

## Manual Smoke Test
### Setup
`npm run build:wasm`; ffmpeg on PATH; Dennis' Mac (Metal).

### Steps
1. Run: `npm run whole-picture`
   Expected: `2 passed` and two `[webm-to-gif] wrote docs/superpowers/whole-picture/slice-4-….gif` lines.
2. Run: open both GIFs in a browser.
   Verify: the same scene in both renderers; WebGPU text tears with its liquid and is DOM text at rest; Canvas2D labels keep a halo while moving; the forced-colours segment shows DOM text with no canvas.
3. Run: `npx vitest run packages/core/__tests__/wdd-docs.test.ts`
   Expected: 0 failed (the slice-4 report test included).

### Pass criteria
- [ ] Both GIFs exist, start with `GIF89a` and are at most 10 MiB.
- [ ] The report has a status per step and renderer, each ✅ backed by an observation.
- [ ] Every Carried row has evidence and a recommendation.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:dist`, `npm run e2e:webgpu-hw`, `npm run e2e:typecheck`; the report test in `wdd-docs.test.ts`; vision on both recordings; ward code review; STOP at gold for Dennis.
