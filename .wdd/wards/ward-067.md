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
