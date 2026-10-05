---
ward: 67
revision: null
name: "Splash and shake, end to end"
epic: "fluid-engine"
status: "planned"
dependencies: [66]
layer: "both"
estimated_tests: 49
created: "2026-10-03"
completed: null
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
- Modified: `src/fluid/{material,grid,solver,elements,api,scenario_tests}.rs`; created: `src/fluid/interaction.rs`.
- `packages/core/ts/src/input.ts` (click listener); `index.ts` with `splash(el, opts?)`, `shake(strength?)` and the exported type `SplashOptions`.
- Tests `splash-input.test.ts`, `splash-api.test.ts`; `e2e/acceptance.spec.ts` steps 3, 4 and 6 with baselines.
- Scene: shake via `__liquidTest.instance.shake()`.

## Decisions
### D67-1: Re-form timing against the constants (blocking)
Proposal: the spec's budget of 1.5 s after a strength-1 splash cannot be met with the spec's constants.
- `s ← 0.25` with `ds/dt = (1−s)/0.7` reaches `s > 0.98` after `0.7·ln(0.75/0.02) ≈ 2.54 s`.
- Adding the 150 ms hold and the 120 ms fade gives ≈ 2.81 s.

Options:
- (a) Default `recovery` 0.34 s: `0.34·ln 37.5 + 0.27 ≈ 1.50 s`. Every element snaps back about twice as fast; the 0.2–3 s range stays.
- (b) Rest gate `s > 0.85` instead of 0.98: `0.7·ln 5 + 0.27 ≈ 1.40 s`. `restAlpha` may rise while the liquid is still slightly soft.
- (c) Splash damage `0.6·(2 − strength)`: `0.7·ln 20 ≈ 2.10 s` plus 0.27. Too slow on its own.
- (d) A 3 s splash budget in spec §6 step 3 and NORTH-STAR, changed together.

Shake: `0.7·ln(0.6/0.02) + 0.27 ≈ 2.65 s`, which is within 3 s only if `maxDev < 0.75 px` by then.
Consequence: `given_strength_1_splash_on_button_when_ticking_then_rest_alpha_1_within_1_5_s` and Playwright step 3 fail by construction until one option is chosen. The chosen numbers go into the spec, the test names and (for d) NORTH-STAR.
Decision: PENDING

### D67-2: Gravity stays unused until slice 6
Proposal: `gx/gy` keep flowing through `tick` and are sanitised, but they are not applied. The test `given_gravity_when_ticking_then_liquid_falls` is `#[ignore = "slice 6"]` (skeleton D67-3).
Consequence: no gravity behaviour to stabilise in slice 2.
Decision: PENDING

### D67-3: Splash and shake impulses from the spike
Proposal: splash speed `950·strength` px/s within a radius of `max(110, 0.75·diag)` px, in seeded lobes, with J reset to 1 for the particles hit. Shake: `520·strength` px/s in a seeded random direction per element, plus per-particle noise (skeleton D67-4).
Consequence: the feel of the spike, tunable later in the W69 playground.
Decision: PENDING

### D67-4: splash() and shake() validate strictly
Proposal: `TypeError` when `strength` is NaN or outside [0, 2], or when `at` is not finite `{x, y}` (skeleton D68-1).
Consequence: invalid calls never reach Rust.
Decision: PENDING

### D67-5: splash on an unobserved element throws
Proposal: `splash(el)` for an element that is not observed throws `Error("[liquiddom] splash: element is not observed")` (skeleton D68-3).
Consequence: mistakes are loud rather than silently ignored.
Decision: PENDING

### D67-6: The scene triggers shake through the test hook
Proposal: the acceptance scene has no shake button. Playwright and manual smoke call `__liquidTest.instance.shake()`.
Consequence: the scene stays exactly as the north star describes it (three buttons and a card).
Decision: PENDING

