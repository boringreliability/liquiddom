---
ward: 65
revision: null
name: "Verification harness (Playwright, CI, perf baseline)"
epic: "fluid-engine"
status: "planned"
dependencies: [64]
layer: "typescript"
estimated_tests: 21
created: "2026-10-03"
completed: null
---
# Ward 065: Verification harness (Playwright, CI, perf baseline)

North star: steps 1 and 8 become machine-checked in a real browser (canvas2d project blocking), and the WebGPU smoke job starts its 10-green-runs count.

## Scope
Real-browser verification from slice 1 onwards:
- A deterministic manual frame clock and the scene test hook (`window.__liquidTest`).
- A Playwright configuration with a blocking `canvas2d` project and a soft `webgpu` project (SwiftShader). Until slice 3 the `webgpu` project runs only the smoke spec.
- A fixture that fails any test on `console.error`, `pageerror` or panic.
- Specs for scene step 1, step 8 (reduced motion), multi-instance stress and the WebGPU smoke.
- Linux-only visual baselines generated in CI.
- A CI `e2e` job in the pinned Playwright image.
- A non-blocking perf baseline and the `opt-level` 3 vs "s" measurement.

## Inputs
- W64: `runtime.ts`, the acceptance scene, the `FluidCore.tick` step count, the RM wiring (D64-6).
- Spec §6 "Testing in real browsers from slice 1" and "Perf".
- The repo's CI `.github/workflows/ci.yml` (one `test` job, Node 20/22 matrix) and `demo/vite.config.ts` (`server.open: true`, COOP/COEP).

## Outputs
- `packages/core/ts/src/clock.ts` (`FrameClock`, `rafClock`, `createManualClock`). `runtime.ts` takes an `@internal` `clock`.
- Scene parameters `?seed&renderer&clock=manual&rm&test=1` and `window.__liquidTest = { ready: Promise<void>; restAlpha(): number[]; advance(frames: number): void; instance: unknown }`.
- `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/guard.spec.ts`, `e2e/acceptance.spec.ts`, `e2e/modes.spec.ts`, `e2e/multi-instance.spec.ts`, `e2e/webgpu-smoke.spec.ts`, `e2e/perf.spec.ts`.
- Pages `demo/scenes/stress.{html,ts}` (`?n=2..4`) and `demo/smoke/webgpu-smoke.{html,ts}`, each with `<link rel="icon" href="data:,">`.
- `.github/workflows/ci.yml`: an `e2e` job plus a `workflow_dispatch` job `e2e-update-baselines`.
- `scripts/e2e-docker.sh` and `scripts/bench-opt-level.mjs`.
- `package.json`: `@playwright/test` pinned exactly; `yaml` as an explicit devDependency; scripts `e2e`, `e2e:canvas2d`, `e2e:webgpu`, `e2e:update`.
- `.gitignore`: `!e2e/__screenshots__/**`, `test-results/`, `playwright-report/`.
- `packages/core/__tests__/ci-workflow.test.ts`.

## Decisions
### D65-1: Manual clock via the internal clock option
Proposal: a `FrameClock` seam in `packages/core/ts/src/clock.ts` (`rafClock`; `createManualClock()` with a fixed dt of 1000/60 ms and `advance(n)`). It is injected through the `@internal` `clock` option of `createFluidRuntime`. The scene uses it with `?clock=manual`, and frames then run only through `window.__liquidTest.advance(n)`. W66 moves it onto `LiquidOptions.clock` (@internal).
Consequence: visual baselines and the reduced-motion check are deterministic and do not depend on machine speed. The perf and stress specs and W69's recordings keep the RAF clock; a manual clock would freeze the video.
Decision: APPROVED 2026-10-04 — manual FrameClock via @internal clock option; scene ?clock=manual (saga dec_f400307b)

### D65-2: Playwright config: snapshot path, Linux-only baselines, web server
Proposal:
- `snapshotPathTemplate: "e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}"`. Baselines exist for Linux only, and visual specs `test.skip` off Linux.
- `.gitignore` gets `!e2e/__screenshots__/**` after the existing `w*-*.png` rule.
- Web server: `npx vite --config demo/vite.config.ts demo --port 4173 --strictPort`, with `BROWSER=none` in its env, `reuseExistingServer: !process.env.CI`, viewport 1280×800 and `testDir: "e2e"`. Command, port and env are exported from `e2e/projects.ts`, so vitest asserts them.

