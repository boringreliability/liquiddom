---
ward: 68
revision: null
name: "Pointer, hover and material"
epic: "fluid-engine"
status: "gold"
dependencies: [67]
layer: "both"
estimated_tests: 81
created: "2026-10-03"
completed: null
---
# Ward 068: Pointer, hover and material

North star: step 2 (pointer sweep: soft bulge, no holes), plus the hover swell on the resting contour. The material becomes tunable for the W69 playground.

## Scope
- Rust: the soft pointer field (moved here from W67 by D63-4) and the hover swell of the home rect.
- TS:
  - the pointer tracker (buffer-space position and smoothed velocity → `tick`);
  - hover and focus tracking, written into `interaction` (hover beats focus until slice 5, D68-2 amended);
  - `setMaterial`/`getMaterial` and the material presets;
  - reduced-motion input gating. Detection stays in W64.
- Playwright: step 2.

## Inputs
- W67 engine and API; W64's `HOVER_SWELL` shared constant and the rest contour drawn at the home rect (B1).
- Spec §2 interaction table, the hover rule, reduced motion.

## Outputs
- Modified: `src/fluid/{interaction,elements,solver,api}.rs` (pointer field, `swell_rect`, `PointerField::sanitized`, pointer through `tick`, `Scratch::invalidate_bounds` on every particle-moving path, D68-10).
- `packages/core/ts/src/pointer-tracker.ts` (new: pointer tracker), `runtime.ts` (pointer → `tick`, reduced-motion gate for splash/shake, `setMaterial`), `element-registry.ts` (hover/focus listeners → `interaction` slot), `material.ts` (`presets`), `index.ts` (`setMaterial`, `getMaterial`, the `presets` export).
- Tests `pointer-input.test.ts`, `hover-focus.test.ts`, `material-api.test.ts`. Modified: `api-migration.test.ts` and `liquiddom-api.test.ts` (whitelist + `presets`), `reduced-motion-input.test.ts` (new); Rust `src/fluid/pointer_hover_tests.rs` (new) and two D68-10 tests in `solver.rs` `w67_tests`; the hovered rest contour is already covered by W64's `given_hover_interaction_at_rest_when_rendering_then_roundRect_at_swelled_home_rect`.
- `e2e/acceptance.spec.ts` step 2 with its baseline.

## Decisions
### D68-1: Material preset values
Proposal: water `{viscosity: 0.15, cohesion: 0.3, recovery: 0.5}`, honey `{0.9, 0.7, 1.6}`, jelly `{0.6, 0.85, 0.4}`, frozen and tuned in the W69 playground.
Consequence: three distinct feels from the start; honey (recovery 1.6 s) re-forms in ≈ 4.6 s, because the 3 s budget (D67-1) is defined for the default material only.
Decision: APPROVED 2026-10-06 — water/honey/jelly as proposed (saga dec_42a7df27)

### D68-2: Hover via mouseenter/mouseleave; focus beats hover
Proposal: `mouseenter`/`mouseleave` and `focus`/`blur` on the observed element itself (not `focusin`); focus beats hover; the initial state is read from `:hover` / `document.activeElement` at observe time; slot 5 is written 0/1/2 on every `sync()`, 3 (dragged) is reserved for slice 5.
Consequence: focus on a child of a card does not count as card focus; touch devices get no hover bulge.
Decision: AMENDED 2026-10-06 — hover from `pointerenter`/`pointerleave` on the element with `pointerType === "touch"` ignored, initial `:hover` read only under `(hover: hover)`; hover beats focus until slice 5 (a click focuses buttons in Chrome/Firefox and must not remove the swell; FOCUSED has no engine effect yet) (saga dec_e431420b)

