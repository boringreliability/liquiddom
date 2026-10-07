---
ward: 71
revision: null
name: "Liquid in WebGPU"
epic: "fluid-engine"
status: planned
dependencies: [70]
layer: "typescript"
estimated_tests: 41
created: "2026-10-07"
completed: null
---
# Ward 071: Liquid in WebGPU

North star: steps 1 (idle: crisp edges, DOM text at rest), 2 (pointer sweep: soft bulge, no holes) and 3 (splash: jets and fingers, re-form within 3 s; no liquid text until slice 4) pass under renderer=webgpu; Canvas2D stays green.

## Scope
Slice 3 starts here. Today `renderer: 'webgpu'` is infrastructure only: one clear pass and a warning. This ward makes it draw the liquid: one instanced quad per moving particle splatted into a half-resolution float target, a composite that thresholds the density into a silhouette with an anti-aliased edge and blends colour where elements meet, and a rounded-rect SDF overlay that makes resting elements crisp. The Canvas2D renderer shares the kernel parameters, so both put the 0.5 threshold on the rect edge the same way. The demo scene accepts `?renderer=webgpu` (and `?t0` for the T0 scale comparison), and the acceptance spec runs steps 1–3 in a `webgpu` Playwright project. Task 0 is a time-boxed spike that decides whether that project can run on SwiftShader in CI.

Out of scope: `auto` probing and the Canvas2D fallback, explicit `'webgpu'` rejecting nothing new, `device.lost` → Canvas2D rebuild, overdraw logging, steps 4/6/8 in WebGPU (all W72); T1/T2, liquid text, the DOM-text halo (slice 4).

## Inputs
- `RenderFrame` / `Renderer` (`renderers/frame.ts`, D64-17): dynamic view SoA (`x, y` at fields 0, 1), static view (`home` at field 0, −1 = none), state view (`restAlpha` at offset 2), element view (10 floats), `paints` (`ElementPaint`: background RGBA with rgb 0–255 and alpha 0–1, `areaPerParticle`, `spacingPx`), viewport (CSS size, dpr).
- `homeRectInto` (`fluid-layout.ts`): the rest rect incl. `home_dx/dy` and the 2 % hover swell.
- Canvas2D: `density-grid.ts` (kernel `mass·(1 − r²/R²)²/(πR²/3)`, R clamped to [1 cell, 8 px], blended colour, `alpha = smoothstep(0.4, 0.6, Σw) · Σw·a/Σw`) and `fluid-canvas2d.ts` (D70-4 cross-fade).
- The infra-only `WebGPURenderer` (W66): adapter/device/context, `alphaMode: 'premultiplied'`, `WebGPUUnavailableError`.
- e2e: `webgpu` project (new headless Chromium, SwiftShader flags, smoke only), pinned image `mcr.microsoft.com/playwright:v1.63.0-noble`, `scripts/e2e-docker.sh` (linux/amd64).

