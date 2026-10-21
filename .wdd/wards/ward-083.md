---
ward: 83
revision: null
name: "Gravity and tilt"
epic: "fluid-engine"
status: "complete"
dependencies: [82]
layer: "both"
estimated_tests: 33
created: "2026-10-14"
completed: "2026-10-20"
---
# Ward 083: Gravity and tilt

North star: none of the 8 acceptance steps (they run with gravity `none` and stay bit-identical); the slice matrix's tilt experience — tilting the phone sloshes the liquid to one side and it settles at home again (slice design §6, D83-1), shown live in a new `demo/scenes/tilt.html`.

## Scope
Fourth ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §6). `gravity: { source: 'none' | 'fixed' | 'orientation', vector, strength }` reaches `tick(…, gx, gy)`. Only changes in gravity act (a high-pass): Rust adds the high-passed `g·dt` to grid velocities of cells with mass, scaled so the liquid never leaves its element, so a tilt sloshes the liquid and it rests at home, the exact contour and the DOM text work as today. A `setGravity(partial)` setter changes it at run time; `orientation` follows `deviceorientation` (listener removed on `destroy`, `requestOrientationPermission()` on iOS); reduced motion means g = 0. The scale, the high-pass time constant, a fixed vector's behaviour at `create()` and the orientation mapping come from the measurement spike W83.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W83.md`, part 1); part 2 of the plan is written after the gate. W82's page-text ink probes gain a 200-ink-pixel floor in this ward's red (approved by Dennis 2026-10-14, saga dec_6f6924ff).

Out of scope: touch drag and the drag opt-out (W84), the adapters (W85), the site (W86), a persistent gravity lean (rejected, slice design §1).

## Inputs
- The slice design §6, §11, §12 (D83-1 … D83-3) and the spec §2 interaction table (gravity row) and §5 API, as amended in `17ede66`.
- `options.ts` `resolveGravity`, `index.ts` (gravity dropped, `requestOrientationPermission`), `api.rs` `tick` (`_gx`, `_gy`), `gravity.test.ts` (four `it.skip`), the ignored slice-6 Rust scenario.
- Baseline at `4a38e4a` (W82 complete): see Specification.

## Outputs
- Rust: `src/fluid/gravity.rs` (`HighPass`, `GRAVITY_SCALE` 1.5, `GRAVITY_TAU_S` 0.5, `GRAVITY_CLAMP_PX_S2` 2000, `GRAVITY_SNAP_PX_S2` 0.5, `sanitized`); `FluidCore::seed_gravity(gx, gy)`; `tick` high-passes `(gx, gy)` per fixed step into `Grid::set_body_accel`; `update_velocities` adds it to cells with mass before the walls and the CFL cap (D83-1, D83-2, D83-4).
- TS: `gravity.ts` (`GravityInput`, `fixedGravity`, `orientationGravity`, `screenAngle`, `ORIENTATION_DEAD_BAND_DEG`), `mergeGravity` in `options.ts`, `setGravity(partial)` on the instance, the runtime hands every tick its gravity and seeds the core's low-pass when a gravity starts fresh (D83-3 … D83-5).
- Demo: `demo/scenes/tilt.html` (RAF by default; a gravity slider, "Use device tilt"; `?gravity=`, `?angle=`, `?clock=manual`, hook `window.__tilt`).
- Tests: 12 Rust, 16 vitest, 4 e2e (3 canvas2d, 1 webgpu-hw); the approved-test changes listed under Tests.
- Docs: spec §2 (gravity row, `seed_gravity`), §5 (`setGravity`, gravity semantics), §6 interim note; CLAUDE.md; CONTEXT; core README; changeset.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D83-1: High-pass gravity — only changes act
Proposal: Rust keeps a low-pass `g_lp` per core and adds `scale·g_hp·dt` (`g_hp = g − g_lp`) to the grid velocities of cells with mass, after momentum → velocity and before the walls and the CFL cap; `|scale·g_hp|` is clamped to 2000 px/s² and `|g_hp| < 0.5 px/s²` snaps to 0 (so the engine returns to bit-identity ≈ 8τ after a change). The home spring is unchanged: a tilt gives a subtle lean of a few px that settles at home, not a run to the side (Dennis chose this over a softer spring during a tilt, 2026-10-14). Reduced motion: g = 0. Parked particles skip the grid and are unaffected (brainstorm 2026-10-13, saga dec_645b54e4, made concrete by W83.0).
Consequence: tilt is a subtle, live detail (W83.0 Q1: a 90° tilt leans 6.4 px at its peak, ragged edges for a few frames, rest within 142 frames, ≤ 0.05 px left after 3 s; the settled frame is byte-identical to the frame before the tilt); the clamp keeps it below the spring's saturation, where the liquid would run out of its element (20–700 px). A tilt during a shake stays bounded (153 px vs 98 px for the shake alone, re-forms within 150 frames). With `source: 'none'` every acceptance step is bit-identical.
Decision: APPROVED 2026-10-14 — high-pass as proposed: per-core low-pass, scale·g_hp·dt on grid velocities with mass after momentum → velocity, clamp 2000 px/s², snap below 0.5 px/s², home spring unchanged (a subtle lean, Dennis chose it over a softer spring), reduced motion g = 0 (saga dec_1b0ca2b0)

