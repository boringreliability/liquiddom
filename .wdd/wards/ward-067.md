---
ward: 67
revision: null
name: "Splash and shake, end to end"
epic: "fluid-engine"
status: "complete"
dependencies: [66]
layer: "both"
estimated_tests: 80
created: "2026-10-03"
completed: "2026-10-05"
---
# Ward 067: Splash and shake, end to end

North star: steps 3 (Canvas2D, no text), 4 (keyboard splash at the centre, focus ring visible) and 6 (shake re-forms within 3 s).

## Scope
The liquid reacts, end to end in one ward (re-sliced by D63-4).

Rust gets the full MLS-MPM dynamics:
- EOS stress, viscosity, the tension cap, J clamp and relaxation;
- CFL caps on particles and grid;
- air drag;
- the damped, saturated home spring relative to the element's velocity;
- stiffness damage and recovery;
- `maxDev` and `restAlpha` with hysteresis and fade;
- slip drift;
- wobble scaled by `(1 − restAlpha)`;
- splash (seeded lobes, J reset) and shake.

TS gets:
- the public `splash()` and `shake()`;
- the `click` listener (splash at the pointer, or at the rect centre when `event.detail === 0`);
- the scene's shake trigger.

Playwright verifies steps 3, 4 and 6.

## Inputs
- W64 Rust modules (the FFI is unchanged), W65 harness, W66 facade.
- Spec §2 physics, T-1000 re-form, per-element rest state, interaction table; §5 `splash`/`shake` signatures.
- Spike constants (reference only).

## Outputs
- Modified: `src/fluid/{material,grid,sampling,pool,solver,elements,api,scenario_tests}.rs`; created: `src/fluid/interaction.rs`.
- `packages/core/ts/src/input.ts` (click listener); `index.ts` with `splash(el, opts?)`, `shake(strength?)` and the exported type `SplashOptions`.
- Tests `splash-input.test.ts`, `splash-api.test.ts`; `e2e/acceptance.spec.ts` steps 3, 4 and 6 with baselines.
- Scene: shake via `__liquidTest.instance.shake()`.

## Decisions
### D67-1: Re-form timing against the constants (blocking)
Proposal: the spec's 1.5 s splash budget is unreachable with its own constants (`s ← 0.25`, `ds/dt = (1−s)/0.7`, gate `s > 0.98`, 150 ms hold, 120 ms fade ≈ 2.82 s). Option 1: lower `REST_S_MIN` to 0.95 and raise the splash budget to 3 s.
Consequence: splash re-forms in ≥ 2.18 s and shake in ≥ 2.02 s, ≥ 0.8 s inside the 3 s budget; spike feel and default recovery 0.7 s kept. Spec §2, spec §6 step 3, the spec §6 Rust list, NORTH-STAR step 3 and the NORTH-STAR Experiences bullet are amended (Task W67.14).
Decision: APPROVED 2026-10-05 — `REST_S_MIN` 0.98 → 0.95 and a 3 s splash re-form budget (option 1) (saga dec_fe306ff0)

