---
ward: 81
revision: null
name: "Parking and resize"
epic: "fluid-engine"
status: "gold"
dependencies: [80]
layer: "both"
estimated_tests: 36
created: "2026-10-14"
completed: null
---
# Ward 081: Parking and resize

North star: step 7 (a long page scrolls with every far element parked off-screen and back at rest the frame it re-enters) and step 1 (idle and resize: the grid grows once when the window outgrows it, nothing re-forms), in both renderers; steps 2–6 and 8 unchanged. Step 7 ✅ in S6 is claimed in W87.

## Scope
Second ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §4). Rust parks every element whose home rect lies entirely outside the world plus the grid margin: its particles carry a new `FLAG_PARKED` bit in the dynamic view, are left out of the transfers, the dirty region, `scroll_shift`, splash, shake and the merge damage, and the element is held at rest; it comes back at rest, in the tick it re-enters, once its rect lies 64 px inside the bound or overlaps the world (D81-1). Canvas2D skips parked particles and the particles of an inactive (w == 0) slot (W76's open item); WebGPU packs parked particles off-screen. One new scalar call, `resize_world(w, h)`, grows the grid when the viewport (or the container's window) outgrows the world, from the resize handler, with one `console.info` per growth, never shrinking (D81-2); container mode's world becomes the container's client box (D81-3). A new long page scene (`demo/scenes/long-page.html`, RAF by default, `?clock=manual` for e2e) shows parking live; the two WebGPU smoke pages get the same RAF default (W80 gold carry-over).

Out of scope: the canvas under page content (W82), gravity (W83), touch drag (W84), the site's long landing page (W86), shrinking the grid, a scroll-range-sized container world.

## Inputs
- The slice design §4, §11, §12 (D81-1, D81-2) and the spec §2 as amended in `17ede66` (grid, walls and off-screen elements).
- W80's `scroll::shifts_with_scroll` (W81 adds "not parked"), `Grid::scroll_origin` and `base_origin_px` (the lattice phase `resize_world` keeps), `ScrollTracker`, the long-page fill helpers in `e2e/scroll.ts`.
- `pool::redistribute`'s placement rule (a never-placed particle snaps to its target, B4), `Elements::update_rest_state_with_f`, `Scratch::invalidate_bounds` (D68-10), the runtime's `resizeCanvas` (window `resize`, container ResizeObserver).