### D83-2: Gravity scale and high-pass time constant
Proposal: τ = 0.5 s, scale = 1.5, clamp `|scale·g_hp|` ≤ 2000 px/s².
Consequence: W83.0 Q1 grid (τ 0.25/0.5/1.0 × scale 0.25/0.5/1.0): the slosh peaks at ≤ 5 px and a 20° or slow 2 s tilt at scale ≤ 0.5 never drops restAlpha (nothing visible); 1.5 with the clamp is the largest visible lean that stays inside rect + one kernel radius (6.4 of 7.09 px) even at 2× strength.
Decision: APPROVED 2026-10-14 — tau 0.5 s, scale 1.5, clamp 2000 px/s² (saga dec_92788d5a)

### D83-3: Changing gravity at run time
Proposal: a `setGravity(partial)` setter, snapshotted, validated and applied atomically like `setMaterial`; for `fixed` the gravity is `normalize(vector)·strength` (both are typed px/s² today, which is ambiguous); a zero vector means no gravity; the Rust clamp guards large strengths.
Consequence: a new public method; `fixed` gravity acts only when it changes (D83-1); the `vector` + `strength` meaning is documented.
Decision: APPROVED 2026-10-14 — setGravity(partial) atomic like setMaterial; fixed gravity = normalize(vector)·strength, a zero vector means none (saga dec_993e915c)

### D83-4: A fixed vector at create()
Proposal: the low-pass is seeded with the initial gravity at `create()` (and on a source switch), so a fixed vector starts at rest; only later changes act.
Consequence: W83.0 Q2: crisp from frame 0 and bit-identical to `none`; the alternative (high-pass from 0) leaned ≈ 2 px at load and held restAlpha below 1 for 74 frames.
Decision: APPROVED 2026-10-14 — the low-pass is seeded with the initial gravity at create() and on a source switch, so a fixed vector starts at rest (saga dec_f274696e)

### D83-5: Orientation mapping
Proposal: `deviceorientation` → `px = cos β · sin γ`, `py = sin β`, rotated by θ = `screen.orientation.angle`: `gx = s·(px·cos θ + py·sin θ)`, `gy = s·(−px·sin θ + py·cos θ)`; a 2° dead band on the gravity direction; the listener is added only for `source: 'orientation'` and removed on `destroy`; `requestOrientationPermission()` (iOS) unchanged.
Consequence: W83.0 Q3: all 8 sign cases (portrait, landscape left/right, upside down × tilt directions) check out and a flat phone gives (0, 0); with ±0.5° sensor noise rest held with every band, and only the 2° band makes `g_hp` exactly 0 at rest (the engine stays bit-quiet); a real 30° tilt passes unchanged. Not tested: the iOS permission prompt on a device.
Decision: APPROVED 2026-10-14 — beta/gamma projection rotated by screen.orientation.angle, 2 degree dead band, listener only for orientation and removed on destroy (saga dec_ec44cc30)