## Outputs
- `renderers/kernel-params.ts` (shared kernel), `renderers/webgpu/{errors,gpu-buffers,shaders,webgpu-renderer}.ts`; `renderers/webgpu-renderer.ts` deleted, `WEBGPU_INFRA_ONLY_WARNING` gone.
- `selectRenderer(choice, canvas, { t0Scale? })`; `@internal webgpuT0Scale`; `WebGPURenderer.isFallbackAdapter` and `lastFragmentEstimate` (0 until W72) for W72.
- Demo: `?renderer=canvas2d|webgpu`, `?t0=0.5|0.75`, `__liquidTest.pixels()`, `demo/smoke/webgpu-liquid.html`.
- Test infra: `_fake-gpu.ts` (W72 extends the same `installFakeGpu`), `PROJECT_RENDERER` / `projectRenderer()`, the local hardware-adapter project `webgpu-hw` (`WEBGPU_HW_LAUNCH_ARGS`, `npm run e2e:webgpu-hw`; W72 extends it), and `SWIFTSHADER_RUNS_LIQUID` in `e2e/projects.ts` (the spike answer, defined once; W72 routes by it).
- The W71.0 spike answer (below), which fixes how WebGPU is verified in CI for the rest of the epic.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D71-1: CI verification route for WebGPU
Proposal: task 0 is a time-boxed spike (½ day, throwaway branch, never merged): can WebGPU run on SwiftShader in the pinned image on a GitHub runner, 20 consecutive runs of the smoke plus a minimal splat page (8000 splats into rgba16float + r16float, 120 frames), without `device lost`? Flag variants: `--enable-unsafe-swiftshader`, `--use-angle=swiftshader`, Vulkan variants, `--disable-dev-shm-usage`, a larger shm; one worker. Yes → the `webgpu` project runs acceptance steps 1–3 with Linux baselines, soft until 10 green runs in a row (spec §6). No (fallback B) → WebGPU acceptance runs locally on macOS only (SwiftShader and Metal), CI keeps the soft smoke, and the limitation goes into CONTEXT.
Consequence: half a day before any production code. The deciding run needs one push of the throwaway branch (Dennis is asked first); without it the answer is "no". Under "no", a WebGPU regression is caught only by local runs and gold screenshots until the CI question is reopened.
Decision: APPROVED 2026-10-07 — SwiftShader spike first (½ day, throwaway branch); yes only with 80/80 on a GitHub runner, else fallback B (local Metal, soft CI smoke) (saga dec_b4a57848)

### D71-2: Which acceptance steps pass in WebGPU in this ward
Proposal: steps 1, 2 and 3 in W71; steps 4, 6 and 8 plus `device.lost` in W72. The acceptance spec is parametrised by the Playwright project's renderer and reuses the Canvas2D asserts unchanged (no hole, bulge ≥ 5 px, swell probe, re-form within 3 s); under `webgpu` the step-4 and step-6 tests skip with a W72 reason. The demo scene accepts `?renderer=webgpu` but never `auto`.
Consequence: W71 ends with a visible WebGPU liquid for the first three scene steps; `auto` stays Canvas2D and nobody gets WebGPU by default until W72. If a Canvas2D threshold fails only under WebGPU, the ward stops and asks instead of loosening it.
Decision: APPROVED 2026-10-07 — steps 1–3 in W71, steps 4, 6, 8 + device.lost in W72; acceptance spec parametrised, canvas2d asserts unchanged (saga dec_3a566bf5)

### D71-3: Pass architecture (splat with an alpha target, composite, rest SDF overlay)
Proposal: two render passes per frame. (1) Splat: one instanced quad per particle (instance data from storage buffers via `instance_index`) into **T0 `rgba16float` = (Σw·rgb, Σw)** and **T0a `r16float` = Σw·a**, both additive `{one, one, add}`. (2) Screen: a full-screen triangle composites T0 (threshold 0.5, edge widened by `fwidth`, colour Σw·rgb/Σw, premultiplied by coverage·Σw·a/Σw, `alphaMode: 'premultiplied'`), then one rounded-rect SDF quad per element with analytic anti-aliasing is drawn over it at `restAlpha` × colour alpha. T2 is deferred to slice 4; no 32-bit float targets (10 B per sample). Pipelines use explicit bind group layouts and are built inside one `pushErrorScope('validation')`; a validation error rejects `create()` as a bug, and a runtime GPU error logs one `console.error`.
Consequence: the T0a attachment corrects the plan index, which had T0 = (Σw·rgb_premul, Σw) (README, slice-3 design §2/§5/§6 and spec §3 now say T0 + T0a, cross-ward verification 2026-10-07): four channels cannot carry the blended alpha next to the density, so a translucent element would come out opaque. With T0a the composite reproduces Canvas2D's `Σw·rgb/Σw` and `Σw·a/Σw` exactly (verified on SwiftShader and Metal: a 0.5-alpha element reads 127–128 with its own colour). Costs one more attachment (2 B per sample) and nothing else.
Decision: APPROVED 2026-10-07 — splat into T0 (Σw·rgb, Σw) + T0a r16float (Σw·a), composite, rest SDF overlay; T2 deferred to slice 4 (saga dec_956b5aa9)