Consequence: macOS runs check behaviour but never pixels. Pixels are compared only in the pinned image (CI or `scripts/e2e-docker.sh`). `server.open: true` in `demo/vite.config.ts` never opens a browser, and the local dev server on :3000 is left alone.
Decision: APPROVED 2026-10-04 — snapshot template e2e/__screenshots__/…-{platform}; Linux-only baselines; vite :4173 --strictPort with BROWSER=none (saga dec_1b435f00)

### D65-3: CI e2e job
Proposal:
- The `e2e` job has `needs: test` and downloads the `wasm-pkg` artifact uploaded by the Node-22 leg.
- It runs in `container: mcr.microsoft.com/playwright:v1.63.0-noble` (`--ipc=host`) with `timeout-minutes: 25`, and is skipped on `workflow_dispatch`.
- `canvas2d` blocks. `webgpu` and `perf` have `continue-on-error: true` and `timeout-minutes: 5`.
- One invocation per project, separated by `E2E_SUITE`.

Consequence: CI time grows by one job, and the image tag and the npm pin must be bumped together (D65-6).
Decision: APPROVED 2026-10-04 — e2e job needs test, wasm-pkg artifact, pinned image v1.63.0-noble; canvas2d blocking, webgpu/perf continue-on-error (saga dec_e9d448f0)

### D65-4: Print spec waits for W66 [BOUNDARY]
Proposal: `step 8 – print` is written in full and marked `test.fixme("W66 stylesheet")` until W66's injected stylesheet exists. W66 removes the `.fixme`.
Consequence: S1 step 8 "print" only reaches ✅ after W66.
Decision: APPROVED 2026-10-04 — print spec test.fixme until W66 stylesheet (saga dec_82109335)

### D65-5: WebGPU project: new headless Chromium on SwiftShader, smoke only, soft
Proposal: `channel: "chromium"` (new headless; the default is headless-shell) with `--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader`. `testMatch` is the smoke spec only until slice 3 (C8). It stays soft until 10 green CI runs in a row, logged under "WebGPU soft-run log" below.
Consequence: WebGPU in CI is software-only, so no GPU timing is measured there, and `acceptance.spec.ts` cannot fail under a renderer that does not exist yet.
Decision: APPROVED 2026-10-04 — webgpu: channel chromium + SwiftShader flags, smoke spec only until slice 3, soft until 10 green runs (saga dec_fb1d2378)

### D65-6: Exact Playwright pin and yaml devDependency
Proposal: `@playwright/test` is pinned exactly to `1.63.0`, which equals the image `v1.63.0-noble`. `yaml` `^2.9.1` becomes an explicit root devDependency for `ci-workflow.test.ts` (D2).
Consequence: a Playwright upgrade bumps the devDependency and the image tag in `ci.yml` together, and a vitest test asserts that they match. There is one small dev dependency, and nothing relies on `js-yaml` arriving transitively.
Decision: APPROVED 2026-10-04 — @playwright/test 1.63.0 exact = image v1.63.0-noble; yaml ^2.9.1 devDependency (saga dec_ee08361e)

### D65-7: Baseline generation: Docker now, workflow_dispatch later
Proposal: during this ward, baselines are generated with `scripts/e2e-docker.sh`: the pinned image as `--platform linux/amd64`, the repo copied in without `node_modules`, and only `e2e/__screenshots__`, `test-results` and `playwright-report` copied back. Later re-baselines use the `workflow_dispatch` job `e2e-update-baselines`, which uploads an `e2e-baselines` artifact.
Consequence: there is no arm64/amd64 Skia rasterisation mismatch between the M4 Mac and CI. GitHub only offers "Run workflow" once `ci.yml` is on `master`, so this ward's own baseline comes from Docker. A human commits every baseline after a vision check.
Decision: APPROVED 2026-10-04 — baselines from scripts/e2e-docker.sh (linux/amd64) now, e2e-update-baselines later; human commits after vision (saga dec_736206f7)