### D68-3: The soft pointer field is in Rust
Proposal: velocity coupling only: inside `POINTER_RADIUS_PX = 70`, `a = (v_ptr − v_p) · POINTER_DRAG_PER_S · (1 − d/r)²` with `POINTER_DRAG_PER_S = 6.0`, added after the home-spring saturation, with no radial term; NaN/Inf makes the pointer inactive and its speed is clamped to `POINTER_VMAX_PX_S = 2000`.
Consequence: a resting pointer has no radial effect and only damps moving liquid (−v·k), so it cannot make a hole; a 600 px/s sweep drags the liquid a few px. If the no-hole tests fail, `POINTER_DRAG_PER_S` is lowered in this ward and the value goes into the gold notes.
Decision: APPROVED 2026-10-06 — velocity-only coupling, drag 6/s, radius 70 px (saga dec_0a6cdade)

### D68-4: Pointer velocity smoothing
Proposal: velocity is sampled once per frame from the runtime clock: `v ← 0.5·v + 0.5·Δpos/Δt` when the pointer moved; held for up to 120 ms without movement, then ×0.8 per frame; Δt floored at 1/240 s; the first sample after the pointer enters has v = 0.
Consequence: deterministic under `?clock=manual`; several events in one frame merge into one net velocity.
Decision: APPROVED 2026-10-06 — per-frame sampling from the runtime clock (saga dec_f9697a6b)

### D68-5: Reduced-motion input gating in TS
Proposal: while reduced motion is on (following live media changes): `pointer_active = false` with zero pointer arguments, slot 5 written as `IDLE`, the runtime's `splash` returns `true` without calling the core for an observed element and its `shake` returns early; the facade validates first.
Consequence: defence in depth with Rust's W67 ignore; `splash(el, { strength: 5 })` still throws `TypeError`, `splash(unobserved)` still throws `Error`, `splash(el)` is a silent no-op.
Decision: APPROVED 2026-10-06 — TS gating with validation first (saga dec_2ca25ef8)

### D68-6: presets join the export whitelist
Proposal: the whitelist test gains `presets`; W66's `OLD_RUNTIME_EXPORTS.presets` changes from `removed` to `kept` (same name, material shape).
Consequence: the API gets its material presets back without contradicting W66 (A2).
Decision: APPROVED 2026-10-06 — `presets` exported with the material shape (saga dec_fce3114b)

### D68-7: Pointer end events
Proposal: `pointerleave`, `pointercancel`, `pointerup` with `pointerType === "touch"` and window `blur` make the pointer inactive and reset its velocity; a mouse or pen `pointerup` keeps it active.
Consequence: a lifted finger leaves no phantom field behind.
Decision: AMENDED 2026-10-06 — document `pointerout` with `relatedTarget === null` (not document `pointerleave`, which browsers do not fire reliably on leaving the window), `pointercancel`, touch `pointerup` and window `blur` deactivate; a non-null `relatedTarget` does not (saga dec_ed96cd8d)

### D68-8: Swell shape
Proposal: a step change exactly as in spec B1, with no easing; the radius scales by the same `1 + HOVER_SWELL`; `swell_rect` is a refactor of W64's swell inside `home_rect`, behaviour unchanged.
Consequence: on `mouseenter` the contour jumps outward by 1 % of the width per side (1.4 px on a 140 px button, 3.2 px on the card) and the element briefly turns liquid, which is the intended gentle bulge; the eased 150 ms alternative was declined.
Decision: APPROVED 2026-10-06 — step change per spec B1 (saga dec_5bf52509)

### D68-9: setMaterial/getMaterial semantics
Proposal: `setMaterial` is atomic (`validateMaterial` → `mergeMaterial` → assign → `core.set_material`); unknown keys and non-objects throw `TypeError` naming the key and the three fields; `getMaterial()` returns a copy; both throw `Error` after `destroy()`.
Consequence: old `presets.jelly`-style physics code gets a `TypeError` naming the bad key, not silent misbehaviour.
Decision: APPROVED 2026-10-06 — atomic set, copying get (saga dec_e41cbdee)