## Outputs
- Rust `parking.rs` (`UNPARK_INSET_PX`, `Bounds`, `bound`, `world`, `outside`, `inside_by`, `overlaps`, `update`, `sync_particles`), `FLAG_PARKED`, `Particles::is_parked`, `Elements::{parked, is_parked, set_parked, rest_now}`, `Grid::{world_w_px, world_h_px, margin_px, resize_world}`, `FluidCore::resize_world`.
- TS `world.ts` (`measureWorld`, `clampWorld`, `grownWorld`, `WORLD_GROWTH`, `WORLD_RESIZE_INFO`), `FluidRuntime.world` (@internal), `FluidCoreLike.resize_world`, `FLAG_PARKED`, the Canvas2D and WebGPU skips.
- `demo/scenes/long-page.html` (hook `__longPage`), the RAF default of `demo/smoke/webgpu-liquid.ts` and `webgpu-modes.ts`, `e2e/parking.spec.ts`.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D81-1: Parking — not simulated outside world + margin, 64 px hysteresis, re-entry at rest
Proposal: the parking bound is the world the grid covers plus its margin (`max(200, tallest initial element)` px), where the walls sit; Rust reads it from the grid, so it stays DOM-blind and no FFI slot is added. An element whose home rect lies entirely outside the bound is parked: its particles carry `FLAG_PARKED` (bit 2 of the dynamic view's `flags`), skip P2G, the grid update, G2P and the particle AABB (the dirty region shrinks), `scroll_shift`, splash, shake and the merge damage; the element is held at rest (s 1, restAlpha 1). It is unparked once its home rect lies 64 px inside the bound on every side, or as soon as it overlaps the world (the viewport in body mode, the container's visible window in container mode), whichever comes first; in that tick (also a 0-step tick) each of its particles is placed at rest (`home + rest_uv`, v = 0, C = 0, J = 1, F = I, torn cleared) and the element is at rest with no previous rect sample, so its next home velocity is 0. A dragged or an inactive (w == 0) element is never parked. A parked element keeps its particle share (the budget and the state stride are unchanged; re-entry needs no redistribute); its particles count as unplaced, so a redistribute that gives one a new home places it on its new target instead of letting it crawl in from the wall. Canvas2D skips a particle with `FLAG_PARKED` and every particle of an inactive slot (w == 0: hidden, or unobserved until the redistribute; WebGPU's element record already hides it), which closes W76's w == 0 item; WebGPU packs a parked particle off-screen. Chosen in the brainstorm (Dennis 2026-10-13, saga dec_645b54e4); the bound, the "or overlaps the world" unpark, the unplaced rule and the inactive rule are the plan's resolutions.
Consequence: invisible: a parked element is always off-screen (it unparks the frame it overlaps the world), and at rest both renderers draw the exact rest shape from the rects anyway. Liquid that was in flight when its element left comes back at rest (plan validation: worst |x − target| 0.00015 px and restAlpha 1 in the re-entry frame). The on-screen simulation is bit-identical with parking on or off (19 160 of 19 160 words after a splash, a shake and a scroll), and the dirty region holds 0.385 × the cells with a far card parked (native frame 2.40 against 3.87 ms with 40 % of the particles parked). The spec's "re-entry needs the rect ≥ 64 px inside the bound" gains "or overlapping the world" (a rect taller than the margin − 64 px would otherwise be on screen while parked). A splash on a parked element (API only; it is off-screen) is ignored. An element that leaves the bound only partly keeps its wall-clamped liquid until it parks or re-forms (W80's parked minor, narrowed). The approved W67 lock-probe test changes for its −1000 px leg (the element now parks instead of clamping to the wall).
Decision: APPROVED 2026-10-14 — parking as proposed: not simulated outside world + grid margin, unpark 64 px inside on every side or overlapping the world, re-entry at rest, dragged/inactive never parked, Canvas2D skips inactive slots; confirms the brainstorm decision 645b54e4 (saga dec_8e1fb156)

### D81-2: Resize — one logged resize_world per growth step, never shrinking
Proposal: a new scalar call `FluidCore::resize_world(w, h) -> bool`; the 7-arg constructor stays frozen. It grows the grid to cover a world of at least w × h px (each axis clamped to [64, 8192] px like the constructor, a non-finite or non-positive extent keeps its axis; never shrinks): the cell, the margin and the lattice origin stay, so every particle keeps its grid position and W80's lattice phase; only the right and bottom walls move out; only the three grid arrays are reallocated, so every view pointer stays valid. TS keeps a copy of the world (`world.ts`, Rust's clamp mirrored). `resizeCanvas()` (the window's `resize` in body mode, the container's ResizeObserver in container mode) measures the world again and, when an axis outgrew the copy, grows that axis to max(need, ⌈1.25 × current⌉) capped at 8192 px and calls `resize_world` once from the handler, never inside a frame, with one `console.info`: `[liquiddom] the viewport outgrew the liquid's world; the grid grew to W×H px.` After a failed frame the core is not called (it may be poisoned). The parking bound grows with the world, so elements that are now inside unpark at rest.
Consequence: one reallocation per growth step, outside `tick` (spec §2: "one explicit, logged reallocation"); the 1.25 headroom bounds a window dragged from 1280 to 2560 px wide to at most four reallocations and four lines. Body mode rarely grows (the world starts at the screen size; zooming out and a move to a larger screen are the triggers); a container that grows is the common case. Memory follows the largest world and is never given back. A world beyond 8192 px stays clamped as before.
Decision: APPROVED 2026-10-14 — resize_world(w, h) grows the grid arrays only, lattice phase kept, never shrinks; TS grows an outgrown axis to ≥ 1.25 × from the resize handler with one console.info per growth (saga dec_bffbacf6)