### D65-8: Perf recording is non-blocking
Proposal: a separate `perf` project (canvas2d, RAF clock). It records the p95 of `core.tick` wall time per returned step (the probe wraps `bridge.core.tick` under `?perf=1`) and the RAF-callback p95 (timing `FrameClock`). CI uploads both as `perf-canvas2d`. Budgets are `expect.soft`: RAF p95 ≤ 12 ms, and tick p95 ≤ 1.2 × `e2e/perf-baseline.json` when that file exists.
Consequence: CI never fails on perf numbers. This ward writes no `perf-baseline.json`; at gold, Dennis decides whether the CI artifact becomes the baseline.
Decision: APPROVED 2026-10-04 — perf project non-blocking; tick p95 ≤ 1.2× baseline + RAF p95 ≤ 12 ms soft budgets; no perf-baseline.json in W65 (saga dec_0ef7fed4)

### D65-9: opt-level 3 vs "s" by measurement
Proposal: `scripts/bench-opt-level.mjs` builds twice through `CARGO_PROFILE_RELEASE_OPT_LEVEL=3|s` (Cargo.toml untouched). It times `FluidCore.tick` per step in Node at 8000 particles in the acceptance layout, over 3 alternating rounds of 600 ticks. It uses the 7-arg constructor, area hint 76 057 px² (the rounded-rect formula) and max_element_h_px 180, which is the configuration W64's scenario tests use.
Consequence: the result goes into the gold notes. Whether `[profile.release]` changes is Dennis' decision at gold, not part of this ward.
Decision: APPROVED 2026-10-04 — opt-level 3 vs "s" measured by bench-opt-level.mjs; Cargo.toml unchanged in W65 (saga dec_facdf083)

### D65-10: Multi-instance stress page
Proposal: `demo/scenes/stress.html?n=2..4&ms=` starts `n` `createFluidRuntime` calls synchronously in one task (`Promise.all`, the race3 shape). Each has its own element, 2000 particles and a counting clock, and all share a counting `loader` around `loadFluidWasm`. The page counts successful `WebAssembly.instantiate*` calls. Pass criteria: 1 instantiation, 1 distinct memory, every instance ticked, finite state, idempotent destroy, and no console.error, pageerror or panic, over n = 2, 3, 4 and 50 reloads.
Consequence: the W61 multi-instance regression is checked in a real browser on every CI run. The page has no `data-liquid`, so W66 must pass `autoObserve: false` there.
Decision: APPROVED 2026-10-04 — stress page: n = 2..4 creates in one task, 1 instantiation, 1 memory, 50 reloads (saga dec_5e69c474)

### D65-11: Scene hook contract
Proposal: `window.__liquidTest = { ready, restAlpha(), advance(n), instance, params, perf }`, typed in `demo/test-hooks.ts`, which the demo pages and `e2e/global.d.ts` share. The observed elements are the `[data-liquid]` nodes in DOM order: `#splash`, `#split`, `#merge`, `#card`.
Consequence: W66 keeps these names and that order when it moves the scene to `LiquidDOM.create` (with `autoObserve`), and keeps `perf` working through an @internal path.
Decision: APPROVED 2026-10-04 — window.__liquidTest contract in demo/test-hooks.ts; [data-liquid] in DOM order (saga dec_dd763d4e)

