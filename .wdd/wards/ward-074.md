---
ward: 74
revision: null
name: "Text that flows"
epic: "fluid-engine"
status: planned
dependencies: [73]
layer: "typescript"
estimated_tests: 62
created: "2026-10-10"
completed: null
---
# Ward 074: Text that flows

North star: step 3 "✅ W with text" (slice matrix, S4 column): under `renderer=webgpu` a splashed element's text stretches and tears with its own liquid and the real DOM text returns pixel-exact at rest; steps 1, 2, 4 and 6 stay green in both renderers, and the pale "ghost pill" inside a splash hole is gone in both.

## Scope
Slice 4's first ward makes the text liquid in WebGPU (slice-4 design §3):
- **Rust:** a render-only deformation gradient F per particle, updated in G2P every substep (`F ← (I + dt·C)·F`, slip towards I, closed-form 2×2 SVD clamp σ ∈ [0.2, 5], det < 0 flipped, sticky `torn` with hysteresis), never in the stress. Rest gains a third condition, per element `max‖F − I‖ < 0.05`, exported in state slot 3. F-cost benchmark and finiteness/det > 0 over the stress sequence.
- **Text atlas** (`renderers/webgpu/text-atlas.ts`): text nodes, `Range.getClientRects()` line boxes, computed style, word-wise `fillText` at DPR on one shelf-packed `OffscreenCanvas`, gutter 10 px; injectable canvas factory for jsdom.
- **GPU:** the particle buffer grows to 8 floats (x, y, F, flags, pad), rest UVs upload with the homes, a third pass splats atlas text into T1 `rgba16float` + T1w `r16float` at 1× backing with the liquid's kernel and `‖F⁻¹‖ ≤ 2`, and a text composite is drawn after the rest SDF.
- **`liquid-text` toggle** (`text-toggle.ts`, refcounted holds in `stylesheet.ts`), set by the runtime after `render()` only while the WebGPU renderer draws that element's atlas text; removed on Canvas2D, reduced motion, an atlas failure, `device.lost` (the W72 rebuild clears it), a failed frame, `unobserve` and `destroy`.
- **The ghost pill** (D74-7): investigated in W74.0, fixed by evidence.
- e2e: Canvas2D never sets `liquid-text`; in `webgpu-hw` the text is visible mid-splash, DOM text and no class at rest, no blink at the toggle, `device.lost` and live reduced motion remove the class.

Out of scope (W75): per-element MutationObserver, colour auto-refresh, atlas re-render on text/fonts/DPR, forced-colors/print with the class active, `refresh()`/a11y under WebGPU, the Canvas2D halo. Out (later slices): drag/merge, scroll, resize, parking, gravity, icons/images/SVG in the atlas.

## Inputs
- W67–W73: `src/fluid/` (solver G2P with `measure_dev`/`reuse_bounds`, `Elements` rest state with hysteresis and `damage`, `Particles.f`/`flags` already in the dynamic view, `FLAG_TORN = 1`), `scenario_tests.rs` stress sequence and re-form budgets.
- W71/W72: `WebGPURenderer` (splat → composite → rest SDF, explicit layouts, validation scope at init, `maxTextureDimension2D`, `loseDeviceForTest`), `gpu-buffers.ts`, `shaders.ts`, `kernel-params.ts`, `_fake-gpu.ts`, the runtime's mutable renderer slot and `rebuildAsCanvas2D`, `__liquidTest.pixels()`, the `webgpu-hw` project and `webgpu-robust.spec.ts`.
- W66: `stylesheet.ts` (`TEXT_CLASS`, the layered screen-only rules), `ElementRegistry`, decoration refcounting.
- Slice-4 design `docs/superpowers/specs/2026-10-10-liquiddom-slice-4-liquid-text-design.md` §2 (spike numbers), §3, §5, §6; the binding spec §2–§4 as amended in `58c1512`.

