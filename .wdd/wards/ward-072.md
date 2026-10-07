---
ward: 72
revision: null
name: "WebGPU by default, robust"
epic: "fluid-engine"
status: planned
dependencies: [71]
layer: "typescript"
estimated_tests: 58
created: "2026-10-07"
completed: null
---
# Ward 072: WebGPU by default, robust

North star: steps 4 (keyboard splash), 6 (shake) and 8 (reduced motion, print/forced colours and `device.lost`) pass under `renderer=webgpu`; step 8 gains "+ device.lost ✅" (slice matrix, S3 column). `auto`, the default option value, becomes WebGPU with a Canvas2D fallback.

## Scope
W71 draws the liquid in WebGPU for an explicit `renderer: 'webgpu'` and leaves `auto` on Canvas2D. This ward makes WebGPU the effective default and makes it survive the real world:
- `auto` probes WebGPU and falls back to Canvas2D (no WebGPU, or a software/fallback adapter), with one `console.info` unless `silentFallback`, on a remounted canvas (a canvas that handed out a `webgpu` context can never give a `2d` one);
- an explicit `'webgpu'` accepts a fallback adapter (SwiftShader), so CI can exercise the WebGPU path;
- a lost device rebuilds the running instance as Canvas2D in place (mutable renderer slot and canvas in the runtime), one `console.warn`, `activeRenderer === 'canvas2d'`;
- the splat overdraw is estimated per frame and logged (test hook, perf spec, e2e annotation), never gated;
- acceptance steps 4, 6 and 8 run under `renderer=webgpu`, plus a `device.lost` e2e; the gold phase records GIFs of the scene in both renderers.

Out of scope: liquid text, T1/T2, the DOM-text halo (D72-5, slice 4), drag/merge (slice 5), scroll/resize/parking (slice 6), a whole-picture check (the next one is after slice 4), any Rust change.

## Inputs
- W71: `renderers/webgpu/webgpu-renderer.ts` (`WebGPURenderer` with `t0Scale`, the `isFallbackAdapter` / `lastFragmentEstimate` getters, `T0_SCALE_DEFAULT`, `WebGPURendererOptions` with `t0Scale` only; W72 adds `acceptFallbackAdapter` and `onDeviceLost`), `renderers/webgpu/errors.ts` (`WebGPUUnavailableError`), `renderers/kernel-params.ts` (`kernelRadiusPx`), `_fake-gpu.ts` (`installFakeGpu`, extended here), `?renderer=webgpu` and `__liquidTest.pixels()` in the acceptance scene, `projectRenderer()`, the W71.0 SwiftShader spike answer in `.wdd/wards/ward-071.md` and its single copy `SWIFTSHADER_RUNS_LIQUID`, and the W71 routing in `e2e/projects.ts` (`WEBGPU_PROJECT_SPEC`, the local `webgpu-hw` project with `WEBGPU_HW_LAUNCH_ARGS`).
- W66: `renderers/select.ts`, `runtime.ts` (canvas mount, failed-frame handling, destroy), `stylesheet.ts` `mountLiquidCanvas`, `options.ts` (`renderer` default `'auto'`, `silentFallback` validated only, B13).
- W67/W70: the canvas2d acceptance tests for steps 4, 6 and 8 (`e2e/acceptance.spec.ts`, `e2e/modes.spec.ts`); W69/W70: `e2e/record.spec.ts`, `scripts/webm-to-gif.mjs`.