### D67-7: Physics constants
Proposal:
- From the spike: `SUBSTEPS 8`, `SOUND_SPEED_PX 380`, `COMPRESS_MIN 0.55`, `J_RELAX 1.5`, `SPRING_K 220`, `SPRING_ZETA 0.8`, `SPRING_AMAX_PX 3200`, `AIR_DRAG 0.8`, `MAX_CELLS_PER_SUBSTEP 0.45`, `WOBBLE_PX 1.1`, `SLIP_RATE 3.0`, `SLIP_MAX_PX 160`, `S_FLOOR 0.015`.
- From the spec, for the material: viscosity `100·20^v` px²/s (0.5 ≈ 447; the spike used 700), cohesion `0.02 + 0.28·c` (0.5 → 0.16; the spike used 0.10), recovery 0.7 s.

Consequence: the default material is somewhat less viscous and more cohesive than the spike. Visible in the step 3/6 screenshots and tuned in W69.
Decision: PENDING

## Specification
- **Constitutive model:**
  - `σ = E(J−1)·I + μ(C + Cᵀ)`;
  - `J` relaxes towards 1 at `J_RELAX`, is clamped at ≥ 0.55, and yields at `1 + TENSION_MAX`;
  - velocity is capped at 0.45 cells per substep, for particles and grid nodes;
  - air drag.
- **Home spring:**
  - ζ = 0.8;
  - damping is relative to the element's own velocity, measured as the rect delta per fixed step;
  - acceleration is saturated at 3200 px/s².
- **Stiffness:**
  - damage: splash sets `s ← max(S_FLOOR, min(s, 0.25·(2 − strength)))` (unless D67-1 changes it); shake sets `s ← min(s, 0.4)`;
  - recovery: `ds/dt = (1 − s)/recovery`.
- **Slip drift:** `3/s·s²` towards the target, capped at 160 px/s. It is non-physical, and the code comment says so.
- **Rest state:**
  - `restAlpha` rises after `s > 0.98` and `maxDev < 0.75 px` have held for ≥ 150 ms;
  - it falls immediately when either condition breaks;
  - the fade is 120 ms both ways.