## Specification
- The manual clock's `advance(n, dtMs = 1000/60)` runs queued callbacks `n` times with timestamps increasing by `dtMs`. `cancel(handle)` removes the callback.
- `__liquidTest.restAlpha()` returns the `restAlpha` of every `[data-liquid]` element in DOM order (`#splash`, `#split`, `#merge`, `#card`).
- The guard fixture collects `console` messages of type `error`, `pageerror` events and any text matching `/panicked at|RuntimeError: unreachable/`, and fails the test at fixture teardown.
- Step 1 waits for `__liquidTest.ready`, advances 120 frames, asserts every `restAlpha === 1` and that the DOM text is visible, then takes a screenshot with `maxDiffPixelRatio: 0.01`.
- Step 8 (reduced motion) uses `emulateMedia({ reducedMotion: "reduce" })`: `restAlpha` is 1 on the first frame, and two frames 1 s apart are identical.
- The multi-instance spec opens `stress.html?n=2|3|4` for 3 s each, then reloads 50 times. Zero errors are allowed.
- The WebGPU smoke page calls `requestAdapter()`, logs `adapter.info` including `isFallbackAdapter`, clears to a known colour, reads the pixel back and compares it.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_manual_clock_when_advance_3_then_callbacks_run_3_times_with_fixed_dt | clock (D65-1) |
| 2 | given_manual_clock_when_cancelled_then_callback_not_run | clock |
| 3 | given_callback_cancelled_by_an_earlier_callback_in_the_same_frame_when_advancing_then_it_does_not_run | clock RAF semantics |
| 4 | given_callback_requested_during_a_frame_when_advancing_one_frame_then_it_runs_on_the_next_frame | clock RAF semantics |
| 5 | given_explicit_dt_when_advancing_then_timestamps_step_by_that_dt | clock |
| 6 | given_invalid_frames_or_dt_or_start_when_used_then_TypeError | clock validation |
| 7 | given_rafClock_when_request_and_cancel_then_delegates_to_requestAnimationFrame | rafClock |
| 8 | given_two_runtimes_same_seed_manual_clock_when_advanced_120_frames_then_dynamic_views_identical | determinism |
| 9 | given_two_runtimes_different_seeds_manual_clock_when_advanced_then_dynamic_views_differ | seed |
| 10 | given_manual_clock_at_one_sixtieth_when_frames_run_then_tick_returns_one_step_each | step count |
| 11 | given_clock_option_when_runtime_runs_then_requestAnimationFrame_is_never_called | clock seam |
| 12 | given_manual_clock_without_advance_when_real_time_passes_then_no_frame_runs | clock seam |
| 13 | given_empty_query_when_parsed_then_seed_1_raf_clock_canvas2d_and_all_flags_off | scene params (D65-11) |
| 14 | given_seed_7_clock_manual_rm_1_test_1_when_parsed_then_all_fields_set | scene params |
| 15 | given_perf_1_with_raf_clock_and_max_u32_seed_when_parsed_then_perf_true | scene params |
| 16 | given_invalid_query_%s_when_parsed_then_TypeError (it.each, 10 cases) | scene params validation |
| 17 | given_perf_with_manual_clock_when_parsed_then_TypeError | scene params validation |
| 18 | given_ci_yml_when_parsed_then_e2e_job_needs_test_and_uses_playwright_image_matching_the_exact_devDependency_version | CI pin (D65-6) |
| 19 | given_ci_yml_when_parsed_then_canvas2d_step_is_blocking_and_webgpu_step_continue_on_error | CI policy (D65-3) |
| 20 | given_ci_yml_when_parsed_then_pkg_artifact_is_uploaded_by_test_and_downloaded_by_e2e | CI artifact |
| 21 | given_ci_yml_when_parsed_then_perf_step_is_non_blocking_and_its_json_is_uploaded | perf in CI (D65-8) |
| 22 | given_ci_yml_when_parsed_then_e2e_update_baselines_job_is_workflow_dispatch_and_uploads_baselines | D65-7 |
| 23 | given_playwright_config_when_loaded_then_webgpu_project_matches_only_the_smoke_spec | D65-5 (C8) |
| 24 | given_e2e_spec_files_when_routed_then_canvas2d_runs_every_spec_except_smoke_and_perf | routing |
| 25 | given_project_table_when_read_then_only_canvas2d_is_blocking_and_perf_runs_only_perf_spec | routing (D65-3) |
| 26 | given_webgpu_launch_args_when_read_then_they_equal_the_spec_swiftshader_flags | D65-5 |
| 27 | given_playwright_config_when_loaded_then_webgpu_runs_new_headless_chromium_and_web_server_has_BROWSER_none_and_strictPort | D65-5, D65-2 |
| 28 | given_samples_when_summarized_then_nearest_rank_p50_p95_mean_and_max | perf stats |
| 29 | given_gitignore_when_checked_then_baselines_are_tracked_even_when_named_w_star_and_reports_are_ignored | D65-2 |
| 30 | given_e2e_docker_script_when_read_then_it_pins_platform_linux_amd64 | D65-7 |
| 31 | given a page that logs console.error when the guard fixture runs then the test fails | guard |
| 32 | given a page throwing pageerror when the guard fixture runs then the test fails | guard |
| 33 | given a page that logs a Rust panic message at info level when the guard fixture runs then the test fails | guard |
| 34 | given a clean page when the guard fixture runs then the test passes | guard |
| 35 | step 1 – given the acceptance scene at seed 1 when idle 2 s then every element has restAlpha 1 and DOM text is visible | step 1 |
| 36 | step 1 – given rest when screenshotted then it matches the baseline (maxDiffPixelRatio 0.01) | step 1 visual (Linux only) |
| 37 | step 8 – given prefers-reduced-motion reduce when the scene loads then restAlpha is 1 on the first frame and two frames 1 s apart are identical | step 8 RM |
| 38 | step 8 – given ?rm=1 (forceReducedMotion) when the scene loads then restAlpha is 1 on the first frame | step 8 RM |
| 39 | step 8 – given print media when emulated then the liquid canvas is display none | step 8 print (fixme → W66, D65-4) |
| 40 | given 2, 3 and 4 instances created in the same task when the page runs 3 s then no console error, pageerror or panic | multi-instance (D65-10) |
| 41 | given the stress page when reloaded 50 times then no console error, pageerror or panic | multi-instance (D65-10) |
| 42 | given SwiftShader WebGPU when requesting an adapter then adapter.info incl. isFallbackAdapter is logged | webgpu smoke |
| 43 | given a known clear colour when rendered and read back then the pixel matches | webgpu smoke |
| 44 | given a WGSL pipeline drawing a full-screen triangle when rendered and read back then the pixel matches | webgpu smoke |
| 45 | perf – given 8000 particles in the acceptance scene when 5 s of RAF frames are sampled then p95 tick per fixed step and RAF p95 are recorded | D65-8 (non-blocking) |
| 46 | D65-11 – given the scene when loaded then restAlpha indices map to #splash, #split, #merge, #card and advance throws unless the clock is manual | scene hook (D65-11) |
| 47 | step 8 visual – given reduced motion (media) and a moved card when screenshotted then it matches the baseline | step 8 RM visual (Linux only) |
| 48 | step 8 visual – given reduced motion (option) and a moved card when screenshotted then it matches the baseline | step 8 RM visual (Linux only) |