### D68-10: Invalidate the fused AABB on particle-moving paths
Proposal: `Scratch::invalidate_bounds()` is called from the pointer, splash, shake and redistribute paths and from the test setters, so the W67 fused AABB is never reused after particles moved (W67 perf-review carry).
Consequence: no visible effect; removes a latent stale-bounds bug once pointer input can move particles mid-tick.
Decision: APPROVED 2026-10-06 — invalidate on every particle-moving path (saga dec_b8d7e2bb)

## Specification
- **Pointer:** a document `pointermove` → buffer-space position (minus the container offset) and px/s velocity → `tick(dt, px, py, pvx, pvy, active, gx, gy)`.
- **Hover swell:** the home rect is scaled by `1 + HOVER_SWELL` (0.02) about its centre when `interaction == 1` and not in reduced motion. The targets follow it in Rust, and the Canvas2D rest `roundRect` follows it in TS.
- **Focus** has no engine effect.
- **`setMaterial(partial)`:** W66's `validateMaterial(partial)`, then W66's `mergeMaterial`, then assign atomically, then `core.set_material(v, c, r)` (D68-9). On `TypeError` the state is unchanged.
- **`getMaterial()`** returns a copy.
- **`create({ material })`** calls `set_material` exactly once, with the resolved values.
- **Fused AABB (D68-10):** redistribute, the reduced-motion pin, splash, shake, an active pointer tick and the test setter `set_particle_px` call `Scratch::invalidate_bounds()`; `SubstepOpts::reuse_bounds` never reuses an AABB older than the last particle-moving call.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_pointer_within_70px_moving_when_accel_evaluated_then_pulled_towards_pointer_velocity_with_weight_1_minus_d_over_r_squared | D68-2, D68-3 |
| 2 | given_particle_at_or_beyond_70px_when_accel_evaluated_then_zero | D68-2 |
| 3 | given_static_pointer_over_resting_liquid_when_accel_evaluated_then_zero_so_no_radial_push | D68-2 (guard once compiled) |
| 4 | given_inactive_pointer_when_accel_evaluated_then_zero | D68-2 |
| 5 | given_nan_or_infinite_pointer_when_sanitized_then_inactive | D68-4 |
| 6 | given_pointer_speed_above_vmax_when_sanitized_then_clamped_to_vmax_preserving_direction | D68-4 |
| 7 | given_hover_interaction_when_swelled_then_rect_grows_2_percent_about_its_centre_with_radius | D68-5 |
| 8 | given_idle_focus_or_dragged_interaction_when_swelled_then_rect_unchanged | D68-5 |
| 9 | given_reduced_motion_or_nan_interaction_when_swelled_then_rect_unchanged | D68-5 |
| 10 | given_card_hovered_when_ticking_then_its_targets_swell_2_percent_about_centre_and_other_elements_unchanged | D68-5 |
| 11 | given_card_focused_when_ticking_then_targets_unchanged | D68-5, focus no-op |
| 12 | given_reduced_motion_and_card_hovered_when_ticking_then_targets_unchanged | D68-5 |
| 13 | given_static_pointer_over_split_when_ticking_1s_then_every_element_stays_at_rest_below_0_75px | D68-2, no hole (guard once compiled) |
| 14 | given_still_pointer_inside_radius_when_ticking_60_frames_then_positions_match_inactive_run_within_0_05px | D68-2, no push (guard once compiled) |
| 15 | given_pointer_sweeping_across_buttons_when_ticking_then_liquid_follows_pointer_direction_and_no_interior_bin_empties | step 2, D68-2 |
| 16 | given_pointer_sweep_then_pointer_inactive_when_ticking_then_every_rest_alpha_returns_to_1_within_3s | step 2 re-form |
| 17 | given_reduced_motion_and_active_pointer_sweep_when_ticking_then_every_particle_stays_on_its_target | D68-5 RM |
| 18 | given_nan_pointer_inputs_when_ticking_then_no_panic_and_positions_finite | D68-4, no panic |
| 19 | given_same_seed_and_pointer_sweep_when_run_twice_then_positions_bit_identical | determinism |
| 20 | given_ticked_core_when_redistribute_splash_shake_reduced_motion_tick_or_set_particle_px_then_fused_aabb_invalidated | D68-10 |
| 21 | solver.rs: given_particle_moved_outside_the_fused_aabb_and_bounds_invalidated_when_substep_reuses_bounds_then_bit_identical_to_plain_substep | D68-10 |
| 22 | solver.rs: given_active_pointer_over_the_block_when_stepping_with_api_options_then_bit_identical_to_plain_substep_and_the_block_moved | D68-10 |
| 23 | elements.rs: given_hover_with_home_offset_and_odd_sizes_when_home_rect_then_bit_identical_to_w64_arithmetic | D68-5 swell refactor bit-identity (guard) |
| 24 | given_constants_when_read_then_match_D68_4 | D68-4 tracker |
| 25 | given_two_samples_at_the_same_timestamp_when_moved_then_dt_floored_at_1_240_s | D68-4 tracker |
| 26 | given_velocity_built_up_when_blur_cancel_or_touch_up_then_next_move_first_sample_has_zero_velocity | D68-4 tracker |
| 27 | given_no_pointer_events_when_sampled_then_inactive_and_zero_velocity | D68-4 tracker |
| 28 | given_pointermove_events_one_frame_apart_when_sampled_then_buffer_space_position_and_smoothed_velocity | D68-4 tracker |
| 29 | given_several_moves_within_one_frame_when_sampled_then_velocity_uses_net_displacement_over_frame_dt | D68-4 tracker |
| 30 | given_container_offset_when_sampled_then_position_is_client_minus_offset | D68-4 tracker |
| 31 | given_no_move_for_less_than_120ms_when_sampled_then_velocity_held_and_then_decays_by_0_8_per_frame | D68-4 tracker |
| 32 | given_leave_when_sampled_then_inactive_and_next_move_starts_from_zero_velocity | D68-4 tracker |
| 33 | given_nonfinite_coordinates_when_moved_then_ignored | D68-4 tracker |
| 34 | given_attached_to_document_when_pointer_events_dispatched_then_tracker_follows_and_detach_removes_listeners | D68-4 tracker |
| 35 | given_pointermove_events_when_sampled_then_buffer_space_position_and_smoothed_velocity_passed_to_tick | D68-4 tracker |
| 36 | given_container_mode_when_sampled_then_pointer_container_relative | D68-4 tracker |
| 37 | given_pointer_left_the_window_when_ticking_then_pointer_active_false | D68-4 tracker |
| 38 | given_reduced_motion_when_ticking_then_pointer_active_false | D68-4 tracker |
| 39 | given_runtime_destroyed_when_inspected_then_document_and_window_pointer_listeners_removed | D68-4 tracker |
| 40 | given_mouseenter_when_synced_then_interaction_slot_1 | D68-2, D68-5 (the test now fires `pointerenter`, mouse) |
| 41 | given_focus_while_hovered_when_synced_then_interaction_slot_1_hover_beats_focus | D68-2 amended again (dec_e431420b; was `…_slot_2`, focus beat hover) |
| 42 | given_focused_when_mouse_leaves_then_interaction_slot_stays_2 | D68-2, D68-5 (leave is `pointerleave`) |
| 43 | given_blur_and_mouseleave_when_synced_then_interaction_slot_0 | D68-2, D68-5 (the test now fires `pointerleave`) |
| 44 | given_element_already_focused_when_observed_then_interaction_slot_2_on_first_sync | D68-2, D68-5 |
| 45 | given_reduced_motion_when_hovered_or_focused_then_interaction_slot_0 | D68-2, D68-5 (guard) |
| 46 | given_reduced_motion_turned_off_when_still_hovered_then_interaction_slot_1_on_next_sync | D68-2, D68-5 |
| 47 | given_child_of_observed_card_focused_when_synced_then_slot_idle | D68-2, D68-5 (guard) |
| 48 | given_element_already_hovered_when_observed_then_interaction_slot_1_on_first_sync | D68-2, D68-5 (initial `:hover` read only under `(hover: hover)`) |
| 49 | given_unobserve_when_called_then_all_four_interaction_listeners_removed | D68-2, D68-5 (`pointerenter`, `pointerleave`, `focus`, `blur`) |
| 50 | given_observe_called_twice_when_listeners_counted_then_attached_once | D68-2, D68-5 |
| 51 | given_create_with_material_when_started_then_set_material_called_once_with_resolved_values | D68-1, D68-9 (guard) |
| 52 | given_setMaterial_partial_when_called_then_merged_validated_and_set_material_called_with_merged_values | D68-1, D68-9 |
| 53 | given_invalid_partial_when_setMaterial_then_TypeError_and_state_unchanged | D68-1, D68-9 |
| 54 | given_unknown_key_or_non_object_when_setMaterial_then_TypeError | D68-1, D68-9 |
| 55 | given_getMaterial_when_result_mutated_then_internal_state_unchanged | D68-1, D68-9 |
| 56 | given_presets_when_read_then_water_honey_jelly_frozen_and_valid | D68-1, D68-9 |
| 57 | given_preset_when_passed_to_setMaterial_or_create_then_core_receives_its_values | D68-1, D68-9 |
| 58 | given_destroyed_instance_when_setMaterial_or_getMaterial_then_destroyed_Error_not_TypeError | D68-1, D68-9 |
| 59 | given_reduced_motion_when_observed_element_clicked_then_core_splash_not_called_and_default_not_prevented | D68-5 RM |
| 60 | given_reduced_motion_when_splash_or_shake_api_called_then_still_validated_but_core_not_called | D68-5 RM |
| 61 | given_live_media_change_to_reduce_when_pointer_moves_then_tick_pointer_inactive_until_changed_back | D68-5 RM |
| 62 | given_live_media_change_to_reduce_when_clicked_then_no_splash_and_after_change_back_one_splash | D68-5 RM |
| 63 | api-migration.test.ts: given_presets_when_imported_then_material_presets_water_honey_jelly_replace_the_old_physics_presets | D68-6 (A2) |
| 64 | api-migration.test.ts: given_old_physics_shaped_config_when_setMaterial_then_TypeError_naming_the_key_and_the_material_fields | D68-6, D68-9 |
| 65 | liquiddom-api.test.ts: given_instance_when_created_then_setMaterial_and_getMaterial_are_functions_and_getMaterial_returns_resolved_material | D68-6 |
| 66 | liquiddom-api.test.ts: given_root_index_when_imported_then_export_keys_equal_whitelist (modified: + presets) | D68-6 |
| 67 | liquiddom-api.test.ts: given_testBackend_when_create_then_instance_with_particleCapacity_and_elementCapacity (modified: + setMaterial, getMaterial) | D68-6 |
| 68 | api-migration.test.ts: given_old_runtime_exports_when_imported_then_each_fate_holds (modified: presets kept) | D68-6 (A2) |
| 69 | e2e: step 2 – given a pointer sweep across the buttons when sampled then canvas alpha inside each button never drops below the fill threshold (no holes) | step 2 (guard at red) |
| 70 | e2e: step 2 – given the sweep when ticking then the liquid reacts and every restAlpha returns to 1 within 3 s after the pointer leaves | step 2 |
| 71 | e2e: step 2 – given the pointer resting on Split when settled then the rest contour is swelled 2 % and un-swells when the pointer leaves | step 2, D68-5 |
| 72 | e2e: step 2 – given the end of the pointer sweep when screenshotted then it matches the baseline (maxDiffPixelRatio 0.01) | step 2 (Linux-only visual, baseline in W68.13) |
| 73 | solver.rs: given_hoisted_pointer_grid_with_cheap_rejection_when_accel_evaluated_then_bit_identical_to_the_w68_reference | D68-3, perf guard (hoisted field, cheap rejection) |
| 74 | solver.rs: given_pointer_disc_outside_the_particle_aabb_when_stepping_then_bit_identical_to_no_pointer | D68-3, D68-10, perf guard (AABB disc skip) |
| 75 | given_touch_tap_with_compat_mouseenter_when_synced_then_slot_idle_and_no_stuck_swell | D68-2 amended (touch ignored) |
| 76 | given_mouse_or_pen_pointerenter_when_synced_then_hover_and_pointerleave_clears_it | D68-2 amended |
| 77 | given_element_matching_hover_at_observe_when_hover_none_then_idle_and_when_hover_hover_then_hover | D68-2 amended (`(hover: hover)` gate) |
| 78 | given_getter_valid_on_first_read_and_invalid_after_when_setMaterial_then_one_consistent_result_matching_the_core | D68-9 (snapshot, getters read once) |
| 79 | given_unknown_key_beside_a_getter_when_setMaterial_then_TypeError_names_the_key_without_reading_it | D68-9 (snapshot) |
| 80 | given_successive_samples_when_compared_then_the_same_object_is_reused_with_current_values | D68-4 tracker (no per-frame allocation) |
| 81 | given_container_in_a_second_document_when_pointer_moves_there_then_tick_receives_it | D68-4 tracker (ownerDocument pointer) |
| 82 | given_hovered_button_focused_by_click_when_synced_then_hover_and_after_pointerleave_while_focused_then_focused | D68-2 amended again (ward review) |
| 83 | given_hovered_element_detached_when_synced_then_not_hover_after_reattach | D68-2 (ward review: hover cleared on detach) |
| 84 | given_hovered_button_disabled_when_synced_then_not_hover | D68-2 (ward review: hover cleared on disable) |
| 85 | solver.rs: given_pointer_disc_overlapping_the_particle_aabb_edge_by_one_cell_when_stepping_then_bit_identical_to_the_unskipped_path | D68-3, perf guard (7c, ward review) |
| 86 | solver.rs: given_disc_touching_just_outside_or_just_inside_an_aabb_edge_when_reaches_then_true_false_true | D68-3, perf guard (7c, ward review) |
| 87 | e2e: step 2 – given a sweep parallel to the row 30 px below the pills when ticking then no element is hovered, the liquid un-rests and a pill's centroid shifts in the sweep direction (pointer field alone) | step 2, D68-3 (ward review: proves the pointer path without hover) |