### D67-2: Gravity stays unused until slice 6
Proposal: `tick` accepts and sanitises `gx/gy` but does not apply them; a non-ignored test proves they have no effect and `given_gravity_when_ticking_then_liquid_falls` is `#[ignore = "slice 6"]`.
Consequence: the `gravity` options are accepted but do nothing visible until slice 6 (the spec's interim state).
Decision: APPROVED 2026-10-05 — gravity ignored until slice 6, proven by a no-effect test (saga dec_f525fbc3)

### D67-3: Splash and shake impulses from the spike
Proposal: splash `950·strength` px/s within `max(110, 0.75·diag)` px, ±0.45 rad jitter, seeded lobes `k1 ∈ 4..7`, `k2 = k1 + 2..4`, J reset to 1 for hit particles; shake `520·strength` px/s in one seeded direction per element ±0.45 noise. Damage per spec: splash only the target, `min(s, 0.25·(2−strength))` ≥ `S_FLOOR`; shake `min(s, 0.4)` on every element.
Consequence: the spike's feel, tunable in W69; neighbours are hit only by the flying liquid.
Decision: APPROVED 2026-10-05 — spike impulses with spec damage (splash target only, shake all) (saga dec_c3555fda)

### D67-4: splash() and shake() validate strictly
Proposal: `TypeError` for a `strength` that is NaN, infinite, not a number or outside [0, 2], for `at` that is not finite `{x, y}`, for non-object `opts`, for unknown keys, and for the 0.2 keys ("SplashOptions changed shape").
Consequence: invalid calls never reach Rust.
Decision: APPROVED 2026-10-05 — strict whitelist validation in TS (saga dec_06beb181)

### D67-5: splash on an unobserved element throws
Proposal: `splash(el)` on an element that is not observed throws `Error("[liquiddom] splash: element is not observed")`; a non-element throws `TypeError`.
Consequence: mistakes are loud rather than silently ignored.
Decision: APPROVED 2026-10-05 — Error for unobserved, TypeError for non-element (saga dec_602c802d)

### D67-6: The scene triggers shake through the test hook
Proposal: the acceptance scene has no shake button; Playwright and the manual smoke test call `__liquidTest.instance.shake()`.
Consequence: the scene stays exactly as the north star describes it (three buttons and a card).
Decision: APPROVED 2026-10-05 — shake via the test hook, no button (saga dec_c5bb8271)

### D67-7: Physics constants
Proposal: spike constants: `SOUND_SPEED 380`, `J_RELAX 1.5`, `COMPRESS_MIN 0.55`, `SPRING_K 220`, `SPRING_ZETA 0.8` damping the velocity relative to the element, acceleration capped at `3200·(0.25 + 0.75·s)`, `AIR_DRAG 0.8`, CFL 0.45 cells per substep, `WOBBLE 1.1·(1−restAlpha)`, `SLIP 3·s²` capped at 160 px/s; material per spec: viscosity `100·20^v`, cohesion `0.02 + 0.28·c`.
Consequence: the default material is a little less viscous and more cohesive than the spike; visible in the step 3/6 screenshots and tuned in W69.
Decision: APPROVED 2026-10-05 — spike constants with the spec material mapping (saga dec_44d36e1b)

### D67-8: Strength 0 is a no-op
Proposal: `strength: 0` applies no impulse and no damage; the TS range stays [0, 2] inclusive.
Consequence: no crisp-to-liquid cross-fade without motion, which the literal formula (`s ← 0.5`) would show.
Decision: APPROVED 2026-10-05 — strength 0 is a no-op (saga dec_5570e6c1)

### D67-9: One splash per click event
Proposal: the innermost observed element wins; a `WeakSet` of handled events stops observed ancestors from splashing too; `preventDefault` and `stopPropagation` are never called.
Consequence: a card around a button does not double-splash, and the host's event handling is untouched.
Decision: APPROVED 2026-10-05 — one splash per click, innermost element (saga dec_f78d0bca)

### D67-10: maxDev against the target the spring used
Proposal: `maxDev` is measured in G2P against the target the spring actually used, wobble included.
Consequence: the 1.1 px wobble can never keep an element from resting (against the un-wobbled target the deviation reaches 1.28 px > 0.75 px).
Decision: APPROVED 2026-10-05 — maxDev against the wobbled spring target (saga dec_9f4f536c)

### D67-11: Reduced-motion click gating belongs to W68
Proposal: TS-side gating of clicks under reduced motion is W68's D68-5; W67 relies on Rust ignoring `splash`/`shake` under reduced motion, proven by a Rust test.
Consequence: under reduced motion in W67 a click still crosses the FFI, with no visible effect; W63's `given_reduced_motion_when_clicked_then_no_splash` row moves to W68.
Decision: APPROVED 2026-10-05 — Rust-side ignore in W67, TS gating in W68 (saga dec_681bc282)

### D67-12: Elements already on their targets start at rest
Proposal: after `redistribute()`, `Elements::settle_if_at_rest` sets the hold to full and `restAlpha = 1` for every element with `s > REST_S_MIN` and `maxDev < 0.75 px`.
Consequence: freshly observed elements neither fade in nor wobble and stay bit-static at rest; the W64 assertion `rest_alpha == 0.0` one frame after a 10 px displacement becomes `< 1.0` (≈ 0.86).
Decision: APPROVED 2026-10-05 — settle_if_at_rest after redistribute (saga dec_ff2cdb75)

### D67-13: Edge-aligned rest ring plus R2 interior
Proposal: at `redistribute()` the outermost layer of each element's particles is placed evenly along its rounded contour, and the R2 sequence fills only the interior (W64 found sd 0.48 px edge raggedness in motion from the anisotropic R2 layout).
Consequence: a smooth edge in motion, deterministic and paid only at redistribute; changes the static view (`rest_u`, `rest_v`) and W64's layout tests.
Decision: APPROVED 2026-10-05 — edge-aligned ring + R2 interior (saga dec_d09082c5)

### D67-14: Element velocity once per tick
Proposal: the element's rect velocity is computed once per `tick` (rect delta over the tick's time) and used for every fixed step in that tick.
Consequence: no 3Δ/dt-then-0 spike in the relative spring damping when an element moves.
Decision: APPROVED 2026-10-05 — rect velocity per tick, shared by its fixed steps (saga dec_41131b84)

