---
ward: 77
revision: null
name: "Closed liquid under shake and splash"
epic: "fluid-engine"
status: "complete"
dependencies: [76]
layer: "both"
estimated_tests: 10
created: "2026-10-10"
completed: "2026-10-11"
---
# Ward 077: Closed liquid under shake and splash

North star: step 6 (shake) in both renderers, ruled ❌ at W76 gold ("motion yes, experience no"), becomes ✅: every element sloshes as one closed body, no diagonal lace, also on wide surfaces (landing page); step 3 keeps its neighbours whole (no specks next to a splash).

## Scope
Fix ward after the slice-4 whole-picture check (`.wdd/memory/whole-picture/slice-4.md`), before slice 5. The W77 spike (2026-10-10, throwaway, measurements below) found two causes. Render: the kernel radius is capped at 8 px, so on a page with a large observed area (particle spacing 5.4–5.7 px on the landing page) it reaches only 1.45 × spacing instead of 2.3 ×, and a neighbour's exact rest layout already shows 429 hole px under the capped kernel; a 0.9–2 px nudge from a splash next door drops its rest fade and shows them. Physics: the stretch yield J ≤ 1 + `tension_max` = 1.16 lets the shake bend tear the sheet into rows with diamond voids instead of thinning it. Also the honey preset (re-form 285 frames, budget 180, carried since W73) and the demo index opening scenes in Canvas2D by default.

Out of scope: escaped liquid painting over page text and other elements, author border/shadow at rest, `:hover` colour, detached icon chips, the WebGPU hover tilt (open points in slice-4.md for later wards); slice 5.

## Inputs
- W76 report `.wdd/memory/whole-picture/slice-4.md` (step 6 ❌, landing findings, frame cites), its GIFs and key frames.
- W73 (D73-1..3: amplitude 0.5, cap 0.3, `e2e/lace.ts` guard f10 ≤ 1699, f20 ≤ 915), W71 D71-5 (`kernel-params.ts` shared kernel, 2.3 × spacing, cap 8).
- W77 spike measurements (canvas2d, seed 1, manual clock, 1280×800):

| Lever | acc card t4 f10/f20 | landing dark card enc peak/Σ | "Book a demo" holes peak/Σ/last frame | re-form frames | tick p95 |
|---|---|---|---|---|---|
| baseline | 1145/815 | 8572/167,885 | 347/12,583/46 | 136–149 | 4.5 ms |
| kernel cap 8→16 px | 1145/815 | 8407/154,275 | 0/0/0 | = | 4.7 ms |
| tension_max 0.16→0.46 | 652/297 | 4437/83,677 | 346/11,938/44 | ≤139 | 4.5 ms |
| amplitude 0.5→0.35 | 411/499 | 4208/78,967 | 347 | ≤149 | 4.6 ms |
| cap 16 + tension 0.46 + amplitude 0.35 | 99/176 | 0/0 | 0/0/0 | 136–139 | 4.6 ms |

Slosh (non-rigid rms displacement, acc card / landing dark card): baseline 37.6/29.5 px, combined 26.3/20.2 px (−30 %, still visibly bending). Canvas2D frame cost on the landing shake with cap 16: 12.1 → 21.5 ms median (splat cost ∝ R²); acceptance scene unchanged (10.2 → 10.4 ms). WebGPU frame time unchanged (4.6 ms); landing overdraw 512k → 1.24M fragments/frame. Stills: the spike's `vis-{before,alt}-*` captures (WebGPU landing shake f12: diagonal lace on all three cards before, closed cards with readable text after).

