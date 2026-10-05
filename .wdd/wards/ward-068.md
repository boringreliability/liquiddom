---
ward: 68
revision: null
name: "Pointer, hover and material"
epic: "fluid-engine"
status: "planned"
dependencies: [67]
layer: "both"
estimated_tests: 20
created: "2026-10-03"
completed: null
---
# Ward 068: Pointer, hover and material

North star: step 2 (pointer sweep: soft bulge, no holes), plus the hover swell on the resting contour. The material becomes tunable for the W69 playground.

## Scope
- Rust: the soft pointer field (moved here from W67 by D63-4) and the hover swell of the home rect.
- TS:
  - the pointer tracker (buffer-space position and smoothed velocity → `tick`);
  - hover and focus tracking, written into `interaction` (focus beats hover);
  - `setMaterial`/`getMaterial` and the material presets;
  - reduced-motion input gating. Detection stays in W64.
- Playwright: step 2.

## Inputs
- W67 engine and API; W64's `HOVER_SWELL` shared constant and the rest contour drawn at the home rect (B1).
- Spec §2 interaction table, the hover rule, reduced motion.

## Outputs
- Modified: `src/fluid/{interaction,elements,solver}.rs` (pointer field, hover swell).
- `packages/core/ts/src/input.ts` (pointer tracker, hover/focus listeners), `element-registry.ts` (`interaction` slot), `material.ts` (`presets`), `index.ts` (`setMaterial`, `getMaterial`, the `presets` export).
- Tests `pointer-input.test.ts`, `hover-focus.test.ts`, `material-api.test.ts`. Modified: `api-migration.test.ts` and `liquiddom-api.test.ts` (whitelist + `presets`), `fluid-canvas2d.test.ts` (hovered rest contour).
- `e2e/acceptance.spec.ts` step 2 with its baseline.

## Decisions
### D68-1: Material preset values
Proposal: water `{viscosity: 0.15, cohesion: 0.3, recovery: 0.5}`, honey `{0.9, 0.7, 1.6}`, jelly `{0.6, 0.85, 0.4}`, frozen, to be tuned in the W69 playground (skeleton D68-2).
Consequence: three distinct feels from the start, and the values may change after W69 without an API change.
Decision: PENDING

### D68-2: Hover via mouseenter/mouseleave; focus beats hover
Proposal: `mouseenter`/`mouseleave` set hover, and `focus`/`blur` set focused. The `interaction` slot is 2 when focused, else 1 when hovered, else 0. It is written in `registry.sync()` (skeleton D68-4).
Consequence: keeps the old observer's semantics. Touch devices get no hover bulge.
Decision: PENDING

### D68-3: The soft pointer field is in Rust
Proposal: particles within 70 px of the pointer are pulled towards the pointer's velocity with weight `(1 − d/r)²`, with no radial push (skeleton D67-2, moved by D63-4).
Consequence: the spike's "hole" is gone. Pointer cost is O(n) per substep, bounded by the radius test.
Decision: PENDING

### D68-4: Pointer velocity smoothing
Proposal: `v ← 0.5·v_prev + 0.5·v_instant` per pointer event, decaying by ×0.8 per frame when there has been no event for more than 120 ms (spike behaviour). `pointerleave` sets `pointer_active = false`.
Consequence: a stable field without jitter, and a still pointer stops pushing.
Decision: PENDING

### D68-5: Reduced-motion input gating in TS
Proposal: under reduced motion TS passes `pointer_active = false` and writes `interaction = 0`, in addition to Rust ignoring them.
Consequence: defence in depth, and the hover swell never appears under reduced motion.
Decision: PENDING

### D68-6: presets join the export whitelist
Proposal: the whitelist test gains `presets` (and `SplashOptions` stays a type). W66's absent-test only asserted that the old physics-shaped presets were gone (A2).
Consequence: the API gains its material presets without contradicting the W66 tests.
Decision: PENDING

## Specification
- **Pointer:** a document `pointermove` → buffer-space position (minus the container offset) and px/s velocity → `tick(dt, px, py, pvx, pvy, active, gx, gy)`.
- **Hover swell:** the home rect is scaled by `1 + HOVER_SWELL` (0.02) about its centre when `interaction == 1` and not in reduced motion. The targets follow it in Rust, and the Canvas2D rest `roundRect` follows it in TS.
- **Focus** has no engine effect.
- **`setMaterial(partial)`:** merge, then `validateMaterial`, then assign atomically, then `core.set_material(v, c, r)`. On `TypeError` the state is unchanged.
- **`getMaterial()`** returns a copy.
- **`create({ material })`** calls `set_material` exactly once, with the resolved values.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_pointer_within_70px_moving_when_ticking_then_particles_pulled_towards_pointer_velocity_with_weight_1_minus_d_over_r_squared | pointer field |
| 2 | given_static_pointer_over_liquid_when_ticking_then_no_radial_push_and_no_hole | no hole |
| 3 | given_hover_interaction_when_ticking_then_home_rect_swells_2_percent_about_centre | hover swell |
| 4 | given_focus_interaction_when_ticking_then_targets_unchanged | focus no-op |
| 5 | given_pointermove_events_when_sampled_then_buffer_space_position_and_smoothed_velocity_passed_to_tick | tracker |
| 6 | given_container_mode_when_sampled_then_pointer_container_relative | container |
| 7 | given_pointerleave_when_ticking_then_pointer_active_false | leave |
| 8 | given_reduced_motion_when_ticking_then_pointer_active_false | RM gating |
| 9 | given_mouseenter_when_synced_then_interaction_slot_1 | hover |
| 10 | given_focus_while_hovered_when_synced_then_interaction_slot_2 | focus beats hover |
| 11 | given_blur_and_mouseleave_when_synced_then_interaction_slot_0 | reset |
| 12 | given_reduced_motion_when_hovered_then_interaction_slot_0 | RM gating |
| 13 | given_hovered_element_at_rest_when_rendering_then_roundRect_is_home_rect_swelled_by_HOVER_SWELL | B1 rest contour |
| 14 | given_setMaterial_partial_when_called_then_merged_validated_atomically_and_set_material_called | material API |
| 15 | given_invalid_partial_when_setMaterial_then_TypeError_and_state_unchanged | atomic |
| 16 | given_getMaterial_when_result_mutated_then_internal_state_unchanged | copy |
| 17 | given_presets_when_read_then_water_honey_jelly_frozen_and_valid | D68-1 |
| 18 | given_create_with_material_when_started_then_set_material_called_once_with_resolved_values | create path |
| 19 | given_root_index_when_imported_then_export_keys_equal_whitelist (modified: + presets) | D68-6 |
| 20 | step 2 – given a pointer sweep across the buttons when sampled then canvas alpha inside each rect never drops below the fill threshold (no holes) and the frame matches baseline | step 2 |

## Must NOT
- Reintroduce a hard radial push.
- Give focus an engine effect (the focus ring belongs to the DOM).
- Change the FFI.

## Must DO
- Gate D68-1 … D68-6 before `wdd ward status 68 red`, and log them in NORTH-STAR.
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