Totals: 72 rows = 23 Rust (20 `pointer_hover_tests.rs`, 2 `solver.rs`, 1 `elements.rs`) + 45 TS (new and modified-existing) + 4 e2e. Rows marked guard pass at red (or once Rust compiles).

Hovered rest contour: covered by W64 fluid-canvas2d.test.ts given_hover_interaction_at_rest_when_rendering_then_roundRect_at_swelled_home_rect.

## Must NOT
- Reintroduce a hard radial push.
- Give focus an engine effect (the focus ring belongs to the DOM).
- Change the FFI.

## Must DO
- Gate D68-1 … D68-10 before `wdd ward status 68 red`, and log them in NORTH-STAR.
- Reconcile this Tests table in the red commit.
- Inspect the step 2 screenshot and a hover screenshot with vision.

## Manual Smoke Test
### Setup
`npm run build`

### Steps
1. Run: `npx playwright test e2e/acceptance.spec.ts --project=canvas2d`
   Expected: steps 1, 2, 3, 4 and 6 pass.
2. Run: `npm run dev`, open `/scenes/acceptance.html?test=1`, and sweep the pointer across the buttons.
   Verify: a soft bulge that follows the pointer, with no hole. Take a screenshot and inspect it with vision.
3. Hover "Merge" and wait 2 s.
   Verify: the resting pill is visibly about 2 % larger, and crisp.