## Outputs
- `packages/core/ts/src/renderers/kernel-params.ts` (+ the Canvas2D density grid), `src/fluid/` (tension yield, shake amplitude, honey preset values), `demo/index.html`.
- Tightened lace guard (acceptance card) plus a landing lace guard and a neighbour-speck guard.
- NORTH-STAR: no matrix change (step 6's S4 cell is already ✅ as the slice target). Step 6 is ruled back to ✅ per renderer in the new `.wdd/memory/whole-picture/slice-4-addendum.md` after vision at gold, where Dennis rules it; the NORTH-STAR plan decision log already holds D77-1 … D77-4 (D77-2's row also carries the slosh-floor approval, dec_a99cad59).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D77-1: Kernel reach follows the particle spacing (render, both renderers)
Proposal: the shared kernel radius stays 2.3 × the particle spacing, with `KERNEL_RADIUS_CAP_PX` raised from 8 to 16 px (D71-5 amended); the Canvas2D density grid cell scales with R so its splat cost per frame stays flat on large-area pages.
Consequence: the neighbour specks after a splash vanish (347 → 0 px in the spike), landing lace drops ≈92 % at f10; the acceptance scene does not change (R there is 7.09 px). WebGPU overdraw on large-area pages rises ≈2.4× (frame time unchanged on Metal); without the grid scaling Canvas2D would cost ≈12 → 21.5 ms per frame on the landing page. At rest nothing changes (exact rounded rect).
Decision: APPROVED 2026-10-10 — kernel 2.3 × spacing, cap 8 → 16 px (D71-5 amended), Canvas2D density grid scales with R (saga dec_279c7763)

### D77-2: The sheet thins instead of tearing (physics)
Proposal: the default stretch yield `tension_max` rises from 0.16 to ≈0.46 (cohesion 0.5 → 0.46 via the cohesion map, `TENSION_MAX_MAX` 0.30 → 0.90), and `SHAKE_PROFILE_AMPLITUDE` drops from 0.5 to 0.35 (D73-1 amended again); the W73 lace guard tightens to the new level (acceptance card ≤ ≈300 tear px at f10/f20) and gains a landing-page guard.
Consequence: with D77-1 the acceptance card goes 1145/815 → 99/176 tear px and the landing dark card to 0; re-form ≤ 139 frames; tick p95 ≈4.6 ms. Shake slosh drops ≈30 % but stays visibly a bend. Splash rims shed fewer droplets (7 → 2 fragments at f6). The cohesion remap shifts the water/honey/jelly presets; they are re-measured in W77.
Decision: APPROVED 2026-10-10 — tension_max ≈0.46 (TENSION_MAX_MAX 0.30 → 0.90), shake amplitude 0.35 (D73-1 amended), tighter lace guard + landing guard (saga dec_3ba590a1); slosh floors 20/10 approved 2026-10-11 (saga dec_a99cad59)

### D77-3: Honey re-forms within the budget
Proposal: retune the honey preset (recovery/viscosity) so its re-form after the acceptance splash is ≤ 180 frames (3 s) in both renderers while it still reads as slower and thicker than water; measured after D77-2's cohesion remap.
Consequence: closes the carried W73 item (285 frames); honey becomes a little quicker. The playground's stored `liquiddom-playground-v2` values stay valid (only preset defaults change).
Decision: APPROVED 2026-10-10 — honey re-form ≤ 180 frames in both renderers, still slower than water (saga dec_f68c0534)

### D77-4: The demo index opens scenes as a library user sees them
Proposal: `demo/index.html` links the acceptance, splash, playground and landing scenes with `?renderer=auto` (WebGPU on a hardware adapter, Canvas2D otherwise); the scenes' own default stays `canvas2d` so every test knows its renderer.
Consequence: a person opening the demo sees the default renderer; one approved test changes (the W76 pin of the landing link in `wdd-docs.test.ts`).
Decision: APPROVED 2026-10-10 — demo index links scenes with ?renderer=auto; scene default stays canvas2d (saga dec_eab87afb)

