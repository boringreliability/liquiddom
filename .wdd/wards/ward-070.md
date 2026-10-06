---
ward: 70
revision: null
name: "Slice 2 fix: sloshing shake, readable bulge, clean cross-fade"
epic: "fluid-engine"
status: "planned"
dependencies: [69]
layer: "both"
estimated_tests: 0
created: "2026-10-06"
completed: null
---
# Ward 070: Slice 2 fix: sloshing shake, readable bulge, clean cross-fade

North star: steps 2 (pointer sweep: soft bulge, no holes) and 6 (shake: everything sloshes) move from ❌ to ✅ in canvas2d. Step 8 joins the recording.

## Scope
The whole-picture check after slice 2 (`.wdd/memory/whole-picture/slice-2.md`, W69) observed both steps as "motion yes, experience no". Step 2's bulge is not readable (centroid shift 0.14–1.22 px). Step 6 moves intact blobs instead of sloshing. Dennis chose a small fix ward before slice 3, because both are solver behaviour, independent of the renderer, and slice 3 should not be built on a feel that doesn't hold yet.

This ward fixes four things:
- the shake impulse shape and its stiffness cap;
- the pointer drag constant;
- the Canvas2D restAlpha cross-fade dip that shows as a pale flash on every hover and re-form;
- the recording, which gets the step-8 (reduced-motion) segment.

It ends with an updated whole-picture addendum for steps 2, 6 and 8. Out of scope: the DOM-text halo (goes to slice 4 with liquid text), the honey preset (after Dennis' playground session), furry edges (slice 3), ring density (slice 6).

## Inputs
- W67 `interaction.rs` shake (`SHAKE_SPEED_PX_S = 520`, `SHAKE_NOISE = 0.9`, `SHAKE_STIFFNESS_CAP = 0.4`) and its re-form tests. The 3 s budget comes from D67-1.
- W68 pointer field (`POINTER_DRAG_PER_S = 6.0`, `POINTER_RADIUS_PX = 70`), its no-hole tests, and the pointer-only centroid e2e (threshold 0.35 px).
- `renderers/fluid-canvas2d.ts` and `density-grid.ts`: the density is weighted by `1 − restAlpha` before the 0.4–0.6 smoothstep.
- W69 `e2e/record.spec.ts`, `scripts/webm-to-gif.mjs`, the slice-2 report and its Carried rows.

## Outputs
- Changed constants and shake impulse in `src/fluid/interaction.rs`, plus the cross-fade rule in the Canvas2D renderer.
- Measurable "slosh" and "bulge" tests in Rust and e2e.
- A step-8 segment in the recording, plus `.wdd/memory/whole-picture/slice-2-addendum.md` with the re-recorded GIF.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). Presented to Dennis in chat; record with saga_record_decision; then APPROVED/AMENDED + NORTH-STAR "Plan decisions" row. The ward cannot move to red while any line says PENDING. -->
### D70-1: Spatially coherent shake impulse
Proposal: each element gets one seeded direction `d` and phase `φ`. A particle at local position `u = (x − cx) / (w / 2)` gets velocity `d · speed · (1 + A · sin(π · u + φ))` in grid units (`speed · g.inv_cell`), with `A = 0.8`. This replaces the per-particle white noise (`SHAKE_NOISE`), which averages out. There is no rotation term, because that would be rigid motion.
Consequence: the element bends and waves instead of translating intact. The impulse stays deterministic per seed. The W67 shake tests (re-form ≤ 3 s, no NaN, determinism) remain the guard; tests that pin `SHAKE_NOISE` are updated.
Decision: PENDING

### D70-2: Lower the shake stiffness cap
Proposal: `SHAKE_STIFFNESS_CAP` 0.4 → 0.15, so a shaken element keeps 15 % instead of 40 % of its stiffness. The final value in [0.1, 0.2] is picked in this ward as the highest that passes the D70-5 slosh metric.
Consequence: the element goes softer during a shake and sloshes more. Re-form starts from a lower stiffness, so the 3 s shake budget (D67-1) is the guard. If 0.1–0.2 cannot meet it, the ward stops and asks.
Decision: PENDING

