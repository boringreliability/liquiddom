---
ward: 85
revision: null
name: "Adapters"
epic: "fluid-engine"
status: "approved"
dependencies: [84]
layer: "both"
estimated_tests: 48
created: "2026-10-22"
completed: null
---
# Ward 085: Adapters

North star: none — the adapters carry the engine to React and Vue (slice design §8); the 8 acceptance steps are unchanged. An app built with `@liquiddom/react` or `@liquiddom/vue` learns when its instance stopped, can opt an element out of drag, gets the same liquid resolution as `autoObserve` and is smoke-tested from the published `dist` in both frameworks.

## Scope
Sixth ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §8). Four parts: (1) a stopped instance is reported: a new core option `onError(err)` is called once when the instance stops (a throwing frame, a failed `resize_world`, a failed rebuild after a lost device), and the React and Vue providers turn it into an error state; (2) `drag` reaches the adapters (`<LiquidElement drag={false}>`, `useLiquidRef({ drag: false })`; W84 added it to core's `ElementOptions`); (3) the area hint without `autoObserve`: today an app that observes its elements after `create()` (every adapter app) builds the core with hint 0, so the grid cell stays at 8 px for good, while `autoObserve` gives `clamp(√(4A/N), 4, 8)`; (4) `examples/vue` and a blocking Vue dist e2e, mirroring `examples/react`. How visible the 8 px cell is, and whether a core call that rebuilds the grid before any element is placed equals a core built with the hint, come from the time-boxed spike W85.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W85.md`, part 1); part 2 is written after the gate.

Out of scope: the site (W86), publishing (W87, Dennis), an automatic re-create after a stop (recovery stays `destroy()` + `create()`; an adapter remount), a cell change once liquid is placed.

## Inputs
- The slice design §8, §11 (vitest: `onError` once, adapter `drag` prop and error state), §12 (D85-1).
- `runtime.ts` `stopInstance(msg, err)` (failed frame, `growWorld`) and `rebuildFailed` (its own copy of the stop logic); `options.ts` `OPTION_KEYS`/`resolveOptions` (function options: `testBackend`, `loader`, `clock`); `index.ts` (`initial = autoObserve ? candidatesIn(root) : []`, `measureHint` → `areaHintPx2`, `maxElementHPx`); `src/fluid/grid.rs` `choose_cell_px` (B5), `margin_px` (B15), `Grid::new`, `resize_world`; the runtime's redistribute batcher and the over-budget warning (`max_area_px2`).
- `packages/react/src/index.tsx` and `packages/vue/src/index.ts` (`pickElementOptions` copies only `viscosity` and `recovery`; create rejections only `console.error`); `examples/react`, `e2e/dist.spec.ts`, `e2e/projects.ts` (`DIST_*`), `e2e:dist:build`, `ci.yml`'s dist steps, and the tests that pin them (`e2e-harness.test.ts`, `ci-workflow.test.ts`, `workspace-publish.test.ts`).
- Baseline at `9986911` (W84 complete): see Specification.

## Outputs
- Core: `LiquidOptions.onError`; one stop path (`rebuildFailed` on `stopInstance`); the area-hint rule of D85-4.
- React and Vue: the error state of D85-2, the `drag` prop of D85-3.
- `examples/vue`, the Vue dist e2e (D85-5).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). -->
### D85-1: A stopped instance is reported (`onError`)
Proposal: a new `create()` option `onError?: (err: unknown) => void`, validated as a function (TypeError otherwise) and called exactly once per instance when it stops: a throwing frame, a throwing `resize_world`, a failed rebuild after a lost device (`rebuildFailed` is folded into `stopInstance`, so every stop runs one path). It runs synchronously after the stop's cleanup and after its `console.error` (the message stays: an author without a handler still sees it). A throwing handler is caught and reported with one `console.error`. Never called for a `create()` rejection (the promise rejects), an `'auto'` fallback, a lost device that rebuilds as Canvas2D, or after `destroy()`.
Consequence: one new public option and the whitelist grows; the runtime's three stop paths become one. No `instance.stopped` getter (the handler is the signal; YAGNI).
Decision: APPROVED 2026-10-22 — onError(err) once per instance on every stop path (rebuildFailed on stopInstance), after the cleanup and the console.error; a throwing handler caught; never for a create() rejection, a fallback, a rebuilt device or after destroy() (saga dec_3039b876)