## Spike W83.0 result (2026-10-14, a throwaway copy of `7a67ce7`, deleted; report `.superpowers/sdd/W83/spike-Q.md`, stills in `.superpowers/sdd/W83/stills/`, inspected with vision)

| Q | Candidates | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1 | τ 0.25/0.5/1.0 s × scale 0.25/0.5/1.0, then 1.5–3 | peak slosh ≤ 5 px at scale ≤ 1; 20° and slow tilts at ≤ 0.5 never drop restAlpha; cliff at `scale·|Δg|` ≈ 2800–3200 px/s² (spring `a_max`): 20–700 px out of the element; τ 0.5 + scale 1.5 + clamp 2000: 90° tilt 6.4 px (≤ rect + 7.09 px kernel, also at 2×), rest 142 frames (budget 180), ≤ 0.05 px after 3 s | a 3–4 px lean with ragged edges in both renderers; WebGPU text rides the liquid; settled frame byte-identical to before | τ 0.5, scale 1.5, clamp 2000 (D83-2); subtle lean accepted by Dennis over a softer spring (D83-1) |
| Q2 | (i) high-pass from 0, (ii) low-pass seeded at create | (i) ≈ 2 px lean at load, restAlpha < 1 for 74 frames; (ii) bit-identical to `none` | (i) a visible lean in WebGPU; (ii) crisp from frame 0 | (ii) (D83-4) |
| Q3 | dead band 0°, 1°, 2° | ±0.5° noise: rest held with all; only 2° makes `g_hp` exactly 0; 30° tilt passes; 8 sign cases correct, flat phone (0, 0) | — | mapping + 2° band (D83-5) |
| Q4 | `none`, seeded `fixed` | all 8 acceptance-step state hashes equal HEAD; reduced motion g = 0; parked, drag, scroll unaffected; a snap `|g_hp| < 0.5 → 0` is needed for bit-identity to return after a change | — | snap in D83-1 |

## Specification
**Values.** `GRAVITY_SCALE = 1.5`, `GRAVITY_TAU_S = 0.5`, `GRAVITY_CLAMP_PX_S2 = 2000`, `GRAVITY_SNAP_PX_S2 = 0.5`, `GRAVITY_INPUT_MAX_PX_S2 = 1e5` (`gravity.rs`); `ORIENTATION_DEAD_BAND_DEG = 2` (`gravity.ts`); `strength` default 980 px/s² (unchanged).

**Engine (Rust, D83-1, D83-2).** `HighPass` holds `g_lp` (f64). Per fixed step of `tick`: `g` sanitised (NaN/Inf → 0, ±1e5); `h = g − g_lp`; if `|h| < 0.5` then `g_lp = g` and the step adds exactly nothing; else the grid gets `1.5 · h`, clamped to 2000 px/s² along its direction, in cells/s² (`Grid::set_body_accel`), and `g_lp += (1 − e^(−FIXED_DT/τ)) · h`. Every substep's `update_velocities` adds `body_accel · dt` to the cells with mass after momentum → velocity, before the walls and the CFL cap; a zero body acceleration is skipped (bit-identical to W82). Under reduced motion `tick` seeds `g_lp = g`. `seed_gravity(gx, gy)` sets `g_lp = g` (sanitised). FFI layout and the constructor are unchanged.