### D71-4: T0 render scale
Proposal: T0 is allocated at `ceil(backing px × t0Scale)` (at least 1×1), default **0.5**, configurable through the `@internal` option `webgpuT0Scale` (validated in (0, 1]) and the demo's `?t0=0.5|0.75`. At gold Dennis compares 0.5× and 0.75× side by side on Metal (Splash pill at rest, mid-sweep bulge, card after the splash) and picks the default.
Consequence: one more internal option in the whitelist. At DPR 1 and 0.5× a T0 texel is 2 CSS px, the Canvas2D grid size. 0.75× costs 2.25× the splat fill; if chosen, the default, three test literals and the webgpu baselines change at gold.
Decision: APPROVED 2026-10-07 — T0 scale default 0.5× (@internal webgpuT0Scale, ?t0=); Dennis picks 0.5× vs 0.75× at gold (saga dec_abea49e1)

### D71-5: Kernel radius per spacing, shared by both renderers
Proposal: `KERNEL_RADIUS_PER_SPACING = 2.3`, `KERNEL_RADIUS_CAP_PX = 8`, `DENSITY_THRESHOLD = 0.5` and `EDGE_SOFTNESS = 0.1` move to `renderers/kernel-params.ts` with `kernelRadiusPx(spacing)` and `kernelWeight(r, R, mass)`; `density-grid.ts` re-exports them and the WGSL interpolates them. The WebGPU radius is clamped to at least one T0 texel, as DensityGrid clamps to one cell. If vision at gold still shows bead chains in motion, the proposal is 2.8 in both renderers, in a later fix ward.
Consequence: Canvas2D pixels do not change. Both renderers can only drift apart through code that a parity test pins (grid cell = kernelWeight at the cell centre).
Decision: APPROVED 2026-10-07 — kernel 2.3 per spacing, cap 8 px, shared kernel-params.ts with a parity test; 2.8 in a later fix ward only if bead chains remain (saga dec_0beb7f91)

### D71-6: Cross-fade between the moving liquid and the rest contour
Proposal: the D70-4 rule in WebGPU form: an element's particles splat at full weight while its `restAlpha < 1` and are skipped (degenerate quads) at `restAlpha = 1`; the rest SDF overlay is drawn at `restAlpha` on top.
Consequence: no translucent dip and no fur at rest, the same transition Canvas2D shows since W70. During the fade the soft moving edge shows under the crisp contour until rest.
Decision: APPROVED 2026-10-07 — D70-4 rule in WebGPU: full splat weight while restAlpha < 1, skipped at 1, SDF overlay at restAlpha (saga dec_ca46b6f0)