## Specification
Plan: `docs/superpowers/plans/2026-10-10-fluid-slice-4/W77.md`. Spec: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md` §2 (cohesion map, line ~224; shake row, line ~172), §3 (kernel cap, line ~251; overdraw risk, line ~519), amended in W77.6.

**W77.0 baseline (2026-10-10, at 9de5607, real WASM, seed 1, manual clock, 1280×800, DPR 1).** Probe: a temporary Playwright spec (never committed) using the guards' own helpers in `e2e/lace.ts`, run in the `perf` project (canvas2d, headless shell, the same browser as the blocking `canvas2d` project) and `webgpu-hw` (Metal).

| Measure | Method | Canvas2D | WebGPU |
|---|---|---|---|
| Acceptance card lace, f10 / f20 after `shake()` | `cardTearPixels` (W73 closing-r4, `#263238`) | 1175 / 831 | 972 / 573 |
| Landing dark card lace, f10 / f20 (peak f1–30, Σ f1–30) | `regionTearPixels(#card-ops, #111827, margin 40)` | 5232 / 1805 (5636, 72,203) | 3938 / 1316 (4282, 54,139) |
| "Book a demo" specks after an API splash on "Start free", peak / Σ f1–60 / last frame | `specksInside(#demo, inset 6, caps excluded)` | 307 / 11,542 / f46 | 238 / 8,947 / f46 |
| Same after a click on "Start free" (landing.spec's path), peak / Σ | same | 307 / 11,544 | 238 / 8,948 |
| Re-form after a splash on `#splash` (frames), default / water / honey / jelly | `setMaterial(preset)`, 30 frames, `splash()`, frames until every restAlpha is 1 | 144 / 135 / **285** / 123 | 144 / 135 / **285** / 123 |
| Re-form after `shake()` (frames), default / water / honey / jelly | the probe shook 30 frames after its splash measurement (not from rest) | 142 / 129 / **279** / 106 | 142 / 129 / **279** / 106 |
| Re-form after `shake()` from rest (frames), water / honey / jelly | the guards' own protocol: open the scene, `setMaterial(preset)`, 30 frames, `shake()` (W77.1 red run; WebGPU after the red review) | 131 / > 180 / 111 | 131 / > 180 / 111 |
| Frame cost on the shake, median wall ms of `advance(1)` over f1–40 (3 runs) | acceptance / landing | 22.06–22.81 / 24.81–25.54 (medians 22.53 / 25.10, ratio 1.114; a first run 1.122) | 4.35–4.41 / 4.48–4.69 |

The spike's numbers (its table above) used the chromium channel and a margin of 80 px; the guard margin is 40 px because at 80 px the region reaches the corner of "Book a demo" (`#111827` as well, 48 px from the dark card). The headless shell's absolute Canvas2D frame cost differs from the spike's (22 vs 10 ms), so the frame-cost guard is normalised by the acceptance shake, which D77-1 leaves alone (R 7.09 px, 2 px grid).

**Rust at D77-2's constants (scratch copy, never the worktree):** `TENSION_MAX_MAX 0.90` + `SHAKE_PROFILE_AMPLITUDE 0.35` fails exactly the six pins the red changes below and the W70 slosh floor: peak non-rigid RMS [Splash, Split, Merge, card] = [16.46, **11.52**, 21.90, 25.39] px (today [21.42, 14.88, 31.59, 36.65]) against floors 12 / 24. Re-form evidence there: splash 129 (+10), shake 130 (+10), D74-2 splash 139 frames (today 135 / 126 / 145). With the red tests applied the scratch copy passes `170 passed; 0 failed; 2 ignored`.

**Guard thresholds (red):**
- Acceptance card lace (D77-2, approved-test change of D73-3's 1699 / 915): ≤ **300** tear px at f10 and at f20 (spike 99 / 176: 3.0× / 1.7× margin; 26 % / 36 % of today). Canvas2D blocking, WebGPU in webgpu-hw.
- Landing dark card lace (D77-2): ≤ **400** region tear px at f10 and at f20 (spike 8 / 40 at margin 80; 7.6 % / 22 % of today). The spike had no Canvas2D grid scaling (D77-1's 3.5 px cells on this page, set by the pills' R 13.04 px), hence the wider margin. Canvas2D blocking (`landing.spec.ts`), WebGPU in webgpu-hw.
- Neighbour specks (D77-1): peak ≤ **16** px inside "Book a demo" over f1–60 after a splash on "Start free" (spike 0 with cap 16; today 307 / 238). Canvas2D blocking, WebGPU in webgpu-hw.
- Re-form (D77-2, D77-3): water, honey and jelly re-form within the NORTH-STAR step-3 (splash) and step-6 (shake) budgets, 180 frames each, read from `.wdd/NORTH-STAR.md`; honey's splash re-form is at least **1.15×** water's (red review finding 8; W77.0 285 / 135 = 2.1), so it still reads slower and thicker. Canvas2D blocking, WebGPU in webgpu-hw.
- Canvas2D frame cost (D77-1): median landing-shake frame / median acceptance-shake frame ≤ **1.29** = baseline 1.12 × 1.15 (perf project, non-blocking; the spike's cap 16 without the grid scaling, +78 % on the landing page, fails it).
- Slosh floors (W70 D70-5, consequence of D77-2): card 24 → **20** px, pills 12 → **10** px (still 1.5× W67's white-noise peak 6.64 px). **Approved by Dennis 2026-10-11 (saga dec_a99cad59)**, recorded on D77-2's Decision line. Margins at D77-2's constants: Split 11.52 / 10 = 1.15×, card 25.39 / 20 = 1.27×.

**D77-1 grid rule (W77.2, amended by the red review, findings 1 and 2):** `densityCellPx(maxR, minR) = max(2, min(ceil(min(maxR, 16)) / 4, floor(4 · minR / 2.3) / 4))` CSS px, over the frame's paints that have particles (`particleCount > 0`) and a finite positive `spacingPx`; other paints are skipped (an element without particles has spacing 0, and `kernelRadiusPx(0)` is the cap, which would put the whole page on the 4 px grid). In the pure function a bad max R takes the cap and a bad min R adds no bound. The second term keeps the cell at or under the finest particle spacing, so every element's kernel spans ≥ 2.3 cells per radius and never reaches `DensityGrid.splat`'s one-cell floor, where Canvas2D's kernel would diverge from WebGPU's (D71-5). Limit: the 2 px floor (`DEFAULT_SCALE_PX`, the pre-W77 grid, and WebGPU's 0.5× backing at DPR 1) wins for spacings under 2 px, as before W77. The Canvas2D renderer reallocates its density buffer only when the cell changes. Acceptance R 7.09–7.36 px → 2 px (unchanged); landing R 12.47 / 13.04 px → 3.5 px (the min bound, 5.25 px, does not bind); R 16 alone → 4 px; R 16 next to spacing 3.2 → 3 px, next to spacing 2 → 2 px. A splat touches ≈ π·(R/cell)² ≈ 50 cells at the largest R, as at R 8 px on 2 px cells (fewer only when a fine element holds the cell down).

**D77-3 procedure (W77.3):** after D77-2, measure honey's splash and shake re-form (canvas2d manual clock, seed 1, the W77 e2e helper); lower `recovery` from 1.6 s in steps of 0.2 s with viscosity 0.9 and cohesion 0.7 fixed until both are ≤ 165 frames (15-frame margin under 180); if recovery reaches 0.8 s (water's 0.5 s + 0.3 s) without it, lower viscosity in steps of 0.05 instead; stop at the first pair that passes and keeps honey's splash re-form ≥ 1.15× water's. **Viscosity floor 0.6** (jelly's, so honey stays the thickest preset): if viscosity reaches 0.6 without a passing pair, keep the last tried values out of the tree, **STOP and report to Dennis** (every pair and its frames); never change cohesion, the budget or a guard to get there. Pin the result in `material-api.test.ts` (approved-test change of W68's pin, D77-3; made in W77.3 because the values are not known at red, named here so it is approved with the red tests).

D77-3 run (W77.3, 2026-10-11, canvas2d, macOS, after D77-2; water splash 130 / shake 118, jelly 115 / 106; "> 180" = not back within the 180-frame guard window):
- viscosity 0.9, cohesion 0.7, recovery 1.6 s: splash 285, shake > 180 → fails
- viscosity 0.9, cohesion 0.7, recovery 1.4 s: splash 253, shake > 180 → fails
- viscosity 0.9, cohesion 0.7, recovery 1.2 s: splash 220, shake > 180 → fails
- viscosity 0.9, cohesion 0.7, recovery 1.0 s: splash 188, shake > 180 → fails
- viscosity 0.9, cohesion 0.7, recovery 0.8 s: splash 155, shake 152, honey / water 155 / 130 = 1.19 ≥ 1.15 → **passes, chosen** (viscosity unchanged)

**W77.5 browser, perf and Linux runs (2026-10-11, at 0e3636d, after `npm run build:wasm` and `npm run build -w liquiddom`).** Suites: `e2e:canvas2d` 49 passed, 9 skipped (macOS-skipped visual specs); `e2e:webgpu-hw` (Metal) 45 passed, 23 skipped; `perf` 2 passed, 1 skipped (W65 line: tick/step p95 3.945 ms, RAF p95 4.060 ms); Docker (`e2e:update`, Linux, canvas2d) 56 passed, 2 skipped.

| W77 guard (bound) | macOS canvas2d | Metal (webgpu-hw) | Linux canvas2d (Docker) |
|---|---|---|---|
| Acceptance card lace f10 / f20 (≤ 300) | 103 / 161 | 53 / 79 | 103 / 161 |
| Landing dark card lace f10 / f20 (≤ 400) | 10 / 42 | 0 / 1 | 8 / 40 |
| "Book a demo" specks, peak f1–60 (≤ 16) | 0 (Σ 0) | 0 | 0 (Σ 0) |
| Splash re-form water / honey / jelly (≤ 180) | 130 / 155 / 115 | 130 / 155 / 115 | 130 / 155 / 115 |
| Shake re-form from rest water / honey / jelly (≤ 180) | 118 / 152 / 106 | 118 / 152 / 106 | 118 / 152 / 106 |
| Honey / water splash re-form (≥ 1.15) | 155 / 130 = 1.19 | 155 / 130 | 155 / 130 = 1.19 |
| Canvas2D landing / acceptance shake frame (≤ 1.29, perf) | 18.92 / 22.72 ms = **0.833** (W77.0 baseline 1.119) | skips | not run (perf is local) |

Perf guard bites (Step 1b, scratch state never committed: `fitCell` returned before `densityCellPx`, i.e. cap 16 on the 2 px grid): landing 33.34 ms / acceptance 22.20 ms = **1.501** > 1.29, the W77 perf test fails as intended (baseline 1.119, with the grid scaling 0.833). `fluid-canvas2d.ts` restored with `git checkout`, tree clean.

Linux baselines moved (Docker `--update-snapshots=all`): `acceptance-step2`, `acceptance-step3-splash-f12`, `acceptance-step4-split-focus-f30`, `acceptance-step6-shake-f20` (the four the plan expected). Unchanged: `acceptance-step1`, `a11y-focus-split`, `step8-reduced-motion-media`, `step8-reduced-motion-option` (Must NOT holds). The moved baselines wait for Dennis' vision approval (D65-7).

**STOP rules after the change (red review findings 3, 4, 7):** W77.3 and W77.5 stop and report to Dennis on **any** W77 guard failure (acceptance or landing lace, specks, water / honey / jelly re-form, honey ≥ 1.15× water, slosh floors, the perf ratio), on macOS or in the Docker (Linux) run; no bound is raised without Dennis. W77.5 reads the W77 log lines from the Docker canvas2d run and records the Linux numbers next to the macOS ones, and measures once in the perf project that the frame-ratio guard rejects cap 16 without the grid scaling (`densityCellPx` forced to 2 in a scratch run).

## Tests

Red run (2026-10-11, W77.1, after `npm run build:wasm` and `npm run build -w liquiddom`): cargo `164 passed; 6 failed; 2 ignored` (baseline 170 + 2 ignored); vitest `11 failed | 618 passed | 4 skipped (633)`, 4 failing files (baseline 625 | 4 (629)); `npm run e2e:typecheck` clean; canvas2d (`acceptance.spec.ts` + `landing.spec.ts`) `5 failed | 20 passed | 7 skipped`; webgpu-hw + perf (`-g W77`) `4 failed | 3 passed | 1 skipped`. `--list`: canvas2d 58 (was 49), webgpu 33 (26), webgpu-hw 68 (54), perf 3 (2). With D77-2's constants in a scratch crate copy the Rust tests pass (`170 passed`); with W77.2's code applied to a scratch state of the TS renderers the seven renderer test files pass (`55 passed`). Approved-test changes are marked `W77 red: approved-test change (D77-k …)` in the code.

Red review fixes (2026-10-11, after `.superpowers/sdd/W77/red-review.md`): four new vitest tests (rows 30–33), honey ≥ 1.15× water (row 22), the WebGPU speck test checks that the splash softened "Start free" (row 27), the WebGPU shake re-form starts from rest (row 28). Re-run: cargo `164 passed; 6 failed; 2 ignored` (the six D77-2 pins); vitest `15 failed | 618 passed | 4 skipped (637)`, 4 failing files; `npm run e2e:typecheck` clean; canvas2d (`acceptance.spec.ts` + `landing.spec.ts`) `5 failed | 20 passed | 7 skipped` (same failures, same numbers); webgpu-hw (`webgpu-robust.spec.ts -g W77`) `4 failed | 2 passed` (WebGPU shake from rest: water 131, jelly 111). With the amended W77.2 code applied to a scratch state of the TS renderers the seven renderer test files pass (`59 passed`).

Known approved-test change after red (D77-3, named at the red STOP): W77.3 updates the honey pin in `material-api.test.ts` (`presets.honey` and the `setMaterial.mock.calls` line) to the values the D77-3 procedure finds.

Gold run (2026-10-11, at 17739d2): `npm run verify` green — cargo `170 passed; 0 failed; 2 ignored`, vitest `633 passed | 4 skipped (637)`, clippy clean; `npm run e2e:canvas2d` `49 passed | 9 skipped`; `npm run e2e:webgpu-hw` `45 passed | 23 skipped`; Docker Linux canvas2d `56 passed | 2 skipped`; perf W77 ratio 0.833 (1.501 with the cell forced to 2 px, Step 1b). Guards (macOS Canvas2D / Metal WebGPU / Linux Canvas2D): acceptance lace f10/f20 103/161, 53/79, 103/161 (≤ 300); landing lace 10/42, 0/1, 8/40 (≤ 400); specks 0/0/0 (≤ 16); splash re-form water/honey/jelly 130/155/115, shake 118/152/106 (≤ 180; honey 1.19× water). Baselines moved and approved by Dennis 2026-10-11 (9770e37): acceptance step 2, 3, 4, 6 Canvas2D Linux; step 1, a11y-focus-split and both reduced-motion baselines unchanged. Manual smoke: the demo index's five links on Metal render with a clean console and no fallback info (auto → WebGPU). Ward review (opus, 9de5607..dc53980): ready for gold; Important 1 (atlas gutter claim vs R 16) and Minor 2–4 fixed in 17739d2, Minor 5 (honey margin 1.19 vs 1.15) left for the gold vision check.

| # | Test Name | Verifies | Red outcome | Gold outcome |
|---|-----------|----------|-------------|--------------|
| 1 | material.rs: given_cohesion_0_5_when_mapped_then_0_46_and_bounds_0_02_0_90 | D77-2 cohesion map (approved-test change of W67's 0.16/0.30) | ❌ `TENSION_MAX_MAX` is 0.3, not 0.9 | ✅ |
| 2 | material.rs: given_default_material_when_mapped_then_params_match_spec_defaults | D77-2 default yield 0.46 (approved-test change) | ❌ tension_max 0.16 | ✅ |
| 3 | api.rs: given_set_material_when_called_then_cohesion_applies_globally_only | D77-2 cohesion 1 → 0.90, NaN → 0.46 (approved-test change) | ❌ cohesion 1 gives 0.30 | ✅ |
| 4 | interaction.rs: given_d67_3_and_d70_constants_when_read_then_splash_and_shake_values_pinned | D77-2 amplitude 0.35 (approved-test change of D73-1's pin) | ❌ amplitude 0.5 | ✅ |
| 5 | interaction.rs: given_shake_gain_when_evaluated_across_u_then_it_is_1_plus_0_35_sin_pi_u_plus_phase_within_0_65_and_1_35 | D77-2 gain range (approved-test change) | ❌ gain at u −0.5 is 0.5, not 0.65 | ✅ |
| 6 | interaction.rs: given_shake_when_applied_then_each_element_moves_along_one_seeded_direction_with_a_coherent_sine_profile_across_u_and_no_particle_noise | D77-2 profile fit 0.35 (approved-test change) | ❌ fitted amplitude 0.5 | ✅ |
| 7 | scenario_tests.rs: given_shake_strength_1_when_ticking_30_frames_then_the_rigid_fit_residual_rms_reaches_24px_on_the_card_and_12px_on_each_pill | W70 slosh floors 24/12 → 20/10 (consequence of D77-2; approved by Dennis 2026-10-11, saga dec_a99cad59) | ✅ passes (guard; at D77-2's constants Split 11.52 px would fail the old 12 px floor) | ✅ |
| 8 | kernel-params.test: given_kernel_params_when_read_then_spec_values_and_density_grid_re_exports_them_instead_of_defining_its_own | D77-1 cap 16 (approved-test change) | ❌ cap 8 | ✅ |
| 9 | kernel-params.test: given_a_spacing_when_kernelRadiusPx_then_min_of_the_cap_and_2_3_spacing_and_the_cap_for_non_finite_or_non_positive | D77-1 R = 2.3 × spacing up to 16 px (approved-test change) | ❌ kernelRadiusPx(4) = 8, not 9.2 | ✅ |
| 10 | kernel-params.test: given_the_largest_kernel_radius_when_densityCellPx_then_max_of_2px_and_ceil_R_over_4_with_bad_or_oversized_radii_taking_the_cap | D77-1 grid rule | ❌ `DENSITY_CELLS_PER_RADIUS` undefined | ✅ |
| 11 | kernel-params.test: given_a_splat_at_R_on_the_densityCellPx_R_grid_when_counting_touched_cells_then_at_most_1_15x_a_splat_at_8px_on_the_2px_grid | D77-1 flat splat cost | ❌ `densityCellPx is not a function` | ✅ |
| 12 | kernel-params.test: given_paints_whose_largest_kernel_radius_changes_when_rendering_then_the_grid_cell_follows_densityCellPx_and_the_buffer_is_reallocated_only_on_a_change | D77-1 renderer cell, no per-frame reallocation | ❌ `renderer.densityCellPx` undefined | ✅ |
| 13 | density-grid.test: given_kernel_constants_when_read_then_pinned_to_spec_values | D77-1 cap pin (approved-test change) | ❌ cap 8 | ✅ |
| 14 | density-grid.test: given_radius_request_above_16px_when_splatting_then_capped_at_16px | D77-1 cap in the grid (approved-test change of "capped at 8 px") | ❌ density 14 px away is 0 | ✅ |
| 15 | webgpu-shaders.test: given_SPLAT_WGSL_when_read_then_it_embeds_the_shared_kernel_cap… | D77-1 WGSL cap 16.0 (approved-test change) | ❌ `8.0` | ✅ |
| 16 | webgpu-shaders.test: given_TEXT_WGSL_when_read_then_it_splats_t1_and_t1w_with_the_liquids_kernel… | D77-1 WGSL cap 16.0 (approved-test change) | ❌ `8.0` | ✅ |
| 17 | wdd-docs: given_demo_index_when_read_then_its_heading_says_slice_4_and_it_links_the_landing_scene | D77-4 landing link with `?renderer=auto` (approved-test change of the W76 pin) | ❌ href is `scenes/landing.html` | ✅ |
| 18 | wdd-docs: given_demo_index_when_read_then_acceptance_landing_splash_and_playground_are_linked_with_renderer_auto | D77-4 four links, scene default canvas2d | ❌ `scenes/acceptance.html?renderer=auto` missing | ✅ |
| 19 | e2e acceptance (canvas2d): step 6 – … the card shows no lace: tear pixels at f10 and f20 within the D77-2 bounds | D77-2 acceptance lace ≤ 300 (approved-test change of D73-3's 1699 / 915) | ❌ 1175 / 831 | ✅ |
| 20 | e2e acceptance (canvas2d): D77-3 – given the water / honey / jelly preset when Splash is splashed … within the NORTH-STAR step-3 budget (3 tests) | D77-3 splash re-form ≤ 180 | ❌ honey −1 (285 at W77.0); water 135 and jelly 123 ✅ (guards) | ✅ |
| 21 | e2e acceptance (canvas2d): D77-2 – given the water / honey / jelly preset when the instance shakes … within the NORTH-STAR step-6 budget (3 tests) | D77-2/D77-3 shake re-form ≤ 180 after the remap | ❌ honey −1 (279); water 131 and jelly 111 ✅ (guards) | ✅ |
| 22 | e2e acceptance (canvas2d): D77-3 – given honey and water when Splash is splashed then honey re-forms at least 1.15× as slowly as water | D77-3 honey still thicker (red review: ≥ 1.15×, was `>`) | ✅ passes (guard: 285 vs 135, ratio 2.11) | ✅ |
| 23 | e2e landing (canvas2d): D77-2 – … the dark card shows no lace: region tear pixels at f10 and f20 within the W77 bound | D77-2 landing lace ≤ 400 | ❌ 5232 / 1805 | ✅ |
| 24 | e2e landing (canvas2d): D77-1 – given a splash on Start free when ticking then Book a demo shows no specks | D77-1 specks ≤ 16 px | ❌ peak 307 px (f20) | ✅ |
| 25 | e2e webgpu-robust (webgpu-hw): W77 D77-2 step 6 – … acceptance card shows no lace | D77-2 in WebGPU | ❌ 972 / 573 | ✅ |
| 26 | e2e webgpu-robust (webgpu-hw): W77 D77-2 – … landing … dark card shows no lace | D77-2 in WebGPU | ❌ 3938 / 1316 | ✅ |
| 27 | e2e webgpu-robust (webgpu-hw): W77 D77-1 – … Book a demo shows no specks | D77-1 in WebGPU; the splash softened "Start free" at f2 (red review) | ❌ peak 238 px | ✅ |
| 28 | e2e webgpu-robust (webgpu-hw): W77 D77-3 – given renderer webgpu and the water / honey / jelly preset when Splash is splashed, and from rest the instance shakes, then each re-forms within the NORTH-STAR budgets (3 tests) | D77-2/D77-3 in WebGPU; the shake starts from rest on a fresh scene (red review) | ❌ honey −1 / −1; water 135 / 131 and jelly 123 / 111 ✅ | ✅ |
| 29 | e2e perf (perf): perf – W77 D77-1: the Canvas2D frame on the landing shake costs at most the W77.0 baseline + 15 % | D77-1 grid scaling keeps Canvas2D cost flat (ratio ≤ 1.29) | ✅ passes (guard, ratio 1.119; skips in webgpu-hw) | ✅ |
| 30 | kernel-params.test: given_the_largest_and_smallest_kernel_radius_when_densityCellPx_then_the_cell_is_never_coarser_than_the_finest_spacing | D77-1 grid rule bounded by the smallest kernel radius (red review finding 2; D71-5) | ❌ `cell is not a function` | ✅ |
| 31 | kernel-params.test: given_a_paint_without_particles_or_with_a_non_positive_spacing_when_rendering_then_it_does_not_coarsen_the_grid | D77-1 `fitCell` skips zero-particle and bad-spacing paints (red review finding 1) | ❌ `renderer.densityCellPx` undefined | ✅ |
| 32 | kernel-params.test: given_paints_with_mixed_spacings_when_rendering_then_the_cell_is_bounded_by_the_smallest_kernel_radius_and_each_splat_keeps_its_own_radius | D77-1 mixed spacings: cell 2.5 px, not 3.75 (red review finding 2) | ❌ `renderer.densityCellPx` undefined | ✅ |
| 33 | density-grid.test: given_a_spacing_8_lattice_whose_radius_18_4_is_capped_at_16px_when_splatted_then_the_interior_still_integrates_to_1 | D77-1 capped lattice still integrates to ≈ 1 (red review finding 9) | ❌ cap 8 | ✅ |

## Must NOT
- Change any resting frame (step 1, a11y focus, reduced-motion baselines) or the exact rounded rect at rest.
- Let re-form exceed the NORTH-STAR budgets or remove the visible slosh.
- Change the two renderers' kernels apart (one kernel-params.ts, D71-5).

## Must DO
- Measure every lever before red (W77.0) on the acceptance card, the landing dark card and the splash neighbour, and record it here.
- Regenerate only the Canvas2D Linux baselines the change moves, with Dennis' vision approval (D65-7).
- Re-check water, honey and jelly re-form after the cohesion remap.

## Manual Smoke Test
Open http://localhost:3001/scenes/landing.html?renderer=auto and the acceptance scene; shake and splash: closed bodies, no lace, no specks next to a splash.

## Verification
npm run verify, npm run e2e:canvas2d, npm run e2e:webgpu-hw, Docker canvas2d baselines, vision on shake and splash in both renderers.

**Resolved at gold (Dennis, 2026-10-11):** gold approved; step 6 (shake) ruled ✅ in both renderers. Open, not fixed in W77: Canvas2D stair-stepped edge at the 3.5 px cell, the dark landing card reaching past the viewport edge under shake, "Book a demo" drawn into a bead chain at f20, faint residual lace.
