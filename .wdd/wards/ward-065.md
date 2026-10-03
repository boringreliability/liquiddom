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
Proposal: `createManualClock()` (fixed dt, default 1000/60 ms, `advance(n)`) is injected via the `@internal` `clock` option, and the scene uses it when given `?clock=manual`.
Consequence: visual baselines become deterministic. Recordings (W69) must use the RAF clock instead, or the video freezes.
Decision: PENDING

### D65-2: Snapshot path and Linux-only baselines
Proposal: `snapshotPathTemplate: "e2e/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}"`. Baselines are Linux only, and visual assertions are skipped off Linux unless `UPDATE=1`.
Consequence: macOS runs check behaviour but not pixels. The `.gitignore` rule `w*-*.png` must not swallow baselines (negation added, and no baseline name may start with `w`).
Decision: PENDING

### D65-3: CI e2e job
Proposal:
- The `e2e` job `needs: test` and downloads the `pkg/` artifact uploaded by the Node-22 leg.
- It runs in `container: mcr.microsoft.com/playwright:v<X.Y.Z>-noble`, the same version as the exact `@playwright/test` pin, with `timeout-minutes: 20`.
- The `canvas2d` step is blocking; the `webgpu` step has `continue-on-error: true`.

Consequence: CI time grows by one job, and the image version and the npm pin must be bumped together. A test asserts that they match.
Decision: PENDING

### D65-4: Print spec waits for W66 [BOUNDARY]
Proposal: `step 8 – print` is `test.fixme("W66 stylesheet")` until the injected stylesheet exists.
Consequence: S1 step 8 "print" is only ✅ after W66.
Decision: PENDING

### D65-5: WebGPU project runs new headless Chromium on SwiftShader
Proposal: `channel: "chromium"` (new headless; the default is headless-shell) with `--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader`, and the page forces `renderer: 'webgpu'`.
Consequence: software WebGPU in CI. GPU timing is not measured there.
Decision: PENDING

### D65-6: Baselines are generated in CI
Proposal: a `workflow_dispatch` job `e2e-update-baselines` runs `npm run e2e:update` in the pinned image and uploads `e2e/__screenshots__` as an artifact, which is committed by hand. The local helper `scripts/e2e-docker.sh` uses `--platform linux/amd64` and a Linux `node_modules` volume (D1).
Consequence: no arm64 and amd64 Skia rasterisation mismatch between the M4 Mac and CI.
Decision: PENDING

### D65-7: The webgpu project runs only the smoke spec until slice 3
Proposal: `testMatch: /webgpu-smoke\.spec\.ts/` for the `webgpu` project (C8).
Consequence: `acceptance.spec.ts` does not fail under a renderer that does not exist yet.
Decision: PENDING

### D65-8: Perf baseline is non-blocking; opt-level by measurement
Proposal: `e2e/perf.spec.ts` (canvas2d, 8000 particles, acceptance scene, 600 RAF frames) records the p95 of `tick` per fixed step and the RAF-callback p95, and CI uploads them as an artifact without failing the job. `scripts/bench-opt-level.mjs` builds with `opt-level = 3` and with `"s"`, benchmarks both, and the result goes into this ward's gold notes (C1).
Consequence: the spec's budgets (≤ 1.2× the CI baseline, RAF p95 ≤ 12 ms) get their baseline. `[profile.release]` may change to `"s"` by measurement.
Decision: PENDING

### D65-9: yaml is an explicit devDependency
Proposal: add `yaml` to the root devDependencies to parse workflows in `ci-workflow.test.ts` (D2).
Consequence: one small dev dependency. No reliance on `js-yaml` arriving transitively.
Decision: PENDING

### D65-10: Playwright web server
Proposal: `BROWSER=none npx vite --config demo/vite.config.ts demo --port 4173 --strictPort`, with `reuseExistingServer: !process.env.CI`, viewport 1280×800 and `testDir: "e2e"`.
Consequence: `server.open: true` never opens a browser in CI, and the local dev server on 3000 is untouched.
Decision: PENDING