## Specification
Plan: `docs/superpowers/plans/2026-10-06-fluid-slice-3/W71.md` (task by task, complete code). Slice design: `docs/superpowers/specs/2026-10-06-liquiddom-slice-3-webgpu-design.md` §2, §4, §5.
- **Buffers (`gpu-buffers.ts`, pure):** particles `x, y` interleaved for `[0, activeParticles)` every frame (non-finite → −1e6); homes (`i32`, −1 for none, NaN, fractional, out of range, unpainted or `w == 0`, Review Focus 3) only when `generation`, the `paints` array or the particle count changes; elements every frame, 16 floats = 64 B per slot: home rect (4), radius, restAlpha (clamped, NaN → 0), mass (`areaPerParticle`), kernel radius (`kernelRadiusPx(spacing)`), straight rgba (0–1), flags (1 = drawable), 3 × pad. `packElements` returns 1 + the last drawable slot (0 → no rest draw). Storage buffers are never smaller than 16 B (64 B for elements) (Review Focus 2).
- **Uniform `View` (32 B):** CSS size, backing px size, dpr, t0Scale. Positions are buffer-space CSS px (the registry subtracts the container offset), mapped to clip space with the CSS size, as Canvas2D does with `setTransform(dpr)`.
- **Splat:** quad of ±R (CSS px) around the particle, R = clamp(kernel radius, 1 T0 texel, 8 px); fragment weight `mass·(1 − r²/R²)²/(πR²/3)`, discard outside; outputs (w·rgb, w) and w·a. Degenerate quad for home −1/out of range, flags 0, restAlpha ≥ 1, mass ≤ 0.
- **Composite:** `textureSample` (linear, clamp) of T0/T0a at `frag.xy / size_px`; `soft = max(0.1, 0.75·fwidth(Σw))`; coverage = smoothstep(0.5 − soft, 0.5 + soft, Σw); rgb = Σw·rgb / max(Σw, 1e-4); alpha = coverage · clamp(Σw·a / max(Σw, 1e-4)); output (rgb·alpha, alpha) (Review Focus 4).
- **Rest overlay:** instanced quad per slot padded by 1 device px; rounded-rect SDF in CSS px, coverage = clamp(0.5 − sd·dpr, 0, 1); alpha = coverage · restAlpha · colour alpha; premultiplied, blend (one, one-minus-src-alpha).
- **Resize (Review Focus 1):** T0/T0a reallocated at `max(1, ceil(px · t0Scale))` when the size changes; the old pair is destroyed; the composite bind group follows.
- **Errors:** unavailable → `WebGPUUnavailableError` (as W66); pipeline validation error → plain `Error` ("pipeline validation failed: …"), device destroyed; `device.lost` (not `destroyed`) → one `console.warn`, rendering stops (W72 adds the rebuild); first uncaptured GPU error → one `console.error`.
- **Test readback:** a WebGPU canvas is readable only in the task that rendered it (probe 2026-10-07, SwiftShader and Metal). The scene snapshots the liquid canvas into a detached 2D canvas at the end of every `advance()`; e2e pixel helpers read `__liquidTest.pixels()` in both projects.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `kernel-params.test.ts` `given_kernel_params_when_read_then_spec_values_and_density_grid_re_exports_them_instead_of_defining_its_own` | D71-5 |
| 2 | `kernel-params.test.ts` `given_a_spacing_when_kernelRadiusPx_then_min_of_the_cap_and_2_3_spacing_and_the_cap_for_non_finite_or_non_positive` | D71-5 |
| 3 | `kernel-params.test.ts` `given_kernelWeight_when_integrated_over_its_disk_then_it_returns_the_mass_and_it_is_zero_at_and_beyond_R` | D71-5 (threshold on the rect edge) |
| 4 | `kernel-params.test.ts` `given_one_splat_when_the_density_grid_is_sampled_at_cell_centres_then_each_cell_equals_kernelWeight_there` | D71-5 parity |
| 5 | `kernel-params.test.ts` `given_the_canvas2d_renderer_when_splatting_then_the_radius_is_kernelRadiusPx_of_the_paint_spacing` | D71-5 |
| 6 | `webgpu-shaders.test.ts` `given_the_three_shaders_when_read_then_each_has_a_vs_and_an_fs_entry_point_and_binds_group_0_only` | D71-3 |
| 7 | `webgpu-shaders.test.ts` `given_SPLAT_WGSL_when_read_then_it_embeds_the_shared_kernel_cap_normalises_by_pi_R2_over_3_and_skips_unassigned_or_resting_particles` | D71-5, D71-6, RF3 |
| 8 | `webgpu-shaders.test.ts` `given_COMPOSITE_WGSL_when_read_then_threshold_and_edge_come_from_kernel_params_the_sum_is_guarded_and_the_output_is_premultiplied` | D71-3, RF4 |
| 9 | `webgpu-shaders.test.ts` `given_REST_WGSL_when_read_then_alpha_is_coverage_times_rest_alpha_times_colour_alpha_with_analytic_aa_and_premultiplied` | D71-3, D71-6 |
| 10 | `gpu-buffers.test.ts` `given_the_element_record_when_read_then_16_floats_64_bytes_with_the_wgsl_struct_offsets` | layout |
| 11 | `gpu-buffers.test.ts` `given_soa_positions_when_packParticles_then_x_y_are_interleaved_for_the_active_particles_and_the_count_is_returned` | particle upload |
| 12 | `gpu-buffers.test.ts` `given_non_finite_positions_when_packParticles_then_the_particle_goes_off_screen_and_a_too_small_output_throws_RangeError` | robustness |
| 13 | `gpu-buffers.test.ts` `given_an_empty_scene_when_packing_then_every_count_is_zero_and_no_particle_or_home_is_written_review_focus_2` | RF2 |
| 14 | `gpu-buffers.test.ts` `given_homes_when_packHomes_then_painted_active_slot_ids_and_minus_one_for_none_nan_unpainted_inactive_fractional_or_out_of_range_review_focus_3` | RF3 |
| 15 | `gpu-buffers.test.ts` `given_painted_slots_when_packElements_then_home_rect_radius_rest_alpha_mass_kernel_radius_straight_colour_and_the_drawable_flag` | element record |
| 16 | `gpu-buffers.test.ts` `given_unpainted_or_inactive_slots_when_packElements_then_their_record_is_zero_and_the_count_ends_at_the_last_drawable_slot_review_focus_3` | RF3 |
| 17 | `gpu-buffers.test.ts` `given_a_translucent_background_and_odd_rest_alphas_when_packElements_then_alpha_is_kept_rgb_stays_straight_and_rest_alpha_is_clamped_review_focus_4` | RF4 |
| 18 | `gpu-buffers.test.ts` `given_reduced_motion_when_packElements_then_a_hovered_slot_is_not_swelled` | B1 rule |
| 19 | `webgpu-renderer.test.ts` `given_webgpu_renderer_when_typed_then_satisfies_Renderer_the_error_lives_in_webgpu_errors_and_the_old_module_is_gone` | errors.ts move (modified from W66) |
| 20 | `webgpu-renderer.test.ts` `given_navigator_gpu_missing_when_init_then_WebGPUUnavailableError` | kept (fake GPU) |
| 21 | `webgpu-renderer.test.ts` `given_requestAdapter_null_or_throwing_when_init_then_WebGPUUnavailableError_with_cause` | kept (fake GPU) |
| 22 | `webgpu-renderer.test.ts` `given_requestDevice_rejects_when_init_then_WebGPUUnavailableError_with_cause` | kept (fake GPU) |
| 23 | `webgpu-renderer.test.ts` `given_getContext_webgpu_null_when_init_then_WebGPUUnavailableError_and_device_destroyed` | kept (fake GPU) |
| 24 | `webgpu-renderer.test.ts` `given_successful_init_when_built_then_three_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3` | D71-3 |
| 25 | `webgpu-renderer.test.ts` `given_a_validation_error_in_the_scope_when_init_then_rejects_with_a_plain_Error_naming_it_and_destroys_the_device` | D71-3 (bug, not unavailable) |
| 26 | `webgpu-renderer.test.ts` `given_a_fallback_adapter_when_init_then_explicit_webgpu_accepts_it_and_isFallbackAdapter_reports_it` | spec §3 amended (D72-2 input) |
| 27 | `webgpu-renderer.test.ts` `given_t0Scale_when_constructed_then_default_0_5_accepts_0_75_and_1_and_rejects_out_of_range_with_RangeError_D71_4` | D71-4 |
| 28 | `webgpu-renderer.test.ts` `given_resize_when_the_backing_size_changes_then_T0_and_T0a_are_reallocated_at_ceil_px_times_scale_and_the_old_pair_destroyed` | D71-4, RF1 |
| 29 | `webgpu-renderer.test.ts` `given_a_zero_or_sub_pixel_canvas_when_resized_then_T0_is_clamped_to_1x1_and_no_validation_error_review_focus_1` | RF1 |
| 30 | `webgpu-renderer.test.ts` `given_an_empty_scene_when_rendering_then_no_zero_size_buffer_no_splat_or_rest_draw_one_composite_draw_and_no_validation_error_review_focus_2` | RF2 |
| 31 | `webgpu-renderer.test.ts` `given_a_scene_when_rendering_frames_then_particles_and_elements_upload_every_frame_and_homes_only_on_a_generation_or_paints_change` | upload policy |
| 32 | `webgpu-renderer.test.ts` `given_the_particle_count_changes_without_a_generation_or_paints_change_when_rendering_then_the_homes_are_uploaded_again` | upload policy (homes follow the particle count) |
| 33 | `webgpu-renderer.test.ts` `given_a_moving_scene_when_rendering_then_the_splat_pass_clears_T0_and_T0a_and_draws_6_vertices_per_particle_and_the_screen_pass_composites_then_draws_the_rest_quads` | D71-3, D71-6 |
| 34 | `webgpu-renderer.test.ts` `given_device_lost_with_reason_unknown_when_rendering_then_one_console_warn_and_render_is_a_noop_and_our_own_destroy_is_silent_but_an_external_destroyed_loss_warns` | device.lost, identity rule (W71.0 finding; W72 rebuilds) |
| 35 | `webgpu-renderer.test.ts` `given_uncaptured_gpu_errors_when_they_fire_then_exactly_one_console_error_names_the_first` | D71-3 runtime errors |
| 36 | `webgpu-renderer.test.ts` `given_destroy_when_called_before_init_after_failure_and_twice_then_no_throw_and_every_gpu_object_is_released_once` | lifecycle |
| 37 | `renderer-abstraction.test.ts` `given_selectRenderer_webgpu_with_a_t0Scale_when_called_then_WebGPURenderer_active_webgpu_scale_applied_and_no_infra_only_warning_W71` | D71-2, D71-4 |
| 38 | `renderer-abstraction.test.ts` `given_soft_body_renderer_modules_when_checked_then_deleted` (modified: old webgpu-renderer.ts path) | module move |
| 39 | `auto-renderer.test.ts` `given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_the_liquid_pipelines_exist_and_no_warning_D71_2` (modified) | D71-2 |
| 40 | `auto-renderer.test.ts` `given_two_webgpu_instances_when_frames_run_then_each_owns_a_device_draws_two_passes_per_frame_and_nothing_is_warned` (modified) | D71-2 |
| 41 | `auto-renderer.test.ts` `given_webgpuT0Scale_0_75_when_create_with_renderer_webgpu_then_T0_is_allocated_at_three_quarters_of_the_backing_size_D71_4` | D71-4 wiring |
| 42 | `options.test.ts` `given_option_whitelist_when_read_then_equals_spec_section_5_plus_internal_hooks` (modified) | D71-4 |
| 43 | `options.test.ts` `given_webgpuT0Scale_internal_option_when_resolved_then_undefined_by_default_0_5_0_75_and_1_accepted_and_others_TypeError_D71_4` | D71-4 |
| 44 | `scene-params.test.ts` `given_invalid_query_%s_when_parsed_then_TypeError` (modified: 14 cases) | D71-2, D71-4 |
| 45 | `scene-params.test.ts` `given_renderer_webgpu_with_and_without_t0_when_parsed_then_webgpu_and_t0Scale_only_when_given_W71` | D71-2, D71-4 |
| 46 | `e2e-harness.test.ts` `given_playwright_config_when_loaded_then_webgpu_project_matches_the_acceptance_the_liquid_and_the_smoke_specs_W71` (modified) | D71-2 |
| 47 | `e2e-harness.test.ts` `given_e2e_spec_files_when_routed_then_canvas2d_runs_every_spec_except_smoke_webgpu_liquid_perf_record_and_dist` (modified) | routing |
| 48 | `e2e-harness.test.ts` `given_project_renderer_map_when_read_then_only_the_webgpu_project_renders_webgpu_and_an_unknown_project_throws_W71` | D71-2 |
| 49 | `e2e-harness.test.ts` `given_the_webgpu_hw_project_when_read_then_it_runs_the_webgpu_specs_on_the_hardware_adapter_locally_and_the_spike_constant_matches_ci_W71` | D71-1 (local Metal, spike constant) |
| 50 | `ci-workflow.test.ts` `given_ci_yml_when_parsed_then_canvas2d_step_is_blocking_and_webgpu_step_continue_on_error` (modified per spike; [yes] also the e2e-job and baselines tests) | D71-1 |
| 51 | `acceptance.spec.ts` steps 1–3 in the `webgpu` project: `step 1 – …`, `D65-11 – …`, `step 3 – given a click on Splash …`, the five `step 2 – …` behaviour tests (modified: renderer-aware URLs, `__liquidTest.pixels()`, steps 4/6 skip under webgpu; the step 1/2/3 Linux baselines skip under webgpu while `SWIFTSHADER_RUNS_LIQUID` is false) | D71-2, steps 1–3 |
| 52 | `acceptance.spec.ts` `W71 gold – capture steps 1, 2 and 3 in this project's renderer (and T0 0.5 vs 0.75 under webgpu)` (VISION=1 only) | gold, D71-4 |
| 53 | `webgpu-liquid.spec.ts` `D71-3 – given the three liquid shaders when every pipeline is built under a validation error scope then there is no validation error and no compilation error` | D71-3 |
| 54 | `webgpu-liquid.spec.ts` `D71-2 – given renderer webgpu when the page idles, splashes and re-forms then activeRenderer is webgpu, the liquid is drawn and no GPU error is reported` | D71-2 |
| 55 | `webgpu-liquid.spec.ts` `Review Focus 4 – given a translucent and a transparent element when at rest and mid-splash then the translucent liquid keeps its colour at half alpha with no dark fringe, the transparent one uses the default liquid colour, and webgpu matches canvas2d` | RF4, rest SDF corner radius (corner and 45° arc probes vs canvas2d) |

