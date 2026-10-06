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
- Carried into the whole-picture check (Dennis, 2026-10-06, saga dec_92684722): the three W67 gold observations, each decided with the playground in hand:
  - the DOM text has low contrast while the liquid is away (there is no liquid text yet);
  - the in-motion edges are furry because of the density renderer;
  - shake reads as sliding blobs more than as sloshing.
- Also carried:
  - a browser smoke test of the published `dist`, from the W66 ward review;
  - ring density when the area hint is off, from the W67 perf review.

## Outputs
- `demo/scenes/playground.{html,ts}` and `demo/scenes/playground-state.ts` (material, schema 2); `demo/scenes/splash.{html,ts}`; `demo/index.html` links.
- `packages/core/ts/__tests__/playground.test.ts`, `e2e/scenes.spec.ts`, `e2e/record.spec.ts` (project `record`, not in CI).
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