## Must NOT
- Make the `webgpu` project blocking (that needs 10 green runs in a row).
- Commit baselines that were not generated in the pinned Linux image.
- Use external fonts in scenes (COEP `require-corp`, and determinism).
- Fail CI on perf numbers.

## Must DO
- Gate D65-1 … D65-11 before `wdd ward status 65 red`, and log them in NORTH-STAR.
- Reconcile this Tests table in the red commit.
- Give every new HTML page `<link rel="icon" href="data:,">` (D5).
- Record the `bench-opt-level.mjs` result and the first perf numbers in the gold notes.
- Inspect the step-1 baseline image with vision before committing it.

## Manual Smoke Test
### Setup
`npm ci && npm run build && npx playwright install chromium`

### Steps
1. Run: `npx playwright test --project=canvas2d`
   Expected: all canvas2d specs pass. Visual assertions are skipped on macOS.
2. Run: `npx playwright test e2e/webgpu-smoke.spec.ts --project=webgpu`
   Verify: the adapter info is logged and the pixel matches (or the job is reported soft).
3. Run: `npm run e2e:update`
   Verify: `e2e/__screenshots__/…/acceptance-step1-canvas2d-linux.png` is written. Inspect it with vision.
4. Run: `node scripts/bench-opt-level.mjs`
   Verify: it prints mean and p95 ms per step for `opt-level=3` and `opt-level="s"`.

### Pass criteria
- [ ] canvas2d green locally and in CI; webgpu smoke attempted.
- [ ] The baseline image is inspected with vision (crisp pills, DOM text).
- [ ] The perf artifact exists in the CI run.

## Verification
CI shows the `e2e` job green for canvas2d, `npm run verify` is green, the gold notes contain the perf and opt-level numbers, and Dennis approves.

## WebGPU soft-run log (D65-5: blocking after 10 green CI runs in a row)
| # | CI run | webgpu smoke | adapter.info |
|---|--------|--------------|--------------|