Guards that stay unchanged and must stay green: every Canvas2D test (`density-grid.test.ts`, `fluid-canvas2d.test.ts` incl. D70-4), the `canvas2d` e2e project and its Linux baselines (no canvas2d frame may change), `runtime-lifecycle.test.ts`, `dist.spec.ts`, the webgpu smoke.

## Must NOT
- Change Rust, the FFI, `RenderFrame` or the `Renderer` method shape (slice 3 constraint).
- Touch the DOM from a renderer, or move the canvas above the DOM (D7).
- Use 32-bit float render targets, T1 or T2, or `layout: "auto"` in production pipelines.
- Make `auto` probe WebGPU, fall back, remount the canvas or rebuild on `device.lost` (W72).
- Loosen a Canvas2D e2e threshold to make WebGPU pass; change any canvas2d baseline.
- Copy spike code into production (the W71.0 branch is deleted).

## Must DO
- Run the direction gate for D71-1 … D71-6 before W71.1, and the spike before any test.
- Keep both renderers on `kernel-params.ts`; pin the parity with a test.
- Never create a zero-size buffer or texture; validate pipelines under an error scope.
- Read WebGPU pixels in the rendering task (`__liquidTest.pixels()`), never later.
- At gold: Metal screenshots of steps 1–3 in both renderers, same seed and frame, inspected with vision; 0.5× vs 0.75× crops for Dennis' D71-4 choice.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run dev`