## Outputs
- `selectRenderer(choice, canvas, { silentFallback, remountCanvas, onDeviceLost, t0Scale? })` returning `{ renderer, active, canvas }`; `fallbackInfo(reason)`; `initCanvas2D(canvas)`.
- `remountLiquidCanvas(old, container?)` in `stylesheet.ts`.
- `WebGPURenderer`: `acceptFallbackAdapter` (the fallback-adapter gate), `onDeviceLost` (for any loss we did not cause, whatever its reason — a crashed GPU process also reports `'destroyed'` (W71.0 spike); never after our own `destroy()`; the renderer no longer warns), loss during init → `WebGPUUnavailableError`, `@internal loseDeviceForTest()`, live `lastFragmentEstimate`, exported `adapterIsFallback`; `renderers/webgpu/overdraw.ts` `estimateSplatFragments(frame, t0Scale)`.
- `runtime.ts`: mutable renderer slot and canvas, the Canvas2D rebuild, `canvas` and `activeRenderer` as live getters, `@internal simulateDeviceLoss()` and `fragmentEstimate`, `DEVICE_LOST_WARNING`.
- Test hook: `params.renderer` accepts `auto`; `loseDevice()`, `overdraw`.
- Test infra: `installFakeGpu` gains `holdInit`, per-device handles, `releaseInit()` and the no-2d-after-webgpu rule; `installFakeGpuLifecycle` is a thin view over it (one fake for both wards).
- e2e: `e2e/webgpu-robust.spec.ts`, `e2e/frame-readback.ts` (thin wrappers over W71's `__liquidTest.pixels()`), W71's `webgpu-hw` project extended (robust spec, webgpu perf) and the new local project `record-webgpu`, the perf spec's webgpu test (`perf-webgpu.json`), the record spec for both renderers, `npm run record:w72` → `docs/superpowers/whole-picture/slice-3-w72-canvas2d.gif` and `slice-3-w72-webgpu.gif` (next to the slice-2 GIFs).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D72-1: `auto` probes WebGPU and becomes the effective default
Proposal: `renderer: 'auto'` (the option default) initialises the WebGPU renderer with `acceptFallbackAdapter: false`. A `WebGPUUnavailableError` (no `navigator.gpu`, a null or throwing `requestAdapter`, a rejected `requestDevice`, a null `webgpu` context, a device lost during init) and a fallback adapter (`adapter.info.isFallbackAdapter`, checked right after `requestAdapter`, before any device or context exists) fall back to Canvas2D. The canvas is remounted on every fallback, in place (same parent, same position, same class and attributes). One `console.info` — `[liquiddom] WebGPU is not available (<reason>); using the Canvas2D renderer. Pass silentFallback: true to hide this message.` — unless `silentFallback`. Any other init error (shader or pipeline validation, a `configure` error) rejects `create()`.
Consequence: a user-visible default change (changeset): browsers with a hardware adapter get WebGPU, everything else gets Canvas2D plus one info line. `create()` gains one `requestAdapter` round-trip. jsdom (no `navigator.gpu`), the headless shell of the `canvas2d` and `dist` projects and SwiftShader all fall back, so every existing canvas2d e2e, the dist smoke and the React example stay Canvas2D in CI, and each facade unit test that uses the default logs one info line (no test forbids `console.info`). `silentFallback` stops being "validated only" (B13 ends).
Decision: PENDING

### D72-2: Explicit `'webgpu'` accepts a fallback adapter
Proposal: `renderer: 'webgpu'` initialises with `acceptFallbackAdapter: true`: a software adapter (SwiftShader) is used, `isFallbackAdapter` is recorded on the renderer. Unavailable WebGPU still rejects `create()` with `WebGPUUnavailableError`; there is no fallback and no `console.info` for an explicit choice.
Consequence: the `webgpu` Playwright project (SwiftShader) exercises the real WebGPU path. A user who forces `'webgpu'` on a machine with only a software adapter gets slow WebGPU instead of Canvas2D; that is what they asked for.
Decision: PENDING

### D72-3: `device.lost` rebuilds the instance as Canvas2D in place
Proposal: the runtime's renderer slot and canvas become mutable. Any loss after init that our own `destroy()` did not cause — detected by device identity, not by the reason string, because a crashed GPU process also reports `'destroyed'` (W71.0 spike): one `console.warn` (`[liquiddom] WebGPU device lost (<reason>: <message>); continuing with the Canvas2D renderer.`), `activeRenderer` becomes `'canvas2d'` at once, the WebGPU renderer is destroyed, the canvas is remounted, Canvas2D is initialised, the backing store is resized, and the next frame renders through Canvas2D with the same core and particle state. A loss during init counts as `WebGPUUnavailableError` (so `auto` falls back and `'webgpu'` rejects); a loss that resolves after `destroy()`, or between init and the runtime being built, is handled (ignored, or replayed once). A failing Canvas2D rebuild takes the failed-frame path (one `console.error`, the instance stops). Test seam: `@internal WebGPURenderer.loseDeviceForTest()` (calls `device.destroy()` and reports the loss as reason `'unknown'`), reached only through `@internal FluidRuntime.simulateDeviceLoss()` and the scene hook `loseDevice()`.
Consequence: `activeRenderer` and `runtime.canvas` can change during an instance's life (documented). Frames during the asynchronous rebuild tick the core but draw nothing (at most a frame or two). There is no `liquid-text` to remove until slice 4. Browsers give no way to lose a device with reason `'unknown'` on demand, so the e2e covers the rebuild through the seam, and the jsdom tests cover the real promise path with the fake.
Decision: PENDING

### D72-4: Overdraw is estimated and logged, never gated
Proposal: `estimateSplatFragments(frame, t0Scale)` = Σ over painted elements with `restAlpha < 1` of `particleCount × (2·R·dpr·t0Scale)²`, `R = kernelRadiusPx(spacingPx)`, rounded. `WebGPURenderer` stores it every frame (`lastFragmentEstimate`), the runtime exposes it (`@internal fragmentEstimate`, 0 under Canvas2D), the scene hook as `overdraw`. The webgpu e2e attaches the shake's maximum as an annotation; a perf test in the local `webgpu-hw` project writes `perf-webgpu.json` with RAF p95 and the overdraw summary. No threshold anywhere.
Consequence: it is an estimate (quads × area, an upper bound that ignores clipping), not a GPU counter: SwiftShader has no timestamp queries and pipeline-statistics queries are not in WebGPU core. Cost is O(elements) per frame. Spec §7's "≈1.6M fragments at 1× DPR" can be checked against a number for the first time.
Decision: PENDING

### D72-5: The DOM-text halo stays in slice 4
Proposal: no text-shadow halo or other DOM-text treatment in this ward. Under WebGPU, as in Canvas2D today, an element's DOM text sits on the bare page while its liquid is away (splash, shake); slice 4's liquid text addresses it for WebGPU, and the halo decision for Canvas2D goes with it.
Consequence: the WCAG contrast gap during motion (slice-2 report, Carried "DOM text contrast while the liquid is away") stays open through slice 3 in both renderers; it is listed in CONTEXT's known limitations. Nothing in this ward touches the stylesheet's text rules.
Decision: PENDING

## Specification
Plan: `docs/superpowers/plans/2026-10-06-fluid-slice-3/W72.md` (complete code for every task). Slice design: `docs/superpowers/specs/2026-10-06-liquiddom-slice-3-webgpu-design.md` §3–§5.
- **Selection** (`renderers/select.ts`): `'canvas2d'` never touches `navigator.gpu`. `'auto'` and `'webgpu'` construct `WebGPURenderer({ acceptFallbackAdapter: choice === 'webgpu', onDeviceLost, t0Scale })`. On an init error the renderer is destroyed; `'webgpu'` or a non-`WebGPUUnavailableError` rethrows; otherwise `remountCanvas()` → `initCanvas2D(fresh)` → `console.info(fallbackInfo(err.message))` unless `silentFallback` → `{ renderer, active: 'canvas2d', canvas: fresh }`.
- **Remount** (`stylesheet.ts`): `remountLiquidCanvas(old, container?)` builds a canvas exactly like `mountLiquidCanvas` and `old.replaceWith(fresh)`; a detached `old` is appended like a fresh mount. The runtime re-applies the backing-store size.
- **WebGPURenderer**: after `requestAdapter`, W71's `isFallbackAdapter = adapterIsFallback(adapter)` (`adapter.info.isFallbackAdapter` or the deprecated `adapter.isFallbackAdapter`); refused when `!acceptFallbackAdapter`, before `requestDevice`. `device.lost` is watched from `requestDevice` on; before init settles a loss is remembered and init throws `WebGPUUnavailableError('…lost during init…')`; after init `onDeviceLost` fires once unless `reason === 'destroyed'` (our `destroy()` nulls the device first) — except for `loseDeviceForTest()`, which is reported as `'unknown'`. The renderer itself never warns.
- **Runtime**: `LossRelay { handler, early }` bridges a loss that resolves before `buildRuntime`. `rebuildAsCanvas2D(info)` as in D72-3; `simulateDeviceLoss(): Promise<boolean>` resolves after the rebuild (false when not on WebGPU); `fragmentEstimate`. `destroy()` settles pending rebuild waiters with `false` and removes the current canvas.
- **Facade**: passes `silentFallback`; `activeRenderer` stays a getter over the runtime (now changes after a loss).
- **e2e**: `webgpu-robust.spec.ts` (auto probe, steps 4/6/8, print/forced colours, device.lost, two Linux baselines when the spike said yes) is routed to W71's local `webgpu-hw` project (channel `chromium`, `WEBGPU_HW_LAUNCH_ARGS`, no SwiftShader flag) and, when W71's `SWIFTSHADER_RUNS_LIQUID`, to `webgpu` (CI, soft; its baselines come from the CI `e2e-update-baselines` job). `record-webgpu` records the scene in WebGPU locally. Pixel reads advance ≥ 1 manual-clock frame and read W71's `__liquidTest.pixels()` snapshot (`frame-readback.ts` wraps it), because a WebGPU canvas only holds its pixels in the task that presented them.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | renderer-select: given_auto_without_navigator_gpu_when_selected_then_canvas2d_on_a_remounted_canvas_and_one_fallback_info | D72-1 unavailable → Canvas2D, remount in place, info |
| 2 | renderer-select: given_auto_and_a_null_adapter_or_a_rejected_device_when_selected_then_canvas2d_and_one_info_each | D72-1 every unavailable cause falls back |
| 3 | renderer-select: given_auto_and_a_fallback_adapter_when_selected_then_canvas2d_without_a_device_or_webgpu_context_and_the_info_names_the_fallback_adapter | D72-1 software adapter = unavailable, refused before requestDevice |
| 4 | renderer-select: given_auto_with_silentFallback_when_it_falls_back_then_canvas2d_on_a_remounted_canvas_and_no_info | D72-1 silentFallback |
| 5 | renderer-select: given_auto_and_a_hardware_adapter_when_selected_then_webgpu_on_the_same_canvas_without_remount_info_or_warn | D72-1 happy path |
| 6 | renderer-select: given_auto_and_an_init_bug_when_selected_then_rejects_with_that_error_without_remount_or_info_and_the_device_is_destroyed | D72-1 bugs reject |
| 7 | renderer-select: given_a_device_lost_during_init_when_auto_then_canvas2d_on_a_fresh_canvas_and_when_webgpu_then_WebGPUUnavailableError | D72-3 loss during init = unavailable; remount needed (tainted canvas) |
| 8 | renderer-select: given_webgpu_and_a_fallback_adapter_when_selected_then_webgpu_with_isFallbackAdapter_and_no_info | D72-2 |
| 9 | renderer-select: given_webgpu_without_navigator_gpu_when_selected_then_WebGPUUnavailableError_without_remount_or_info | D72-2 explicit has no fallback |
| 10 | renderer-select: given_canvas2d_when_selected_then_navigator_gpu_is_never_probed_and_the_canvas_is_kept | selection |
| 11 | renderer-select: given_webgpu_selected_when_its_device_is_lost_with_reason_unknown_then_onDeviceLost_receives_it_once | D72-3 wiring |
| 12 | renderer-select: given_a_reason_when_fallbackInfo_is_built_then_it_is_the_exact_documented_message | D72-1 message |
| 13 | stylesheet: given_a_mounted_canvas_in_body_when_remounted_then_a_new_canvas_takes_its_place_with_identical_markup | remount position and attributes |
| 14 | stylesheet: given_container_mode_when_remounted_then_the_new_canvas_is_in_the_container_with_absolute_style | remount in container mode |
| 15 | stylesheet: given_a_detached_old_canvas_when_remounted_then_the_new_canvas_is_mounted_like_mountLiquidCanvas | remount fallback path |
| 16 | webgpu-lifecycle: given_acceptFallbackAdapter_false_and_a_fallback_adapter_when_init_then_WebGPUUnavailableError_before_requestDevice | D72-1 gate in the renderer |
| 17 | webgpu-lifecycle: given_the_default_options_and_a_fallback_adapter_when_init_then_it_succeeds_and_isFallbackAdapter_is_true | D72-2 |
| 18 | webgpu-lifecycle: given_an_initialised_renderer_when_the_device_is_lost_with_reason_unknown_then_onDeviceLost_once_no_warn_and_render_is_a_noop | D72-3 |
| 19 | webgpu-lifecycle: given_an_initialised_renderer_when_the_device_is_lost_externally_with_reason_destroyed_then_onDeviceLost_is_called_once | D72-3 external 'destroyed' rebuilds (W71.0 spike) |
| 20 | webgpu-lifecycle: given_destroy_when_the_loss_resolves_afterwards_then_onDeviceLost_is_not_called_and_destroy_is_idempotent | RF5 lost after destroy |
| 21 | webgpu-lifecycle: given_a_device_lost_while_init_is_pending_when_init_resumes_then_WebGPUUnavailableError_and_no_callback | D72-3 loss during init |
| 22 | webgpu-lifecycle: given_loseDeviceForTest_when_called_then_onDeviceLost_receives_reason_unknown_with_the_simulated_message | D72-3 test seam |
| 23 | webgpu-lifecycle: given_a_rendered_frame_when_read_then_lastFragmentEstimate_equals_estimateSplatFragments_at_the_T0_scale | D72-4 |
| 24 | webgpu-lifecycle: given_the_lifecycle_fake_when_the_W71_renderer_inits_resizes_and_renders_then_nothing_throws_and_it_submits | fake compatibility pin |
| 25 | overdraw: given_resting_and_moving_elements_when_estimated_then_only_restAlpha_below_1_counts_particles_times_quad_area | D72-4 formula |
| 26 | overdraw: given_dpr_scale_and_degenerate_paints_when_estimated_then_quad_side_scales_and_unpainted_or_empty_slots_add_nothing | D72-4 edge cases |
| 27 | device-lost: given_webgpu_when_the_device_is_lost_then_canvas2d_on_a_remounted_canvas_resized_rendering_next_frame_one_warn_no_error | D72-3 rebuild |
| 28 | device-lost: given_webgpu_when_the_device_reports_reason_destroyed_then_no_rebuild_and_no_warn | D72-3 |
| 29 | device-lost: given_a_loss_that_resolves_after_destroy_when_flushed_then_no_rebuild_no_warn_and_no_canvas | RF5 |
| 30 | device-lost: given_destroy_during_the_canvas2d_rebuild_when_it_completes_then_the_new_renderer_is_destroyed_and_no_canvas_remains | RF5 race |
| 31 | device-lost: given_two_webgpu_instances_when_one_device_is_lost_then_only_that_instance_rebuilds | RF5 two instances |
| 32 | device-lost: given_a_loss_right_after_init_before_the_runtime_exists_when_built_then_it_rebuilds_once | relay replay |
| 33 | device-lost: given_a_failing_canvas2d_rebuild_when_the_device_is_lost_then_one_console_error_and_the_instance_stops | rebuild failure path |
| 34 | device-lost: given_create_pending_on_webgpu_init_when_the_caller_destroys_as_soon_as_it_resolves_then_no_canvas_device_destroyed_and_no_warn | RF5 destroy vs pending init |
| 35 | device-lost: given_the_test_seams_when_used_then_simulateDeviceLoss_rebuilds_and_fragmentEstimate_is_0_under_canvas2d | hooks |
| 36 | auto-renderer: given_renderer_auto_and_a_hardware_adapter_when_create_then_activeRenderer_webgpu_no_console_info_and_no_warn | D72-1 facade |
| 37 | auto-renderer: given_renderer_omitted_when_create_then_it_is_auto_and_probes_webgpu_once | default = auto |
| 38 | auto-renderer: given_renderer_canvas2d_when_create_then_webgpu_is_never_probed | D72-1 |
| 39 | auto-renderer: given_renderer_auto_without_navigator_gpu_when_create_then_canvas2d_one_liquid_canvas_and_one_console_info | D72-1 jsdom path |
| 40 | auto-renderer: given_a_fallback_adapter_when_create_with_auto_then_canvas2d_and_with_explicit_webgpu_then_webgpu_D72_2 | D72-1/2 |
| 41 | auto-renderer: given_renderer_webgpu_without_navigator_gpu_when_create_then_WebGPUUnavailableError_no_info_and_nothing_left_behind | D72-2 |
| 42 | auto-renderer: given_a_webgpu_init_bug_when_create_with_auto_or_webgpu_then_rejects_with_that_error_and_nothing_left_behind | D72-1 |
| 43 | auto-renderer: given_silentFallback_when_auto_falls_back_then_true_logs_nothing_false_logs_one_info_per_instance_and_a_non_boolean_is_a_TypeError | D72-1 (replaces B13) |
| 44 | auto-renderer: given_renderer_webgpu_when_frames_run_then_no_console_warn_and_the_device_submits | no infra warning |
| 45 | scene-params: given_renderer_auto_when_parsed_then_renderer_is_auto | hook |
| 46 | react-adapter: W72_given_provider_unmounted_while_webgpu_init_is_pending_when_init_completes_then_no_canvas_the_device_is_destroyed_and_no_warning | RF5 adapter path |
| 47 | e2e-harness: given_local_hardware_projects_when_read_then_webgpu_hw_and_record_webgpu_are_local_only_and_the_robust_spec_is_routed_by_the_spike_answer | routing |
| 48 | whole-picture-tooling: given_root_package_and_record_spec_when_read_then_record_w72_records_both_renderers_and_ci_never_runs_it | GIF tooling |
| 49 | e2e webgpu-robust: D72-1 – given ?renderer=auto when the scene loads then activeRenderer is webgpu exactly when a non-fallback adapter exists, one liquid canvas, and at most one fallback console.info | D72-1 in a browser |
| 50 | e2e webgpu-robust: step 4 (webgpu) – keyboard splash equals the API centre splash, focus ring visible, re-form within 3 s | step 4 W |
| 51 | e2e webgpu-robust: step 6 (webgpu) – shake throws liquid out, every element un-rests, re-form within 3 s, overdraw logged | step 6 W, D72-4 |
| 52 | e2e webgpu-robust: step 8 (webgpu) – ?rm=1 click and shake leave restAlpha 1 and frames identical and non-blank | step 8 W |
| 53 | e2e webgpu-robust: step 8 (webgpu) – print and forced-colors hide the WebGPU canvas | step 8 W |
| 54 | e2e webgpu-robust: step 8 (device.lost) – canvas2d continues on one remounted canvas, splashes and re-forms, one console.warn | D72-3 in a browser |
| 55 | e2e webgpu-robust: step 4 (webgpu) baseline at frame 30 (Linux, only when SWIFTSHADER_RUNS_LIQUID) | step 4 visual |
| 56 | e2e webgpu-robust: step 6 (webgpu) baseline at frame 20 (Linux, only when SWIFTSHADER_RUNS_LIQUID) | step 6 visual |
| 57 | e2e perf: perf – webgpu (local hardware adapter): RAF p95 and splat overdraw are logged, not gated | D72-4 |
| 58 | e2e record: whole picture – acceptance steps 1-4, 6 and 8 recorded in webgpu | gold GIF |

## Must NOT
- Change Rust, the FFI, `RenderFrame` or the `Renderer` method shape.
- Let the WebGPU renderer warn on a lost device (the runtime owns the single `console.warn`), or rebuild after our own `destroy()`; never decide on the reason string.
- Log a fallback with `console.warn` or `console.error` (e2e fixtures fail on `console.error`); the fallback is one `console.info`, none with `silentFallback`.
- Gate anything on the overdraw estimate or on WebGPU timing.
- Add a DOM-text halo or touch the stylesheet's paint/text rules (D72-5).
- Run `webgpu-hw` or `record-webgpu` in CI, or commit a `webgpu` baseline without Dennis' vision approval (D65-7).
- Use the `@internal` seams (`loseDeviceForTest`, `simulateDeviceLoss`, `fragmentEstimate`) outside tests and the demo scenes.

## Must DO
- Remount the canvas on every `auto` fallback and on every device-lost rebuild, in place.
- Keep `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:dist` green; the dist smoke keeps exactly one `canvas.liquid-canvas` with `auto`.
- Pin Review Focus 5 (destroy during pending init, loss after destroy, two instances) with tests.
- Inspect Canvas2D and WebGPU screenshots side by side (same seed, same step) and both GIFs with vision at gold.
- Write the changeset: `auto` now picks WebGPU (user-visible).

## Manual Smoke Test
### Setup
```bash
npm run build:wasm
npm run build -w liquiddom
npm run dev
```

### Steps
1. Run: open `http://localhost:3000/scenes/acceptance.html?seed=1&renderer=auto&test=1` in Chrome on the Mac (Metal).
   Expected: `__liquidTest.instance.activeRenderer === "webgpu"` in the console; no `console.info`; the liquid looks like W71's WebGPU liquid.
2. Run: in the console, `await __liquidTest.loseDevice()`.
   Verify: one `[liquiddom] WebGPU device lost (unknown: simulated device loss (test hook)); continuing with the Canvas2D renderer.` warning; `activeRenderer` is `"canvas2d"`; exactly one `canvas.liquid-canvas` in Elements; the liquid keeps reacting to the pointer and to "Splash".
3. Run: open the same URL with `--disable-gpu` Chrome (or Safari without WebGPU).
   Verify: one `[liquiddom] WebGPU is not available (…); using the Canvas2D renderer. …` info; Canvas2D liquid.
4. Run: `npm run record:w72`
   Verify: `docs/superpowers/whole-picture/slice-3-w72-canvas2d.gif` and `slice-3-w72-webgpu.gif` exist, each under 10 MB.

### Pass criteria
- [ ] `auto` gives WebGPU on Metal and Canvas2D without WebGPU, with exactly one info line in the latter.
- [ ] After `loseDevice()` the scene continues in Canvas2D with no error and one warning.
- [ ] Steps 4, 6 and 8 look right in both GIFs (vision).

## Verification
- `npx vitest run`: every test in the table above green; `npm run verify` green.
- `npx vitest run`: 501 passed | 4 skipped (W72 plan, "Targets after W72").
- `npm run e2e:canvas2d` and `npm run e2e:dist` green; `npm run e2e:webgpu-hw` green on the Mac; when the W71.0 spike answered yes, the soft CI `webgpu` step green including the robust spec (soft until 10 green runs).
- Gold: Canvas2D vs WebGPU screenshots of steps 4, 6 and 8 and the two GIFs inspected with vision; ward review (code-review skill, level high); `wdd ward status 72 gold`; STOP for Dennis.