**Sources (TS, D83-3 … D83-5).** `fixed`: `normalize(vector) · strength`, a zero vector (or strength 0) is none. `orientation`: `d = (cos β · sin γ, sin β, cos β · cos γ)` from `deviceorientation`; the held `d` moves only when a reading turns it by more than 2°; `g = strength · (dx · cos θ + dy · sin θ, −dx · sin θ + dy · cos θ)` with `θ = screen.orientation.angle` (else `window.orientation`, else 0); no reading yet: none. The listener is added only while the source is `orientation` and removed on a source switch and on `destroy`. Under reduced motion every tick gets 0. `core.seed_gravity(g)` runs before the tick at `create()`, after a source switch, on the first orientation reading and on the first frame after reduced motion. `setGravity(partial)`: every own key read once, the merge validated like create()'s `gravity` (TypeError, state unchanged), then handed to the runtime.

**Baseline (2026-10-14, `4a38e4a`).**

| Suite | Count |
|---|---|
| cargo | 228 passed; 0 failed; 2 ignored |
| vitest | 752 passed, 4 skipped (756), 75 files |
| Playwright `--list` | canvas2d 94, webgpu 51, webgpu-hw 97, perf 6 |

## Tests

| # | Test Name | Verifies | Red outcome | Gold outcome |
|---|-----------|----------|-------------|--------------|
| 1 | gravity.rs: given_the_approved_decisions_when_reading_the_gravity_constants_then_they_equal_the_literals | D83-1, D83-2 values | ✅ passes (guard) | ✅ passes |
| 2 | gravity.rs: given_gravity_input_when_sanitized_then_finite_values_are_kept_up_to_1e5_and_nan_or_inf_gives_0 | no panics on JS input | ❌ the stub gives (0, 0) | ✅ passes |
| 3 | gravity.rs: given_a_90_degree_step_when_the_high_pass_steps_then_it_starts_at_the_scaled_change_decays_with_tau_and_snaps_to_exactly_0 | D83-1, D83-2 high-pass and snap, W83 RF1 | ❌ "1.5 · (g − g_lp)": (0, 0) | ✅ passes |
| 4 | gravity.rs: given_a_180_degree_flip_at_double_strength_when_stepped_then_the_output_is_clamped_to_2000_px_s2_along_the_change | D83-1 clamp | ❌ "clamped: 0" | ✅ passes |
| 5 | gravity.rs: given_a_seeded_low_pass_when_stepped_with_the_same_gravity_then_every_step_returns_exactly_0 | D83-4 seed | ✅ passes (guard) | ✅ passes |
| 6 | gravity.rs: given_gravity_none_and_a_seeded_constant_vector_when_the_acceptance_stress_runs_then_the_core_state_is_bit_identical | bit-identity, RF2 | ✅ passes (guard) | ✅ passes |
| 7 | gravity.rs: given_a_90_degree_tilt_when_the_snap_engages_then_the_core_runs_bit_identical_to_one_without_gravity_and_not_before | the snap restores bit-identity, RF1 | ❌ "1 s after the tilt the high-pass still acts" | ✅ passes |
| 8 | gravity.rs: given_reduced_motion_when_gravity_turns_and_motion_returns_then_nothing_sloshes | reduced motion, RF4 | ❌ "under reduced motion the low-pass followed g": (0, 0) | ✅ passes |
| 9 | gravity.rs: given_non_finite_gravity_when_seeded_and_ticked_then_nothing_panics_and_the_core_equals_one_without_gravity | no panics on JS input | ✅ passes (guard) | ✅ passes |
| 10 | gravity.rs: given_a_parked_element_when_gravity_tilts_then_its_particles_are_bit_unchanged_while_the_others_lean | W81 parking | ❌ "the tilt leans the on-screen elements" | ✅ passes |
| 11 | scenario_tests.rs: given_a_constant_gravity_seeded_at_create_when_ticking_then_positions_identical_to_zero_gravity (approved-test change) | D83-1, D83-4 | ✅ passes (guard) | ✅ passes |
| 12 | scenario_tests.rs: given_a_90_degree_tilt_on_the_settled_acceptance_layout_when_ticking_then_the_liquid_leans_inside_rect_plus_kernel_rests_within_3_s_and_no_deviation_persists (approved-test change) | D83-1 slosh and rest, RF3 | ❌ "the tilt leans the liquid: peak 0 px" | ✅ passes |
| 13 | gravity-input.test: given_a_fixed_vector_and_strength_when_fixedGravity_then_normalize_vector_times_strength_and_a_zero_vector_or_strength_is_no_gravity | D83-3 | ❌ stub [0, 0] | ✅ passes |
| 14 | gravity-input.test: given_device_orientation_poses_when_orientationGravity_then_the_W83_0_sign_table_holds_and_a_flat_phone_feels_none | D83-5 mapping | ❌ stub (portrait upright gy 0) | ✅ passes |
| 15 | gravity-input.test: given_screen_orientation_angle_or_window_orientation_when_screenAngle_then_they_are_read_in_that_order_and_anything_else_is_0 | D83-5 θ | ❌ stub 0 | ✅ passes |
| 16 | gravity-input.test: given_an_orientation_source_when_readings_arrive_then_the_first_seeds_noise_within_2_degrees_is_held_and_a_larger_tilt_acts_without_a_seed | D83-5 dead band, D83-4 | ❌ stub never seeds | ✅ passes |
| 17 | gravity.test: given_gravity_none_when_ticking_then_the_low_pass_is_seeded_with_zero_once_and_every_tick_receives_zero_gravity_even_after_an_orientation_event (approved-test change) | none, D83-4 | ❌ no seed_gravity | ✅ passes |
| 18 | gravity.test: given_gravity_fixed_when_created_then_the_low_pass_is_seeded_with_normalize_vector_times_strength_before_the_first_tick_and_every_tick_receives_it (approved-test change) | D83-3, D83-4 | ❌ no seed; ticks get (0, 0) | ✅ passes |
| 19 | gravity.test: given_orientation_event_when_ticking_then_beta_gamma_mapped_to_gx_gy_and_the_first_reading_seeds (approved-test change) | D83-5 | ❌ no seed; ticks get (0, 0) | ✅ passes |
| 20 | gravity.test: given_reduced_motion_when_ticking_then_gravity_clamped_to_zero (approved-test change: un-skipped) | reduced motion | ✅ passes (guard) | ✅ passes |
| 21 | gravity.test: given_orientation_source_when_destroyed_then_deviceorientation_listener_removed (approved-test change: un-skipped) | D83-5 listener | ❌ no deviceorientation listener | ✅ passes |
| 22 | gravity.test: given_fixed_gravity_when_setGravity_changes_the_vector_then_the_next_ticks_receive_the_new_gravity_without_a_seed | D83-3, D83-1 | ❌ ticks get (0, 0) | ✅ passes |
| 23 | gravity.test: given_a_source_switch_when_setGravity_then_the_low_pass_is_seeded_before_the_next_tick_and_the_orientation_listener_follows_the_source | D83-4, D83-5, RF5 | ❌ no seed | ✅ passes |
| 24 | gravity.test: given_an_invalid_partial_when_setGravity_then_a_TypeError_names_the_problem_the_gravity_is_unchanged_and_after_destroy_it_throws_Error | D83-3 atomic | ❌ no TypeError (stub merge) | ✅ passes |
| 25 | gravity.test: given_a_partial_with_a_getter_when_setGravity_then_the_value_is_read_once | D83-3 snapshot | ❌ read 0 times | ✅ passes |
| 26 | gravity.test: given_reduced_motion_when_it_ends_then_the_low_pass_is_seeded_with_the_gravity_before_the_first_tick_with_motion | reduced motion, D83-4, RF4 | ❌ no seed | ✅ passes |
| 27 | gravity.test: given_orientation_source_when_the_first_reading_arrives_then_it_seeds_and_a_later_tilt_beyond_the_dead_band_acts_without_a_seed | D83-4, D83-5, RF5 | ❌ no seed | ✅ passes |
| 28 | fluid-ffi.test: given_the_real_core_when_a_constant_gravity_is_seeded_then_it_is_bit_identical_to_none_and_a_90_degree_tilt_moves_the_liquid_to_the_right | the WASM export | ❌ "leans the liquid right": 0 | ✅ passes |
| 29 | e2e tilt (canvas2d): D83-1 – given the tilt scene at rest when gravity turns 90° then the liquid leans, none leaves its rect + 8 px, every restAlpha is 1 within 3 s and the settled frame equals the frame before the tilt | D83-1 in the browser | ❌ restAlpha stays 1 | ✅ passes |
| 30 | e2e tilt (canvas2d): D83-4 – given a fixed vector at create() when the scene loads then every restAlpha is 1 from the first frame and the canvas equals the same scene with gravity none | D83-4 | ✅ passes (guard) | ✅ passes |
| 31 | e2e tilt (canvas2d): D83-5 – given gravity orientation when the first deviceorientation reading arrives then nothing moves, and a 30° tilt leans the liquid and every restAlpha is 1 within 3 s | D83-5 in the browser | ❌ "the 30° tilt leans the liquid": 1 | ✅ passes |
| 32 | e2e webgpu-robust (webgpu-hw): W83 D83-1 – given renderer webgpu on the tilt scene when gravity turns 90° then the liquid leans, none leaves its rect + 8 px, every restAlpha is 1 within 3 s and the settled frame equals the frame before the tilt | D83-1 in WebGPU | ❌ restAlpha stays 1 | ✅ passes |
| 33 | gravity.rs: given_ticks_of_different_length_when_gravity_turns_then_the_low_pass_advances_once_per_fixed_step_not_per_tick | D83-2 tau per fixed step, frame-rate independent (red fix round 1) | ❌ the stub seed sanitises to (0, 0) | ✅ passes |