- **Wobble:** `1.1 px·(1 − restAlpha)`.
- **Reduced motion:** splash and shake are ignored, in Rust and before TS calls them.
- **TS `splash(el, { strength = 1, at })`:** `at` is in client px and is converted to buffer space (minus the container offset); the default is the rect centre. `shake(strength = 1)`.
- **Click listener:** on every observed element. Pointer clicks splash at `clientX/Y`. `event.detail === 0` (keyboard Enter/Space) splashes at the rect centre. Native activation is never prevented, and exactly one splash fires per click.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_viscosity_0_and_1_when_mapped_then_100_and_2000 | material map |
| 2 | given_viscosity_0_5_when_mapped_then_about_447 | material map |
| 3 | given_cohesion_0_5_when_mapped_then_0_16_and_bounds_0_02_0_30 | material map |
| 4 | given_recovery_nan_or_out_of_range_when_sanitized_then_default_0_7_or_clamped_0_2_3 | sanitising |
| 5 | given_element_viscosity_slot_nan_when_ticking_then_material_default_used | per-element override |
| 6 | given_set_material_when_called_then_cohesion_applies_globally_only | cohesion global |
| 7 | given_compressed_particles_when_substep_then_J_clamped_at_0_55_and_relaxes_towards_1 | J clamp/relax |
| 8 | given_stretch_beyond_tension_max_when_substep_then_J_yields_at_1_plus_tension_max | tension yield |
| 9 | given_high_velocity_when_substep_then_particle_and_grid_speed_capped_at_0_45_cells_per_substep | CFL |
| 10 | given_free_moving_particle_when_ticking_then_air_drag_decays_velocity | drag |
| 11 | given_shear_flow_when_substep_then_viscous_stress_reduces_velocity_gradient | viscosity |
| 12 | given_element_moving_at_v_and_particles_co_moving_on_target_when_spring_evaluated_then_damping_force_zero | relative damping |
| 13 | given_droplet_far_from_home_when_spring_evaluated_then_acceleration_saturates | saturation |
| 14 | given_rect_velocity_when_elements_updated_then_velocity_from_rect_delta_per_fixed_step | element velocity |
| 15 | given_splash_strength_1_when_damaged_then_s_at_most_0_25 | damage (per D67-1) |
| 16 | given_splash_strength_2_when_damaged_then_s_equals_floor_0_015 | damage floor |
| 17 | given_shake_when_damaged_then_s_at_most_0_4 | shake damage |
| 18 | given_s_0_25_and_recovery_0_7_when_recovering_then_matches_ds_dt_1_minus_s_over_recovery | recovery |
| 19 | given_s_1_and_offset_particle_when_ticking_then_slip_rate_3_per_s_capped_160px_per_s | slip |
| 20 | given_s_floor_when_ticking_then_slip_scaled_by_s_squared | slip scale |
| 21 | given_rest_alpha_1_when_ticking_then_wobble_zero | wobble |
| 22 | given_s_above_0_98_and_maxdev_below_0_75_for_150ms_when_ticking_then_rest_alpha_rises_to_1_over_120ms | rest rise |
| 23 | given_rest_alpha_1_when_condition_breaks_then_it_falls_immediately_reaching_0_after_120ms | rest fall |
| 24 | given_condition_flickering_under_150ms_when_ticking_then_rest_alpha_stays_0 | hysteresis |
| 25 | given_splash_when_applied_then_hit_particles_get_J_1_and_outward_velocity_with_seeded_lobes | splash |
| 26 | given_same_seed_when_splashing_twice_then_identical_velocities | determinism |
| 27 | given_invalid_id_or_nan_coords_when_splash_then_no_op | robustness |
| 28 | given_shake_when_applied_then_each_element_gets_seeded_direction_plus_particle_noise | shake |
| 29 | given_reduced_motion_when_splash_or_shake_then_ignored | RM |
| 30 | given_stress_sequence_pointer_splash_shake_when_run_then_mean_J_within_5_percent_of_1 | volume |
| 31 | given_stress_sequence_when_run_then_no_nan_or_inf_and_every_F_finite_with_det_positive | stability |
| 32 | given_stress_sequence_when_run_then_particle_count_and_mass_exactly_constant | conservation |
| 33 | given_strength_1_splash_on_button_when_ticking_then_rest_alpha_1_within_1_5_s | re-form (timing per D67-1) |
| 34 | given_shake_strength_1_when_ticking_then_all_rest_alpha_1_within_3_s | re-form |
| 35 | given_same_seed_and_inputs_when_stress_sequence_run_twice_then_positions_bit_identical | determinism |
| 36 | #[ignore = "slice 6"] given_gravity_when_ticking_then_liquid_falls | D67-2 |
| 37 | given_pointer_click_on_observed_element_when_dispatched_then_core_splash_at_pointer_in_buffer_space_strength_1 | click splash |
| 38 | given_keyboard_click_detail_0_when_dispatched_then_core_splash_at_rect_centre | keyboard splash |
| 39 | given_click_when_handled_then_default_not_prevented_and_exactly_one_splash | native activation |
| 40 | given_reduced_motion_when_clicked_then_no_splash | RM gating |
| 41 | given_splash_without_options_when_called_then_strength_1_at_rect_centre | API defaults |
| 42 | given_splash_at_client_point_in_container_mode_when_called_then_converted_with_container_offset | coordinates |
| 43 | given_strength_nan_or_out_of_0_2_when_splash_or_shake_then_TypeError | D67-4 |
| 44 | given_unobserved_element_when_splash_then_Error | D67-5 |
| 45 | given_shake_without_argument_when_called_then_core_shake_1 | API defaults |
| 46 | given_destroyed_instance_when_splash_or_shake_then_Error | lifecycle |
| 47 | step 3 – given a click on Splash when ticking then liquid leaves the rect and every restAlpha returns to 1 within 1.5 s | step 3 (timing per D67-1) |
| 48 | step 4 – given Tab focus on Split and Enter when ticking then splash at centre and focus ring visible throughout | step 4 |
| 49 | step 6 – given shake when ticking then every restAlpha returns to 1 within 3 s | step 6 |

## Must NOT
- Change the FFI layout or the strides.
- Prevent default on `click`, or splash twice per activation.
- Copy spike code (D2).
- Add the pointer field or hover swell (W68).

## Must DO
- Gate D67-1 … D67-7 before `wdd ward status 67 red`, and log them in NORTH-STAR. D67-1 is blocking.
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
