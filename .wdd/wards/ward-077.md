---
ward: 77
revision: null
name: "Closed liquid under shake and splash"
epic: "fluid-engine"
status: "planned"
dependencies: [76]
layer: "both"
estimated_tests: 10
created: "2026-10-10"
completed: null
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
- Tightened lace guard (acceptance card) plus a landing lace guard and a neighbour-speck guard; NORTH-STAR step 6 back to ✅ after vision at gold.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D77-1: Kernel reach follows the particle spacing (render, both renderers)
Proposal: the shared kernel radius stays 2.3 × the particle spacing, with `KERNEL_RADIUS_CAP_PX` raised from 8 to 16 px (D71-5 amended); the Canvas2D density grid cell scales with R so its splat cost per frame stays flat on large-area pages.
Consequence: the neighbour specks after a splash vanish (347 → 0 px in the spike), landing lace drops ≈92 % at f10; the acceptance scene does not change (R there is 7.09 px). WebGPU overdraw on large-area pages rises ≈2.4× (frame time unchanged on Metal); without the grid scaling Canvas2D would cost ≈12 → 21.5 ms per frame on the landing page. At rest nothing changes (exact rounded rect).
Decision: APPROVED 2026-10-10 — kernel 2.3 × spacing, cap 8 → 16 px (D71-5 amended), Canvas2D density grid scales with R (saga dec_279c7763)

### D77-2: The sheet thins instead of tearing (physics)
Proposal: the default stretch yield `tension_max` rises from 0.16 to ≈0.46 (cohesion 0.5 → 0.46 via the cohesion map, `TENSION_MAX_MAX` 0.30 → 0.90), and `SHAKE_PROFILE_AMPLITUDE` drops from 0.5 to 0.35 (D73-1 amended again); the W73 lace guard tightens to the new level (acceptance card ≤ ≈300 tear px at f10/f20) and gains a landing-page guard.
Consequence: with D77-1 the acceptance card goes 1145/815 → 99/176 tear px and the landing dark card to 0; re-form ≤ 139 frames; tick p95 ≈4.6 ms. Shake slosh drops ≈30 % but stays visibly a bend. Splash rims shed fewer droplets (7 → 2 fragments at f6). The cohesion remap shifts the water/honey/jelly presets; they are re-measured in W77.
Decision: APPROVED 2026-10-10 — tension_max ≈0.46 (TENSION_MAX_MAX 0.30 → 0.90), shake amplitude 0.35 (D73-1 amended), tighter lace guard + landing guard (saga dec_3ba590a1)

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
| Re-form after `shake()` (frames), default / water / honey / jelly | same, `shake()` | 142 / 129 / **279** / 106 | 142 / 129 / **279** / 106 |
| Frame cost on the shake, median wall ms of `advance(1)` over f1–40 (3 runs) | acceptance / landing | 22.06–22.81 / 24.81–25.54 (medians 22.53 / 25.10, ratio 1.114; a first run 1.122) | 4.35–4.41 / 4.48–4.69 |

The spike's numbers (its table above) used the chromium channel and a margin of 80 px; the guard margin is 40 px because at 80 px the region reaches the corner of "Book a demo" (`#111827` as well, 48 px from the dark card). The headless shell's absolute Canvas2D frame cost differs from the spike's (22 vs 10 ms), so the frame-cost guard is normalised by the acceptance shake, which D77-1 leaves alone (R 7.09 px, 2 px grid).

**Rust at D77-2's constants (scratch copy, never the worktree):** `TENSION_MAX_MAX 0.90` + `SHAKE_PROFILE_AMPLITUDE 0.35` fails exactly the six pins the red changes below and the W70 slosh floor: peak non-rigid RMS [Splash, Split, Merge, card] = [16.46, **11.52**, 21.90, 25.39] px (today [21.42, 14.88, 31.59, 36.65]) against floors 12 / 24. Re-form evidence there: splash 129 (+10), shake 130 (+10), D74-2 splash 139 frames (today 135 / 126 / 145). With the red tests applied the scratch copy passes `170 passed; 0 failed; 2 ignored`.

**Guard thresholds (red):**
- Acceptance card lace (D77-2, approved-test change of D73-3's 1699 / 915): ≤ **300** tear px at f10 and at f20 (spike 99 / 176: 3.0× / 1.7× margin; 26 % / 36 % of today). Canvas2D blocking, WebGPU in webgpu-hw.
- Landing dark card lace (D77-2): ≤ **400** region tear px at f10 and at f20 (spike 8 / 40 at margin 80; 7.6 % / 22 % of today). The spike had no Canvas2D grid scaling (D77-1's 3.5 px cells on this page, set by the pills' R 13.04 px), hence the wider margin. Canvas2D blocking (`landing.spec.ts`), WebGPU in webgpu-hw.
- Neighbour specks (D77-1): peak ≤ **16** px inside "Book a demo" over f1–60 after a splash on "Start free" (spike 0 with cap 16; today 307 / 238). Canvas2D blocking, WebGPU in webgpu-hw.
- Re-form (D77-2, D77-3): water, honey and jelly re-form within the NORTH-STAR step-3 (splash) and step-6 (shake) budgets, 180 frames each, read from `.wdd/NORTH-STAR.md`; honey's splash re-form stays longer than water's. Canvas2D blocking, WebGPU in webgpu-hw.
- Canvas2D frame cost (D77-1): median landing-shake frame / median acceptance-shake frame ≤ **1.29** = baseline 1.12 × 1.15 (perf project, non-blocking; the spike's cap 16 without the grid scaling, +78 % on the landing page, fails it).
- Slosh floors (W70 D70-5, consequence of D77-2): card 24 → **20** px, pills 12 → **10** px (still 1.5× W67's white-noise peak 6.64 px). Dennis confirms at red.

**D77-1 grid rule (W77.2):** `densityCellPx(R) = max(2, ceil(min(R, 16)) / 4)` CSS px for the largest kernel radius R among the frame's paints (a bad R takes the cap); the Canvas2D renderer reallocates its density buffer only when that cell changes. Acceptance R 7.09–7.36 px → 2 px (unchanged); landing R 12.47 / 13.04 px → 3.25 / 3.5 px, so the landing page (largest R 13.04) runs at 3.5 px; R 16 → 4 px. A splat touches ≈ π·(R/cell)² ≈ 50 cells at every R, as at R 8 px on 2 px cells.

**D77-3 procedure (W77.3):** after D77-2, measure honey's splash and shake re-form (canvas2d manual clock, seed 1, the W77 e2e helper); lower `recovery` from 1.6 s in steps of 0.2 s with viscosity 0.9 and cohesion 0.7 fixed until both are ≤ 165 frames (15-frame margin under 180); if recovery reaches 0.8 s (water's 0.5 s + 0.3 s) without it, lower viscosity in steps of 0.05 instead; stop at the first pair that passes and keeps honey's splash re-form > water's. Pin the result in `material-api.test.ts` (approved-test change of W68's pin, D77-3).

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | to be planned after the gate | |

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