## Outputs
- Rust: `src/fluid/fmath.rs` (`svd2`, `clamp_f`, `update_f`, `mul2`, `f_dev`, `F_SIGMA_MIN/MAX`, `TORN_CLEAR_MIN/MAX`, `F_REST_TOL`); `SubstepOpts.f_dt`; `Scratch.max_fdev`; `Elements::update_rest_state_with_f`; state slot 3 = `ST_MAX_F_DEV`.
- TS: `renderers/webgpu/text-atlas.ts` (`AtlasRect`, `AtlasCanvasFactory`, `ATLAS_GUTTER_PX`, `ATLAS_MAX_SIZE_PX`, `TextAtlas` with `build`, `invalidate`, `stale`, `version`, `dpr`, `canvas`, `width`, `height`), `renderers/frame.ts` (`ElementPaint.atlasRect: AtlasRect | null`, `TextAtlasFrame`, `RenderFrame.textAtlas`, `Renderer.textReady?`), `gpu-buffers.ts` (`PARTICLE_GPU_FLOATS`, `TEXT_INFO_FLOATS`, `packParticles` 8 floats, `packRestUV`, `packTextInfo`, `hasMovingText`), `shaders.ts` (`TEXT_WGSL`, `TEXT_COMPOSITE_WGSL`, `FINV_NORM_CLAMP`), `stylesheet.ts` (`addTextClass`, `removeTextClass`, the new text rule), `text-toggle.ts` (`syncTextClasses`, `clearTextClasses`, `releaseTextClass`), `runtime.ts` (atlas build, toggle, fail-safe paths, `@internal textAtlasCanvas`, `TEXT_ATLAS_WARNING`). W75 consumes `TextAtlas.invalidate/stale` and the toggle.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D74-1: F update rate
Proposal: F is updated in G2P on every substep (`fmath::update_f`: `F ← (I + dt·C)·F`, then `F ← F + k·(I − F)` with `k = dt·SLIP_RATE_PER_S·s²`, then the σ clamp, computed without trigonometry), with no allocation and never in the stress. At gold the shipped WASM is timed (`scripts/bench-opt-level.mjs --run`, pointer sweep, splash and shake, five alternating runs against an "F off" build): only if the median p95 ratio exceeds 1.2 (spec §6 tick budget) does F drop to every 2nd substep (dt × 2). An ignored native benchmark (`bench_f_update_cost_every_vs_every_2nd_substep_d74_1`) reports off / every / every 2nd for reference.
Consequence: +7 % (spike, mean 3.41 → 3.66 ms) to +14 % (plan validation 2026-10-10, WASM median p95 ratio 1.14, runs 1.06–1.25; mean 3.64 → 4.10 ms per fixed step) Rust tick time; the FFI is unchanged (`f00..f11`, `flags` are already in the dynamic view); a test-only knob `f_every` exists for the benchmark.
Decision: APPROVED 2026-10-10 — every substep; drop to every 2nd only if the gold WASM p95 ratio > 1.2 (saga dec_020dbc51)

### D74-2: Rest needs F ≈ I
Proposal: per element `max‖F − I‖_F < 0.05` joins `s > 0.95` and `maxDev < 0.75 px` in the rest condition (same 150 ms hold, same 120 ms rise), measured in the last substep's G2P with maxDev (and by `measure_max_f_dev` on redistribute/reduced motion), exported as state slot 3 (`ST_RESERVED` becomes `ST_MAX_F_DEV` / `St.MAX_F_DEV`); `settle_if_at_rest` also requires it. Re-form must stay ≤ 3 s; W74.0 measures it with the real F before red.
Consequence: rest comes slightly later after a hard splash, and the "sharpness snap" at the atlas → DOM text switch disappears. Risk measured in W74.0: the wobble keeps `‖F − I‖` above 0 while restAlpha < 1; if it reaches 0.05 or re-form exceeds 3 s, W74.0 stops and the tolerance or the F slip is brought back to this gate.
Decision: AMENDED 2026-10-10 — rest also needs max‖F−I‖_F < 0.05 (state slot 3 ST_MAX_F_DEV) and F gets its own slip rate F_SLIP_RATE_PER_S = 1.5 × SLIP_RATE_PER_S, after W74.0 measured the card splash at 218 frames with the shared slip (was dec_52b5d447) (saga dec_f34db06a)