4. In devtools run `__liquidTest.instance.setMaterial({ viscosity: 0.9 })`, then click "Splash".
   Verify: a visibly thicker, slower splash.

### Pass criteria
- [ ] The step 2 and hover screenshots are inspected with vision.
- [ ] `npm run verify` is green.

## Verification
`npm run verify` and CI e2e canvas2d are green, the screenshots are attached, and Dennis approves.

## Gold notes

**North-star step 2 (canvas2d):**
- **Pointer sweep, soft bulge, no holes.** Baseline `acceptance.spec.ts/acceptance-step2-canvas2d-linux.png` (end of sweep).
  - Vision: Splash has already re-formed crisp. Split and Merge are soft and dragged a few px in the sweep direction (Merge reaches ~880 px vs 874 at rest). No holes; the card is at rest.
  - The effect is deliberately subtle (D68-3: velocity coupling only, drag 6.0); its strength is a W69 tuning item.
- **Pointer-only proof.** A sweep 30 px below the pills never hovers anything, yet the liquid un-rests and each pill's alpha centroid shifts +0.70 to +0.82 px (threshold 0.35).
  - With the browser pointer path forced off, that test fails (shift 0) while the old "reacts" test still passed, which is the gap the ward review found.
- **Hover swell.** Mouse or pen `pointerenter` swells the contour 2 %, and it un-swells on leave. Touch is ignored.

