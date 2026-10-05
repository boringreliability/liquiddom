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
Proposal: water `{viscosity: 0.15, cohesion: 0.3, recovery: 0.5}`, honey `{0.9, 0.7, 1.6}`, jelly `{0.6, 0.85, 0.4}`, frozen and tuned in the W69 playground.
Consequence: three distinct feels from the start; honey (recovery 1.6 s) re-forms in ≈ 4.6 s, because the 3 s budget (D67-1) is defined for the default material only.
Decision: APPROVED 2026-10-06 — water/honey/jelly as proposed (saga dec_42a7df27)

### D68-2: Hover via mouseenter/mouseleave; focus beats hover
Proposal: `mouseenter`/`mouseleave` and `focus`/`blur` on the observed element itself (not `focusin`); focus beats hover; the initial state is read from `:hover` / `document.activeElement` at observe time; slot 5 is written 0/1/2 on every `sync()`, 3 (dragged) is reserved for slice 5.
Consequence: focus on a child of a card does not count as card focus; touch devices get no hover bulge.
Decision: APPROVED 2026-10-06 — element-level enter/leave and focus/blur, focus beats hover (saga dec_802fccd4)

### D68-3: The soft pointer field is in Rust
Proposal: velocity coupling only: inside `POINTER_RADIUS_PX = 70`, `a = (v_ptr − v_p) · POINTER_DRAG_PER_S · (1 − d/r)²` with `POINTER_DRAG_PER_S = 6.0`, added after the home-spring saturation, with no radial term; NaN/Inf makes the pointer inactive and its speed is clamped to `POINTER_VMAX_PX_S = 2000`.
Consequence: a resting pointer has exactly zero effect, so it cannot make a hole; a 600 px/s sweep drags the liquid a few px. If the no-hole tests fail, `POINTER_DRAG_PER_S` is lowered in this ward and the value goes into the gold notes.
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
Decision: APPROVED 2026-10-06 — leave/cancel/touch-up/blur deactivate (saga dec_8adfe545)

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
