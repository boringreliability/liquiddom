---
ward: 69
revision: null
name: "Playground, splash scene, whole-picture check"
epic: "fluid-engine"
status: "planned"
dependencies: [68]
layer: "typescript"
estimated_tests: 7
created: "2026-10-03"
completed: null
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

## Outputs
- `demo/scenes/playground.{html,ts}` and `demo/scenes/playground-state.ts` (material, schema 2); `demo/scenes/splash.{html,ts}`; `demo/index.html` links.
- `packages/core/ts/__tests__/playground.test.ts`, `e2e/scenes.spec.ts`, `e2e/record.spec.ts` (project `record`, not in CI).
- `scripts/webm-to-gif.mjs` (local ffmpeg).
- `.wdd/memory/whole-picture/slice-2.md` and `docs/superpowers/whole-picture/slice-2-canvas2d.gif`.
- One added test in `packages/core/__tests__/wdd-docs.test.ts`.

## Decisions
### D69-1: Playground storage v2
Proposal: storage key `liquiddom-playground-v2`; schema 2 = `{ material, init: { particles, seed, renderer, forceReducedMotion } }`. Saved v1 state is discarded.
Consequence: old soft-body playground settings are lost on purpose, because they have no meaning for the fluid engine.
Decision: PENDING

### D69-2: Recording pipeline
Proposal: a Playwright `record` project with `video: "on"`, using the RAF clock (not `?clock=manual`, which would freeze the video), converted by `scripts/webm-to-gif.mjs` with the local `/opt/homebrew/bin/ffmpeg`. Artefacts go to `.wdd/memory/whole-picture/slice-2.md` and `docs/superpowers/whole-picture/slice-2-canvas2d.gif`.
Consequence: ffmpeg is assumed locally only, and the `record` project never runs in CI.
Decision: PENDING

## Specification
- **Playground:** Tweakpane bindings for viscosity, cohesion and recovery call `setMaterial(partial)`. A preset dropdown offers water, honey and jelly. The init folder (particles, seed, renderer, forceReducedMotion) re-creates the instance. URL params `?particles&seed&renderer` are validated and then stripped.
- **Splash scene:** a row of buttons in different colours and radii, with click and keyboard splash. No console error is allowed.
- **`slice-2.md` structure:**
  - the date;
  - a link to the GIF;
  - a table `| Step | Expected (S2) | Observed | Status |` for steps 1–8, with status ✅/⏳/❌;
  - perf: p95 tick per step and RAF p95 from W65;
  - open issues;
  - a recommendation for slice 3, which Dennis decides.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_saved_v1_state_when_loading_then_discarded_and_null | D69-1 |
| 2 | given_valid_v2_state_when_loading_then_material_restored | D69-1 |
| 3 | given_url_params_particles_seed_renderer_when_parsed_then_validated_and_stripped | URL params |
| 4 | given_material_binding_change_when_applied_then_setMaterial_called_with_partial | binding |
| 5 | given the splash scene when buttons are clicked and keyboard-activated then no console error and every element re-forms to restAlpha 1 | splash scene |
| 6 | record – scene steps 1–4 and 6 recorded in canvas2d with the RAF clock | recording (project `record`) |
| 7 | given_whole_picture_slice_2_when_read_then_it_has_status_per_scene_step_against_north_star_and_links_the_gif | whole-picture doc (in `wdd-docs.test.ts`) |

## Must NOT
- Record with `?clock=manual`.
- Claim a WebGPU result: the slice-2 check is canvas2d only.
- Start planning slice 3 before Dennis has read `slice-2.md`.

## Must DO
- Gate D69-1 and D69-2 before `wdd ward status 69 red`, and log them in NORTH-STAR.
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