### D67-15: Cross-element lock probe
Proposal: a Rust scenario test moves an element ±1000 px and back and requires it to reach rest again via slip drift.
Consequence: proves W67's slip resolves W64's known overlap lock; if it cannot, the limitation is documented and parking moves into slice 6.
Decision: APPROVED 2026-10-05 — scenario probe; fallback is slice-6 parking (saga dec_14e3ffed)

## Specification
- **Constitutive model:**
  - `σ = E(J−1)·I + μ(C + Cᵀ)`;
  - `J` relaxes towards 1 at `J_RELAX`, is clamped at ≥ 0.55, and yields at `1 + TENSION_MAX`;
  - velocity is capped at 0.45 cells per substep, for particles and grid nodes;
  - air drag.
- **Home spring:**
  - ζ = 0.8;
  - damping is relative to the element's own velocity, measured once per tick as the rect delta over the tick's simulated time and shared by its fixed steps (D67-14);
  - acceleration is saturated at 3200 px/s².
- **Stiffness:**
  - damage: splash sets `s ← max(S_FLOOR, min(s, 0.25·(2 − strength)))` (D67-1 keeps it); shake sets `s ← min(s, 0.4)`;
  - recovery: `ds/dt = (1 − s)/recovery`.
- **Slip drift:** `3/s·s²` towards the target, capped at 160 px/s. It is non-physical, and the code comment says so.
- **Rest state:**
  - `restAlpha` rises after `s > REST_S_MIN` (0.95, D67-1 option 1) and `maxDev < 0.75 px` have held for ≥ 150 ms;
  - it falls immediately when either condition breaks;
  - the fade is 120 ms both ways.