### D85-2: The providers' error state
Proposal: React and Vue providers chain their own handler in front of `config.onError` (which is still called). On a stop the provider destroys the stopped instance, `useLiquid()` returns `null` and a new `useLiquidError()` returns the error (React: `unknown | null`; Vue: `Ref<unknown | null>`); a `create()` rejection sets the same error (its `console.error` stays). No automatic retry (a deterministic failure would loop); a remount (React `key`, Vue `v-if`/`key`) creates a new instance and clears the error. The Vue plugin (`LiquidPlugin.install`) behaves like the provider.
Consequence: `useLiquid()` keeps its type (non-breaking); one new hook per adapter. Elements stay as the stop left them until the provider destroys the instance (then exactly restored).
Decision: APPROVED 2026-10-22 — the providers destroy a stopped instance, useLiquid() null, useLiquidError() the error (also a create() rejection); config.onError still called; no retry, a remount clears; the Vue plugin likewise (saga dec_70e6753b)

### D85-3: `drag` in the adapters
Proposal: `<LiquidElement drag={false}>` (React prop; Vue prop `{ type: Boolean, default: undefined }`, since Vue casts an absent Boolean prop to `false`) and `useLiquidRef({ drag })`, captured once at the first render/setup like `viscosity` (D66-4). `pickElementOptions` copies every `ElementOptions` key that is not `undefined` (`viscosity`, `recovery`, `drag`); `drag` is never spread onto the DOM.
Consequence: an absent `drag` passes no key (W84: no `data-liquid-drag`); changing the prop after mount has no effect, as for `viscosity`.
Decision: APPROVED 2026-10-22 — drag on LiquidElement and useLiquidRef, captured once; Vue Boolean prop with default undefined; pickElementOptions copies every defined key; never on the DOM (saga dec_eb4b4ea5)

### D85-4: The area hint without `autoObserve`
Proposal: (a), from W85.0. Candidates: (a) a new scalar call `FluidCore::set_area_hint(area_px2, max_element_h_px)` that rebuilds the grid (cell by B5, margin by B15; world, viewport and lattice phase kept) and returns `true` only while no element has ever been placed (generation 0), otherwise does nothing and returns `false`; the runtime calls it once, at the first redistribute batch with observed area > 0, only when `create()` had hint 0; (b) build the core lazily at the first observe batch; (c) no change, document that `autoObserve` or observing before the first frame gives the finer liquid.
Consequence: (a) one allocation outside `tick` (13 µs at 1280×800, 178 µs at 8192²) and one new FFI call (the 7-arg constructor stays); a core built with a hint is untouched; bit-identical to a hinted constructor (W85.0 Q2); adapter apps get the finer, more ragged liquid in motion that the engine was tuned at, and a smaller over-budget limit (`particles · cell² / 2`), so an app observing more area than its particles cover now gets the warning `autoObserve` would give. (b) restructures `create()` (renderer, bridge and loop wait for elements) for no gain. (c) adapter apps keep the 8 px cell: smoother, rounder liquid in motion, identical at rest.
Decision: AMENDED 2026-10-22 — (a) FluidCore::set_area_hint(area_px2, max_element_h_px) rebuilds the grid only at generation 0, called once by the runtime at the first batch with area > 0 when create() had hint 0 (a zero-area batch while the hint is pending skips redistribute, so the generation stays 0); the scroll applied before placement is summed (f64) and replayed through scroll_origin on the new lattice, bit-identical to a hinted core (re-splitting the old drift is not: rem(rem(D, 8), c) ≠ rem(D, c)); a throwing set_area_hint stops the instance; first approved as dec_8655ba84 (saga dec_19811b35)

