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
Decision: PENDING

### D77-2: The sheet thins instead of tearing (physics)
Proposal: the default stretch yield `tension_max` rises from 0.16 to ≈0.46 (cohesion 0.5 → 0.46 via the cohesion map, `TENSION_MAX_MAX` 0.30 → 0.90), and `SHAKE_PROFILE_AMPLITUDE` drops from 0.5 to 0.35 (D73-1 amended again); the W73 lace guard tightens to the new level (acceptance card ≤ ≈300 tear px at f10/f20) and gains a landing-page guard.
Consequence: with D77-1 the acceptance card goes 1145/815 → 99/176 tear px and the landing dark card to 0; re-form ≤ 139 frames; tick p95 ≈4.6 ms. Shake slosh drops ≈30 % but stays visibly a bend. Splash rims shed fewer droplets (7 → 2 fragments at f6). The cohesion remap shifts the water/honey/jelly presets; they are re-measured in W77.
Decision: PENDING

### D77-3: Honey re-forms within the budget
Proposal: retune the honey preset (recovery/viscosity) so its re-form after the acceptance splash is ≤ 180 frames (3 s) in both renderers while it still reads as slower and thicker than water; measured after D77-2's cohesion remap.
Consequence: closes the carried W73 item (285 frames); honey becomes a little quicker. The playground's stored `liquiddom-playground-v2` values stay valid (only preset defaults change).
Decision: PENDING

### D77-4: The demo index opens scenes as a library user sees them
Proposal: `demo/index.html` links the acceptance, splash, playground and landing scenes with `?renderer=auto` (WebGPU on a hardware adapter, Canvas2D otherwise); the scenes' own default stays `canvas2d` so every test knows its renderer.
Consequence: a person opening the demo sees the default renderer; one approved test changes (the W76 pin of the landing link in `wdd-docs.test.ts`).
Decision: PENDING

## Specification
To be written in the W77 plan after the gate.

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