### D81-3: Container world — the container's client box, not its scroll range
Proposal: in container mode the world is the container's client box (`clientWidth × clientHeight`) instead of W64's `max(client, scroll)`. Since W80 buffer space in container mode is the container's visible window (the canvas is translated onto it), so the world, and with it the parking bound (world + margin), is that window: content scrolled far away parks as in body mode. The ResizeObserver that already resizes the canvas drives D81-2's growth. Spec §2 "(or the container's maximum in container mode)" is amended.
Consequence: a long container's grid shrinks to its window plus the margin (less memory); content beyond the margin parks instead of being simulated against the walls. A content change that only grows the scroll range reallocates nothing. The W80 container scene and the D72-6 container tests are unaffected (their elements stay inside the window plus the margin; plan validation: the canvas2d suite and the Metal container tests pass).
Decision: APPROVED 2026-10-14 — the container world is its client box, not its scroll range (saga dec_0831a6b4)

## Specification
**Values.** `FLAG_PARKED = 2` (dynamic view `flags`, next to `FLAG_TORN = 1`); `UNPARK_INSET_PX = 64`; parking bound `[−margin, world_w + margin] × [−margin, world_h + margin]` px; the world `[0, world_w] × [0, world_h]`; `WORLD_MIN_PX 64`, `WORLD_MAX_PX 8192` (Rust and `world.ts`); `WORLD_GROWTH = 1.25`.

**Engine (Rust).** `tick`: first (also on a 0-step tick and under reduced motion) `parking::update(particles, grid, elements, reduced_motion)`: per element `wants_parked` (dragged or inactive → false; parked → stays until `inside_by(home, bound, 64) || overlaps(home, world)`; else parks when `outside(home, bound)`); a changed element gets `Elements::rest_now`; then one `sync_particles` pass flags newly parked particles (`placed = false`) and places newly unparked ones at their target with `reset_kinematics`; any change invalidates the fused AABB. `redistribute`: after `pool::redistribute`, `parking::update` and an unconditional `sync_particles` (new homes). The solver skips a parked particle in `particle_bounds`, P2G, G2P (and the fused AABB), `compute_targets` (no target: the pin and maxDev skip it) and `measure_max_f_dev`; `update_rest_state_with_f` writes rest for a parked element; `scroll::apply` skips parked particles and `shifts_with_scroll` is `!dragged && !parked`; `splash` on a parked id returns false; `shake` and `hold_dragged` skip parked elements. `resize_world` → `Grid::resize_world` (+ `invalidate_bounds`).

**Runtime (TS).** `createFluidRuntime` measures the world (`world.ts` `measureWorld`: body `max(screen, inner)`, container the client box), passes it to the frozen constructor and to `buildRuntime`, which keeps `clampWorld(world)`. `resizeCanvas()` ends with `growWorld()`: `grownWorld(world, measureWorld(container))`; null → nothing; else `world = next`, `core.resize_world(next.w, next.h)` and, when it grew, one `console.info`. Skipped after a failed frame. `FluidRuntime.world` (@internal) reads the copy.

**Renderers.** Canvas2D `splatMoving`: after the restAlpha test, skip when the slot's `w` is not > 0 and when `flags & FLAG_PARKED`. WebGPU `packParticles`: flags read for every particle; `FLAG_PARKED` → x, y = `OFFSCREEN_PX` (with or without F); the flags are still packed.

**Baseline (2026-10-14, `3e044d3`).**

| Suite | Count |
|---|---|
| cargo test | 207 passed; 0 failed; 2 ignored |
| vitest | 724 passed, 4 skipped (728), 70 files |
| Playwright --list canvas2d / webgpu / webgpu-hw / perf | 80 / 51 / 93 / 5 |

## Tests