### D85-5: `examples/vue` and the Vue dist e2e
Proposal: `examples/vue` (private `liquiddom-vue-example`, render functions in `.ts`, no SFC, so no `@vitejs/plugin-vue` dependency; `vite.config.ts` defines Vue's three feature flags), the same two pills as `examples/react`; both examples give one pill `drag={false}` so the dist e2e also checks `data-liquid-drag="off"` from the built adapter. `e2e:dist:build` also builds `@liquiddom/vue` and the Vue example; `dist.spec.ts` gets a second test that serves `examples/vue/dist` with Vite's `preview()` on :4175 (`DIST_VUE_PORT`, `DIST_VUE_EXAMPLE_ROOT`); CI's dist step runs both; `.changeset/config.json` ignores the Vue example.
Consequence: approved tests change at red (Dennis approves them with the red tests): `e2e-harness.test.ts` (the `e2e:dist:build` string, the dist constants), `workspace-publish.test.ts` (the example set); `ci-workflow.test.ts` needs no change (the dist steps keep their commands; amended 2026-10-22); the dist job gets slower by one adapter and one example build.
Decision: APPROVED 2026-10-22 — examples/vue as render functions (no plugin, the three Vue feature-flag defines), one drag={false} pill in both examples, the Vue dist test on :4175, CI runs both; the pinned harness/CI/publish tests change at red (saga dec_f37258d2)

## Spike W85.0 result (2026-10-22, a throwaway copy of `c61bc5e`, deleted; stills inspected with vision)

| Q | Measured | Recommendation |
|---|---|---|
| Q1 cell | Acceptance scene: hinted cell 6.17 px (A = 76 057 px², N = 8000) against 8 px when observed after `create()`; `examples/react`'s pills: 4 px (√(4·24 855/8000) = 3.5, clamped) against 8. Particle spacing and kernel radius follow area per particle, not the cell, so they are equal; the cell sets the solver's resolution (B-spline support 18.5 px against 24 px; 12 against 24 for the pills). At rest the stills are byte-identical (exact roundRect) in both renderers. In motion (splash frame 20), vision: the hinted liquid has finer, more ragged edges (thin tendrils, a jagged hole), the 8 px liquid the same shape with a smoother, rounder outline; the pills (4 against 8) differ more. Nothing looks broken. No over-budget warning in any case (a hinted budget is exactly 2·A; 8 px has the largest budget, so it can only hide the warning). | the engine was tuned (W73–W77) at the hinted cell; an element's liquid should not depend on when it was observed → D85-4 (a) |
| Q2 rebuild | Prototype `set_area_hint(area, tallest) -> bool` (only at generation 0; `Grid::new` with the current world, B5 cell, B15 margin; viewport kept): **bit-identical** to a hinted constructor in the dynamic, state and static views after 120 frames with a splash, for k = 0, 1 and 5 empty frames before it. Against a page that observed at create the empty frames shift only `time_s` (the wobble phase): ≤ 0.195 px, the same as any two pages observing at different frames. After a redistribute it returns `false` and changes nothing. Cost: 13 µs at 1280×800, 178 µs at 8192² (release). No TS view points into grid memory; a memory growth rebinds the bridge's views (W81's path). A `scroll_shift` before the first batch drifts the origin by < ½ old cell; the prototype carried it over in px. | (a) is safe; re-split the drift with `scroll_origin` (design resolution of part 2) |
| Q3 first batch | Frames ticked before the first observe batch: React built 0, React dev (StrictMode) 1, Vue dev 0, Vue built 0; the batch is `observe, observe`, generation 0 → 1 in all four; nothing drawn before it (no active particles). StrictMode never batches observe/unobserve/observe: its effect replay creates and destroys a whole first instance (the WASM loads once). | the generation-0 condition holds for adapter apps; (b) gains nothing over (a) |
| Q4 Vue example | `examples/vue` as render functions in `.ts` builds with Vite 8.3.2 without `@vitejs/plugin-vue`; preview: ready flag, 2 `.liquid-element`, one canvas, no console error. JS 168.9 kB (57.7 kB gzip) against React's 248.8 kB (79.6 kB); build time equal. Dev mode warns about the three undefined Vue feature flags; a `define` in `vite.config.ts` removes it. | D85-5 as proposed, plus the three `define`s |

## Specification
**Baseline (2026-10-22, `8c42be8`, recounted on the plan-validation copy).**

| Suite | Count |
|---|---|
| cargo | 240 passed; 0 failed; 1 ignored |
| vitest | 798 passed (798), 80 files |
| Playwright `--list` | canvas2d 102, webgpu 51, webgpu-hw 99, perf 6, dist 1 |

**Values.** `ON_ERROR_THREW = "[liquiddom] the onError handler threw; ignored."` in `runtime.ts`; `DIST_VUE_PORT = 4175`, `DIST_VUE_EXAMPLE_ROOT = "examples/vue"` in `e2e/projects.ts`; B5 (`clamp(√(4A/N), 4, 8)`, 8 for no usable hint) and B15 (`max(200, tallest)`) unchanged.

**`onError` (D85-1).** `LiquidOptions.onError?: (err: unknown) => void` is in the option whitelist; anything but a function or `undefined` throws `TypeError` "onError must be a function …". Every stop goes through `stopInstance(msg, err)`: a frame that throws, a throwing `resize_world` (`growWorld`), a throwing `set_area_hint` (design resolution 7) and a failed Canvas2D rebuild after a lost WebGPU device (`rebuildFailed`, which keeps its renderer and class cleanup and its own message). `stopInstance` does nothing when the instance already stopped or was destroyed; otherwise it runs the W78/W83 cleanup, the one `console.error(msg, err)` and then, last, `onError(err)`; a throwing handler is caught and reported with one `console.error(ON_ERROR_THREW, handlerErr)`. Every caller returns right after it, so the handler may call `destroy()`. A stop in `buildRuntime`'s growth right after `loop.start()` calls `onError` before `create()` resolves. Never called for a `create()` rejection, an `'auto'` fallback, a lost device rebuilt as Canvas2D, or after `destroy()`.

