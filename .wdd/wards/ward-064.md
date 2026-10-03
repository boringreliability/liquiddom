---
ward: 64
revision: null
name: "Liquid at rest, end to end"
epic: "fluid-engine"
status: "planned"
dependencies: [63]
layer: "both"
estimated_tests: 115
created: "2026-10-03"
completed: null
---
# Ward 064: Liquid at rest, end to end

North star: scene step 1 (C, roundRect + DOM text) and step 8 (reduced motion).

## Scope
The first vertical slice of the fluid engine.

Rust (`src/fluid/`) gets an MLS-MPM core that, in this ward, only has to hold liquid at rest:
- seeded sampling of each element's rounded rect;
- area-proportional particle apportionment;
- a home spring towards each particle's target;
- P2G/G2P at rest;
- the reduced-motion pin;
- the per-element state view.

The new FFI (`FluidCore`, strides 10/4/7/3) is complete from day one, with `splash`/`shake` as no-op stubs.

TS gets:
- the single-flight WASM loader with loud failure (fixes the W61 root cause at the source);
- `FluidBridge`;
- the element registry and colour parsing;
- the Canvas2D fluid renderer (low-res density grid plus an exact `roundRect` at rest);
- the internal `createFluidRuntime()`;
- the acceptance scene.

The soft-body engine is untouched and keeps passing until W66 removes it.

## Inputs
- W63: `.wdd/NORTH-STAR.md` (scene, steps 1 and 8) and the direction-gate rules.
- Spec §2 (physics at rest, timestep, grid, pool, FFI, robustness), §3 (Canvas2D fallback, colour), §4 (canvas attributes).
- The plan's interface contract, amended by resolutions B1–B8, B12, B14, B15, A5, A6, C2, C5, D3, D4, D5.
- `packages/core/ts/src/border-radius.ts` (`parseBorderRadius`), kept.
- W61 repro `docs/superpowers/specs/assets/w61-rca/race3.mjs` / `race3fix.mjs`.
- Spike `spike/fluid-mpm` (`src/lib.rs`, `web/render.ts`, `bench.mjs`): reference for constants, the Canvas2D kernel and the bench layout only. Never copied (D2).