| # | Test Name | Verifies | Red outcome | Gold outcome |
|---|-----------|----------|---|---|
| 1 | parking_tests.rs: given_the_world_and_margin_when_the_bounds_are_read_then_outside_inside_by_and_overlaps_follow_d81_1 | D81-1 geometry | ❌ stub bound is all zero (assert_eq left == right) | ✅ cargo (223 passed) |
| 2 | parking_tests.rs: given_a_world_when_resize_world_then_it_grows_never_shrinks_clamps_and_keeps_the_origin_and_the_lattice_phase | D81-2 grid | ❌ `wider: grows (height kept)` (stub returns false) | ✅ cargo (223 passed) |
| 3 | parking_tests.rs: given_an_element_entirely_below_the_world_plus_margin_when_redistributed_and_ticked_then_it_is_parked_at_rest_and_every_one_of_its_particles_carries_flag_parked | D81-1 park, the flag in the view | ❌ `parked from the first redistribute` | ✅ cargo (223 passed) |
| 4 | parking_tests.rs: given_a_parked_element_when_ticking_with_a_splash_a_shake_and_the_pointer_then_its_particles_are_untouched_and_it_stays_at_rest | D81-1 skip | ❌ `no P2G, G2P, splash, shake or pointer on a parked element` | ✅ cargo (223 passed) |
| 5 | parking_tests.rs: given_a_parked_far_element_when_the_others_splash_shake_and_scroll_then_their_simulation_is_bit_identical_to_the_unparked_engine_and_touches_fewer_cells | D81-1 no side effect, perf (≤ 0.5 × cells) | ❌ `the parked element's particles leave the dirty region: 10371538 vs 10371538 cells` | ✅ 19 160 / 19 160 words identical, cells 0.385 × |
| 6 | parking_tests.rs: given_no_element_ever_leaves_the_bound_when_splashing_shaking_and_scrolling_300_px_then_the_core_is_bit_identical_with_parking_on_and_off | W80 bit-identity against a hard-coded W80 golden hash (guard) | ✅ passes (guard) | ✅ guard: `W80_GOLDEN` unchanged |
| 7 | parking_tests.rs: given_a_parked_element_scrolled_into_view_when_it_overlaps_the_world_then_in_that_frame_it_is_unparked_at_rest_with_every_particle_on_its_target_and_it_stays_at_rest | D81-1 re-entry at rest (home velocity 0 in the entering frame and after the first rigid scroll frame), W81 RF1 | ❌ `still parked with its top at 2370 px (below the world)` | ✅ worst \|x − target\| 0.000153 px, restAlpha 1 at scroll 1620 px |
| 8 | parking_tests.rs: given_a_parked_element_near_the_bound_when_its_rect_jitters_by_5_px_then_it_does_not_flap_and_it_unparks_only_64_px_inside | D81-1 hysteresis | ❌ `assertion failed: c.is_parked_of(1)` | ✅ cargo (223 passed) |
| 9 | parking_tests.rs: given_a_dragged_element_outside_the_bound_when_ticking_then_it_is_never_parked_and_a_parked_element_that_becomes_dragged_unparks_at_once | D81-1 drag | ❌ `c.is_parked_of(…)` | ✅ cargo (223 passed) |
| 10 | parking_tests.rs: given_a_parked_element_when_the_page_scrolls_then_scroll_shift_leaves_its_particles_alone | W80 carry-over (`shifts_with_scroll`) | ❌ `c.is_parked_of(…)` | ✅ cargo (223 passed) |
| 11 | parking_tests.rs: given_a_parked_element_when_redistributed_then_it_keeps_its_area_share_and_when_it_is_unobserved_its_particles_start_on_their_new_visible_targets | D81-1 budget, unplaced rule, W81 RF2 | ❌ `c.is_parked_of(…)` | ✅ cargo (223 passed) |
| 12 | parking_tests.rs: given_reduced_motion_when_an_element_is_out_of_the_bound_then_it_is_parked_the_pin_skips_it_and_re_entry_places_it_on_its_target | reduced motion | ❌ `parking holds under reduced motion` | ✅ cargo (223 passed) |
| 13 | parking_tests.rs: given_an_inactive_element_when_ticking_then_it_is_never_parked_and_a_parked_slot_that_goes_inactive_loses_the_flag | D81-1 inactive | ❌ `c.is_parked_of(…)` | ✅ cargo (223 passed) |
| 14 | parking_tests.rs: given_a_core_when_resize_world_grows_it_then_particles_and_every_non_grid_buffer_stay_and_an_element_inside_the_new_bound_unparks | D81-2 core, W81 RF5 | ❌ `taller: grows` | ✅ cargo (223 passed) |
| 15 | parking_tests.rs: given_a_page_scrolled_150_px_before_and_after_resize_world_when_a_splash_is_in_flight_then_every_particle_matches_an_unscrolled_resized_core_up_to_f32_rounding | D81-2 lattice phase (W80 carry-over) | ❌ `assertion failed: c.resize_world(1920.0, 1080.0)` | ✅ 0.00043 px |
| 16 | world.test: given_body_mode_when_measured_then_the_world_is_max_screen_inner_per_axis | B2 (guard) | ✅ passes (guard) | ✅ vitest (737 passed) |
| 17 | world.test: given_container_mode_when_measured_then_the_world_is_the_container_client_box_not_its_scroll_range_d81_3 | D81-3 | ❌ stub measure is `max(client, scroll)` (360 expected, 1200 received) | ✅ vitest (737 passed) |
| 18 | world.test: given_rusts_world_extent_when_clampWorld_then_positive_extents_clamp_to_64_8192_and_non_positive_or_non_finite_fall_back_to_1280_800 | Rust's clamp mirrored | ❌ stub clampWorld does not clamp | ✅ vitest (737 passed) |
| 19 | world.test: given_a_world_when_grownWorld_then_only_outgrown_axes_grow_to_at_least_1_25_times_capped_at_8192_and_it_never_shrinks | D81-2 growth rule | ❌ stub grownWorld returns null | ✅ vitest (737 passed) |
| 20 | world-runtime.test: given_the_window_grown_beyond_the_world_when_resize_fires_then_resize_world_runs_once_outside_any_frame_with_the_grown_world_and_logs_one_console_info | D81-2 trigger and log | ❌ no `resize_world` call from the resize handler | ✅ vitest (737 passed) |
| 21 | world-runtime.test: given_container_mode_when_created_then_the_world_is_the_container_client_box_and_a_ResizeObserver_growth_reallocates_once_d81_3 | D81-3 in the runtime | ❌ container world is `max(client, scroll)`; no `resize_world` call | ✅ vitest (737 passed) |
| 22 | world-runtime.test: given_a_frame_that_failed_when_the_window_grows_then_no_core_method_is_called_and_nothing_is_logged | W81 RF5 (guard) | ✅ passes (guard) | ✅ vitest (737 passed) |
| 23 | world-runtime.test: given_a_world_beyond_8192_px_when_the_window_grows_then_resize_world_gets_the_capped_world_once_and_further_growth_calls_nothing | D81-2 cap | ❌ no `resize_world` call | ✅ vitest (737 passed) |
| 24 | fluid-canvas2d.test: given_particles_flagged_parked_while_their_element_moves_when_rendering_then_only_the_unparked_ones_splat | D81-1 Canvas2D | ❌ every particle splats | ✅ vitest (737 passed) |
| 25 | fluid-canvas2d.test: given_an_inactive_slot_w_0_with_a_paint_and_rest_alpha_0_when_rendering_then_its_particles_add_no_density_and_no_rest_contour_w76 | W76 w == 0, W81 RF4 | ❌ the inactive slot's particles splat | ✅ vitest (737 passed) |
| 26 | gpu-buffers.test: given_parked_particles_when_packParticles_with_or_without_F_then_their_quads_go_off_screen_and_their_flags_are_kept | D81-1 WebGPU | ❌ parked particles keep their positions | ✅ vitest (737 passed) |
| 27 | fluid-ffi.test: given_the_real_core_with_a_card_below_the_world_when_ticked_then_its_particles_carry_flag_parked_and_resize_world_unparks_it_at_rest_with_the_view_pointers_unchanged | the WASM exports | ❌ no particle is flagged parked | ✅ vitest (737 passed) |
| 28 | e2e parking (canvas2d): D81-1 – given the long page at the top when read then #far1 and #far2 are parked, #top and #hide are not, every restAlpha is 1 and no green or orange liquid is drawn | park, renderer skip | ❌ `parked()` is `[false, false, false, false]` | ✅ macOS + Linux (Docker) |
| 29 | e2e parking (canvas2d): step 7 (long page) – given the page scrolled to #far1 at 30 px per frame and back … every restAlpha is 1 within the step-7 budget | step 7 on a long page | ❌ `at 2100 px: #top, #hide and #far2 parked, #far1 not` | ✅ worst fill 0.954 (#hide at 0 px) macOS and Linux (bound 0.85) |
| 30 | e2e parking (canvas2d): D81-1 – given a jump straight to #far2 when the frame runs then #far2 is unparked and at rest in that very frame … | re-entry frame, W81 RF1 | ❌ `#far2 unparked, the first screen parked` | ✅ macOS + Linux (Docker) |
| 31 | e2e parking (canvas2d): D81-1 (W76 w == 0) – given #hide moving after a shake when its wrapper is hidden … no red liquid is left on the Canvas2D canvas | colour-keyed w == 0 guard, W81 RF4 | ❌ `an inactive slot's liquid is not drawn (colour-keyed guard)`: 7202 red pixels | ✅ 0 red pixels, macOS + Linux (Docker) |
| 32 | e2e parking (canvas2d): D81-2 – given the window grown beyond the world when resized then exactly one console.info … a smaller window logs nothing | D81-2 in the browser | ❌ `page.waitForFunction: Timeout 5000ms exceeded` (the world never grows) | ✅ macOS + Linux (Docker) |
| 33 | e2e webgpu-robust (webgpu-hw): W81 D81-1 – given renderer webgpu on the long page when scrolled to the far card at 30 px per frame and back … | parking in WebGPU | ❌ `parked()` is all false (webgpu-hw) | ✅ Metal: lowest fill 0.901 (#hide at scroll 0), every restAlpha 1 after 26 frames (budget 180) |
| 34 | e2e perf (perf): perf – W81: a Canvas2D frame of the long page with its far cards parked costs at most 0.6 × the same page with every element on screen | slice design §11 perf | — not run at red (perf project) | ✅ parked 0.67 ms vs compact 3.87 ms, ratio 0.173 (bound 0.6) |
| 35 | parking_tests.rs: given_a_parked_element_that_enters_the_world_on_a_0_step_tick_when_ticked_then_it_is_unparked_at_rest_and_placed_on_its_targets | D81-1 re-entry on a 0-step tick (RF1) | ❌ `assertion failed: c.is_parked_of(FAR_ID)` (the stub never parks; the 0-step premise itself verified) | ✅ (last assertion = `count_parked_others`, as test 7; approved by Dennis 2026-10-14, 29cd613) |
| 36 | world-runtime.test: given_a_resize_world_that_throws_when_the_window_grows_then_the_instance_stops_with_one_console_error_and_no_further_tick | W81 RF5 (task review of W81.3: a throwing `resize_world` takes the `stopInstance` path; approved by Dennis 2026-10-14) | — added after red (32f40e0) | ✅ vitest (737 passed) |

Approved-test changes at red (Dennis approves with the tests): `scenario_tests.rs` W67 lock probe (−1000 px leg: parked at rest instead of "left its home"); `fluid-layout.test.ts` (layout.rs has 36 constants, `FLAG_PARKED` mirrored); the openers of `e2e/webgpu-liquid.spec.ts` and the D72-6 block of `e2e/webgpu-robust.spec.ts` add `clock=manual` (the smoke pages run on RAF by default, W80 gold carry-over).

**Gold run (2026-10-14, HEAD 067ded2).**
- **Counts:** cargo 223 passed, 0 failed, 2 ignored; vitest 72 files, 737 passed, 4 skipped (741); clippy clean (`-D warnings`); `cargo fmt --check` and `npm run e2e:typecheck` clean; `npm pack --dry-run -w liquiddom` 78 files (W80 76 + `dist/world.js`, `dist/world.d.ts`).
- **e2e:** canvas2d (macOS) 70 passed, 15 skipped; webgpu-hw (Metal) 51 passed, 44 skipped; Docker Linux canvas2d without `--update-snapshots` 83 passed, 2 skipped, 0 failed (W80: 78/2), `e2e/__screenshots__` untouched: no baseline moved.
- **Long page:** 30 px/frame worst fill 0.954 in Canvas2D on macOS and Linux, 0.901 in WebGPU on Metal (bound 0.85); every restAlpha 1 after 26 frames (budget 180); the colour-keyed w == 0 guard 0 red pixels (7202 at red); perf ratio 0.173 (bound 0.6).
- **Rust evidence:** on-screen elements bit-identical with parking on and off (19 160 / 19 160 words, cells 0.385 ×); re-entry worst 0.000153 px at restAlpha 1; resize mid-scroll 0.00043 px; `W80_GOLDEN` unchanged.
- **Vision (approved by Dennis 2026-10-14):** stills in both renderers on the live (RAF) page: the top, the re-entry frame of `#far1` (crisp, no liquid trailing in), the jump to `#far2`, back at the top, and the hidden `#wrap` after a shake (no red liquid). Under continuous scrolling a re-entered element leaves rest through W80's scroll inertia (D80-2), exactly like `#top` on the first screen (restAlpha 1 → 0.861 → 0.722 in both); it re-enters at rest.
- **Reviews:** task reviews of W81.1–W81.3 ✅/✅ after one fix round each (W81.2: kinematics reset when a parked slot goes inactive, one sync after redistribute; W81.3: a throwing `resize_world` stops the instance). Ward review: ready for gold, three minors fixed in 067ded2 (growth waits for the loop, so an init-time throw cannot leak listeners; a stopped device-loss rebuild settles false; flag values named in the docs). Parked: a margin near 8192 px needs ≈ 450 MB of grid (CONTEXT).
- **Approved-test changes after red (Dennis 2026-10-14):** test 35's last assertion; the new test 36.
- **Manual smoke:** pending Dennis at the live URLs below (both renderers).

## Must NOT
- Change the FFI strides, the element or state slots or the 7-arg constructor; allocate inside `tick`; panic on JS input.
- Simulate, shift, splash or shake a parked element; park a dragged or inactive one; let a re-entered element appear in flight.
- Shrink the grid, reallocate it inside a frame, or log more than once per growth.
- Change a run in which no element is parked (bit-identical to W80) or an existing Linux baseline.

## Must DO
- Keep W80's lattice phase across `resize_world` and add "not parked" to `shifts_with_scroll`.
- Close W76's w == 0 item with the colour-keyed e2e guard.
- Give every new or touched scene the RAF clock by default (`?clock=manual` for e2e) and a live URL for the gold smoke.

## Manual Smoke Test
### Setup
`npm run dev`, then open `http://localhost:3000/scenes/long-page.html?renderer=auto` (Metal: WebGPU) and `http://localhost:3000/scenes/long-page.html?renderer=canvas2d`; also `http://localhost:3000/smoke/webgpu-liquid.html` and `http://localhost:3000/smoke/webgpu-modes.html?mode=container` (live since W81).

### Steps
1. On the long page, shake (the console: `__longPage.shake()`), then scroll quickly to the green card and on to the orange one, and back.
   Expected: each card is crisp and at rest the moment it scrolls in; the pills at the top come back at rest; no liquid trails in from the screen edge.
2. Make the window much wider (or zoom out with ⌘−).
   Verify: one `console.info` "the grid grew to W×H px"; the liquid does not move; zooming back in logs nothing.
3. Open the two smoke pages.
   Verify: the liquid is drawn live (no `?clock=manual`).

### Pass criteria
- [ ] No console error or warning in either renderer.
- [ ] The DOM never moves because of liquiddom; keyboard focus and the a11y tree are unchanged.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, the perf project's W81 guard, `npm run e2e:docker -- --project=canvas2d` (every existing Linux baseline unchanged), vision on the long page in both renderers.