### D70-3: Raise the pointer drag
Proposal: raise `POINTER_DRAG_PER_S` from 6.0 to the lowest value in [12, 24] for which a 600 px/s sweep across a resting pill gives a mid-sweep centroid shift of ≥ 3 px. The W68 no-hole tests and the step-2 re-form within 3 s must stay green. The value is picked in this ward from a measured sweep (at 6.0 it was 0.14–1.22 px). `POINTER_RADIUS_PX` stays 70.
Consequence: the bulge becomes readable. A higher drag also damps moving liquid under a still pointer more (−v·k). Doc comments that quote "6 · dt" are updated.
Decision: PENDING

### D70-4: Full density weight during the Canvas2D cross-fade
Proposal: while `restAlpha < 1`, the density field is drawn at full weight, with no `1 − restAlpha` scaling before the smoothstep. The rest `roundRect` is still drawn at `globalAlpha = restAlpha` on top.
Consequence: no translucent fill mid-transition. Today the dip is ~151/255 at restAlpha 0.58, seen as a pale flash on hover and at the end of re-form. The trade-off: during the fade, the moving liquid's soft edge shows under the crisp contour until rest. That is the same edge the liquid has while moving.
Decision: PENDING

### D70-5: Make "experience" measurable for steps 2 and 6
Proposal:
- **Slosh (Rust scenario test).** At the shake peak, fit the best rigid translation to each element's particle displacements. The RMS of the residual, non-rigid displacement must be ≥ 6 px for the card and ≥ 3 px for each pill, against ~0 for a rigid slide. The thresholds are set from the measured W69 baseline (red) and the D70-1/2 result.
- **Bulge (e2e).** Raise the pointer-only centroid threshold from 0.35 px to 3 px.
Consequence: the ❌ in the slice-2 report becomes a test that fails today and passes when the experience is met. The thresholds are numbers, not taste, so they get vision-checked at gold.
Decision: PENDING

### D70-6: Step 8 in the recording plus a slice-2 addendum
Proposal:
- The record spec appends a reduced-motion segment (`?rm=1`): a click and a shake show no motion, and the scene stays crisp.
- At the end of the ward the acceptance scene is re-recorded, and `.wdd/memory/whole-picture/slice-2-addendum.md` re-rates steps 2, 6 and 8 with evidence.
- The W69 report itself is not rewritten.
Consequence: the recorded steps match NORTH-STAR (1–4, 6 and 8). There is no new full whole-picture check; the next one is after slice 4, per the rule.
Decision: PENDING

## Specification
To be written after the direction gate (plan: `docs/superpowers/plans/2026-10-03-fluid-slices-1-2/W70.md`).

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | (written at red) | |

## Must NOT
- Change the renderer beyond D70-4, or touch WebGPU (slice 3).
- Change public API shapes; `presets` values stay as they are (honey waits for Dennis).
- Weaken the W67/W68 guards: re-form ≤ 3 s, no holes, no NaN, determinism.

## Must DO
- Gate D70-1 … D70-6 before `wdd ward status 70 red`, and log them in NORTH-STAR.
- Pick the final constants by measurement inside the ward, and record them in the gold notes.
- Vision-check the re-recorded GIF frames for steps 2 and 6 at gold.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run dev`

### Steps
1. Open `/scenes/acceptance.html`, sweep the mouse across the pills.
   Verify: each pill visibly bulges along the sweep, no holes.
2. In the console: `__liquidTest.instance.shake()`.
   Verify: elements bend and wave (slosh), not slide as intact blobs; all re-form within 3 s.
3. Hover Split and Merge.
   Verify: no pale flash.

### Pass criteria
- [ ] Steps 2 and 6 read as the north star describes in the re-recorded GIF.
- [ ] `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:dist` are green.

## Verification
`npm run verify`, canvas2d and dist e2e are green; the slice-2 addendum rates steps 2 and 6 with evidence; Dennis approves.