**The providers (D85-2).** React's `LiquidProvider`, Vue's `LiquidProvider` and `LiquidPlugin.install` pass `config` with their own handler chained in front of `config.onError` (called after it); an `onError` that is not a function is passed on, so `create()` rejects with its `TypeError`. On a stop the handler (synchronously) destroys the instance, sets the instance to `null` and the error to the stop's error; an instance that stopped before `create()` resolved is destroyed on arrival. A `create()` rejection keeps its `console.error` and sets the error. No retry. React: `useLiquidError(): unknown` from a private context, cleared by the effect cleanup (a remount); Vue: `useLiquidError(): Ref<unknown>` (`shallowRef`) under the exported `LiquidErrorKey`, one per provider or plugin. `useLiquid()` keeps its type in both.

**`drag` (D85-3).** `pickElementOptions(opts)` copies every own key whose value is not `undefined` and returns `undefined` when none is left. React `LiquidElementProps.drag?: boolean`, destructured with `as`, `viscosity`, `recovery`; Vue prop `drag: { type: Boolean, default: undefined }`. Both pass `{ viscosity, recovery, drag }` to `useLiquidRef`, captured once (D66-4).

**The area hint (D85-4).** Rust: `FluidCore::set_area_hint(area_px2, max_element_h_px) -> bool`. While `generation == 0` it replaces the grid with `Grid::new(world_w, world_h, choose_cell_px(N, area), margin_px(tallest))` (the grid's current world, so a W81 growth stays), replays `pre_place_scroll_px` (the sum of the sanitised `scroll_shift` deltas while `generation == 0`, f64) through `Grid::scroll_origin` (the lattice phase equals a hinted core's with the same scroll history and the result is bit-identical, except when a step lands exactly on half a cell: a hinted core rounds that step away from zero, so its origin depends on the order of the steps and may sit one whole cell apart from the summed replay; the walls sit in the margin, nothing is visible), invalidates the fused AABB, rewrites the dynamic view and returns `true`; the viewport, particles, elements, clock, gravity and RNG are untouched. Otherwise it returns `false` and changes nothing. Runtime: `hintPending = !(areaHint > 0)` from the hint `create()` measured; in the redistribute batch, a stopped or destroyed instance's batch calls nothing (review M7); while pending, a batch with observed area 0 skips `core.redistribute()` (nothing to place; the generation stays 0) and an observed area > 0 clears the flag and calls `core.set_area_hint(registry.observedArea(), registry.observedTallest())` before `core.redistribute()` (a throw stops the instance and skips the redistribute). The over-budget warning reads `max_area_px2()` after the call.