### Steps
1. Open `http://localhost:3000/scenes/acceptance.html?renderer=webgpu` in Chrome (Metal).
   Expected: no console warning or error; the three pills and the card look like the Canvas2D page (`?renderer=canvas2d`) at rest: crisp rounded edges, DOM text readable.
2. Sweep the mouse across the pills.
   Verify: each pill leans along the sweep, no holes, smooth (not stair-stepped) edges while moving.
3. Click "Splash".
   Verify: jets and fingers leave the pill, colours blend where the Splash liquid meets Split's, everything re-forms within 3 s with no pale flash.
4. Open `…/acceptance.html?renderer=webgpu&t0=0.75` and repeat 2–3.
   Verify: edges in motion are at least as smooth as at 0.5×.
5. Open `http://localhost:3000/smoke/webgpu-liquid.html` and run `__webgpuLiquid.advance(120)` in the console.
   Verify: the translucent "Glass" element shows half-transparent liquid of its own colour, "Clear" shows the default purple.

### Pass criteria
- [ ] Steps 1–3 read in WebGPU as the north star describes, side by side with Canvas2D.
- [ ] `npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:dist` and `npm run e2e:webgpu` are green (webgpu per the spike answer).

## Verification
Gold requires: `npm run verify` (cargo 151 + 1 ignored unchanged, vitest 460 passed | 4 skipped, clippy clean); `npm run e2e:canvas2d` unchanged and green; `npm run e2e:webgpu` (SwiftShader) and `npm run e2e:webgpu-hw` (Metal) 14 passed / 9 skipped locally; [yes] the CI webgpu step green with three vision-approved Linux webgpu baselines; the W71 gold captures read with vision for both renderers; a `code-review` pass at level high; Dennis' D71-4 choice recorded.