## Outputs
- `Cargo.toml` `[profile.release]` with `opt-level = 3`, `lto = true`, `codegen-units = 1` (provisional; W65 measures 3 against "s"), and `[profile.test] opt-level = 2` (W64's gate appends this as D64-16).
- `src/lib.rs` gains `pub mod fluid;`.
- `src/fluid/{mod,access,layout,rng,clock,sampling,grid,particles,material,elements,pool,solver,views,api,scenario_tests}.rs`; `mod.rs` re-exports `api::FluidCore`.
- TS `packages/core/ts/src/`: `fluid-layout.ts`, `wasm-loader.ts` (`loadFluidWasm`, `createWasmLoader`, `LiquidWasmLoadError`, the structural `FluidBackend` / `FluidCoreLike` / `FluidCoreCtor` types), `fluid-bridge.ts` (`FluidBridge`), `color.ts`, `element-registry.ts` (`ElementRegistry`, `createMicrotaskBatcher`), `options.ts` (`ElementOptions` type only), `material.ts` (`Material`, `DEFAULT_MATERIAL`), `runtime.ts` (`createFluidRuntime`, `LIQUID_CANVAS_CLASS`, `REDUCED_MOTION_QUERY`), `renderers/frame.ts` (`RenderFrame`, `ElementPaint`, `Renderer`), `renderers/density-grid.ts`, `renderers/fluid-canvas2d.ts` (`FluidCanvas2DRenderer`). None of these is exported from `index.ts` yet.
- `scripts/copy-wasm.mjs` rewrites the `pkg` specifier in every `dist/**/*.js`, according to its depth.
- Shared test helpers `packages/core/ts/__tests__/_fluid-test-backend.ts` (`createTestBackend()`) and `_fake-canvas.ts` (`installFakeCanvas2D()`). W66 and the React/Vue adapter tests import them by relative path (`../../core/ts/__tests__/_fake-canvas`, `../../core/ts/__tests__/_fluid-test-backend`).
- `demo/scenes/acceptance.{html,ts}`.

## Decisions
### D64-1: Cell size and density budget
Proposal: the cell size is decided once at create: `cell = clamp(√(4·A_hint/N), 4, 8)` px, where `A_hint` is the rounded-rect area measured from `initialElements`; with no hint the cell is 8 px. Observed area above `N·cell²/2` gives one `console.warn` per runtime and no reallocation (B2, B5). The spec §2 resize reallocation moves to slice 6.
Consequence: the bare `create()` then `observe()` pattern gets 8 px cells (W66 restores parity by measuring the `autoObserve` candidates). The scene's hint of 76 057 px² gives ≈ 6.17 px.
Decision: PENDING

### D64-2: Interim binary restAlpha
Proposal: `restAlpha = 1` iff `s > 0.98 && maxDev < 0.75 px` (always under reduced motion), and `s ≡ 1` until W67.
Consequence: the roundRect pops in and out with no fade (nothing moves in slice 1). Hold and fade arrive in W67.
Decision: PENDING

### D64-3: Stable progressive redistribution
Proposal: each element's rest set is an R2 low-discrepancy sequence seeded by `(seed, slot)`. Every particle keeps its rank; a particle whose home is still active and whose rank is below the new count keeps its home and its bit-identical `rest_uv`. Surplus ranks are freed and refilled in index order. Never-placed particles snap to their target; placed particles keep `x, y` and crawl. Per generation `p_vol = area_per_particle / cell²` and `p_mass = p_vol` (B4).
Consequence: the particle count is always constant, and "total mass constant" holds between redistributions only. There is no slip drift before W67, so particles moved to a new home through other liquid may not arrive in W64; this is not visible in the scene, which has a single generation.
Decision: PENDING

### D64-4: Full FFI surface now
Proposal: the constructor is frozen at 7 arguments: `new(particles, max_elements, world_w_px, world_h_px, area_hint_px2, max_element_h_px, seed)` (B15: `max_element_h_px` sizes the grid margin). Every other `FluidCore` method from the contract exists in W64. `splash`/`shake` are no-op stubs with `_`-prefixed parameters (B8). `tick` returns the number of fixed steps simulated: 0 to 3, and always 0 under reduced motion.
Consequence: the FFI is frozen from W64 on. W67/W68 fill in the bodies without changing it, and the W65 perf metric "tick per step" has its denominator.
Decision: PENDING

### D64-5: A null 2d context rejects create
Proposal: `FluidCanvas2DRenderer.init` rejects when `getContext('2d')` is null; there is no silent mode. The renderer only uses `ctx.createImageData` and a canvas from `document.createElement("canvas")`, never `new ImageData` or `new OffscreenCanvas`. jsdom tests use the shared `_fake-canvas.ts` (A6).
Consequence: every jsdom test that creates a runtime, including the W66 facade and the adapter tests, must call `installFakeCanvas2D()`. A browser without Canvas2D gets a rejected promise instead of an invisible page.
Decision: PENDING

### D64-6: Reduced-motion detection, the matchMedia change listener and set_reduced_motion land here [BOUNDARY]
Proposal: `forceReducedMotion: true` forces reduced motion on; otherwise `matchMedia("(prefers-reduced-motion: reduce)")` decides and drives `core.set_reduced_motion`. The media `change` listener is attached and tested in W64 (C5). W68 keeps only the input gating.
Consequence: S1 step 8 (reduced motion ✅) is met by W64. W68 must not add a second media-query listener.
Decision: PENDING

### D64-7: The bridge class is named FluidBridge
Proposal: `FluidBridge` plays the role the spec calls "WasmBridge": the sole owner of pointers and views.
Consequence: the old `WasmBridge` (soft-body) and `FluidBridge` coexist until W66 deletes the old engine, with no name clash.
Decision: PENDING

### D64-8: The internal entry is runtime.ts
Proposal: `createFluidRuntime()` in `runtime.ts` is the W64 entry point. The scene imports it by the relative source path `../../packages/core/ts/src/runtime`; `index.ts` does not export it.
Consequence: there is no public API change in W64. W66 owns the public `LiquidDOM.create()` that wraps it. The two `Renderer`/`RenderFrame` types (old `renderers/renderer.ts`, new `renderers/frame.ts`) coexist internally until W66.
Decision: PENDING

### D64-9: Interim scene CSS [BOUNDARY]
Proposal: `.scene-liquid { position: relative; z-index: 1; background/border/box-shadow transparent !important }`, added *after* `observe()` snapshots the colour. W66's injected stylesheet replaces it.
Consequence: the scene shows the liquid under the DOM text without W66's stylesheet. A colour snapshot taken after the class is added would read transparent, so the order in `acceptance.ts` is load-bearing. W66 must delete this CSS.
Decision: PENDING

### D64-10: Type files, names and defaults
Proposal: `options.ts` holds only `ElementOptions { viscosity?, recovery? }`; `material.ts` holds `Material { viscosity, cohesion, recovery }` and `DEFAULT_MATERIAL = { 0.5, 0.5, 0.7 }` (A5). W66 adds `LiquidOptions`/`resolveOptions`/validation, and W68 adds presets and `SplashOptions`. `HOME_NONE = -1`. The canvas class is `liquid-canvas` with `aria-hidden="true"`. `DEFAULT_LIQUID_COLOR = rgb(83, 52, 131)` (opaque), and the default text colour is black.
Consequence: `ElementRegistry` and `FluidRuntimeOptions.material` compile in W64. W66 and W68 extend these files instead of creating them, and the W65 e2e selectors rely on `canvas.liquid-canvas`.
Decision: PENDING

### D64-11: Canvas2D renderer
Proposal: the density cell is 2 CSS px, with kernel `(1−r²/R²)²/(πR²/3)` and `R = min(2.3·spacing, 8 px)`, per-element mass normalisation and a density-weighted colour blend. The edge is a smoothstep from 0.4 to 0.6, so it crosses 0.5 at the rect edge, and the result is upscaled bilinearly. The rest contour is a `roundRect` at the home rect (DOM rect + `(home_dx, home_dy)`, swelled by `HOVER_SWELL = 0.02` when `interaction == 1` and not reduced motion, B1) with `globalAlpha = restAlpha·bgAlpha`; particles of a `restAlpha = 1` element add no density. Particles whose `home` is `HOME_NONE` or whose paint record is missing are skipped (B12).
Consequence: at rest the shapes are pixel-exact roundRects; in motion the silhouette is soft at about 2 px resolution. Text is always DOM text (no liquid text in Canvas2D). In W64 the swell term exists but `interaction` is always 0.
Decision: PENDING

### D64-12: World and margin
Proposal: the world is `max(screen, inner)` per axis, or `max(client, scroll)` in container mode, clamped to 64–8192 px. The margin is `max(200, tallest initial element)` px, passed to the constructor as `max_element_h_px` (B2, B15). In container mode the buffer origin is the container's padding box (`rect + clientLeft/Top`), because that is where the absolute canvas sits.
Consequence: the grid is never reallocated in W64. A window grown beyond the screen size, or liquid thrown beyond the margin, meets the wall (a stated limit until slice 6).
Decision: PENDING

### D64-13: At-rest physics in W64
Proposal: APIC transfer plus the home spring, with `SPRING_K = 220 /s²` and `ζ = 0.8`, damping the absolute particle velocity. No stress, J update, CFL cap, drag, slip or wobble; W67 owns all of them.
Consequence: displaced liquid re-forms rigidly in about 0.5 s.
Decision: PENDING

### D64-14: Canvas resize and DPR
Proposal: fullscreen mode listens to `window` `resize`; container mode uses one `ResizeObserver` on the container (disconnected in `destroy`). The backing store is `max(1, round(css · devicePixelRatio))` per axis, and `renderer.resize(backingW, backingH, dpr)` resizes the density buffer to `css / 2 px`. DPR is re-read on every resize event; `setTransform(dpr, 0, 0, dpr, 0, 0)` is applied every frame (C2).
Consequence: container mode works from slice 1. A DPR change without a resize event (moving the window to another monitor) is picked up on the next resize; browser zoom fires `resize`, so it is covered. The MPM grid world is not resized (D64-12).
Decision: PENDING

### D64-15: copy-wasm rewrite
Proposal: only files directly in `ts/src/` may import the repo-root `pkg/` glue. `scripts/copy-wasm.mjs` rewrites every `(../)+pkg/` specifier in every `dist/**/*.js` to `wasm/`, with the prefix computed from the file's depth (D3). `FluidBackend` is declared structurally in `wasm-loader.ts`, and `wasm-loader.ts` uses `//` header comments, so no `.d.ts` mentions `pkg/`.
Consequence: the published tarball is self-contained. An import of `pkg/` from a subdirectory fails `wasm-import-paths.test.ts` instead of breaking consumers.
Decision: PENDING

## Specification
- **Shared constants** (Rust `src/fluid/layout.rs` = TS `fluid-layout.ts`, which MUST match; `fluid-layout.test.ts` parses `layout.rs` and checks both directions):
  - `ELEMENT_STRIDE = 10`, indices `x 0, y 1, w 2, h 3, radius_px 4, interaction 5, home_dx 6, home_dy 7, viscosity 8, recovery 9` (Rust `EL_*`, TS `El`). `w == 0` means the slot is inactive; NaN in slots 8/9 means the material default.
  - `STATE_STRIDE = 4` (`s, maxDev, restAlpha, reserved`; Rust `ST_*`, TS `St`).
  - `DYNAMIC_FIELDS = 7` (`x, y, f00, f01, f10, f11, flags`; `DYN_FLAGS = 6`; TS `Dyn`).
  - `STATIC_FIELDS = 3` (`home, rest_u, rest_v`; Rust `STAT_*`, TS `Stat`).
  - `HOME_NONE = -1`, `FLAG_TORN = 1`, interaction codes `0 idle, 1 hover, 2 focused, 3 dragged`, `HOVER_SWELL = 0.02`.
- **Rust-only constants:** `clock.rs`: `FIXED_DT_S = 1/60`, `MAX_RAW_DT_S = 0.1`, `MAX_STEPS_PER_TICK = 3`, `SUBSTEPS = 8`. `grid.rs`: `CELL_MIN_PX = 4`, `CELL_MAX_PX = 8`, `GRID_MARGIN_MIN_PX = 200`, `REGION_PAD_CELLS = 2`. `solver.rs`: `SPRING_K = 220`, `SPRING_ZETA = 0.8`.
- **Robustness** (B6, B7): `src/fluid/mod.rs` sets `cfg_attr(not(test), deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic))`; use `get`/`get_mut` with explicit fallbacks, or iterators. A 300-tick test asserts that every `Vec` keeps its capacity and data pointer. The grid keeps a per-substep dirty AABB of the particle bounds plus 2 cells, and `clear`/`update` touch only that region (tested by counting cells).
- **Particle views** (B14, B3): dynamic SoA `x, y, f00, f01, f10, f11, flags` with field stride `particleCapacity`; static SoA `home, rest_u, rest_v`. `RenderFrame` carries `particleCapacity` and `activeParticles` (in slices 1–2 `activeParticles ∈ {0, particleCapacity}`) and `paints` indexed by slot id, kept until the generation bump that reassigns the slot (B12). Slice 3 uploads `particleCapacity·7·4` bytes.
- **`FluidCore` FFI.** Constructor `new(particles, max_elements, world_w_px, world_h_px, area_hint_px2, max_element_h_px, seed)` (7 arguments, frozen by D64-4/B15; `max_element_h_px` is the tallest initial element height and sets the grid margin `max(GRID_MARGIN_MIN_PX, max_element_h_px)`). Methods:
  - pointers: `elements_ptr`, `dynamic_ptr`, `static_ptr`, `state_ptr`;
  - sizes: `particle_capacity`, `element_capacity`, `active_particles`, `cell_px`, `max_area_px2`;
  - strides: `element_stride`, `state_stride`, `dynamic_fields`, `static_fields`;
  - `generation()`;
  - `tick(raw_dt_s, px, py, pvx, pvy, pointer_active, gx, gy) -> u32`;
  - `splash(id, x, y, strength)` and `shake(strength)` (stubs);
  - `set_material(viscosity, cohesion, recovery)`, `redistribute()`, `set_reduced_motion(on)`;
  - `free()` (generated).

  Everything is allocated in the constructor; nothing allocates on the hot path. Inputs are clamped defensively, and TS validates them first.
- **Timestep.**
  - The f64 accumulator steps while `acc + 1e-6 ≥ FIXED_DT_S`, at most 3 times per `tick`.
  - Hitting the cap drops the remainder.
  - NaN or negative `raw_dt` gives 0 steps.
  - `raw_dt` is clamped to 0.1 s.
- **At rest.** Each fixed step runs 8 substeps of home spring + P2G/G2P towards the target (`rest_uv` mapped into the current home rect). `maxDev` is the max distance from target per element, O(n).
- **Reduced motion.** Every particle sits at its target, every `restAlpha = 1`, and rect moves are followed within the same tick.
- **Loader.**
  - One module-level promise, reset on rejection.
  - A failure rejects with `LiquidWasmLoadError`, which carries `cause`.
  - `createFluidRuntime` leaves no canvas behind on failure.
  - The node test ports `race3.mjs`: two creates started in one task resolve to one instantiation and one shared memory.
- **Bridge.**
  - `dynamicView()` returns a new view over the current buffer on every call.
  - `staticView()` is cached and replaced only when the generation changes or the buffer detaches.
  - Element and state views rebind when the buffer is replaced.
  - A stride mismatch throws `Error("[liquiddom] FFI stride mismatch …")`.
- **Registry.**
  - id = the lowest free slot; `observe` is idempotent.
  - `RangeError` when full.
  - Rect, radius (via `parseBorderRadius`) and options are written per frame, container-relative in container mode.
  - `observe`/`unobserve` batches schedule one `redistribute` per microtask.
- **Canvas2D renderer.**
  - Density grid at 2 CSS px per cell.
  - Kernel `(1−r²/R²)²/(πR²/3)`, with `R = min(8, 2.3·spacing)` px.
  - Per-element mass normalisation, threshold 0.5 at the rect edge, density-weighted colour blend.
  - Elements with `restAlpha = 1` add no density and get an exact `roundRect` with their colour and radius, cross-faded by `restAlpha`.
  - No liquid text: `liquid-text` is never set.
- **Runtime frame order.** coord offset → `registry.sync` → `core.tick` → `bridge.syncGeneration` → `renderer.render`. `destroy()` is idempotent: it cancels the loop, unobserves everything, calls `renderer.destroy`, removes the canvas, detaches the listeners and calls `core.free`.
- **Canvas.** Class `liquid-canvas`, `aria-hidden="true"`, `pointer-events: none`, `position: fixed; z-index: 0`, appended last in `body`. In container mode it is absolutely positioned inside the container.
- **Scene.**
  - Three buttons, 140×48 with radius 24, at x 406/570/734 and y 260: "Splash", "Split", "Merge".
  - A card, 320×180 with radius 16, at (480, 340), with a heading and two lines of text.
  - Seed 1, a system font stack, and `<link rel="icon" href="data:,">`.
  - The buttons and the card are passed as `initialElements`.

## Tests
The 115 tests W64 writes (47 Rust in `src/fluid/`, 68 TS), grouped by file in W64's order.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_same_seed_when_drawing_1000_values_then_sequences_identical | rng determinism (`src/fluid/rng.rs`) |
| 2 | given_seed_zero_when_constructed_then_sequence_is_nondegenerate | rng seed 0 (`src/fluid/rng.rs`) |
| 3 | given_any_seed_when_next_f32_then_value_in_unit_interval | rng range (`src/fluid/rng.rs`) |
| 4 | given_two_streams_of_one_seed_when_derived_then_sequences_differ | rng streams per slot (`src/fluid/rng.rs`) |
| 5 | given_raw_dt_one_sixtieth_when_advanced_60_times_then_exactly_60_steps | clock epsilon (`src/fluid/clock.rs`) |
| 6 | given_raw_dt_250ms_when_advanced_then_clamped_to_100ms_capped_at_3_steps_and_remainder_dropped | clock clamp (`src/fluid/clock.rs`) |
| 7 | given_nan_or_negative_dt_when_advanced_then_zero_steps | clock input (`src/fluid/clock.rs`) |
| 8 | given_120hz_frames_when_advanced_then_one_step_every_second_frame | clock at 120 Hz (`src/fluid/clock.rs`) |
| 9 | given_weights_when_apportioning_8000_then_sum_is_exactly_8000_and_each_within_one_of_proportional | apportionment (`src/fluid/sampling.rs`) |
| 10 | given_all_zero_or_nan_weights_when_apportioning_then_nothing_is_assigned | apportionment input (`src/fluid/sampling.rs`) |
| 11 | given_rounded_rect_when_sampling_n_points_then_exactly_n_points_all_inside | sampling (`src/fluid/sampling.rs`) |
| 12 | given_same_seed_when_sampling_twice_then_uv_bit_identical | sampling determinism (`src/fluid/sampling.rs`) |
| 13 | given_more_points_when_sampling_then_the_shorter_sample_is_a_prefix | progressive sampling (D64-3) (`src/fluid/sampling.rs`) |
| 14 | given_radius_above_half_height_when_sampling_then_radius_clamped_and_no_panic | radius clamp (`src/fluid/sampling.rs`) |
| 15 | given_zero_or_nan_rect_when_sampling_then_returns_without_panic | robustness (`src/fluid/sampling.rs`) |
| 16 | given_8000_particles_and_76k_px2_when_choosing_cell_then_sqrt_4a_over_n_clamped_4_to_8 | D64-1 formula (`src/fluid/grid.rs`) |
| 17 | given_zero_area_hint_when_choosing_cell_then_8px | D64-1 default (`src/fluid/grid.rs`) |
| 18 | given_world_1280x800_when_grid_built_then_covers_world_plus_200px_margin_each_side | grid size (`src/fluid/grid.rs`) |
| 19 | given_tallest_element_when_margin_chosen_then_max_of_200_and_its_height | grid margin (B15) (`src/fluid/grid.rs`) |
| 20 | given_any_fraction_when_bspline_weights_summed_then_one | stencil (`src/fluid/grid.rs`) |
| 21 | given_particle_bounds_when_region_set_then_clear_and_update_touch_only_the_padded_region | dirty region (B6) (`src/fluid/grid.rs`) |
| 22 | given_hover_and_motion_when_home_rect_then_swelled_2_percent_about_centre | home rect swell (B1) (`src/fluid/elements.rs`) |
| 23 | given_nan_or_zero_slot_when_queried_then_inactive_and_none | element slot input (`src/fluid/elements.rs`) |
| 24 | given_four_elements_when_redistribute_then_every_particle_has_a_home_and_counts_follow_area | pool (`src/fluid/pool.rs`) |
| 25 | given_first_redistribute_when_particles_unplaced_then_each_starts_at_its_target | first placement (`src/fluid/pool.rs`) |
| 26 | given_element_released_when_redistribute_then_its_particles_keep_position_and_get_new_home | crawl, no snap (`src/fluid/pool.rs`) |
| 27 | given_element_added_when_redistribute_then_kept_particles_keep_identical_rest_uv | stable redistribution (D64-3) (`src/fluid/pool.rs`) |
| 28 | given_no_active_elements_when_redistribute_then_active_particles_zero_and_homes_none | empty pool (`src/fluid/pool.rs`) |
| 29 | given_redistribute_when_masses_computed_then_p_mass_is_area_per_particle_over_cell_squared | B4 (`src/fluid/pool.rs`) |
| 30 | given_redistribute_when_reading_static_view_then_home_rest_u_rest_v_in_soa_order | static view (B14) (`src/fluid/views.rs`) |
| 31 | given_tick_when_reading_dynamic_view_then_x_y_in_px_f_identity_and_flags_zero | dynamic view (B14) (`src/fluid/views.rs`) |
| 32 | given_fluid_core_when_querying_strides_then_equal_layout_constants | FFI strides (`src/fluid/api.rs`) |
| 33 | given_view_pointers_when_lengths_computed_then_match_capacities | FFI views (`src/fluid/api.rs`) |
| 34 | given_same_seed_and_inputs_when_two_cores_tick_300_frames_then_dynamic_views_bit_identical | determinism (`src/fluid/api.rs`) |
| 35 | given_nan_rect_or_out_of_range_id_when_tick_splash_or_redistribute_then_no_panic_and_slot_ignored | no panics on input (`src/fluid/api.rs`) |
| 36 | given_tick_with_raw_dt_one_sixtieth_when_called_then_returns_one_step | tick return (`src/fluid/api.rs`) |
| 37 | given_redistribute_when_called_then_generation_increments_by_one | generation (`src/fluid/api.rs`) |
| 38 | given_area_hint_when_constructed_then_cell_px_and_max_area_follow_resolution_b5 | B5 via constructor (`src/fluid/api.rs`) |
| 39 | given_out_of_range_capacities_when_constructed_then_clamped | constructor clamps (`src/fluid/api.rs`) |
| 40 | given_elements_at_rest_when_ticking_120_frames_then_max_dev_below_0_75px | rest (`src/fluid/scenario_tests.rs`) |
| 41 | given_particles_displaced_10px_when_ticking_3s_then_max_dev_below_0_75px_and_rest_alpha_1 | home spring (`src/fluid/scenario_tests.rs`) |
| 42 | given_rect_moved_50px_when_ticking_then_particles_converge_to_new_rect_targets | targets follow rect (`src/fluid/scenario_tests.rs`) |
| 43 | given_reduced_motion_when_ticking_then_every_particle_equals_target_and_rest_alpha_is_1 | RM pin (`src/fluid/scenario_tests.rs`) |
| 44 | given_reduced_motion_when_rect_moves_then_particles_follow_in_same_tick | RM follow (`src/fluid/scenario_tests.rs`) |
| 45 | given_ticks_between_redistributions_when_running_then_particle_count_and_total_mass_constant | conservation (B4 scope) (`src/fluid/scenario_tests.rs`) |
| 46 | given_300_ticks_when_running_then_every_vec_capacity_and_data_pointer_unchanged | no hot-path allocation (B7) (`src/fluid/scenario_tests.rs`) |
| 47 | given_one_small_element_in_1280x800_world_when_ticking_then_grid_work_is_bounded_by_particle_aabb | dirty region (B6), cells touched (`src/fluid/scenario_tests.rs`) |
| 48 | given_layout_rs_when_parsed_then_every_rust_constant_has_an_equal_ts_mirror | strides Rust = TS (`fluid-layout.test.ts`) |
| 49 | given_ts_mirror_when_compared_then_no_ts_constant_is_missing_in_rust | strides TS = Rust (`fluid-layout.test.ts`) |
| 50 | given_hover_swell_when_compared_then_rust_and_ts_both_equal_0_02 | B1 shared const (`fluid-layout.test.ts`) |
| 51 | given_hover_interaction_and_motion_when_homeRect_then_swelled_2_percent_about_centre | B1 (TS) (`fluid-layout.test.ts`) |
| 52 | given_hover_interaction_under_reduced_motion_when_homeRect_then_dom_rect_plus_home_offset | B1 under RM (`fluid-layout.test.ts`) |
| 53 | given_inactive_nan_or_out_of_range_slot_when_homeRect_then_null | homeRect input (`fluid-layout.test.ts`) |
| 54 | given_two_concurrent_loads_when_awaited_then_importer_and_init_run_once_and_return_same_backend | single-flight (`wasm-loader.test.ts`) |
| 55 | given_init_rejects_when_loading_then_rejects_with_LiquidWasmLoadError_carrying_cause | loud failure (`wasm-loader.test.ts`) |
| 56 | given_previous_load_rejected_when_loading_again_then_retries_and_succeeds | reset on rejection (`wasm-loader.test.ts`) |
| 57 | given_glue_without_FluidCore_when_loading_then_rejects_naming_the_rebuild | stale pkg/ fails loudly (`wasm-loader.test.ts`) |
| 58 | given_Promise_all_of_two_createFluidRuntime_with_gated_loader_when_resolved_then_one_init_and_shared_memory | runtime single-flight (`wasm-loader.test.ts`) |
| 59 | given_wasm_load_failure_when_createFluidRuntime_then_rejects_and_no_canvas_remains | cleanup on failure (`wasm-loader.test.ts`) |
| 60 | given_default_loader_in_jsdom_when_createFluidRuntime_then_rejects_with_LiquidWasmLoadError | no silent mock mode (`wasm-loader.test.ts`) |
| 61 | given_two_creates_started_in_one_task_with_gated_init_when_both_resolve_then_one_instantiation_same_memory_and_both_cores_tick_without_throwing | race3 port (node, real wasm) (`multi-instance-wasm.test.ts`) |
| 62 | given_real_fluid_core_when_bridging_then_strides_equal_ts_layout_constants | real wasm strides (`fluid-ffi.test.ts`) |
| 63 | given_view_pointers_when_lengths_computed_then_within_wasm_memory_and_match_capacities | real wasm views (`fluid-ffi.test.ts`) |
| 64 | given_elements_written_via_bridge_when_redistribute_then_static_homes_match_and_generation_bumps | real wasm pool (`fluid-ffi.test.ts`) |
| 65 | given_tick_when_reading_dynamic_view_then_positions_inside_element_rects | real wasm rest (`fluid-ffi.test.ts`) |
| 66 | given_reduced_motion_when_tick_then_rest_alpha_is_1_for_active_elements | real wasm RM (`fluid-ffi.test.ts`) |
| 67 | given_bridge_when_dynamicView_called_twice_then_two_distinct_views_over_current_buffer | fresh views (`fluid-bridge.test.ts`) |
| 68 | given_unchanged_generation_when_staticView_called_then_same_cached_view | generation gate (`fluid-bridge.test.ts`) |
| 69 | given_generation_bumped_when_syncGeneration_then_true_and_staticView_fresh | generation gate (`fluid-bridge.test.ts`) |
| 70 | given_memory_buffer_replaced_when_elementView_called_then_view_rebound | rebind (`fluid-bridge.test.ts`) |
| 71 | given_core_with_mismatched_stride_when_constructing_bridge_then_throws | stride guard (`fluid-bridge.test.ts`) |
| 72 | given_dynamicByteRange_when_read_then_it_spans_particleCapacity_times_7_floats | upload range (B14) (`fluid-bridge.test.ts`) |
| 73 | given_rgba_alpha_zero_or_transparent_when_parsed_then_null | colour (`color.test.ts`) |
| 74 | given_rgb_or_rgba_when_parsed_then_rgba_tuple | colour (`color.test.ts`) |
| 75 | given_element_with_background_when_snapshotted_then_background_and_text_parsed | colour snapshot (`color.test.ts`) |
| 76 | given_transparent_background_when_snapshotted_then_default_liquid_color | colour fallback (`color.test.ts`) |
| 77 | given_element_when_observed_then_slot_id_returned_and_rect_radius_written | registry (`element-registry.test.ts`) |
| 78 | given_same_element_when_observed_twice_then_same_id | idempotent (`element-registry.test.ts`) |
| 79 | given_full_registry_when_observing_then_throws_RangeError | capacity (`element-registry.test.ts`) |
| 80 | given_freed_slot_when_observing_new_element_then_lowest_free_slot_reused | slot reuse (`element-registry.test.ts`) |
| 81 | given_three_observes_in_one_task_when_microtasks_flush_then_redistribute_called_once | batching (`element-registry.test.ts`) |
| 82 | given_container_offset_when_syncing_then_rect_written_container_relative | container mode (`element-registry.test.ts`) |
| 83 | given_element_options_when_observed_then_slots_8_9_written_else_NaN | element options (`element-registry.test.ts`) |
| 84 | given_unobserve_when_called_then_slot_w_zero_and_redistribute_scheduled | unobserve (`element-registry.test.ts`) |
| 85 | given_percent_radius_when_element_resizes_then_radius_recomputed_on_sync | radius per frame (`element-registry.test.ts`) |
| 86 | given_element_with_background_when_observed_then_record_carries_snapshotted_colors | colour on observe (`element-registry.test.ts`) |
| 87 | given_uniform_particles_of_one_element_when_splatted_then_interior_density_near_1_and_0_5_crossing_at_rect_edge | normalisation (`density-grid.test.ts`) |
| 88 | given_two_elements_with_different_spacing_when_splatted_then_each_normalised_independently | per-element norm (`density-grid.test.ts`) |
| 89 | given_overlapping_elements_when_resolving_color_then_rgb_is_density_weighted_blend | blended colour (`density-grid.test.ts`) |
| 90 | given_radius_request_above_8px_when_splatting_then_capped_at_8px | kernel cap (`density-grid.test.ts`) |
| 91 | given_threshold_when_writing_image_then_interior_opaque_outside_transparent_with_element_colour | threshold (`density-grid.test.ts`) |
| 92 | given_rest_alpha_1_when_rendering_then_roundRect_filled_with_element_color_and_radius | crisp at rest (`fluid-canvas2d.test.ts`) |
| 93 | given_rest_alpha_1_when_rendering_then_its_particles_add_no_density | no fur at rest (`fluid-canvas2d.test.ts`) |
| 94 | given_rest_alpha_0_when_rendering_then_density_is_drawn_in_the_element_colour_and_upscaled | density path (`fluid-canvas2d.test.ts`) |
| 95 | given_particle_with_home_none_or_missing_paint_when_rendering_then_skipped | B12 (`fluid-canvas2d.test.ts`) |
| 96 | given_dpr_2_when_rendering_each_frame_then_setTransform_dpr_not_cumulative_scale | DPR (`fluid-canvas2d.test.ts`) |
| 97 | given_hover_interaction_at_rest_when_rendering_then_roundRect_at_swelled_home_rect | B1 rest contour (`fluid-canvas2d.test.ts`) |
| 98 | given_null_2d_context_when_init_then_rejects | D64-5 (renderer) (`fluid-canvas2d.test.ts`) |
| 99 | given_resize_when_called_then_density_buffer_comes_from_createImageData_at_css_over_scale | no new ImageData (A6) (`fluid-canvas2d.test.ts`) |
| 100 | given_testBackend_when_frame_runs_then_order_is_sync_tick_syncGeneration_render | loop order (`runtime.test.ts`) |
| 101 | given_prefers_reduced_motion_when_created_then_set_reduced_motion_true_and_change_listener_attached | RM detection (`runtime.test.ts`) |
| 102 | given_reduced_motion_media_change_when_fired_then_set_reduced_motion_follows | RM change (C5) (`runtime.test.ts`) |
| 103 | given_forceReducedMotion_when_media_changes_then_ignored | RM force (C5) (`runtime.test.ts`) |
| 104 | given_runtime_when_destroyed_then_core_freed_canvas_removed_listeners_detached_and_idempotent | destroy (`runtime.test.ts`) |
| 105 | given_null_2d_context_when_creating_then_rejects | D64-5 (runtime) (`runtime.test.ts`) |
| 106 | given_core_index_when_imported_then_createFluidRuntime_is_not_exported | internal entry (`runtime.test.ts`) |
| 107 | given_observed_area_over_max_area_when_redistributed_then_console_warn_once | density warning (`runtime.test.ts`) |
| 108 | given_window_resize_when_fired_then_canvas_backing_store_and_renderer_resized_with_dpr | resize (C2) (`runtime.test.ts`) |
| 109 | given_container_mode_when_container_resizes_then_ResizeObserver_resizes_canvas_and_canvas_is_inside_container | container resize (C2) (`runtime.test.ts`) |
| 110 | given_initial_elements_when_created_then_area_hint_and_tallest_height_passed_to_core | B5 + B15 constructor args (`runtime.test.ts`) |
| 111 | given_observed_element_when_frame_runs_then_render_frame_carries_capacity_active_count_and_paint_by_slot | RenderFrame (B3, B12) (`runtime.test.ts`) |
| 112 | given_ts_src_when_scanned_then_only_files_directly_in_ts_src_import_pkg | copy-wasm (D3) (`wasm-import-paths.test.ts`) |
| 113 | given_built_dist_when_scanned_then_no_js_file_still_contains_a_pkg_specifier | copy-wasm (D3) (`wasm-import-paths.test.ts`) |
| 114 | given_built_dist_when_scanned_then_no_d_ts_references_pkg | copy-wasm (D3) (`wasm-import-paths.test.ts`) |
| 115 | given_dist_wasm_loader_when_read_then_dynamic_import_points_at_the_packaged_glue | copy-wasm (D3) (`wasm-import-paths.test.ts`) |

## Must NOT
- Touch or break the soft-body engine (`src/{api,buffer,entity,math,physics}.rs`, `phantom-observer.ts`, `wasm-bridge.ts`, old renderers); W66 removes it.
- Export anything new from `packages/core/ts/src/index.ts`.
- Copy spike code (D2), use `unwrap`/`expect`/panicking indexing in `src/fluid/`, or allocate on the hot path.
- Call `new ImageData` or `new OffscreenCanvas` in the renderer.
- Pass JSON over the FFI.

## Must DO
- Gate D64-1 … D64-15 before `wdd ward status 64 red`, and log them in NORTH-STAR (W64.1 appends D64-16 … D64-18).
- Reconcile this Tests table with the tests actually written, in the red commit.
- Run `npm run build:wasm` before `npm test` from this ward on (D4). `fluid-ffi` and `multi-instance-wasm` need a fresh `pkg/` containing `FluidCore`.
- Keep `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` clean.
- Inspect the gold screenshots with vision, not with programmatic position checks.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run build`

### Steps
1. Run: `cargo test --lib fluid::`
   Expected: all `fluid::` tests pass, with no `ignored` other than those marked for slice 6.
2. Run: `npm test`
   Expected: every project green, including `fluid-ffi.test.ts` and `multi-instance-wasm.test.ts`.
3. Run: `npm run dev`, then open `http://localhost:3000/scenes/acceptance.html`.
   Verify: three pills and a card with crisp edges, their own colours and the DOM text visible; no fuzzy fringe; no console errors.
4. Turn on OS "Reduce motion" (macOS: Accessibility → Display → Reduce motion) and reload.
   Verify: the same crisp frame, and two screenshots taken 1 s apart are identical.

### Pass criteria
- [ ] Screenshots of steps 3 and 4 inspected with vision: crisp roundRects and readable DOM text.
- [ ] `npm run verify` is green.

## Verification
`npm run verify` is green, the vision-inspected scene screenshots are attached to the gold message, and Dennis approves.