**Examples and the dist smoke (D85-5).** `examples/vue` (`liquiddom-vue-example`, private; `vue` and `vite` only, the root's versions; render functions in `src/App.ts`; `vite.config.ts` with `optimizeDeps.exclude: ["liquiddom"]` and `__VUE_OPTIONS_API__`, `__VUE_PROD_DEVTOOLS__`, `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`). Both examples render a `useLiquidRef` pill and a `LiquidElement` pill with `drag={false}`, `data-liquid-ready` once the instance arrives and `Liquid stopped: <message>` (`role="alert"`) while `useLiquidError()` is set. `e2e:dist:build` builds core, both adapters and both examples (`--ignore-scripts`); `e2e/dist.spec.ts` serves `examples/react/dist` on 4174 and `examples/vue/dist` on 4175 and checks the ready flag, one canvas, two `.liquid-element`, one `[data-liquid-drag="off"]`, no `[drag]`, the `.wasm` MIME and the console. `.changeset/config.json` ignores the Vue example; CI's dist steps keep their commands.

**D85-4's Decision line** was amended 2026-10-22 (Dennis, with plan part 2; saga dec_19811b35): the summed pre-placement scroll is replayed (design resolution 6), a zero-area batch while the hint is pending skips redistribute (resolution 4), a throwing `set_area_hint` stops the instance (resolution 7); the over-budget slack (resolution 12) was approved with it. D85-5's Consequence: `ci-workflow.test.ts` needs no change.

**Unchanged.** The FFI layout and strides, the 7-arg constructor, every other scalar call, the engine; a core created with a hint (every Linux baseline) never calls `set_area_hint`.

## Tests

| # | Test Name | Verifies | Red outcome | Gold outcome |
|---|-----------|----------|-------------|--------------|
| 1 | on-error.test: given_onError_when_create_options_are_resolved_then_a_function_passes_through_and_anything_else_is_a_TypeError_naming_onError | D85-1 validation | ❌ unknown option "onError" | ✅ |
| 2 | on-error.test: given_a_frame_that_throws_when_the_instance_stops_then_onError_runs_once_with_that_error_after_the_cleanup_and_the_console_error | D85-1 frame path, RF1 (inside the handler: the console.error ran, no halo/away/text class held; review M1) | ❌ onError called 0 times | ✅ |
| 3 | on-error.test: given_a_resize_world_that_throws_when_the_window_grows_twice_then_onError_runs_once_with_that_error_and_the_message_is_unchanged | D85-1 `growWorld`, RF1 | ❌ onError called 0 times | ✅ |
| 4 | on-error.test: given_a_canvas2d_rebuild_that_fails_after_a_lost_device_when_the_instance_stops_then_onError_runs_once_and_the_rebuild_message_is_kept | D85-1 `rebuildFailed` on `stopInstance`, RF1 | ❌ waitFor: onError called 0 times | ✅ |
| 5 | on-error.test: given_a_lost_device_that_continues_in_canvas2d_when_frames_run_then_onError_is_never_called | D85-1 never (rebuilt device) | ✅ passes (guard) | ✅ |
| 6 | on-error.test: given_an_onError_that_throws_when_the_instance_stops_then_the_throw_is_caught_with_one_console_error_and_the_instance_stays_stopped | D85-1 throwing handler | ❌ onError called 0 times | ✅ |
| 7 | on-error.test: given_an_auto_fallback_a_destroy_or_a_create_rejection_when_they_happen_then_onError_is_never_called | D85-1 never, RF1 | ❌ the facade rejects with TypeError unknown option "onError", not the load error | ✅ |
| 8 | on-error.test: given_a_resize_world_that_throws_while_create_awaits_the_renderer_when_create_resolves_then_onError_ran_once_before_it_and_the_instance_is_stopped | design resolution 11 | ❌ create() rejects at once (unknown option): no core | ✅ |
| 9 | on-error.test: given_an_onError_that_destroys_the_runtime_when_resize_world_fails_then_nothing_throws_the_canvas_is_gone_and_the_core_is_freed_once | design resolution 1 (runtime), RF2 | ❌ onError called 0 times | ✅ |
| 10 | on-error.test: given_an_onError_that_destroys_the_instance_when_a_frame_fails_then_destroy_is_safe_and_the_element_is_restored_exactly | design resolution 1 (facade), RF2 | ❌ unknown option "onError" | ✅ |
| 11 | area-hint-runtime.test: given_the_test_backend_when_set_area_hint_runs_then_it_mirrors_rust_b5_at_generation_0_and_returns_false_after_a_redistribute | the helper mirrors Rust | ✅ passes (guard; the helper is real at red) | ✅ |
| 12 | area-hint-runtime.test: given_a_core_created_without_a_hint_when_the_first_batch_observes_area_then_set_area_hint_runs_once_with_the_area_and_the_tallest_height_before_redistribute | D85-4 batch rule, RF3 | ❌ only "redistribute", no set_area_hint | ✅ |
| 13 | area-hint-runtime.test: given_autoObserve_with_or_without_candidates_when_elements_are_observed_later_then_only_the_core_created_without_a_hint_calls_set_area_hint | D85-4, W84 bit-identity, RF3 | ❌ the unhinted core: [] (the hinted part passes) | ✅ |
| 14 | area-hint-runtime.test: given_first_batches_whose_observed_area_is_0_when_a_later_batch_observes_area_then_they_skip_redistribute_and_that_batch_calls_set_area_hint_once_and_gets_the_hinted_cell | design resolution 4 (review M10), RF3 | ❌ "area 0: nothing to place, no redistribute": ["redistribute"] | ✅ |
| 15 | area-hint-runtime.test: given_a_core_created_without_a_hint_when_the_observed_area_outgrows_the_hinted_budget_then_the_over_budget_warning_reads_the_new_max_area | D85-4 budget, design resolution 12 (two 140 × 48 boxes on 1024 particles reach exactly 13 440 px²; review I1) | ❌ "the budget is 2 × 6720": 32768 (cell 8) | ✅ |
| 16 | area-hint-runtime.test: given_a_set_area_hint_that_throws_when_the_first_batch_runs_then_the_instance_stops_with_one_console_error_onError_once_and_no_redistribute | design resolution 7 | ❌ no console.error (never called) | ✅ |
| 17 | fluid-ffi.test: given_the_real_core_built_without_a_hint_when_set_area_hint_runs_before_any_redistribute_then_the_cell_and_the_budget_equal_a_hinted_core_and_after_a_redistribute_it_returns_false | D85-4 real WASM export | ❌ the stub returns false | ✅ |
| 18 | react-error-drag.test: given_a_live_provider_when_its_instance_stops_then_the_provider_destroys_it_useLiquid_is_null_useLiquidError_is_the_error_and_config_onError_runs_after | D85-2, RF2, RF4 | ❌ no instance (create rejects: unknown option "onError") | ✅ |
| 19 | react-error-drag.test: given_create_rejects_when_the_provider_mounts_then_useLiquidError_is_the_rejection_its_console_error_stays_and_nothing_retries | D85-2 rejection, RF4 | ❌ useLiquidError() null (stub) | ✅ |
| 20 | react-error-drag.test: given_a_config_onError_that_is_not_a_function_when_the_provider_mounts_then_create_rejects_with_its_TypeError_and_the_error_state_holds_it | design resolution 9, RF4 | ❌ useLiquidError() null (stub) | ✅ |
| 21 | react-error-drag.test: given_a_stopped_provider_when_it_is_remounted_with_a_new_key_then_a_new_instance_arrives_and_the_error_is_cleared | D85-2 remount, RF4 | ❌ the error stays null after the stop (stub) | ✅ |
| 22 | react-error-drag.test: given_strict_mode_when_the_live_instance_stops_then_one_error_both_instances_are_destroyed_and_no_third_create | design resolution 2, RF2, RF4 | ❌ the stopped instance is not destroyed | ✅ |
| 23 | react-error-drag.test: given_an_instance_that_stops_while_create_awaits_the_renderer_when_create_resolves_then_the_provider_destroys_it_on_arrival_and_holds_the_error | design resolution 11, RF4 | ❌ useLiquidError() null (stub; the instance stopped) | ✅ |
| 24 | react-error-drag.test: given_LiquidElement_with_drag_false_and_one_without_when_mounted_then_observe_gets_drag_false_and_no_key_and_no_drag_attribute_reaches_the_dom | D85-3, RF5 | ❌ observe got undefined, not { drag: false } | ✅ |
| 25 | react-error-drag.test: given_useLiquidRef_with_drag_false_when_rerendered_with_drag_true_then_observe_ran_once_with_drag_false | D85-3 captured once, RF5 | ❌ observe got undefined | ✅ |
| 26 | vue-error-drag.test: given_a_live_provider_when_its_instance_stops_then_it_is_destroyed_useLiquid_is_null_useLiquidError_is_the_error_and_config_onError_runs_after | D85-2, RF2, RF4 | ❌ no instance (create rejects: unknown option "onError") | ✅ |
| 27 | vue-error-drag.test: given_create_rejects_when_the_provider_mounts_then_useLiquidError_is_the_rejection_and_its_console_error_stays | D85-2 rejection, RF4 | ❌ useLiquidError() null (stub) | ✅ |
| 28 | vue-error-drag.test: given_a_stopped_provider_when_it_is_remounted_then_a_new_instance_arrives_and_the_error_is_cleared | D85-2 remount, RF4 | ❌ the error stays null after the stop | ✅ |
| 29 | vue-error-drag.test: given_the_plugin_when_its_instance_stops_or_create_rejects_then_the_injected_refs_hold_null_and_the_error | D85-2 plugin, RF4 | ❌ the stopped instance is not destroyed | ✅ |
| 30 | vue-error-drag.test: given_LiquidElement_with_drag_false_present_or_absent_when_mounted_then_observe_gets_drag_false_true_or_no_key_and_no_drag_attribute | D85-3 Boolean prop, RF5 | ❌ observe got undefined; `drag` rendered as an attribute | ✅ |
| 31 | vue-error-drag.test: given_LiquidElement_with_a_reactive_drag_false_changed_to_true_after_mount_then_observe_ran_once_with_drag_false | D85-3 captured once, RF5 | ❌ observe got undefined | ✅ |
| 32 | options.test: given_option_whitelist_when_read_then_equals_spec_section_5_plus_internal_hooks (approved-test change: `onError`) | D85-1 whitelist | ❌ onError missing from OPTION_KEYS | ✅ |
| 33 | react-adapter.test: given_adapter_index_when_imported_then_exports_are_kept (approved-test change: `useLiquidError`) | D85-2 export | ✅ passes (guard; the stub is exported) | ✅ |
| 34 | vue-adapter.test: given_adapter_index_when_imported_then_exports_are_kept (approved-test change: `LiquidErrorKey`, `useLiquidError`) | D85-2 exports | ✅ passes (guard; the stubs are exported) | ✅ |
| 35 | api-migration.test: given_api_migration_type_fixture_when_tsc_checks_it_then_exit_code_0 (approved-test change: `onError`, `drag`, the error hooks) | D85-1 … D85-3 types | ✅ passes (guard; the types are red scaffolding) | ✅ |
| 36 | e2e-harness.test: given_e2e_spec_files_when_routed_then_dist_project_runs_only_the_dist_spec_on_its_own_port_and_is_blocking (approved-test change: the build script, the Vue port and root) | D85-5 harness | ❌ the old `e2e:dist:build` string | ✅ |
| 37 | workspace-publish.test: changeset_config_matches_spec (approved-test change: the Vue example ignored) | D85-5 changesets | ❌ ignore lacks "liquiddom-vue-example" | ✅ |
| 38 | workspace-publish.test: given_example_vue_package_when_read_then_it_is_private_with_star_liquiddom_deps_the_root_vue_and_vite_and_no_vue_plugin_D85_5 | D85-5 no dependency | ❌ ENOENT examples/vue/package.json | ✅ |
| 39 | cargo area_hint_tests: given_a_core_built_without_a_hint_when_set_area_hint_runs_after_0_1_or_5_empty_frames_then_120_frames_with_a_splash_are_bit_identical_to_a_hinted_constructor | D85-4 bit-identity (W85.0 Q2), RF3 | ❌ "k = 0: generation 0" (the stub returns false) | ✅ |
| 40 | cargo area_hint_tests: given_a_core_that_redistributed_when_set_area_hint_runs_then_it_returns_false_and_changes_nothing | D85-4 generation rule, RF3 | ✅ passes (guard; the stub returns false) | ✅ |
| 41 | cargo area_hint_tests: given_non_finite_or_non_positive_input_when_set_area_hint_runs_then_the_grid_equals_the_constructors_for_the_same_input | D85-4 sanitising | ❌ "area NaN, tallest NaN" (false) | ✅ |
| 42 | cargo area_hint_tests: given_a_world_grown_by_resize_world_and_a_viewport_when_set_area_hint_runs_then_the_grid_covers_the_grown_world_and_the_viewport_is_kept | D85-4 world and viewport | ❌ the stub returns false | ✅ |
| 43 | cargo area_hint_tests: given_a_scroll_before_the_first_batch_when_set_area_hint_runs_then_the_lattice_and_120_frames_with_a_splash_match_a_hinted_core_with_the_same_scroll_history | design resolution 6 | ❌ the stub returns false | ✅ |
| 44 | e2e dist (dist): given the React example built against the published core dist when served by vite preview then create() resolves, canvas.liquid-canvas exists, the wasm is fetched and no console error occurs (approved-test change: the `drag={false}` pill) | D85-5, RF5 | ❌ `[data-liquid-drag="off"]`: 0 | ✅ React dist: 2 pills, one `data-liquid-drag="off"`, no `[drag]` attribute |
| 45 | e2e dist (dist): W85 – the Vue example (D85-5) › given the Vue example built against the published core and @liquiddom/vue dist when served by vite preview then create() resolves, one canvas.liquid-canvas, two observed pills (one drag off), the wasm is application/wasm and no console error occurs | D85-5, RF5 | ❌ missing examples/vue/dist/index.html | ✅ Vue dist (:4175): ready, one canvas, 2 pills, one `drag="off"`, no alert |
| 46 | on-error.test: given_a_canvas2d_rebuild_that_fails_after_destroy_when_it_settles_then_onError_is_never_called_and_nothing_is_logged | D85-1 never after destroy(), RF1 (review M2) | ✅ passes (guard) | ✅ |
| 47 | vue-error-drag.test: given_an_instance_that_stops_while_create_awaits_the_renderer_when_create_resolves_then_the_provider_destroys_it_on_arrival_and_holds_the_error | design resolution 11 in Vue, RF4 (review M4) | ❌ useLiquidError() null (stub) | ✅ |
| 48 | area-hint-runtime.test: given_a_stopped_instance_when_an_element_is_observed_or_unobserved_again_then_its_batch_calls_no_core_method | review M7, RF3 | ❌ "a stopped core is never called": ["redistribute"] | ✅ |

### Gold run (2026-10-22)

cargo `245 passed; 0 failed; 1 ignored`; vitest `833 passed (833)`, 84 files (the slow `workspace-publish`/`runtime-truth` tests timed out once under the parallel run and passed alone, 29/29); clippy and `cargo fmt --check` clean; `e2e:typecheck` clean; the gate tests 47/47. `npm run e2e:dist` 2/2 (rows 44, 45: both examples from the published dist). macOS `--project=canvas2d` 87 passed, 15 skipped (the Linux-only visual specs; the scenes created without candidates take the hinted cell and keep their bounds). `npm run e2e:webgpu-hw` (Metal) 55 passed, 44 skipped, 0 failed. Docker (pinned linux/amd64 image, no `--update-snapshots`) `--project=canvas2d` 100 passed, 2 skipped; `e2e/__screenshots__` untouched. `package-lock.json` +16 lines (the `examples/vue` workspace link only). CONTEXT.md 8186 B. Vision (W85.4, seen by Dennis 2026-10-22): both examples at rest crisp; a splash ragged at the hinted 4 px cell (Canvas2D: the DOM label over its halo; WebGPU: the atlas text rides); the `useLiquidRef` pill dragged with the home spot empty (Canvas2D hides its label); the `drag={false}` pill holds; a forced stop (devtools `getBoundingClientRect` override) removes the canvas, restores plain buttons and shows "Liquid stopped: forced stop" with one `console.error`, in React and Vue. The first stills recorded under `'auto'` were WebGPU (the browser had an adapter); Canvas2D was re-shot with WebGPU disabled. The 404 on every preview load was the missing favicon: both examples now carry an inline SVG icon.

Task reviews: W85.2 (approved; m1 the "bit-identical" wording: a hinted core rounds a half-cell scroll step away from zero, so its origin can sit one cell apart: worded in the Specification, the Rust docs, CLAUDE.md and the spec; the Decision line's wording goes to Dennis at gold), W85.3 (approved; Vue's create handlers as a `then` pair and twin notes fixed in 0a8471f; React keeps two `setState` calls because the approved W66 `provider-cleanup.test.tsx` pins them: under `createRoot` one render, under the legacy root one render with both null, in the React README). Ward review: NOT READY on docs only → 0 Critical, 1 Important (I1 the spec and CONTEXT omitted the `set_area_hint` stop: fixed), Minors: m1 the spec's half-cell caveat (fixed), m2 the over-budget slack in CLAUDE.md and the spec (fixed), m5 `onError` before `create()` resolves in the core README (fixed); m3 Vue has no twin of React's row 20 (a non-function `config.onError`; a new test needs Dennis), m4 a falsy thrown value reads as no error (parked). Smoke: pending (Dennis).

Approved-test changes at red (Dennis approves with the tests): `options.test.ts` (the whitelist gains `onError`, row 32), `react-adapter.test.tsx` and `vue-adapter.test.ts` (the export lists gain `useLiquidError` and, in Vue, `LiquidErrorKey`; rows 33, 34), `__fixtures__/api-migration-types/index.ts` (`onError`, the `drag` prop and both error hooks type-check, a non-function `onError` and a non-boolean `drag` do not, `useLiquid()` keeps its type; row 35), `e2e-harness.test.ts` (the `e2e:dist:build` string and the Vue port and root; row 36), `workspace-publish.test.ts` (changesets ignores the Vue example, row 37; a new test for the Vue example's package, row 38) and `e2e/dist.spec.ts` (the React smoke checks the `drag={false}` pill, row 44). `ci-workflow.test.ts` needs no change: the dist steps keep their commands.

## Must NOT
- Change the FFI layout, the strides or the 7-arg constructor.
- Change the liquid of a core built with an area hint (`autoObserve` with candidates): bit-identical to W84; move a Linux baseline without Dennis' vision approval.
- Re-create a stopped instance automatically, or call `onError` more than once per instance or after `destroy()`.
- Spread adapter-only props (`as`, `viscosity`, `recovery`, `drag`) onto the DOM.
- Add a dependency for the Vue example (no `@vitejs/plugin-vue`, no new lock package).
- Put a test hook into a published package; change an approved test without Dennis' approval.

## Must DO
- Report every stop path once, after its cleanup and its `console.error`; keep each stop's message.
- Keep `useLiquid()`'s type in both adapters; chain, never replace, the author's `config.onError`.
- Call `set_area_hint` at most once per instance and only before the first redistribute that places area.
- Smoke both examples from the built `dist`, with the `drag={false}` pill.

## Manual Smoke Test
### Setup
`npm run e2e:dist:build`, then `npm run preview -w liquiddom-react-example` and, after stopping it, `npm run preview -w liquiddom-vue-example` (each prints its URL). Chrome with devtools.

### Steps
1. Open the React example. Two pills with liquid; click each (a splash); drag the first with the mouse, then try the second (`drag={false}`).
   Verify: the first pill's liquid follows the pointer and flows home; the second does not move; no console error.
2. Open the Vue example and repeat step 1.
   Verify: the same.
3. In each example, run in the devtools console: `document.querySelector(".liquid-element").getBoundingClientRect = () => { throw new Error("forced stop") }`.
   Verify: the console shows one `[liquiddom] frame failed…` error; the liquid and the canvas disappear, both pills are plain buttons again, and the page shows `Liquid stopped: forced stop`. Reloading the page brings the liquid back.
4. Look at a splash in motion in either example.
   Verify: the liquid is the finer, more ragged one of the acceptance scene (the hinted cell), not the smoother 8 px one of W84; it looks right at rest.

### Pass criteria
- [ ] Both examples show the liquid and no console error until the forced stop.
- [ ] `drag={false}` holds in both.
- [ ] The forced stop restores the pills and shows the error line in both; nothing retries.
- [ ] The splash looks right at the hinted resolution.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:dist` (both examples), `npm run e2e:webgpu-hw`, `npm run e2e:docker -- --project=canvas2d` (every Linux baseline unchanged, no `--update-snapshots`), vision on both examples (W85.4), Dennis' smoke.