Approved-test changes at red (Dennis approves with the tests): `gravity.test.ts` (rows 17–21: the zero-gravity test keeps only `none`; the four `it.skip` rewritten to the high-pass and un-skipped; header and describe name), `scenario_tests.rs` (rows 11–12: the D67-2 test seeds its constant gravity; the ignored slice-6 scenario becomes slosh-then-rest), `__fixtures__/api-migration-types/index.ts` (`setGravity` lines checked by the existing tsc test), and the W82 ink floor carried from Dennis' approval of 2026-10-14 (saga dec_6f6924ff): `e2e/under-page.spec.ts` (three probes) and `e2e/webgpu-robust.spec.ts` (`w82Probe` returns `ink`; three probes) require more than `MIN_INK_PX` (200, `e2e/under-page.ts`) glyph-ink pixels.

Fix round 1 (task review) added assertions inside the rows above, and one Rust test beyond the 32 rows (the low-pass advances once per fixed step, not per tick; red: the stub `seed` sanitises to (0, 0)): dead-band cases 1.5°/1.9°/2.1° (row 16), four rotation cases with dy·sin θ ≠ 0 (row 14), an atomicity case (row 24), listener removal on destroy and no listener for `none` (rows 23, 17), same-source and strength restatements without a seed (rows 22, 27), seed/tick args compared numerically (row 18), `outsideBefore` is 0 (rows 29, 32).