## Specification
- The manual clock's `advance(n, dtMs = 1000/60)` runs queued callbacks `n` times with timestamps increasing by `dtMs`. `cancel(handle)` removes the callback.
- `__liquidTest.restAlpha()` returns the `restAlpha` of every observed element, in id order.
- The guard fixture collects `console` messages of type `error`, `pageerror` events and any text matching `/panicked at|RuntimeError: unreachable/`, and fails the test in `afterEach`.
- Step 1 waits for `__liquidTest.ready`, advances 120 frames, asserts every `restAlpha === 1` and that the DOM text is visible, then takes a screenshot with `maxDiffPixelRatio: 0.01`.
- Step 8 (reduced motion) uses `emulateMedia({ reducedMotion: "reduce" })`: `restAlpha` is 1 on the first frame, and two frames 1 s apart are identical.
- The multi-instance spec opens `stress.html?n=2|3|4` for 3 s each, then reloads 50 times. Zero errors are allowed.
- The WebGPU smoke page calls `requestAdapter()`, logs `adapter.info` including `isFallbackAdapter`, clears to a known colour, reads the pixel back and compares it.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_manual_clock_when_advance_3_then_callbacks_run_3_times_with_fixed_dt | clock |
| 2 | given_manual_clock_when_cancelled_then_callback_not_run | clock |
| 3 | given_two_runtimes_same_seed_manual_clock_when_advanced_120_frames_then_dynamic_views_identical | determinism |
| 4 | given_manual_clock_at_one_sixtieth_when_frames_run_then_tick_returns_one_step_each | step count |
| 5 | given a page that logs console.error when the guard fixture runs then the test fails | guard |
| 6 | given a page throwing pageerror when the guard fixture runs then the test fails | guard |
| 7 | step 1 – given the acceptance scene at seed 1 when idle 2 s then every element has restAlpha 1 and DOM text is visible | step 1 |
| 8 | step 1 – given rest when screenshotted then it matches the baseline (maxDiffPixelRatio 0.01) | step 1 visual |
| 9 | step 8 – given prefers-reduced-motion reduce when the scene loads then restAlpha is 1 on the first frame and two frames 1 s apart are identical | step 8 RM |
| 10 | step 8 – given print media when emulated then the liquid canvas is display none | step 8 print (fixme → W66) |
| 11 | given 2, 3 and 4 instances created in the same task when the page runs 3 s then no console error, pageerror or panic | multi-instance |
| 12 | given the stress page when reloaded 50 times then no console error, pageerror or panic | multi-instance |
| 13 | given SwiftShader WebGPU when requesting an adapter then adapter.info incl. isFallbackAdapter is logged | webgpu smoke |
| 14 | given a known clear colour when rendered and read back then the pixel matches | webgpu smoke |
| 15 | given_ci_yml_when_parsed_then_e2e_job_needs_test_and_uses_playwright_image_matching_the_exact_devDependency_version | CI pin |
| 16 | given_ci_yml_when_parsed_then_canvas2d_step_is_blocking_and_webgpu_step_continue_on_error | CI policy |
| 17 | given_ci_yml_when_parsed_then_pkg_artifact_is_uploaded_by_test_and_downloaded_by_e2e | CI artifact |
| 18 | given_ci_yml_when_parsed_then_e2e_update_baselines_job_is_workflow_dispatch_and_uploads_baselines | D65-6 |
| 19 | given_playwright_config_when_loaded_then_webgpu_project_matches_only_the_smoke_spec | D65-7 |
| 20 | given_e2e_docker_script_when_read_then_it_pins_platform_linux_amd64 | D65-6 |
| 21 | perf – given the acceptance scene at 8000 particles in canvas2d when 600 RAF frames run then p95 tick per fixed step and RAF p95 are written to the perf artifact | D65-8 (non-blocking) |

## Must NOT
- Make the `webgpu` project blocking (that needs 10 green runs in a row).
- Commit baselines that were not generated in the pinned Linux image.
- Use external fonts in scenes (COEP `require-corp`, and determinism).
- Fail CI on perf numbers.

## Must DO
- Gate D65-1 … D65-10 before `wdd ward status 65 red`, and log them in NORTH-STAR.
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
3. Run: `scripts/e2e-docker.sh --update`
   Verify: `e2e/__screenshots__/…/acceptance-step1-canvas2d-linux.png` is written. Inspect it with vision.
4. Run: `node scripts/bench-opt-level.mjs`
   Verify: it prints mean and p95 ms per step for `opt-level=3` and `opt-level="s"`.

### Pass criteria
- [ ] canvas2d green locally and in CI; webgpu smoke attempted.
- [ ] The baseline image is inspected with vision (crisp pills, DOM text).
- [ ] The perf artifact exists in the CI run.

## Verification
CI shows the `e2e` job green for canvas2d, `npm run verify` is green, the gold notes contain the perf and opt-level numbers, and Dennis approves.
