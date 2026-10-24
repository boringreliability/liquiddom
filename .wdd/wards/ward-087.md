---
ward: 87
revision: null
name: "Whole picture (slice 6)"
epic: "fluid-engine"
status: "planned"
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
Decision: PENDING

### D87-2: The site landing as the foreign page
Proposal: the live-quality site landing (built `site/dist`, served by the record spec itself with Vite's `preview()` on its own port) replaces W76's one-screen demo landing segment: arrival splash, hover and a splash in chapter 2, a drag merge in chapter 4, "Shake all" in chapter 3, a fast scroll to the parked chapter 6 cards, "Splash both" in chapter 7, scroll back to the top; recorded in both renderers into separate GIFs `slice-6-site-canvas2d.gif`, `slice-6-site-webgpu.gif` (the acceptance GIFs stay comparable with slice 4). `demo/scenes/landing.html` and its smoke spec stay.
Consequence: `record.spec.ts` needs the site built first (`npm run e2e:site:build` inside `whole-picture`); the site recording is a report section, gated only on "every instance at rest at the end" like W76's landing.
Decision: PENDING

### D87-3: Epic 15's CI criterion for WebGPU
Proposal: the completion criterion "`webgpu` blocking once it has 10 green runs in a row" cannot be met as written: SwiftShader does not run the liquid (W71.0 fallback B), so CI only has a soft adapter smoke. Amend it to "WebGPU is verified locally on Metal (`e2e:webgpu-hw`) at every ward's gold; the CI SwiftShader smoke stays soft", and record the reason; the alternative is to keep the criterion open until CI has a GPU runner.
Consequence: (amend) epic 15 can close on its other criteria; (keep open) the epic stays open with no ward that can close it.
Decision: PENDING

### D87-4: Publishing 0.3 and the fate of 0.2.0-rc.0 (Dennis executes)
Proposal: present, never execute: (a) publish the fixed group as `0.3.0-alpha.x` under the `alpha` dist-tag (`npm run version`, tag `v*`, `release.yml` runs `changeset publish` in pre mode), so the site's install line works, and move `latest` to it (`npm dist-tag add`), since `0.2.0-rc.0` was never stable and its soft-body API no longer matches any doc; (b) deprecate `0.2.0-rc.0` with "the soft-body engine is retired; use 0.3"; (c) or publish under `alpha` only and leave `latest` on 0.2 until a 0.3 release.
Consequence: (a)+(b) `npm install liquiddom` and the site's command both give the fluid engine; (c) keeps `latest` on an API the docs no longer describe. Either way the live site's `npm install liquiddom@alpha` fails until something is published.
Decision: PENDING

## Specification
Baseline at `e137d45` (W86 complete; the site live): cargo `245 passed; 0 failed; 1 ignored`; vitest `862 passed (862)`, 88 files; Playwright `--list` canvas2d 101 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2 / site 7.

Written after the W87 gate (part 2 of the plan).

## Tests
Written after the W87 gate (part 2 of the plan).

## Must NOT
- Change the engine or any public API; fix a liquid finding inside W87 (it becomes a later ward).
- Publish, move a dist-tag or deprecate a version (Dennis' calls).
- Move a Linux baseline; commit stills (GIFs only, as W76).

## Must DO
- Inspect every recording with vision before reporting a step's status.
- Record the decisions Dennis takes on D87-3 and D87-4.

## Manual Smoke Test
Written after the W87 gate (part 2 of the plan).

## Verification
`npm run whole-picture` (both renderers, both GIFs per renderer), vision of every segment, the report against NORTH-STAR's S6 column; `npm run verify` and `npm run e2e:canvas2d` unchanged.