## Spike W71.0 result
Answer: **no (fallback B)** — on the GitHub runner every flag variant loses the device within 2–5 frames of any rendering test (only the adapter-exists smoke test passes), so WebGPU acceptance runs locally on macOS (SwiftShader and Metal) and CI keeps the soft smoke. Time used: ≈ 1.5 h of the ½-day box.

| Variant | arm64 local (native) | amd64 emulated | GitHub runner (run 37679595019) | device lost |
|---|---|---|---|---|
| V0 (today's flags) | 20/80 | not run | 20/80 | 20/20 splat runs (arm64) |
| V0 + `--shm-size=2g` instead of `--ipc=host` | 20/80 | not run | not run | 20/20 |
| V1 (+ `--enable-unsafe-swiftshader`) | 20/80 | not run | 20/80 | 20/20 |
| V2 (`--use-angle=swiftshader`) | 20/80 | not run | 20/80 | 20/20 |
| V3 (`--use-vulkan=swiftshader`, `VulkanFromANGLE`) | 20/80 | not run | 20/80 | 20/20 |
| V4 (V1 + `--disable-dev-shm-usage`) | 20/80 | not run | 20/80 | 20/20 |

The 20 passes per variant are all `webgpu-smoke.spec.ts:31` (an adapter exists); every test that renders fails. Runner logs: 89 × `lost: "destroyed: Device was destroyed."` (the rest `"unknown: A valid external Instance reference no longer exists."`), after 2–5 frames, with no uncaptured errors and no validation errors. amd64 emulation was skipped: native arm64 already fails identically, so the CONTEXT note blaming emulation is wrong (the failure is SwiftShader/Vulkan inside the container). On macOS (outside Docker) the same splat page ran 120 frames clean with centre pixel `(51, 102, 204, 255)`, readback via `drawImage` in the rendering task.

Untested routes (outside the D71-1 box, for a later ward): the runner without the container (Playwright's own Chromium + Mesa lavapipe), and GPU-enabled runners.

Consequence for W72 (D72-3): a loss we did not cause can arrive with `reason: "destroyed"`. Rebuild must key on "did our own `destroy()` run", not on the reason string.