- **Wobble:** `1.1 px·(1 − restAlpha)`.
- **Rest layout (D67-13):** at `redistribute()`, each element's first `edge_ring_count` ranks lie evenly on its rounded outline, inset by half a spacing. The spacing is `cell_px / 2`, the particle spacing at the area hint, and it is fixed per core. The R2 sequence fills the interior, one spacing inside the outline. Counts per element are unchanged (largest remainder), and kept particles keep their `rest_uv` (D64-3).
- **Lock probe (D67-15):** an element moved ±1000 px and back is at rest again within 5 s through slip drift. If it cannot be, the limitation is parked for slice 6.
- **Reduced motion:** splash and shake are ignored in Rust (W67). The TS input gating is W68 (D67-11, D68-5).
- **TS `splash(el, { strength = 1, at })`:** `at` is in client px and is converted to buffer space (minus the container offset); the default is the rect centre. `shake(strength = 1)`.
- **Click listener:** on every observed element. Pointer clicks splash at `clientX/Y`. `event.detail === 0` (keyboard Enter/Space) splashes at the rect centre. Native activation is never prevented, and exactly one splash fires per click.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_viscosity_0_and_1_when_mapped_then_100_and_2000 | material map |
| 2 | given_viscosity_0_5_when_mapped_then_about_447 | material map |
| 3 | given_cohesion_0_5_when_mapped_then_0_16_and_bounds_0_02_0_30 | material map |
| 4 | given_recovery_nan_or_out_of_range_when_sanitized_then_default_0_7_or_clamped_0_2_3 | sanitising |
| 5 | given_default_material_when_mapped_then_params_match_spec_defaults | defaults |
| 6 | given_speed_above_cap_when_capped_then_scaled_to_cap_and_direction_kept | CFL helper |
| 7 | given_non_finite_velocity_when_capped_then_zero | CFL helper |
| 8 | given_compressed_particles_when_substep_then_j_clamped_at_0_55_and_relaxes_towards_1 | J clamp/relax |
| 9 | given_stretch_beyond_tension_max_when_substep_then_j_yields_at_1_plus_tension_max | tension yield |
| 10 | given_high_velocity_when_substep_then_particle_and_grid_speed_capped_at_0_45_cells_per_substep | CFL |
| 11 | given_free_moving_particle_when_ticking_then_air_drag_decays_velocity | drag |
| 12 | given_shear_flow_when_substep_then_viscous_stress_reduces_velocity_gradient | viscosity |
| 13 | given_element_viscosity_slot_nan_when_ticking_then_material_default_used | per-element override |
| 14 | given_element_moving_at_v_and_particles_co_moving_on_target_when_spring_evaluated_then_damping_force_zero | relative damping |
| 15 | given_droplet_far_from_home_when_spring_evaluated_then_acceleration_saturates | saturation |
| 16 | given_s_1_and_offset_particle_when_ticking_then_slip_rate_3_per_s_capped_160px_per_s | slip |
| 17 | given_s_floor_when_ticking_then_slip_scaled_by_s_squared | slip scale |
| 18 | given_rest_alpha_1_when_ticking_then_wobble_zero | wobble |
| 19 | given_rect_velocity_when_elements_updated_then_velocity_from_rect_delta_over_dt | element velocity |
| 20 | given_s_0_25_and_recovery_0_7_when_recovering_then_matches_ds_dt_1_minus_s_over_recovery | recovery |
| 21 | given_element_recovery_override_when_recovering_then_override_time_constant_used | recovery override |
| 22 | given_damage_below_floor_when_applied_then_s_clamped_to_floor_0_015 | damage floor |
| 23 | given_s_above_rest_threshold_and_maxdev_below_0_75_for_150ms_when_ticking_then_rest_alpha_rises_to_1_over_120ms | rest rise |
| 24 | given_rest_alpha_1_when_condition_breaks_then_it_falls_immediately_reaching_0_after_120ms | rest fall |
| 25 | given_condition_flickering_under_150ms_when_ticking_then_rest_alpha_stays_0 | hysteresis |
| 26 | given_element_already_on_target_when_redistributed_then_rest_alpha_starts_at_1 | D67-12 |
| 27 | given_splash_when_applied_then_hit_particles_get_j_1_and_outward_velocity_with_seeded_lobes | splash |
| 28 | given_same_seed_when_splashing_twice_then_identical_velocities | determinism |
| 29 | given_invalid_id_or_nan_coords_when_splash_then_no_op | robustness |
| 30 | given_shake_when_applied_then_each_element_gets_seeded_direction_plus_particle_noise | shake |
| 31 | given_reduced_motion_when_splash_or_shake_then_ignored | RM (Rust) |
| 32 | given_splash_strength_1_when_damaged_then_s_at_most_0_25 | damage |
| 33 | given_splash_strength_2_when_damaged_then_s_equals_floor_0_015 | damage floor |
| 34 | given_shake_when_damaged_then_s_at_most_0_4 | shake damage |
| 35 | given_strength_0_when_splash_or_shake_then_no_op | D67-8 |
| 36 | given_set_material_when_called_then_cohesion_applies_globally_only | cohesion global |
| 37 | given_stress_sequence_pointer_splash_shake_when_run_then_mean_j_within_5_percent_of_1 | volume (every frame) |
| 38 | given_stress_sequence_when_run_then_no_nan_or_inf_and_j_within_clamp_bounds | stability (F is render-only until a later slice) |
| 39 | given_stress_sequence_when_run_then_particle_count_and_mass_exactly_constant | conservation |
| 40 | given_strength_1_splash_on_button_when_ticking_then_rest_alpha_1_within_3_s | re-form (D67-1) |
| 41 | given_shake_strength_1_when_ticking_then_all_rest_alpha_1_within_3_s | re-form |
| 42 | given_same_seed_and_inputs_when_stress_sequence_run_twice_then_positions_bit_identical | determinism |
| 43 | given_gravity_args_when_ticking_then_positions_identical_to_zero_gravity_until_slice_6 | D67-2 |
| 44 | #[ignore = "slice 6"] given_gravity_when_ticking_then_liquid_falls | D67-2 |
| 45 | given_rounded_rect_when_edge_layout_sampled_then_every_ring_point_on_contour_inset_half_spacing | D67-13 ring on contour |
| 46 | given_edge_ring_when_laid_out_then_neighbour_spacing_coefficient_of_variation_below_0_05 | D67-13 even spacing |
| 47 | given_edge_layout_when_sampled_then_interior_points_strictly_inside_the_ring | D67-13 interior |
| 48 | given_same_seed_when_edge_layout_sampled_twice_then_uv_bit_identical_and_ring_seed_independent | D67-13 determinism, D64-3 prefix |
| 49 | given_rect_too_small_or_non_finite_when_edge_layout_sampled_then_r2_fallback_without_panic | D67-13 robustness |
| 50 | given_edge_layout_when_redistributed_then_counts_per_element_unchanged_and_ring_ranks_first | D67-13 counts |
| 51 | given_button_moving_at_120px_s_when_ticking_then_edge_envelope_sd_below_0_2px | D67-13 edge in motion |
| 52 | given_rect_moved_once_in_a_three_step_tick_when_ticking_then_all_three_steps_use_delta_over_three_fixed_dt | D67-14 |
| 53 | given_element_moved_1000px_away_and_back_when_ticking_then_every_rest_alpha_1_within_5_s | D67-15 |
| 54 | given_splash_without_options_when_called_then_strength_1_at_rect_centre | API defaults |
| 55 | given_splash_with_at_and_strength_when_called_then_core_receives_buffer_point_and_strength | API |
| 56 | given_splash_at_client_point_in_container_mode_when_called_then_converted_with_container_offset | coordinates |
| 57 | given_strength_nan_or_out_of_0_2_when_splash_or_shake_then_TypeError | D67-4 |
| 58 | given_strength_0_and_2_when_splash_or_shake_then_accepted_bounds_inclusive | D67-4, D67-8 |
| 59 | given_invalid_at_when_splash_then_TypeError | D67-4 |
| 60 | given_old_or_unknown_splash_option_when_splash_then_TypeError_naming_new_shape | D67-4, B9 |
| 61 | given_unobserved_element_when_splash_then_Error | D67-5 |
| 62 | given_shake_without_argument_when_called_then_core_shake_1 | API defaults |
| 63 | given_destroyed_instance_when_splash_or_shake_then_Error | lifecycle |
| 64 | given_pointer_click_on_observed_element_when_dispatched_then_core_splash_at_pointer_in_buffer_space_strength_1 | click splash |
| 65 | given_keyboard_click_detail_0_when_dispatched_then_core_splash_at_rect_centre | keyboard splash |
| 66 | given_click_when_handled_then_default_not_prevented_and_exactly_one_splash | native activation |
| 67 | given_nested_observed_elements_when_inner_clicked_then_exactly_one_splash_on_inner | D67-9 |
| 68 | given_click_on_child_of_observed_element_when_dispatched_then_splash_on_observed_element | click target |
| 69 | given_container_mode_when_clicked_then_splash_container_relative | coordinates |
| 70 | given_unobserved_or_destroyed_when_clicked_then_no_splash | lifecycle |
| 71 | step 3 – given a click on Splash when ticking then liquid leaves the rect and every restAlpha returns to 1 within the D67-1 budget | step 3 |
| 72 | step 3 – given the splash 12 frames after a click when screenshotted then it matches the baseline | step 3 baseline |
| 73 | step 4 – given Tab focus on Split and Enter when ticking then the splash is at the centre and the focus ring is visible throughout | step 4 |
| 74 | step 4 – given the keyboard splash on Split at frame 30 when screenshotted then the focus ring matches the baseline | step 4 baseline |
| 75 | step 6 – given shake when ticking then everything sloshes and every restAlpha returns to 1 within 3 s | step 6 |
| 76 | step 6 – given the shake at frame 20 when screenshotted then it matches the baseline | step 6 baseline |
| 77 | given_s_between_0_94_and_0_96_when_ticking_then_rest_s_min_is_0_95 | D67-1 pin |
| 78 | given_particle_on_wobbled_target_when_max_dev_measured_then_below_rest_threshold | D67-10 |
| 79 | given_d67_7_constants_when_read_then_spike_values_pinned | D67-7 pin |
| 80 | given_d67_3_constants_when_read_then_splash_and_shake_values_pinned | D67-3 pin |