Red run (W83.1, before fix round 1): cargo 232 passed, 7 failed, 1 ignored (rows 2, 3, 4, 7, 8, 10, 12); after fix round 1 cargo is 232 passed, 8 failed; vitest 3 files failed, 15 tests failed, 752 passed (767) (rows 13–19, 21–28); e2e canvas2d rows 29 and 31 fail, 30 passes, `under-page.spec.ts` 9/9 pass with the ink floor (lede 1399 ink px, `#note` 2446); webgpu-hw row 32 fails, the two W82 tests pass. All counts equal the plan's expectation; no deviation. `--list`: canvas2d 97, webgpu 51, webgpu-hw 98, perf 6.

Gold run (W83.5, 2026-10-20): all 33 rows pass. cargo 240 passed, 0 failed, 1 ignored (the 239 the plan validated plus row 33); vitest 772 passed (772), 76 files: 767 at the plan plus five tests added after red, each failing before its fix: three in the W83.3 task review (a stopped instance drops its deviceorientation listener; a huge finite vector normalises overflow-safely; `vector` elements are read once) and two in the ward review (no listener comes back through `setGravity` after a failed frame; a failed rebuild after a lost device drops it); clippy and `cargo fmt --check` clean; wdd-docs 35/35. e2e (macOS): canvas2d 82 passed, 15 skipped; webgpu-hw (Metal) 54 passed, 44 skipped. 90° tilt, canvas2d and Metal: min restAlpha 0, outside rect + 8 px 0 → 0 px, rest after 119 frames, the settled frame equals the frame before (Rust: peak lean 6.44 px). Orientation: the first reading leaves everything at rest, the 30° tilt rests after 74 frames. W82 ink floor: lede 1399, `#note` 2446 ink px, 0 covered. Docker (pinned image, canvas2d, no `--update-snapshots`): 95 passed, 2 skipped, 0 failed; `e2e/__screenshots__` unchanged. Vision (W83.4, approved by Dennis 2026-10-20): every element leans a few px toward the new gravity with ragged edges, WebGPU's atlas text rides the liquid, nothing far outside an element, the settled frame crisp and equal to before; `?angle=90` crisp from the first frame; a quick 180° flip sloshes and rests, a slow move only leans. Ward review (opus): no critical or high; Review Focus 1–5 true in code and pinned; medium 1–2 (listener lifetime on a stopped instance) fixed in 76e0e2f; low: README rest time 2 s → 3 s and the spec's interim gravity sentence fixed; parked: a `strength` above f32 max gives no gravity instead of the clamp (harmless), the demo slider from `?gravity=none` seeds its first move (demo only); a dragged element's liquid feels the tilt like every other (cells with mass, as decided). Manual smoke: pending Dennis.

