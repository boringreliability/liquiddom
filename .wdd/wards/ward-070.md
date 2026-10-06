---
ward: 70
revision: null
name: "Slice 2 fix: sloshing shake, readable bulge, clean cross-fade"
epic: "fluid-engine"
status: "red"
dependencies: [69]
layer: "both"
estimated_tests: 18
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
Decision: APPROVED 2026-10-06 — coherent per-element shake field d·speed·(1 + 0.8·sin(π·u + φ)), no white noise, no rotation (saga dec_d54a6ce1)

### D70-2: Lower the shake stiffness cap
Proposal: `SHAKE_STIFFNESS_CAP` 0.4 → 0.15, so a shaken element keeps 15 % instead of 40 % of its stiffness. The final value in [0.1, 0.2] is picked in this ward as the highest that passes the D70-5 slosh metric.
Consequence: the element goes softer during a shake and sloshes more. Re-form starts from a lower stiffness, so the 3 s shake budget (D67-1) is the guard. If 0.1–0.2 cannot meet it, the ward stops and asks.
Decision: APPROVED 2026-10-06 — SHAKE_STIFFNESS_CAP 0.4 → ~0.15, final in [0.1, 0.2] by measurement (saga dec_0412fd9a)

### D70-3: Raise the pointer drag
Proposal: raise `POINTER_DRAG_PER_S` from 6.0 to the lowest value in [12, 24] for which a 600 px/s sweep across a resting pill gives a mid-sweep centroid shift of ≥ 3 px. The W68 no-hole tests and the step-2 re-form within 3 s must stay green. The value is picked in this ward from a measured sweep (at 6.0 it was 0.14–1.22 px). `POINTER_RADIUS_PX` stays 70.
Consequence: the bulge becomes readable. A higher drag also damps moving liquid under a still pointer more (−v·k). Doc comments that quote "6 · dt" are updated.
Decision: AMENDED 2026-10-06 — `POINTER_DRAG_PER_S` 12 (Option A after measurement: the pointer-only sweep cannot reach 3 px at any drag 12–24; drag 12 gives a 6.3–6.8 px bulge across the pills with no interior hole, 18+ makes holes) (saga dec_7db9a25c)

### D70-4: Full density weight during the Canvas2D cross-fade
Proposal: while `restAlpha < 1`, the density field is drawn at full weight, with no `1 − restAlpha` scaling before the smoothstep. The rest `roundRect` is still drawn at `globalAlpha = restAlpha` on top.
Consequence: no translucent fill mid-transition. Today the dip is ~151/255 at restAlpha 0.58, seen as a pale flash on hover and at the end of re-form. The trade-off: during the fade, the moving liquid's soft edge shows under the crisp contour until rest. That is the same edge the liquid has while moving.
Decision: APPROVED 2026-10-06 — full density weight while restAlpha < 1, roundRect at restAlpha on top (saga dec_b98514b2)

### D70-5: Make "experience" measurable for steps 2 and 6
Proposal:
- **Slosh (Rust scenario test).** At the shake peak, fit the best rigid motion (2D Procrustes: translation plus rotation) to each element's particles. The RMS of the residual, non-rigid displacement must be ≥ 6 px for the card and ≥ 3 px for each pill, against ~0 for a rigid slide. The thresholds are set from the measured W69 baseline (red) and the D70-1/2 result.
- **Bulge (e2e).** Raise the pointer-only centroid threshold from 0.35 px to 3 px.
Consequence: the ❌ in the slice-2 report becomes a test that fails today and passes when the experience is met. The thresholds are numbers, not taste, so they get vision-checked at gold.
Decision: AMENDED 2026-10-06 — bulge ≥ 5 px per pill on an across-the-pills sweep (Rust and e2e), pointer-only e2e stays a 0.35 px guard, W68 e2e no-hole margin 6 → 10 px; slosh ≥ 24 px card and ≥ 12 px pills (the old 6/3 px already passed today); cap 0.2 (saga dec_7db9a25c)