## Must NOT
- Change the FFI layout or the strides.
- Prevent default on `click`, or splash twice per activation.
- Copy spike code (D2).
- Add the pointer field or hover swell (W68).

## Must DO
- Gate D67-1 … D67-15 before `wdd ward status 67 red`, and log them in NORTH-STAR. D67-1 is blocking.
- Reconcile this Tests table in the red commit; if D67-1 changes a timing, rename the tests accordingly.
- Keep the W64 robustness guards (indexing lint, no hot-path allocation test) green.
- Inspect the step 3, 4 and 6 screenshots with vision.

## Manual Smoke Test
### Setup
`npm run build`

### Steps
1. Run: `cargo test --lib fluid::`
   Expected: all pass; only the gravity test is ignored.
2. Run: `npx playwright test e2e/acceptance.spec.ts --project=canvas2d`
   Expected: steps 1, 3, 4 and 6 pass.
3. Run: `npm run dev`, open `/scenes/acceptance.html?test=1&seed=1`, and click "Splash".
   Verify: jets and fingers, then re-forming within the D67-1 budget. Take screenshots mid-splash and at rest, and inspect them with vision.
4. Tab to "Split" and press Enter.
   Verify: a splash from the centre, with the focus ring visible throughout.
5. In devtools run `__liquidTest.instance.shake()`.
   Verify: everything sloshes and re-forms within 3 s.