**Decisions changed during execution** (all approved by Dennis):
- D68-7: `pointerout` with `relatedTarget === null` replaces `pointerleave`.
- D68-2 amended twice:
  - `pointerenter`/`leave` ignoring touch, with the initial `:hover` read only under `(hover: hover)`;
  - hover beats focus until slice 5, so a click no longer drops the swell in Chrome/Firefox.
- D68-3 consequence corrected: a resting pointer has no radial effect and only damps moving liquid.
- `POINTER_DRAG_PER_S` stays 6.0; every no-hole test passes at 6.0.

**Reviews:**
- Every task was reviewed.
- Green-range opus review: touch hover stuck after a tap (fixed by the amendment), `setMaterial` getter snapshot, pointer bound to `ownerDocument`.
- Perf hoisting: bit-identical, no measurable gain. The pointer term was already cheap.
- Whole-ward opus review:
  - the "reacts" e2e was satisfiable by hover alone, now a pointer-only proof;
  - click-focus dropped the swell;
  - hover stuck on detach or disable;
  - `reaches()` boundary tests;
  - docs.
- Controller test-bug fixes, all mine from fix rounds:
  - the velocity-reset test chained trackers;
  - the swell guard used r > h/2 (clamped);
  - the no-holes lattice sampled corner points 1.4 px inside the rounded contour.

**Verification:**
- cargo: 143 passed, 1 ignored.
- vitest: 400 passed, 4 skipped.
- canvas2d (macOS): 24 passed.
- Linux Docker acceptance: 14 passed. All baselines match, including the new step-2 one.
- clippy and fmt clean.
- p95 ~3.5 ms per fixed step with the pointer inactive, ~3.7 ms with it active.

**Known limitations:**
- The ×0.8 pointer idle decay is per frame, so it is twice as fast at 120 Hz.
- A detach and reattach within one frame keeps a stale hover.
- On a hybrid device whose primary input is `hover: none`, a mouse already over an element at observe time is missed until the next `pointerenter`.
- The pointer-only sweep line passes 2 px above the card, which makes it layout-sensitive.

**Carry to W69:** the W67 observations (text contrast, furry edges, shake feel), pointer-bulge strength, preset tuning, the dist smoke test, and ring density.
