---
ward: 73
revision: null
name: "Shake without lace"
epic: "fluid-engine"
status: "approved"
dependencies: [72]
layer: "both"
estimated_tests: 3
created: "2026-10-09"
completed: null
---
# Ward 073: Shake without lace

North star: step 6 (shake) in both renderers — the card sloshes as one body instead of tearing into a lace.

## Scope
Fix ward after slice 3 (Dennis 2026-10-08, saga dec_3342ac32, direction A+B dec_cbc490b2). During shake the card tears into a diagonal lace: the D70-1 profile `1 + 0.8·sin(πu + φ)` stretches it along x up to 3.1× in one band and the tensile yield does not resist, so lattice rows separate into slits and, from f20, true voids. Root cause and evidence: W73 investigation (physics, identical in both renderers at the same manual frame; the W72-gold note "WebGPU reveals lace Canvas2D hides" was wrong — those stills came from different RAF moments). Pre-plan sweep (24 variants × seeds 1–3, Metal): amplitude is the lever; the stiffness cap removes the void tail; higher tension merges slits into bigger holes and shortens splash filaments. This ward changes two Rust constants, guards the result with a blocking lace test, and updates the docs.

## Inputs
- `src/fluid/interaction.rs`: `SHAKE_PROFILE_AMPLITUDE` (0.8), `SHAKE_STIFFNESS_CAP` (0.2), `shake_gain`, pinned in `interaction::w67_tests`.
- Scenario slosh tests (`src/fluid/scenario_tests.rs`, D70-5: card ≥ 24 px, pills ≥ 12 px), the 3 s re-form budget (D67-1), the acceptance e2e (`e2e/acceptance.spec.ts`, step 6).
- W73 investigation and sweep: `findings.md`, `measurements.json`, `sweep/results.md` (session scratchpad; numbers copied below).

## Outputs
- Amplitude 0.5 and stiffness cap 0.3 in Rust; a blocking Canvas2D lace guard; spec §2, CLAUDE.md, NORTH-STAR and CONTEXT updated.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D73-1: Shake profile amplitude 0.8 → 0.5 (amends D70-1)
Proposal: `SHAKE_PROFILE_AMPLITUDE = 0.5`, so the per-element speed profile is `1 + 0.5·sin(π·u + φ)`. Sweep (mean over seeds 1–3): card tear px f10 3760 → 703, f20 1501 → 404 (with D73-2: 355), true voids f20 1343 → 471, f40 112 → 0; slosh worst seed card 30.7 / pills 14.9 (bars 24 / 12).
Consequence: the shake still sloshes but stretches less; the card keeps a few scattered bubbles instead of a lace. Four pinned tests in `interaction::w67_tests` change (the D70 constants and the gain range 0.2–1.8 → 0.5–1.5). Dennis chose 0.5 over 0.4 for the slosh margin.
Decision: APPROVED 2026-10-09 — amplitude 0.5 (Dennis chose 0.5/0.16/0.3 from the sweep) (saga dec_4772155d)