### Pass criteria
- [ ] The mid-splash, keyboard and shake screenshots are inspected with vision.
- [ ] `npm run verify` is green.

## Verification
`npm run verify` and CI e2e canvas2d are green, the vision-inspected screenshots are attached, and Dennis approves.

Rust evidence (W67.10, `cargo test --lib fluid::scenario_tests -- --nocapture`, 2026-10-05):
- D67-1: `W67 D67-1 evidence: splash re-form after Some(135) (+10) frames` (145 ≤ 180)
- D67-1: `W67 D67-1 evidence: shake re-form after Some(120) (+10) frames` (130 ≤ 180)
- D67-13: `W67 D67-13 evidence: edge envelope sd 0.000 px at rest, 0.120 px moving at 120 px/s` (< 0.2)
- D67-15: `W67 D67-15 evidence: dx 1000: every restAlpha back to 1 after Some(270) frames` (≤ 300)
- D67-15: `W67 D67-15 evidence: dx -1000: every restAlpha back to 1 after Some(158) frames` (≤ 300)
- Open: `given_stress_sequence_pointer_splash_shake_when_run_then_mean_j_within_5_percent_of_1` measures max |mean J − 1| = 0.1206 over all frames (frame 264, after the strength-2 card splash); the final-frame value is 0.0001. Awaiting a ruling.