### D74-3: Torn hysteresis
Proposal: `torn` (FLAG_TORN) is set whenever the σ clamp hits (σ outside [0.2, 5] or det < 0) and stays set until both singular values of the updated F lie in [0.67, 1.5]. Non-finite F or C gives `(I, torn)`. The reduced-motion pin (`reset_kinematics`) sets F = I and clears `torn`.
Consequence: text vanishes at a tear and comes back only once the liquid has healed, without flicker at the edge of the band; a torn particle still adds Σw to T1w, so its neighbours' text fades there instead of spreading into the tear. In the stress sequence's strength-2 card splash about 40 % of all particles are torn at the peak (plan validation: 3376 of 8000; the spike's 242 came from a softer sequence), all healed by rest.
Decision: APPROVED 2026-10-10 — torn set at the σ clamp, cleared at σ ∈ [0.67, 1.5] (saga dec_579f4895)

### D74-4: Text pass
Proposal: a third render pass per frame, only while a painted element with a valid atlas rect has `restAlpha < 1`: instanced quads per particle (the liquid's kernel radius, incl. the T0-texel floor) into T1 `rgba16float` (Σw·text_rgba_premul) and T1w `r16float` (Σw) at 1× the canvas backing (clamped to `maxTextureDimension2D`), additive. `uv = rest_uv + diag(1/w_rest, 1/h_rest)·F⁻¹·(frag − x_p)`, `F⁻¹` computed per instance with its norm clamped to 2; coverage 0 when torn, `|det F| < 1e-4` or `uv ∉ [0,1]²`. Screen order: liquid composite → rest SDF → text composite (`T1 / T1w`, thresholded at 0.5 like the liquid, premultiplied, over). The particle buffer becomes 32 B per particle (`x, y, f00, f01, f10, f11, flags, pad`); rest UVs upload with the homes; the atlas uploads with `copyExternalImageToTexture` once per atlas version. Both text pipelines are built at init in the existing validation scope (a shader bug rejects `create()`); T1/T1w and the atlas texture are allocated on first use. T2 is dropped.
Consequence: +10 B per sample in its own pass (the per-pass limit of 32 B holds), one extra instanced draw and one full-screen draw while text moves, ≈ 256 KB per frame particle upload at 8000 particles (was 64 KB); nothing changes under Canvas2D. Approved W71/W72 tests change: pipeline/module/layout counts, the empty-scene buffer labels and the particle write size.
Decision: APPROVED 2026-10-10 — own pass T1 + T1w at 1× backing, liquid kernel, F⁻¹ clamp 2, liquid → SDF → text; T2 dropped (saga dec_a39f7e75)

### D74-5: Atlas
Proposal: `TextAtlas.build(entries)` in `renderers/webgpu/text-atlas.ts`, called by the runtime (never the renderer) under WebGPU on every generation or paints change: per element with at least one non-whitespace text node, a slot of `ceil(w·dpr) + 2·ceil(10·dpr)` × `ceil(h·dpr) + 2·ceil(10·dpr)` atlas px, shelf-packed left to right in one `OffscreenCanvas` page of at most 4096 × 4096 atlas px at the viewport DPR; per text node the parent's computed font, colour, letter-spacing and text-transform; each word (`/\S+/`) filled at its first `Range.getClientRects()` line box, baseline from `fontBoundingBoxAscent/Descent`, no re-wrapping. An element wider than the page or past its height gets no rect (its DOM text stays); a missing canvas or 2d context gives no atlas; a throwing build gives one `console.warn` per instance and no atlas. `invalidate(id)` and `stale` are the W75 re-render hooks.
Consequence: underline, text-shadow, icons, images and SVG are not in the atlas (they stay DOM; decorations are hidden while the text moves, see D74-6); `capitalize` is approximated per word; a font that loads after the build shows the fallback until W75's `loadingdone` trigger; the page costs ≤ 64 MB in the worst case and usually far less.
Decision: APPROVED 2026-10-10 — getClientRects + word-wise fillText at DPR, one shelf-packed page ≤ 4096², gutter 10 px, text nodes only (saga dec_44a29006)

### D74-6: `liquid-text` toggle
Proposal: the runtime calls `syncTextClasses` once per frame after `renderer.render()`: an element carries `liquid-text` exactly while the active renderer is WebGPU, motion is not reduced, `renderer.textReady(id)` is true (its atlas rect is uploaded and valid) and its `restAlpha < 1`; holds are refcounted per element across instances. The class is removed at once on `device.lost` (in `rebuildAsCanvas2D`, before the async init), reduced motion switching on (in the media listener, without waiting for a frame), a failed frame or a failed rebuild, `unobserve` and `destroy`; Canvas2D and a missing atlas or rect never set it. The CSS becomes `.liquid-text, .liquid-text * { -webkit-text-fill-color: transparent; text-decoration-color: transparent; text-shadow: none }` (all `!important`, screen and `forced-colors: none` only) instead of `.liquid-text { color: transparent }`, so descendants with their own colour hide too while `color` (read by the atlas, used by `currentColor` icons and focus rings) is untouched; spec §4 is amended.
Consequence: the DOM text is never invisible without the atlas text in its place (Review Focus 1); approved stylesheet test 4 changes its text-rule assertion; the e2e "never liquid-text" assertions become "at rest" (both renderers) and "never under Canvas2D".
Decision: APPROVED 2026-10-10 — refcounted liquid-text via -webkit-text-fill-color with every fail-safe path (saga dec_8a76bea3)

### D74-7: The splash ghost pill
Proposal: W74.0 traces restAlpha per frame after a splash and probes the canvas inside the hole in both renderers. Hypothesis from the code: `Elements::damage` (splash, shake) only lowers stiffness, so `update_rest_state` lets restAlpha fall over `REST_FADE_S` = 120 ms (≈ 7 frames) while the splash empties the rect within 2–6 frames; `REST_WGSL` and the Canvas2D `roundRect` keep drawing the rest contour at that restAlpha on the original rect, a pale pill in the hole. Fix A (if confirmed): `damage` sets restAlpha to 0 at once (both renderers, no shader change); the 120 ms rise and every non-damage break (pointer, hover, rect motion) keep the fade. Alternative B: mask the rest overlay by the liquid's coverage in both renderers.
Consequence (A): on the splash/shake frame the crisp contour switches to the full-weight liquid of the same shape (the particles have not moved yet) and the atlas text takes over at F = I; the wobble starts a few frames earlier, so the Canvas2D Linux baselines `acceptance-step3-splash-f12` and `acceptance-step6-shake-f20` may move and then need Dennis' approval (D65-7).
Decision: APPROVED 2026-10-10 — fix A — damage() sets restAlpha to 0 at once (saga dec_f2bdd4d3)

## Specification
Plan: `docs/superpowers/plans/2026-10-10-fluid-slice-4/W74.md` (complete code for every task). Slice design §3; spec §2 "Per-element rest state", "Deformation gradient F", §3 "WebGPU", "Liquid text: the formula", "Crisp at rest", "Text atlas", §4.
- **F (Rust):** row-major `[f00, f01, f10, f11]` like C. Blinn's closed form `F = R(φ)·diag(sx, sy)·R(θ)` (`sx ≥ |sy|`, `sy < 0 ⇔ det < 0`). `clamp_f` returns F unchanged when `sx ≤ 5 ∧ sy ≥ 0.2`, else `R(φ)·diag(clamp(sx), clamp(|sy|))·R(θ)` and `hit`. `update_f(f, c, dt, s, torn)`; `torn' = hit ∨ (torn ∧ ¬(σ2 ≥ 0.67 ∧ σ1 ≤ 1.5))`. G2P updates F for every homed particle with mass on every substep with `opts.f_dt > 0`, and on `measure_dev` substeps records per element `max‖F − I‖_F` (sqrt once per element).
- **Rest:** `update_rest_state_with_f(id, maxDev, maxFDev, dt, rm)`; `holds = s > 0.95 ∧ maxDev < 0.75 ∧ maxFDev < 0.05`; slot 3 = maxFDev (non-finite → `f32::MAX`), 0 for inactive slots and under reduced motion. `update_rest_state(id, dev, dt, rm)` stays as the `maxFDev = 0` form for the W67 tests. D74-7 A: `damage` writes restAlpha 0.
- **GPU buffers:** particle record `[x, y, f00, f01, f10, f11, flags, 0]` (non-finite position → `OFFSCREEN_PX`, non-finite F → identity with `FLAG_TORN`); rest UV `[u, v]` (non-finite → −1); text info per slot `[x/W, y/H, w/W, h/H, w/dpr, h/dpr, valid, 0]`, valid only for a finite rect inside the atlas.
- **Renderer:** `prepareText` uploads the atlas when `frame.textAtlas.version` changes (rejecting a size above `maxTextureDimension2D` or a throwing copy), repacks text info when the atlas or paints change, and runs the text pass only when `hasMovingText`. `textReady(id)` = device alive ∧ not lost ∧ atlas uploaded ∧ the slot's record valid.
- **Toggle:** see D74-6; the toggle never runs inside the renderer.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | fmath: given_2x2_matrices_when_svd2_then_u_sigma_vt_reconstructs_f_with_sigma_descending_non_negative_and_orthogonal_u_v | closed-form SVD (README interface) |
| 2 | fmath: given_f_inside_the_clamp_band_with_det_above_0_when_clamp_f_then_bit_identical_and_no_hit | no clamp in the band |
| 3 | fmath: given_singular_values_beyond_5_or_below_0_2_when_clamp_f_then_clamped_into_the_band_rotations_kept_and_hit | σ clamp |
| 4 | fmath: given_det_below_0_when_clamp_f_then_det_above_0_with_the_same_singular_values_and_hit_d74_3 | det flip |
| 5 | fmath: given_identity_and_a_velocity_gradient_when_update_f_then_f_is_i_plus_dt_c_times_f | D74-1 integration |
| 6 | fmath: given_s_1_and_a_stretched_f_when_update_f_for_1_s_then_f_relaxes_towards_i_at_f_slip_rate_4_5_times_s_squared | F-only slip 1.5× (D74-2 amended) |
| 7 | fmath: given_a_torn_particle_when_update_f_then_torn_clears_only_with_both_singular_values_in_0_67_to_1_5_d74_3 | D74-3 hysteresis |
| 8 | fmath: given_non_finite_f_or_c_when_update_f_then_identity_and_torn | no NaN propagation |
| 9 | fmath: given_the_d74_constants_when_read_then_0_2_5_0_67_1_5_and_0_05 | D74-2/3 literals |
| 9a | fmath: given_d74_2_amended_when_reading_the_f_slip_rate_then_it_is_1_5_times_the_liquid_slip_rate | D74-2 amended: F_SLIP_RATE_PER_S = 1.5 × SLIP_RATE_PER_S |
| 10 | particles: given_a_torn_particle_with_deformed_f_when_reset_kinematics_then_f_identity_torn_cleared_other_flag_bits_kept | RM pin heals |
| 11 | elements: given_max_f_dev_at_or_above_0_05_when_rest_state_updated_then_rest_alpha_never_rises_and_slot_3_carries_it_d74_2 | D74-2 rest condition, slot 3 |
| 12 | elements: given_rest_alpha_1_when_damaged_then_rest_alpha_is_0_at_once_d74_7 | D74-7 fix A |
| 13 | scenario: given_stress_sequence_when_run_then_every_f_stays_finite_with_det_above_0_and_sigma_within_the_clamp_d74_1 | F stability over the stress |
| 14 | scenario: given_stress_sequence_then_idle_when_every_element_is_at_rest_then_no_particle_is_torn_and_slot_3_is_below_0_05_d74_3 | heals at rest |
| 15 | scenario: given_a_strength_1_splash_when_re_forming_then_rest_alpha_is_1_only_with_slot_3_below_0_05_and_within_3_s_d74_2 | D74-2 + 3 s budget |
| 16 | scenario: given_a_splash_or_shake_on_resting_elements_when_applied_then_their_rest_alpha_is_0_before_and_after_the_next_frame_d74_7 | D74-7 in the scene |
| 17 | scenario (ignored): bench_f_update_cost_every_vs_every_2nd_substep_d74_1 | D74-1 cost, release |
| 18 | fluid-layout (modified): given_layout_rs_when_parsed_then_every_rust_constant_has_an_equal_ts_mirror | `ST_MAX_F_DEV` mirror |
| 19 | gpu-buffers (modified): given_soa_views_when_packParticles_then_x_y_f_and_flags_are_packed_8_floats_per_active_particle_and_the_count_is_returned | 32 B particle record |
| 20 | gpu-buffers (modified): given_non_finite_positions_or_f_when_packParticles_then_the_particle_goes_off_screen_or_gets_identity_and_torn_and_a_too_small_output_throws_RangeError | sanitising |
| 21 | gpu-buffers: given_PARTICLE_GPU_FLOATS_and_TEXT_INFO_FLOATS_when_read_then_8_and_8_32_bytes_each | WGSL struct sizes |
| 22 | gpu-buffers: given_static_views_when_packRestUV_then_rest_u_rest_v_per_active_particle_and_non_finite_becomes_minus_1 | rest-UV upload |
| 23 | gpu-buffers: given_atlas_rects_when_packTextInfo_then_normalised_atlas_rect_rest_size_in_css_px_and_valid_only_inside_the_atlas_review_focus_4 | Review Focus 4 |
| 24 | webgpu-shaders (modified): given_the_five_shaders_when_read_then_each_has_a_vs_and_an_fs_entry_point_and_binds_group_0_only | text shaders |
| 25 | webgpu-shaders: given_TEXT_WGSL_when_read_then_it_splats_t1_and_t1w_with_the_liquids_kernel_and_skips_resting_unpainted_or_textless_elements | D74-4 |
| 26 | webgpu-shaders: given_TEXT_WGSL_when_read_then_f_inverse_is_norm_clamped_to_2_and_coverage_is_0_when_torn_degenerate_or_outside_the_unit_square_d74_4 | D74-4 formula |
| 27 | webgpu-shaders: given_TEXT_COMPOSITE_WGSL_when_read_then_t1_over_t1w_is_thresholded_like_the_liquid_and_premultiplied | D74-4 composite |
| 28 | webgpu-renderer (modified): given_successful_init_when_built_then_five_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3_D74_4 | approved-test change |
| 29 | webgpu-renderer (modified): given_an_empty_scene_when_rendering_then_no_zero_size_buffer_no_splat_or_rest_draw_one_composite_draw_and_no_validation_error_review_focus_2 | new buffers, 32 B particle |
| 30 | webgpu-renderer (modified): given_a_scene_when_rendering_frames_then_particles_and_elements_upload_every_frame_and_homes_only_on_a_generation_or_paints_change | 8-float upload |
| 31 | webgpu-renderer: given_a_text_atlas_and_a_moving_element_with_an_atlas_rect_when_rendering_then_the_atlas_is_uploaded_once_per_version_the_1x_text_pass_writes_T1_and_T1w_and_the_text_composite_follows_the_rest_quads_d74_4 | D74-4 passes and order |
| 32 | webgpu-renderer: given_every_text_element_at_rest_or_no_atlas_rect_when_rendering_then_no_text_pass_and_no_text_composite | no text at rest |
| 33 | webgpu-renderer: given_textReady_when_queried_then_true_only_for_slots_with_a_valid_uploaded_atlas_rect_and_false_after_a_device_loss_or_destroy | toggle input |
| 34 | webgpu-renderer: given_an_atlas_beyond_maxTextureDimension2D_or_a_failing_copy_when_rendering_then_no_text_textReady_false_and_no_validation_error_review_focus_4 | Review Focus 4 |
| 34a | webgpu-renderer: given_version_n_uploaded_when_the_copy_for_version_n_plus_1_fails_then_textReady_drops_and_the_stale_atlas_is_not_drawn_review_focus_4 | Review Focus 4 (no stale atlas; red review fix 1) |
| 35 | webgpu-renderer: given_text_drawn_when_resized_then_T1_and_T1w_follow_the_backing_size_at_1x_clamped_to_the_device_limit | T1 at 1× |
| 36 | webgpu-renderer: given_rest_uv_when_rendering_then_it_is_uploaded_with_the_homes_only_on_a_generation_paints_or_count_change | rest-UV cadence |
| 37 | text-atlas: given_three_elements_with_text_when_built_then_shelf_packed_left_to_right_with_a_10px_gutter_and_rects_in_atlas_px | D74-5 packing |
| 38 | text-atlas: given_text_nodes_when_built_at_dpr_2_then_each_word_is_filled_at_its_line_box_baseline_with_the_computed_font_colour_letter_spacing_and_text_transform | D74-5 drawing |
| 39 | text-atlas: given_an_element_without_text_or_with_whitespace_only_when_built_then_it_has_no_rect_and_an_atlas_without_text_has_no_canvas_review_focus_1 | Review Focus 1 |
| 40 | text-atlas: given_an_element_wider_than_the_page_or_past_its_height_when_built_then_only_that_element_has_no_rect_review_focus_4 | Review Focus 4 |
| 41 | text-atlas: given_32_elements_with_text_at_dpr_2_when_built_then_every_rect_fits_the_page_without_overlap_review_focus_4 | Review Focus 4 |
| 42 | text-atlas: given_a_factory_that_returns_null_or_a_canvas_without_a_2d_context_when_built_then_an_empty_map_and_no_canvas | jsdom / fail-safe |
| 43 | text-atlas: given_invalidate_when_called_then_stale_until_the_next_build_and_the_version_bumps_per_built_canvas | W75 hook |
| 44 | text-atlas: given_no_Range_getClientRects_when_built_with_text_then_it_throws_a_named_error | failure is loud to the runtime |
| 45 | stylesheet (modified): given_css_text_when_read_then_paint_and_stacking_scoped_to_screen_without_forced_colors_and_print_and_forced_colors_hide_canvas | D74-6 text rule |
| 46 | stylesheet: given_two_holders_when_addTextClass_twice_and_removeTextClass_once_then_the_class_stays_until_the_last_release_and_a_pre_existing_class_is_kept | refcount |
| 47 | text-toggle: given_webgpu_a_ready_renderer_and_rest_alpha_below_1_when_synced_then_the_element_gets_liquid_text_once_and_loses_it_at_rest_alpha_1 | D74-6 rule |
| 48 | text-toggle: given_canvas2d_reduced_motion_no_textReady_or_nan_rest_alpha_when_synced_then_no_class_and_a_held_class_is_released_review_focus_1 | Review Focus 1 |
| 49 | text-toggle: given_two_instances_holding_one_element_when_one_releases_then_the_class_stays_until_both_release | refcount across instances |
| 50 | text-toggle: given_held_elements_when_clearTextClasses_then_every_class_is_removed_and_held_is_empty | fail-safe primitive |
| 51 | text-toggle: given_a_held_element_that_is_no_longer_in_ids_or_released_when_synced_then_its_class_is_removed | no orphan holds |
| 52 | text-runtime: given_webgpu_and_a_moving_element_with_text_when_a_frame_runs_then_the_atlas_is_built_the_text_pass_runs_and_liquid_text_is_set | wiring |
| 53 | text-runtime: given_the_element_comes_to_rest_when_a_frame_runs_then_liquid_text_is_removed_in_the_frame_the_text_pass_stops | no blink (unit) |
| 54 | text-runtime: given_canvas2d_when_elements_move_then_liquid_text_is_never_set_and_no_atlas_is_built | Canvas2D never |
| 55 | text-runtime: given_liquid_text_on_when_the_device_is_lost_then_every_class_is_removed_before_the_canvas2d_rebuild_settles_review_focus_1 | Review Focus 1 (lost device; Canvas2D init held pending) |
| 55a | text-runtime: given_liquid_text_on_when_the_canvas2d_rebuild_fails_then_the_class_is_removed_review_focus_1 | Review Focus 1 (failed rebuild; red review fix 1) |
| 56 | text-runtime: given_liquid_text_on_when_reduced_motion_switches_on_then_the_class_is_removed_without_a_frame_review_focus_1 | Review Focus 1 (RM mid-splash) |
| 57 | text-runtime: given_liquid_text_on_when_unobserve_or_destroy_then_the_class_is_removed_and_the_class_attribute_restored_review_focus_1 | Review Focus 1 (destroy) |
| 58 | text-runtime: given_an_atlas_build_that_throws_when_frames_run_then_one_console_warn_no_class_and_the_liquid_keeps_rendering_review_focus_1 | Review Focus 1 (atlas failure) |
| 59 | text-runtime: given_liquid_text_on_when_a_frame_throws_then_the_class_is_removed_review_focus_1 | Review Focus 1 (failed frame) |
| 60 | text-runtime: given_an_element_without_text_when_it_moves_then_it_never_gets_liquid_text_review_focus_1 | Review Focus 1 (no text nodes) |
| 61 | acceptance.spec (modified): step 1 – … DOM text is visible (message: no liquid-text at rest, both renderers) | D74-6 |
| 62 | modes.spec (modified): step 8 – given print media … (message: Canvas2D never sets liquid-text) | D74-6 |
| 63 | acceptance.spec: step 3 (canvas2d) – given a splash when ticking 30 frames then no element ever carries liquid-text (D74-6) | Canvas2D never (blocking CI) |
| 64 | acceptance.spec: step 3 – given a splash at the centre of Splash when ticking 8 frames then its restAlpha is 0 from the first frame and no probe in the hole shows the pale rest overlay (D74-7) | ghost pill, both renderers |
| 65 | webgpu-robust.spec: W74 step 3 (webgpu) – given a soft splash on Splash when mid-splash then it carries liquid-text, its DOM text fill is transparent and the canvas shows its white text inside the rect | text visible mid-splash |
| 66 | webgpu-robust.spec: W74 step 3 (webgpu) – given the splash re-formed when every restAlpha is 1 then no element carries liquid-text, the DOM text is opaque and the canvas holds no white text pixels | DOM text at rest |
| 67 | webgpu-robust.spec: W74 no blink – given a soft splash when Splash comes to rest then the composited text region changes by less than 2 % MAE across the liquid-text toggle | no blink |
| 68 | webgpu-robust.spec: W74 device.lost – given liquid-text on mid-splash when the device is lost then every element loses the class and its DOM text is opaque again | Review Focus 1 e2e |
| 69 | webgpu-robust.spec: W74 reduced motion – given liquid-text on mid-splash when prefers-reduced-motion turns on then the class is gone without advancing a frame | Review Focus 1 e2e |
| 70 | webgpu-robust.spec (VISION=1): W74 gold – capture the splash, the rest transition and the shake in webgpu and canvas2d | gold vision |
| 71 | auto-renderer (modified): given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_the_liquid_pipelines_exist_and_no_warning_D71_2 | five pipelines at init (approved-test change) |
| 72 | webgpu-lifecycle (modified): given_a_working_surface_when_init_then_exactly_two_balanced_validation_scopes_the_surface_scope_first_and_no_error | five modules and pipelines inside the pipeline scope (approved-test change) |

## Must NOT
- Copy anything from `spike.patch` or the spike branch (D2); the spike is evidence only.
- Let F enter the stress, allocate in the hot path, index panickingly or `unwrap` in `src/fluid` (clippy `indexing_slicing` denied).
- Change the FFI strides or add a scalar call; slot 3 of the state view is the only new meaning.
- Touch the DOM from a renderer; only the runtime writes `liquid-text`.
- Set `liquid-text` under Canvas2D, under reduced motion, without a ready atlas rect, or leave it on after any fail-safe path.
- Add a 32-bit float render target or put T1 in the T0 pass.
- Commit a Linux baseline without Dennis' vision approval (D65-7); push or merge without asking.

## Must DO
- Pass the direction gate (D74-1…7 approved, saga ids, NORTH-STAR rows) before red; stop at red for "godkendt" and at gold.
- Run W74.0's measurements (re-form budget with F rest, F residual under the wobble, ghost-pill trace) and record them below before red.
- Pin Review Focus 1 (tests 39, 48, 55–60, 68, 69) and Review Focus 4 (tests 23, 34, 40, 41).
- Keep `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green; run the release F benchmark at gold and apply D74-1's rule.
- Inspect Metal stills of both renderers at the same frames with vision at gold.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run dev` (Vite on `demo/`, Chromium with WebGPU on Metal).

### Steps
1. Open `http://localhost:3000/scenes/acceptance.html?renderer=webgpu`, wait 2 s, click Splash.
   Verify: the white "Splash" text bends and tears with the blue liquid, gaps in the liquid are gaps in the text, no grey pill inside the hole.
2. Wait until it re-forms.
   Verify: the text sharpens into the real DOM text without a visible jump; DevTools shows no `liquid-text` on any element.
3. Click Splash, then toggle DevTools › Rendering › `prefers-reduced-motion: reduce` mid-splash.
   Verify: the DOM text is visible at once and the scene is still.
4. Open the same URL with `?renderer=canvas2d`, click Splash.
   Verify: the DOM text stays where it is (no `liquid-text` at any time) and no grey pill appears in the hole.

### Pass criteria
- [ ] Text visibly flows and tears with its liquid in WebGPU, readable in a soft splash and under hover.
- [ ] At rest the DOM text is shown and no element has `liquid-text`.
- [ ] No ghost pill in either renderer.

## Verification
`npm run verify` (cargo 168 passed + 2 ignored, vitest 566 passed | 4 skipped, clippy clean), `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, `npm run e2e:typecheck`, the release benchmark `cargo test --release --lib bench_f_update_cost -- --ignored --nocapture`, the Linux baseline check `npm run e2e:docker -- --project=canvas2d`, Metal vision captures (`VISION=1 npx playwright test --project=webgpu-hw -g "W74 gold"`), and a `code-review` pass at level high over the ward's diff.

## Spike W74.0 result

Measured 2026-10-10 on the throwaway branch `spike/w74-measure` (deleted twice; nothing merged, D2), in two runs: the plan as approved (shared slip), then D74-2 amended to an F-only slip `F_SLIP_RATE_PER_S = 1.5 × SLIP_RATE_PER_S` (saga dec_f34db06a).
- Re-form with the F rest condition (D74-2), frames until all four restAlpha = 1 (budget 180), HEAD → shared slip → **amended (F-only slip 1.5×)**: splash 1 on Splash 145 → 165 → **145**; splash 2 on the card 173 → 218 (over budget: the STOP that sent D74-2 back to the gate) → **174**; shake 1 136 → 158 → **136**. Tolerance 0.08 / 0.10 with the shared slip gave the card 203 / 198 (still over), so the tolerance stays 0.05. W67 re-form tests after the amendment: pass, splash 135 (+10), shake 126 (+10) frames (identical to HEAD; shared slip: 155 / 148). Full Rust suite with the amended code: `152 passed; 0 failed; 1 ignored` (151 + the measurement test); no existing test fails.
- Max ‖F − I‖ per element while restAlpha < 1 (Splash, Split, Merge, card), amended: splash 1 [4.54, 0.077, 0, 0.176], card splash 2 [3.37, 2.55, 4.96, 5.68], shake 1 [2.74, 4.11, 3.60, 4.65] (peaks of the deformation; with the shared slip [4.55, 0.083, 0, 0.188], [4.39, 4.05, 5.16, 5.95], [2.98, 4.69, 3.85, 4.70]). Margin to 0.05: with the amended slip F is no longer the last rest condition, e.g. Splash slot 3 = 0.022 at f140 (rests at f145) and card slot 3 = 0.029 at f160 (rests at f174); with the shared slip it was 0.048 at f140 for Splash and 0.074 at f180 for the card. No element stalls above 0.05.
- Ghost pill (D74-7): Splash restAlpha f0…f10 before [1.0, 0.861, 0.722, 0.583, 0.444, 0.306, 0.167, 0.028, 0, 0, 0] → after all 0.0. Cause: restAlpha falls over REST_FADE_S while the hole opens by f2–f3; REST_WGSL and the Canvas2D roundRect draw the rest contour at that restAlpha (probe alpha = restAlpha·255: 149, 113, 78, 42 at f3–f6, in both renderers). Pale probes (max over f4–f7, of 27) before: canvas2d 21, webgpu 21; after fix A: canvas2d 1, webgpu 0 (max over f1–f8: 3 in both, at f1 only). Calibrates `GHOST_PALE_BAND = [16, 160]`, `GHOST_MAX_PROBES = 4`.
- Consequence for the plan: D74-2 amended (F-only slip 1.5×, saga dec_f34db06a); the plan follows it (W74.1 Step 1 / W74.2 Step 1 constant `F_SLIP_RATE_PER_S`, test 6 at the F slip rate, new test 9a pins the constant; Rust counts red 153/15/2, green 168/0/2).