**Resolved at gold (Dennis, 2026-10-20):** gold approved after a live smoke test (saga dec_f9a1400a). Open for W84: touch drag and the per-element opt-out; gravity acts on a dragged element's liquid like on every other (cells with mass, as decided). Parked: a `strength` above f32 max gives no gravity instead of the clamp; the demo slider from `?gravity=none` seeds its first move. Carried: the Canvas2D scroll-frame cost (W80); the W82 stacking limits; iOS `requestOrientationPermission()` and real sensor noise untested.

## Must NOT
- Change the FFI layout or the 7-arg constructor (gravity travels through `tick`'s `gx, gy`).
- Move any acceptance step or Linux baseline with gravity `none`.
- Let a constant gravity lean the liquid (D83-1).
- Copy spike code into the repo (D2); keep spike copies after their numbers are recorded.

## Must DO
- Reduced motion: g = 0.
- Remove the `deviceorientation` listener on `destroy`.
- Every scene live on the RAF clock by default.

## Manual Smoke Test
### Setup
`npm run dev`, then `http://localhost:3000/scenes/tilt.html?renderer=auto` (Metal: WebGPU) and `…?renderer=canvas2d`. Real tilt needs a phone and a secure context (`deviceorientation` is HTTPS-only): the same page served over HTTPS, then "Use device tilt" (optional; W83.0 checked the mapping on synthetic traces only).

### Steps
1. Move the vector slider (desktop) or tilt a phone.
   Verify: the liquid sloshes to the side and settles at home; nothing stays leaning.

### Pass criteria
- [ ] Slosh on a change, rest at home afterwards, in both renderers.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, `npm run e2e:docker -- --project=canvas2d` (every Linux baseline unchanged, no `--update-snapshots`), vision on `tilt.html` in both renderers.