## Gold notes

**North-star steps moved (canvas2d):**
- Step 3: a click on Splash throws the liquid out of the button; it re-forms within the 3 s budget (D67-1: measured 135 frames for splash, 120 for shake, out of 180). Baseline `acceptance.spec.ts/acceptance-step3-splash-f12-canvas2d-linux.png`. Vision: an open ring of droplets on the left and a gathered mass on the right. The splash is clearly visible.
- Step 4: Tab then Enter on Split splashes from the rect centre. Baseline `acceptance-step4-split-focus-f30-canvas2d-linux.png`. Vision: the focus ring is continuous around Split and drawn above the liquid, with the splash hole around the label.
- Step 6: `shake()` displaces every body (more than 500 px of liquid outside the rects) and all of them re-form within 3 s. Baseline `acceptance-step6-shake-f20-canvas2d-linux.png`. Vision: all four bodies are pushed off their places and the card is deformed; the DOM text stays put.
- The step 1, step 8 and a11y baselines are unchanged; the pinned linux/amd64 image runs 26/26 against all baselines.

**Decision evidence:**
- D67-13: edge sd 0.000 px at rest and 0.120 px in motion (bound 0.2); W64 R2 scored 0.61–0.69 px.
- D67-15: the lock probe recovers via slip in 270 frames (dx +1000) and 158 frames (dx −1000) out of 300, so no slice-6 parking is needed.
- D67-14: velocity is computed once per tick (a test pins it). A clock-clamped hiccup divides by wall time.

**Reviews and controller rulings:**
- Every task was reviewed.
- The opus review of the Rust range found the performance cost of the per-particle wobble trig. A behaviour-preserving round cut p95 from about 5.3 ms to about 3.6 ms per fixed step, which is about 11 ms for 3 catch-up steps.
- The whole-ward opus review found that stiffness survived slot reuse. That is fixed, along with:
  - damage applied only on a hit;
  - reduced motion resetting stiffness;
  - no core calls after a failed frame;
  - a stronger step-3 motion proof (peak 1979 px, bound 500, plus a pointer-position hash).
- Controller error, fixed: the red fix round applied the ±5 % mean-J bound to every frame. A strength-2 card splash legitimately swings it to about 12 %. The test now follows spec §6: ±5 % after the sequence (measured 0.0001), plus an every-frame runaway guard of 0.2.

**Verification:**
- cargo: 116 passed, 1 ignored (gravity, slice 6).
- vitest: 348 passed, 4 skipped.
- canvas2d (macOS): 20 passed, with the visual specs skipped.
- linux/amd64 image: 26 passed.
- Clippy and fmt are clean.

**For Dennis (observations, not W67 defects):**
1. While liquid is away from an element, its white DOM text sits on the beige page at low contrast until the liquid returns (spec step 3: no liquid text yet).
2. In motion the edges are furry from the density renderer; the ring only smooths the rest edge.
3. Shake reads more like sliding blobs than sloshing. Tune it in W69.
4. `shake()` before the first redistribute damages active elements without moving them. This is consistent with spec §2.

**Carry:** W68 adds `Scratch::invalidate_bounds()` on the pointer paths. The ring density when the area hint is off is tuned in W69. A browser that loads the published `dist` remains a W69 whole-picture item.