### D73-2: Shake stiffness cap 0.2 → 0.3, tension unchanged (amends D70-2)
Proposal: `SHAKE_STIFFNESS_CAP = 0.3` (`shake` sets `s ← min(s, 0.3)`); the tensile yield (`tension_max` 0.16 at default cohesion) stays.
Consequence: removes the f40 void tail and shortens shake re-form 152 → 136 frames; costs ~10 % slosh (included in D73-1's numbers). Higher tension was rejected: it merges slits into fewer, larger holes at moderate amplitude, shortens splash filaments ~30 % at f30 and would need a new material mapping (0.35 > the current max 0.30).
Decision: APPROVED 2026-10-09 — cap 0.3, tension unchanged (saga dec_08c9b89c)

### D73-3: A blocking lace guard in the Canvas2D acceptance suite
Proposal: a new canvas2d e2e test in `e2e/acceptance.spec.ts` (manual clock, seed 1, the step-6 shake) that counts tear pixels inside the card (background-coloured pixels enclosed by the card's silhouette, the investigation's method) at f10 and f20 and asserts each ≤ 1.5 × the value measured at gold on seed 1 and ≤ 50 % of today's value. Canvas2D shows the same lace as WebGPU at the same frame (investigation), so the guard runs in CI (blocking) and covers both renderers.
Consequence: one more blocking e2e test (~2 s); a future change to shake, material or kernel that brings the lace back fails CI. The thresholds are pinned from measurement, like D70-5.
Decision: APPROVED 2026-10-09 — blocking canvas2d lace guard at f10/f20, ≤ 1.5 × measured and ≤ 50 % of today (saga dec_81494c68)

## Specification
- `src/fluid/interaction.rs`: `SHAKE_PROFILE_AMPLITUDE: f32 = 0.5`, `SHAKE_STIFFNESS_CAP: f32 = 0.3`; doc comments name D73-1/D73-2.
- `interaction::w67_tests`: the four tests pinning D70-1/D70-2 values are updated to the D73 values (approved-test changes, flagged at red): constants pin, `shake_gain` range `[0.5, 1.5]`, the coherent-profile test's expected bounds, `s ≤ 0.3` after shake.
- Slosh scenario tests unchanged (bars 24 / 12 still hold: seed 1 ≈ 30 / 14).
- Re-form budgets unchanged (3 s).
- Lace guard (D73-3) in the canvas2d project.
- Docs: spec §2 shake row (`1 + 0.5·sin`, "amended in W73, D73-1") and the damage rule (`s ← min(s, 0.3)`, D73-2); CLAUDE.md Interim-state formula; NORTH-STAR plan-decision rows D73-1..3 and the D70-1/D70-2 rows marked superseded; CONTEXT (W72 lace note corrected; honey preset re-form 279–292 frames > 3 s budget recorded as a pre-existing open item for Dennis' playground session).
- Gold: Canvas2D and WebGPU (Metal) stills of step 6 at the same manual frames f10/f20/f40 vs today, inspected with vision; re-record `npm run record:w72` GIFs.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | interaction::w67_tests (4 pinned tests, updated) | D73-1/D73-2 constants, gain range, profile bounds, s ≤ 0.3 |
| 2 | e2e canvas2d: step 6 – lace guard at f10 and f20 | D73-3 tear pixels within the pinned bound |
| 3 | scenario_tests slosh (unchanged) | card ≥ 24 px, pills ≥ 12 px still hold |

## Must NOT
- Change the tensile yield, material mapping or presets.
- Change renderer kernel, threshold or T0 (D71-4/D71-5 stay).
- Loosen the slosh bars (D70-5) or the 3 s re-form budget.

## Must DO
- Compare renderers only at the same manual-clock frame.
- Flag every changed approved test at red.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run dev`

### Steps
1. Open `/scenes/acceptance.html?seed=1&renderer=webgpu` and press Shake.
   Verify: the card sloshes as one body; at most a few small bubbles, no diagonal lace.
2. Same with `renderer=canvas2d`.
   Verify: same shape and bubbles.

### Pass criteria
- [ ] No lace in the card during shake in either renderer (vision, same frames).
- [ ] Slosh still clearly visible; re-form within 3 s.

## Verification
`cargo test` (incl. the updated pins and slosh scenarios), `npm run clippy`, `npm test`, `npm run e2e:canvas2d` (incl. the lace guard), `npm run e2e:webgpu-hw`, vision of step-6 stills in both renderers; ward review; gold STOP.

## Gold notes

**Totals (2026-10-09):** cargo 151 passed + 1 ignored (incl. the 4 updated D73 pins and the slosh scenarios); clippy clean; vitest 529 passed | 4 skipped; `e2e:canvas2d` 28 passed / 9 skipped (incl. the D73-3 lace guard); `e2e:dist` 1 passed; `e2e:webgpu-hw` 24 passed; `e2e:typecheck` clean; `wdd validate` passed. Rust re-form evidence: shake 126 (+10) frames, splash 135 (+10) frames.

**Lace guard (D73-3):** card tear pixels seed 1 f10 = 1171 (bound 1699), f20 = 842 (bound 915); identical on macOS and in the pinned Linux image (deterministic). Before the fix: 4921 / 2430.

**Vision (same manual-clock frames, seeds 1 and 2, Canvas2D and WebGPU on Metal; scratchpad w73/gold/sidebyside_seed{1,2}.png):** f10 the dense diagonal slit net is gone (a few short marks remain); f20 a handful of small diamond bubbles instead of the lace; f40 the card is whole (before: holes still open); Merge's droplet chain at f20 is one body. Both renderers identical in every row. Slosh still clearly visible. GIFs re-recorded (`npm run record:w72`).

**Correction recorded:** the W72-gold note that WebGPU reveals lace Canvas2D hides was wrong (stills from different RAF moments); the lace was physics (D70-1 stretch), now fixed in both renderers.

**Reviews:** red review APPROVED (no blocking findings); ward review 0 high / 0 medium / 3 low — stale slosh comment fixed (scenario_tests.rs), CONTEXT byte trim accepted, honey open item deliberate.

**Open (pre-existing, for Dennis):** the honey preset re-forms in 279–292 frames, above the 3 s budget (CONTEXT).