### D70-6: Step 8 in the recording plus a slice-2 addendum
Proposal:
- The record spec appends a reduced-motion segment (`?rm=1`): a click and a shake show no motion, and the scene stays crisp.
- At the end of the ward the acceptance scene is re-recorded, and `.wdd/memory/whole-picture/slice-2-addendum.md` re-rates steps 2, 6 and 8 with evidence.
- The W69 report itself is not rewritten.
Consequence: the recorded steps match NORTH-STAR (1–4, 6 and 8). There is no new full whole-picture check; the next one is after slice 4, per the rule.
Decision: APPROVED 2026-10-06 — ?rm=1 segment in the recording, re-record, slice-2 addendum for steps 2, 6, 8 (saga dec_40e9ea63)

## Specification
Plan: `docs/superpowers/plans/2026-10-03-fluid-slices-1-2/W70.md`. Its pre-plan measurements set every threshold below. **Blocker before red:** as approved, D70-3 and D70-5 cannot both be met. The bulge e2e reaches at most 1.87 px at drag 24, and the W68 e2e no-hole test fails at every drag ≥ 8. The values below are the plan's Option A (A1–A4); Dennis confirms or amends them in W70.0.
- **Shake (D70-1):** each active element gets `ShakeField { dir, phase }` from `Rng::derive(stream, id)`. The direction is W67's first draw; the phase is the second draw. Each particle gets `Δv = dir · 520 · strength · (1 + 0.8 · sin(π·u + φ))` in grid units, with `u = (x − cx)/(w/2)` from the home rect. There is no per-particle noise (`SHAKE_NOISE` is deleted) and no rotation. `shake_gain(u, φ)` lies in [0.2, 1.8], and non-finite input gives 1. The field is deterministic per seed.
- **Cap (D70-2):** `SHAKE_STIFFNESS_CAP = 0.2`, the highest value in [0.1, 0.2] that passes the slosh metric. Measured shake re-form: 146 frames (budget 180).
- **Slosh (D70-5, A4):** for 30 frames after `shake(1)`, the peak RMS of each element's displacement from rest after removing its best rigid motion (translation plus rotation, Procrustes) must be ≥ 24 px on the card and ≥ 12 px on each pill. W67 white noise gives 2.06–6.64 px; the coherent field at cap 0.2 gives ≥ 23.67 px (Procrustes measurement, fix round 1).
- **Pointer (D70-3, A1):** `POINTER_DRAG_PER_S = 12`; `POINTER_RADIUS_PX` stays 70. The doc comment's stability bound becomes `12/480 = 0.025 ≪ 1`.
- **Bulge (A2):** a 600 px/s sweep through the pills must shift each pill's liquid ≥ 5 px in the sweep direction. In Rust this is the mean particle x shift (6.33–6.81 px at drag 12); in e2e, the alpha centroid over the box padded by 10 px (7.40–7.72 px). The pointer-only sweep below the row keeps 0.35 px as a guard.
- **No holes (A3):** the Rust empty-bin test is unchanged (0 bins at drag 12). The W68 e2e lattice moves to ≥ 10 px inside the contour, because at drag 12 the trailing edge recedes ≈ 8 px.
- **Cross-fade (D70-4):** while `restAlpha < 1`, every particle splats with weight 1. The roundRect is drawn at `restAlpha · bg.a` on top. At `restAlpha = 1` nothing is splatted.
- **Recording (D70-6):** `record.spec.ts` appends a `?rm=1` segment after step 6, and that segment asserts no motion. The re-record goes to `docs/superpowers/whole-picture/slice-2-addendum-canvas2d.gif`; the W69 GIF and report stay unchanged. `.wdd/memory/whole-picture/slice-2-addendum.md` re-rates steps 2, 6 and 8 with evidence.
- **Baselines:** the step-2 and step-6 Linux baselines change, and steps 3 and 4 may. They are regenerated in Docker, checked with vision, and approved by Dennis (D65-7).

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `interaction::w67_tests::given_shake_when_applied_then_each_element_moves_along_one_seeded_direction_with_a_coherent_sine_profile_across_u_and_no_particle_noise` (rewritten from W67's noise test) | D70-1 |
| 2 | `interaction::w67_tests::given_shake_gain_when_evaluated_across_u_then_it_is_1_plus_0_8_sin_pi_u_plus_phase_within_0_2_and_1_8` | D70-1 |
| 3 | `interaction::w67_tests::given_shake_field_when_drawn_twice_for_one_stream_and_id_then_bit_identical_with_the_w67_unit_direction_and_a_phase_in_0_to_tau` | D70-1 |
| 4 | `interaction::w67_tests::given_d67_3_and_d70_constants_when_read_then_splash_and_shake_values_pinned` (renamed; drops `SHAKE_NOISE`) | D70-1, D70-2 |
| 5 | `interaction::w67_tests::given_shake_when_damaged_then_s_at_most_0_2` (renamed from `…_0_4`) | D70-2 |
| 6 | `pointer_hover_tests::given_d70_3_when_reading_the_pointer_constants_then_drag_is_12_per_s_and_radius_stays_70_px` | D70-3 |
| 7 | `pointer_hover_tests::given_600px_s_sweep_through_the_pills_when_ticking_then_each_pills_liquid_shifts_at_least_5px_in_the_sweep_direction` | D70-3, D70-5 (A2), step 2 |
| 8 | `scenario_tests::w70::given_a_rigid_translation_of_every_particle_when_measuring_slosh_then_the_residual_rms_is_below_0_01px` | D70-5 metric control |
| 9 | `scenario_tests::w70::given_shake_strength_1_when_ticking_30_frames_then_the_rigid_fit_residual_rms_reaches_24px_on_the_card_and_12px_on_each_pill` | D70-5 (A4), step 6 |
| 10 | `fluid-canvas2d.test.ts` `given_fractional_rest_alpha_when_rendering_then_every_particle_splats_at_full_weight` | D70-4 |
| 11 | `fluid-canvas2d.test.ts` `given_rest_alpha_0_58_when_rendering_then_the_interior_density_is_opaque_and_the_roundRect_fades_in_on_top` | D70-4 |
| 12 | `whole-picture-tooling.test.ts` `given_the_record_spec_when_read_then_a_reduced_motion_segment_on_rm_1_clicks_and_shakes_after_step_6_and_reports_step_8` | D70-6 |
| 13 | `wdd-docs.test.ts` `given_the_slice_2_addendum_when_read_then_steps_2_6_and_8_are_re_rated_with_measured_evidence_and_the_addendum_gif_exists` | D70-6 |
| 14 | `acceptance.spec.ts` `step 2 – given a 600 px/s sweep through the pills when ticking then each pill's liquid centroid shifts at least 5 px in the sweep direction (readable bulge)` | D70-5 (A2), step 2 |
| 15 | `acceptance.spec.ts` `step 2 – given a pointer sweep across the buttons when sampled then canvas alpha inside each button never drops below the fill threshold (no holes)` (modified: `HOLE_MARGIN_PX` 6 → 10) | D70-3 guard (A3), step 2 |
| 16 | `acceptance.spec.ts` `step 2 – given a sweep parallel to the row 30 px below the pills …` (modified: the measured comment only; threshold stays 0.35 px) | step 2 guard |
| 17 | `record.spec.ts` `whole picture – slice 2 – acceptance steps 1-4, 6 and 8 recorded in canvas2d` (modified: `?rm=1` segment, asserts no motion) | D70-6, step 8 |
| 18 | `scenario_tests::w70::given_a_rigid_rotation_of_every_particle_about_its_element_centroid_when_measuring_slosh_then_the_residual_rms_is_below_0_01px` | D70-5 metric control (rotation) |

Guards that stay unchanged and must stay green:
- W67: `given_shake_strength_1_when_ticking_then_all_rest_alpha_1_within_3_s`, the stress tests (no NaN, mean J, bit-identical) and `given_reduced_motion_when_splash_or_shake_then_ignored`;
- W68: `…no_interior_bin_empties`, `…every_rest_alpha_returns_to_1_within_3s`, and the static-pointer tests;
- e2e: step 6 "everything sloshes … within 3 s" and modes.spec.

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
