---
ward: 66
revision: null
name: "Public API swap and soft-body retirement"
epic: "fluid-engine"
status: "approved"
dependencies: [65, 62]
layer: "both"
estimated_tests: 154
created: "2026-10-03"
completed: null
---
# Ward 066: Public API swap and soft-body retirement

North star: steps 1 and 8 (reduced motion + print) through the public `LiquidDOM.create()` API, with focus-ring groundwork for step 4. The soft-body engine is retired (spec D4).

## Prerequisites (human STOP)
- Dennis completes or closes **W62** (currently `gold`) via `wdd`, because this ward deletes its code (`webgpu-freedrop-sdf`, the SDF shaders). `dependencies: [65, 62]` makes `wdd ready` wait for it.
- Dennis closes **W50** (Web Worker offload, `planned`) via `wdd` as moot (spec §7). The form of the closure is his call.

## Scope
Put the public facade `LiquidDOM.create()` on top of `createFluidRuntime()`:
- options validated by a whitelist, with migration hints;
- the injected stylesheet with stacking, print and forced-colors rules;
- the colour snapshot taken before the class is applied, and `refresh(el)`;
- pause, resume and visibility handling;
- renderer selection (`auto` → Canvas2D until slice 3);
- `autoObserve` / `autoDiscover`.

Then retire the soft-body engine completely: Rust modules, `PhantomObserver`, `WasmBridge`, box-shadow, the old renderers and shaders, the W61 workarounds, the W55 scroll lerp, the old scenes and their tests.

Also in this ward:
- port the React and Vue adapters and `examples/react`;
- freeze the site (out of the workspaces, vitest projects and deploy);
- switch versioning to the `0.3.0-alpha` line;
- add the a11y e2e specs.

## Inputs
- W64 runtime, W65 harness (print spec `fixme` → un-fixme here).
- Spec §1 (retirement), §4 (DOM/a11y), §5 (API, old→new table), versioning as amended (`6963d7d`).
- Resolutions A1–A5, B5, B9–B11, B13, C3, C4, C7, D3, E.

## Outputs
- `packages/core/ts/src/{options,stylesheet}.ts`, plus `validateMaterial` in `material.ts`, `index.ts` rewritten as the facade, and `renderers/webgpu-renderer.ts` stripped to infrastructure.
- Deleted:
  - `src/{api,buffer,entity,math,physics}.rs` (`src/lib.rs` becomes `pub mod fluid;`);
  - `phantom-observer.ts`, `wasm-bridge.ts`, `box-shadow.ts`, `renderers/renderer.ts`, `renderers/canvas2d-renderer.ts`, `renderers/shaders/*`;
  - the old tests listed in the plan;
  - `demo/main.ts` and the old scenes.
- Tests: `options.test.ts`, `stylesheet.test.ts`, `api-migration.test.ts`, the type fixture `__fixtures__/api-migration-types/`, `e2e/a11y.spec.ts`. Rewritten tests: `liquiddom-api`, `multi-instance`, `auto-renderer`, `runtime-truth`, `renderer-abstraction`, `gravity`, `webgpu-renderer` (retargeted to `renderers/frame.ts`), `border-radius` (slot[8] block deleted).
- `demo/vite.config.ts` alias `liquiddom → packages/core/ts/src/index.ts`; `demo/index.html` scene index.
- Adapters: React/Vue sources, tests, READMEs, `examples/react` (deps `"*"`).
- `package.json` workspaces `["packages/*","examples/*"]`, the site override removed, `@axe-core/playwright`, a regenerated lock; `vitest.config.ts` without `./site`; `deploy-site.yml` set to `workflow_dispatch` only.
- `.changeset/config.json` (fixed group, `onlyUpdatePeerDependentsWhenOutOfRange`), `.changeset/pre.json`, `.changeset/fluid-engine-alpha.md`. Package versions `0.3.0-alpha.0`, peers `^0.3.0-alpha.0`.
- CLAUDE.md: the soft-body architecture sections are replaced by the fluid architecture.

## Decisions
### D66-1: Removed and unknown options throw TypeError naming the replacement
Proposal: `resolveOptions` is a whitelist. Removed and unknown options throw `TypeError`, and a removed option's message names its replacement. The removed options are `capacity`, `physics`, `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex` and `maxDt`. The whitelist also holds three undocumented `@internal` hooks: `testBackend`, `loader` and `clock`.
Consequence: 0.2 configs fail loudly at `create()` instead of being silently ignored.
Decision: APPROVED 2026-10-04 — `resolveOptions` whitelist; removed (`capacity`, `physics`, `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex`, `maxDt`) and unknown options throw `TypeError` naming the replacement; `testBackend`, `loader`, `clock` kept as undocumented `@internal` hooks (saga dec_49026e5f)

### D66-2: auto means Canvas2D until slice 3
Proposal: `renderer: 'auto'` means Canvas2D and never probes WebGPU. `'webgpu'` gives an infra-only WebGPU renderer that only clears the canvas, plus one `console.warn` per instance. `isFallbackAdapter` handling moves to slice 3. `silentFallback` is only validated in slices 1–2 (B13), because there is no fallback log to silence.
Consequence: `activeRenderer` is always `'canvas2d'` unless the caller forces `'webgpu'`, in which case nothing is drawn.
Decision: APPROVED 2026-10-04 — `renderer: 'auto'` = Canvas2D without probing WebGPU; `'webgpu'` = infra-only clear-only renderer plus one `console.warn` per instance; `isFallbackAdapter` moves to slice 3; `silentFallback` only validated in slices 1–2 (B13) (saga dec_a6c048ad)

### D66-3: Stacking via the data-liquid-stack attribute
Proposal: Stacking uses `data-liquid-stack="relative" | "z"`, decided once at `observe()` from the computed `position`/`z-index`: static → `relative` (`position: relative; z-index: 1`), positioned with `z-index: auto` → `z` (`z-index: 1`), explicit z-index → untouched. There are no inline style writes, and `unobserve()` restores the element exactly.
Consequence: A later change to the element's position is not re-evaluated until it is re-observed.
Decision: APPROVED 2026-10-04 — stacking via `data-liquid-stack="relative" | "z"` decided once at `observe()` (static → `relative`, positioned with `z-index: auto` → `z`, explicit z-index untouched), no inline style writes, `unobserve()` restores exactly (saga dec_a225efa1)

### D66-4: Adapter element options are flat props
Proposal: The flat props `viscosity` and `recovery`, captured at first attach. React captures them in a `useRef`; Vue captures them in `setup`.
Consequence: Changing the prop after mount has no effect until the element is remounted. This matches the old `liquidType` semantics. The prop types keep their names but change shape (B10).
Decision: APPROVED 2026-10-04 — adapter element options are flat props `viscosity` and `recovery`, captured at first attach (React `useRef`, Vue `setup`); later changes have no effect until remount (saga dec_9942525f)

### D66-5: The old instance getters and types are removed, with a complete mapping
Proposal: Drop `isReducedMotion`, `isScrolling` and `pointerActive`. The full B10 mapping (`LiquidPhysicsConfig`, the old `SplashOptions`, `UseLiquidRefOptions`, `LiquidElementProps`) is asserted at runtime by `api-migration.test.ts` and at type level by the D66-11 fixture. The demo scenes reach element state and the core only through an internal `runtimeOf(instance)` WeakMap in `internal.ts`, never exported from `index.ts`; the scenes import it by relative source path.
Consequence: Consumers can no longer read the reduced-motion state or element state from the instance.
Decision: APPROVED 2026-10-04 — drop `isReducedMotion`, `isScrolling`, `pointerActive`; full B10 mapping asserted by `api-migration.test.ts` and the D66-11 fixture; demo scenes use an internal `runtimeOf(instance)` WeakMap in `internal.ts`, never exported from `index.ts` (saga dec_9e687208)

### D66-6: Capacity bounds
Proposal: `particles` is an integer in [256, 65536]. `maxElements` is an integer in [1, 256]. Anything else is a `TypeError`.
Consequence: `particles: 100` throws.
Decision: APPROVED 2026-10-04 — `particles` integer in [256, 65536], `maxElements` integer in [1, 256], anything else is a `TypeError` (saga dec_20f0ebc2)

### D66-7: The default seed is a random u32
Proposal: When `seed` is omitted it is a random u32 from `crypto.getRandomValues`, falling back to `Math.random`.
Consequence: Runs are not reproducible unless the caller passes `seed`. The scene always passes one.
Decision: APPROVED 2026-10-04 — omitted `seed` is a random u32 from `crypto.getRandomValues`, falling back to `Math.random` (saga dec_85afadab)

### D66-8: validateMaterial lands here [BOUNDARY]
Proposal: `validateMaterial` (@internal) lands here and throws `TypeError` on NaN or out-of-range values: viscosity and cohesion in [0, 1], recovery in [0.2, 3] s. W64 created `Material`/`DEFAULT_MATERIAL` (A5).
Consequence: `resolveOptions` and the later `setMaterial` (W68) share one validator.
Decision: APPROVED 2026-10-04 — `validateMaterial` (@internal) throws `TypeError` on NaN or out-of-range values (viscosity and cohesion in [0, 1], recovery in [0.2, 3] s), shared by `resolveOptions` and later `setMaterial` (W68) (saga dec_b90481c1)

### D66-9: Versioning per the amended spec
Proposal: Hand-set the three packages to `0.3.0-alpha.0`; peers become `^0.3.0-alpha.0`; `examples/react` deps become `"*"`. `.changeset/config.json` gets `fixed: [["liquiddom","@liquiddom/react","@liquiddom/vue"]]` and `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true`. Run `changeset pre enter alpha`, then add minor changesets; the release plan is expected to give `0.3.0-alpha.1` (simulated 2026-10-03). The core build first deletes `packages/core/dist` and core's tsbuildinfo (`packages/tsconfig.build.tsbuildinfo`).
Consequence: Every `changeset` command prints a harmless red "must depend on the current version … vs `*`" line for the ignored example. Every core build is a full build (a few seconds). Without the clean step, deleted soft-body `.js` files would stay in `dist/` and ship in the tarball. The fate of the published `0.2.0-rc.0` stays open (§7).
Decision: APPROVED 2026-10-04 — three packages hand-set to `0.3.0-alpha.0`, peers `^0.3.0-alpha.0`, example deps `"*"`, changeset `fixed` group plus `onlyUpdatePeerDependentsWhenOutOfRange`, `changeset pre enter alpha` with minor changesets giving `0.3.0-alpha.1`, core build cleans `packages/core/dist` and core's tsbuildinfo first (saga dec_91b80476)

### D66-10: Errors after capacity and after destroy
Proposal: `observe` beyond `maxElements` throws `RangeError`. When there are more `[data-liquid]` elements than slots, `autoObserve` and `autoDiscover` log one `console.warn` and skip the extras instead of throwing. After `destroy()`, every method throws `Error` except `unobserve`/`destroy`, which are silent no-ops; getters stay readable. `refresh(el)` on an unobserved element is a no-op.
Consequence: Matches the old API's lifecycle strictness, and StrictMode double-unmounts stay quiet.
Decision: APPROVED 2026-10-04 — `observe` beyond `maxElements` throws `RangeError`; `autoObserve`/`autoDiscover` warn once and skip extras; after `destroy()` every method throws `Error` except silent no-op `unobserve`/`destroy`, getters stay readable; `refresh(el)` on an unobserved element is a no-op (saga dec_e82c98e2)

### D66-11: Type-level absence is checked by a tsc fixture
Proposal: The fixture lives at `__fixtures__/api-migration-types/` in the repo root, next to the existing `__fixtures__/types-smoke` (A3); W63's draft said `packages/core/ts/__tests__/__fixtures__/`, and W67 and W68 edit the root path. It holds one `@ts-expect-error` line per removed 0.2 type, member and option, plus compiling 0.3 lines. `api-migration.test.ts` checks it with `npx tsc --noEmit -p`; an unused `@ts-expect-error` is a failure.
Consequence: The test needs `npm run build` (the `dist/*.d.ts` of all three packages) and costs about 10–20 s. It is the only place type-level removals are enforced, because vitest does not type-check.
Decision: APPROVED 2026-10-04 — tsc fixture at root `__fixtures__/api-migration-types/` with one `@ts-expect-error` per removed 0.2 type, member and option plus compiling 0.3 lines, checked by `api-migration.test.ts` via `npx tsc --noEmit -p` (saga dec_3a584830)

### D66-12: Known regression documented
Proposal: Two 0.2 → 0.3 behaviour changes, both documented in the changeset: (1) the per-element MutationObserver colour auto-refresh (W52/W54) is gone until slice 4, so colour changes need `refresh(el)`, and the `SplashOptions` shape change (B9) is called out too; (2) the user pause and the hidden-tab pause are tracked separately (`LoopController`), and `isPaused` is `user || hidden`.
Consequence: An honest alpha changelog. A tab becoming visible again does not undo an explicit `pause()`; the old code did undo it.
Decision: APPROVED 2026-10-04 — changeset documents two 0.2 → 0.3 changes: no MutationObserver colour auto-refresh until slice 4 (use `refresh(el)`; `SplashOptions` shape change B9), and separate user and hidden-tab pause sources (`LoopController`, `isPaused` is `user || hidden`) (saga dec_8393ca6e)

### D66-13: The area hint comes from the autoObserve candidates
Proposal: With `autoObserve`, `LiquidDOM.create` passes the `[data-liquid]` candidates as `initialElements`, so the runtime's `area_hint` (D64-1) is the sum of their rounded-rect areas. With `autoObserve: false`, or with no candidates, the hint is 0, which gives the default 8 px cell (B5).
Consequence: The acceptance scene keeps the cell size it had in W64/W65, so the step-1 baseline does not move for this reason. Elements observed later through `observe()` do not change the cell size until the slice-6 reallocation.
Decision: APPROVED 2026-10-04 — with `autoObserve`, the `[data-liquid]` candidates are passed as `initialElements` so `area_hint` is the sum of their rounded-rect areas; with `autoObserve: false` or no candidates the hint is 0 (default 8 px cell) (saga dec_4189fd3e)

### D66-14: Resolved options carry a full Material
Proposal: `resolveOptions` merges the partial `material` option over `DEFAULT_MATERIAL` into a fresh, complete `Material`, never the frozen default object. `ResolvedOptions.material` is `Material`, not `Partial`, and the runtime always receives that complete Material (B11).
Consequence: `material: { cohesion: 0.9 }` means viscosity 0.5 and recovery 0.7. There is no "unset" material, and W68's `getMaterial()` returns a full object.
Decision: APPROVED 2026-10-04 — `resolveOptions` merges partial `material` over `DEFAULT_MATERIAL` into a fresh complete `Material` (never the frozen default); `ResolvedOptions.material` is `Material`, not `Partial` (saga dec_1e47c536)

### D66-15: Injected CSS in @layer liquiddom with !important, checked by two axe passes
Proposal: The paint-neutralising and stacking declarations live in `@layer liquiddom` with `!important`, so they beat author rules, `:hover` and inline styles; `@media print, (forced-colors: active)` hides the canvas (`display: none !important`) and neutralises both classes with `revert-layer !important`; axe runs on screen with WCAG 2.1 A/AA and `color-contrast` disabled, then under print media with `color-contrast` only (spec §4 "contrast identical to the original").
Consequence: Needs `revert-layer` (Chrome 99, Firefox 97, Safari 15.4); jsdom ignores layers, so jsdom tests assert the CSS text and Playwright asserts the behaviour.
Decision: AMENDED 2026-10-04 — injected CSS in `@layer liquiddom` with `!important`, its paint and stacking rules scoped to `@media screen and (forced-colors: none)` (no `revert-layer`: in Chromium it reverts to the UA default, not the author background, found in W66.6); `@media print, (forced-colors: active)` hides the canvas; two axe passes as approved (saga dec_d05913c9)

## Specification
- **Public API** (spec §5):
  - `LiquidDOM.create({ particles = 8000, maxElements = 32, container, renderer = 'auto', material, gravity, seed, autoObserve = true, forceReducedMotion = false, silentFallback = false })`;
  - `observe(el, { viscosity?, recovery? })`, `unobserve`, `refresh`, `pause`, `resume`, `destroy`, `requestOrientationPermission`, `autoDiscover`, `stopAutoDiscover`;
  - getters `isPaused`, `activeRenderer`, `particleCapacity`, `elementCapacity`.

  `splash`, `shake`, `setMaterial` and `getMaterial` arrive in W67/W68.
- **Export whitelist:** `LiquidDOM`, `WebGPUUnavailableError`, `LiquidWasmLoadError`, `validateMaterial` (`@internal`), and the types `LiquidOptions`, `LiquidDOMInstance`, `ElementOptions`, `Material`, `GravityOptions`.
- **Gravity:** accepted and validated, but `tick` receives `(0, 0)` until slice 6. The effect tests are `it.skip("slice 6 ward: …")`.
- **Stylesheet:** one `<style id="liquiddom-styles">` per document, refcounted and removed on the last `destroy()`.
  - `.liquid-element { background: transparent; border-color: transparent; box-shadow: none; }`, plus the `data-liquid-stack` rules.
  - `.liquid-text { color: transparent; }` (unused until slice 4).
  - `@media (forced-colors: active)` and `@media print`: `canvas.liquid-canvas { display: none !important }`, and both classes neutralised with `!important`.
- **Colour:** `snapshotColors` runs before `liquid-element` is added. `refresh(el)` removes the class, re-reads and re-adds it. A transparent background → `DEFAULT_LIQUID_COLOR`.
- **Visibility:** a `visibilitychange` to hidden pauses; visible resumes, unless the user called `pause()`.
- **Retirement:** after this ward, `git grep -nE "PhantomObserver|liquid_type|FLOATS_PER_ENTITY|instance-panic|wasmCallInFlight" -- src packages demo examples` returns nothing.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | given_no_options_when_resolved_then_defaults_8000_particles_32_elements_auto_material_defaults_gravity_none | defaults (C4) (options/material validation) |
| 2 | given_seed_omitted_when_resolved_repeatedly_then_each_seed_is_a_u32_and_not_all_equal | D66-7 seed (options/material validation) |
| 3 | given_explicit_seed_when_resolved_then_kept_and_invalid_seed_TypeError | D66-7 seed (options/material validation) |
| 4 | given_non_integer_or_out_of_range_particles_or_maxElements_when_resolved_then_TypeError | D66-6 capacities (options/material validation) |
| 5 | given_removed_option_capacity_physics_colorDefault_colorHover_colorSource_theme_refraction_preserveBackgrounds_snapDurationMs_canvasZIndex_maxDt_when_resolved_then_TypeError_naming_replacement | D66-1 removed options (options/material validation) |
| 6 | given_unknown_option_when_resolved_then_TypeError | D66-1 whitelist (options/material validation) |
| 7 | given_material_out_of_range_or_nan_when_resolved_then_TypeError | D66-8/D66-14 material (options/material validation) |
| 8 | given_gravity_options_when_resolved_then_validated_and_accepted | gravity validation (options/material validation) |
| 9 | given_renderer_option_when_resolved_then_only_auto_webgpu_canvas2d_accepted | D66-2 (options/material validation) |
| 10 | given_boolean_options_when_non_boolean_then_TypeError_and_silentFallback_is_validated_only | B13 (options/material validation) |
| 11 | given_container_testBackend_loader_or_clock_of_wrong_shape_when_resolved_then_TypeError | internal hooks (D66-1) (options/material validation) |
| 12 | given_option_whitelist_when_read_then_equals_spec_section_5_plus_internal_hooks | D66-1 whitelist (options/material validation) |
| 13 | given_valid_partial_when_validated_then_no_throw_and_input_not_mutated | options/material validation |
| 14 | given_non_object_or_unknown_key_when_validated_then_TypeError | options/material validation |
| 15 | given_element_options_out_of_range_nan_or_unknown_when_validated_then_TypeError | C3 element options (options/material validation) |
| 16 | given_two_instances_when_created_then_one_style_element_per_document | D66-15 stylesheet (injected stylesheet and stacking) |
| 17 | given_last_instance_destroyed_when_destroying_then_style_element_removed | D66-15 stylesheet (injected stylesheet and stacking) |
| 18 | given_style_element_removed_externally_when_next_acquire_then_reinserted_and_refcount_kept | D66-15 stylesheet (injected stylesheet and stacking) |
| 19 | given_css_text_when_read_then_print_and_forced_colors_hide_canvas_and_neutralise_classes_with_important | D66-3 colour snapshot (injected stylesheet and stacking) |
| 20 | given_stackingFor_table_when_evaluated_then_static_relative_auto_z_else_null | D66-3 stacking (injected stylesheet and stacking) |
| 21 | given_static_element_when_observed_then_class_and_stack_relative_z1 | D66-3 stacking (injected stylesheet and stacking) |
| 22 | given_positioned_element_with_z_auto_when_observed_then_only_z1 | injected stylesheet and stacking (D66-3, D66-15) |
| 23 | given_positioned_element_with_explicit_z_when_observed_then_stacking_untouched | D66-3 stacking (injected stylesheet and stacking) |
| 24 | given_static_element_with_explicit_z_index_when_observed_then_relative_because_z_index_is_inert_on_static_and_no_inline_write | injected stylesheet and stacking (D66-3, D66-15) |
| 25 | given_unobserve_when_called_then_element_class_and_attr_exactly_restored | D66-3 stacking (injected stylesheet and stacking) |
| 26 | given_canvas_when_mounted_then_aria_hidden_true_pointer_events_none_fixed_z0_last_in_body | canvas mount (D64-10) (injected stylesheet and stacking) |
| 27 | given_container_mode_when_mounted_then_canvas_inside_container | canvas mount (D64-10) (injected stylesheet and stacking) |
| 28 | given_element_with_background_when_observed_then_color_snapshotted_before_class | D66-3 colour snapshot (injected stylesheet and stacking) |
| 29 | given_refresh_when_called_then_class_temporarily_removed_and_colors_reread | D66-3 colour snapshot (injected stylesheet and stacking) |
| 30 | given_transparent_background_when_observed_then_default_liquid_color | D66-3 colour snapshot (injected stylesheet and stacking) |
| 31 | given_class_present_when_snapshotColorsWithout_then_reads_original_colour_and_restores_class | D66-3 colour snapshot (colour snapshot with class lifted) |
| 32 | given_class_absent_when_snapshotColorsWithout_then_equals_snapshotColors_and_class_not_added | D66-3 colour snapshot (colour snapshot with class lifted) |
| 33 | given_started_loop_when_clock_advances_3_then_onFrame_runs_3_times | loop control (D66-12) |
| 34 | given_paused_when_advancing_then_no_frames_and_resume_restarts | D66-12 pause (loop control) |
| 35 | given_hidden_document_when_visibilitychange_then_paused_until_visible | D66-12 pause (loop control) |
| 36 | given_user_paused_when_tab_becomes_visible_then_still_paused | D66-12 pause (loop control) |
| 37 | given_pause_then_hidden_then_resume_while_hidden_when_advancing_then_still_paused_until_visible_D66_12 | D66-12 pause [D66-12] (loop control) |
| 38 | given_destroyed_when_advancing_then_no_frames_listener_removed_and_idempotent | D66-10 destroy (loop control) |
| 39 | given_runtime_when_created_then_canvas_has_liquid_canvas_class_aria_hidden_and_styles_injected | D66-12 pause (runtime additions) |
| 40 | given_renderer_init_failure_when_creating_runtime_then_canvas_removed_and_core_freed | runtime additions (D66-2, D66-12) |
| 41 | given_runtime_pause_when_frames_advance_then_no_tick_until_resume | D66-12 pause (runtime additions) |
| 42 | given_webgpu_renderer_when_typed_then_satisfies_frame_Renderer_contract_and_error_is_reexported | infra-only WebGPU renderer (D66-2) |
| 43 | given_navigator_gpu_missing_when_init_then_WebGPUUnavailableError | infra-only WebGPU renderer (D66-2) |
| 44 | given_requestAdapter_null_or_throwing_when_init_then_WebGPUUnavailableError_with_cause | infra-only WebGPU renderer (D66-2) |
| 45 | given_requestDevice_rejects_when_init_then_WebGPUUnavailableError_with_cause | infra-only WebGPU renderer (D66-2) |
| 46 | given_getContext_webgpu_null_when_init_then_WebGPUUnavailableError_and_device_destroyed | D66-10 destroy (infra-only WebGPU renderer) |
| 47 | given_successful_init_when_configured_then_alphaMode_premultiplied_and_no_shader_or_pipeline_created | infra-only WebGPU renderer (D66-2) |
| 48 | given_initialised_renderer_when_render_then_one_clear_pass_transparent_and_submitted | infra-only WebGPU renderer (D66-2) |
| 49 | given_device_lost_when_rendering_then_one_console_warn_and_render_noop | infra-only WebGPU renderer (D66-2) |
| 50 | given_destroy_when_called_before_init_after_failure_and_twice_then_no_throw_and_device_destroyed_once | D66-10 destroy (infra-only WebGPU renderer) |
| 51 | given_both_renderers_when_typed_then_satisfy_frame_Renderer_init_render_resize_destroy | D66-10 destroy (single Renderer contract and retirement) |
| 52 | given_soft_body_renderer_modules_when_checked_then_deleted | retirement (single Renderer contract and retirement) |
| 53 | given_selectRenderer_auto_or_canvas2d_when_called_then_FluidCanvas2DRenderer_active_canvas2d | single Renderer contract and retirement (D66-2, D64-5) |
| 54 | given_selectRenderer_canvas2d_with_null_2d_context_when_called_then_rejects_D64_5 | single Renderer contract and retirement (D66-2, D64-5) |
| 55 | given_renderer_auto_when_create_then_activeRenderer_canvas2d_and_webgpu_never_probed | renderer selection (D66-2) |
| 56 | given_renderer_omitted_or_canvas2d_when_create_then_activeRenderer_canvas2d | renderer selection (D66-2) |
| 57 | given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError_and_nothing_left_behind | renderer selection (D66-2) |
| 58 | given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_and_one_console_warn | renderer selection (D66-2) |
| 59 | given_webgpu_renderer_when_frames_run_then_still_one_warn_per_instance_and_second_instance_adds_one | renderer selection (D66-2) |
| 60 | given_webgpu_init_bug_that_is_not_unavailable_when_create_then_rejects_with_that_error | renderer selection (D66-2) |
| 61 | given_silentFallback_true_or_false_when_create_with_auto_then_validated_and_no_console_info_B13 | B13 [B13] (renderer selection) |
| 62 | given_testBackend_when_create_then_instance_with_particleCapacity_and_elementCapacity | public facade |
| 63 | given_wasm_load_failure_without_testBackend_when_create_then_rejects_LiquidWasmLoadError | LiquidWasmLoadError (public facade) |
| 64 | given_root_index_when_imported_then_export_keys_equal_whitelist | export whitelist (public facade) |
| 65 | given_maxElements_reached_when_observe_then_RangeError | D66-10 capacity (public facade) |
| 66 | given_observe_with_out_of_range_element_options_when_called_then_TypeError_and_valid_options_reach_slots_8_9 | C3 element options (public facade) |
| 67 | given_refresh_on_unobserved_element_when_called_then_noop | D66-3 colour snapshot (public facade) |
| 68 | given_autoObserve_when_create_then_data_liquid_elements_observed | autoObserve/autoDiscover (public facade) |
| 69 | given_autoObserve_candidates_when_create_then_area_hint_comes_from_their_rects_B5 | D66-13 area hint (public facade) |
| 70 | given_seed_and_material_options_when_create_then_reach_the_core_D66_7_D66_14 | D66-7 seed [D66-7, D66-14] (public facade) |
| 71 | given_maxElements_1_and_autoDiscover_when_two_data_liquid_added_then_one_warn_and_extra_skipped_D66_10 | autoObserve/autoDiscover [D66-10] (public facade) |
| 72 | given_more_data_liquid_elements_than_maxElements_when_create_then_extra_skipped_with_one_warn | D66-10 capacity (public facade) |
| 73 | given_autoDiscover_when_data_liquid_node_added_or_removed_then_observed_or_unobserved | autoObserve/autoDiscover (public facade) |
| 74 | given_stopAutoDiscover_when_nodes_added_then_not_observed | public facade |
| 75 | given_container_option_when_create_then_canvas_inside_container_and_autoObserve_scoped_to_it | autoObserve/autoDiscover (public facade) |
| 76 | given_pause_when_called_then_no_frames_and_isPaused_true_and_resume_restarts | D66-12 pause (public facade) |
| 77 | given_hidden_tab_when_visibilitychange_then_paused_and_resumed | D66-12 pause (public facade) |
| 78 | given_user_pause_when_tab_becomes_visible_again_then_stays_paused_D66_12 | D66-12 pause [D66-12] (public facade) |
| 79 | given_destroy_when_called_twice_then_idempotent_and_methods_throw_after | D66-10 destroy (public facade) |
| 80 | given_two_instances_created_in_one_task_when_resolved_then_two_canvases_two_cores_one_stylesheet | D66-15 stylesheet (multi-instance facade, stylesheet refcount) |
| 81 | given_two_instances_when_one_destroyed_then_other_keeps_ticking | D66-10 destroy (multi-instance facade, stylesheet refcount) |
| 82 | given_two_instances_when_destroyed_in_either_order_twice_then_idempotent_and_stylesheet_removed_after_last | D66-15 stylesheet (multi-instance facade, stylesheet refcount) |
| 83 | given_gravity_fixed_vector_when_create_then_accepted | gravity interim (gravity interim state) |
| 84 | given_gravity_source_none_default_when_create_then_no_throw | gravity interim (gravity interim state) |
| 85 | given_gravity_fixed_without_vector_when_create_then_no_throw | gravity interim (gravity interim state) |
| 86 | given_invalid_gravity_when_create_then_TypeError | gravity interim (gravity interim state) |
| 87 | given_gravity_option_when_create_then_accepted_but_tick_receives_zero_gravity | gravity interim (gravity interim state) |
| 88 | slice 6 ward: given_gravity_fixed_when_ticking_then_tick_receives_the_vector | skipped until slice 6 |
| 89 | slice 6 ward: given_orientation_event_when_ticking_then_beta_gamma_mapped_to_gx_gy | skipped until slice 6 |
| 90 | slice 6 ward: given_reduced_motion_when_ticking_then_gravity_clamped_to_zero | skipped until slice 6 |
| 91 | slice 6 ward: given_orientation_source_when_destroyed_then_deviceorientation_listener_removed | skipped until slice 6 |
| 92 | requestOrientationPermission_handles_unsupported_jsdom_default | gravity interim state (spec 6) |
| 93 | requestOrientationPermission_handles_unsupported_explicit_stub | gravity interim state (spec 6) |
| 94 | requestOrientationPermission_handles_ios_grant_and_deny | gravity interim state (spec 6) |
| 95 | given_npm_pack_when_dry_run_then_tarball_ships_wasm_binary_and_wasm_loader_but_no_soft_body_files | LiquidWasmLoadError (runtime truth) |
| 96 | given_root_export_when_imported_then_internals_are_not_leaked | export hygiene (runtime truth) |
| 97 | given_pkg_glue_when_read_then_FluidCore_exported_and_LiquidCore_gone | D66-9 dist/pkg (runtime truth) |
| 98 | given_public_create_with_testBackend_when_manual_frames_advance_then_core_tick_receives_raw_dt_in_seconds | runtime tick (runtime truth) |
| 99 | given_old_instance_members_when_inspected_then_each_fate_holds | D66-5 removed members (old to new migration) |
| 100 | given_instance_when_inspected_then_grow_tween_impulse_spawnDroplet_despawnDroplet_setPhysicsConfig_getPhysicsConfig_refreshTheme_refreshShadow_setBackgroundTexture_getBuffer_pointerX_pointerY_preserveBackgrounds_isScrollSnapping_capacity_absent | D66-3 colour snapshot (old to new migration) |
| 101 | given_instance_when_inspected_then_isReducedMotion_isScrolling_pointerActive_absent_D66_5 | D66-5 removed members [D66-5] (old to new migration) |
| 102 | given_observe_with_number_when_called_then_TypeError_mentioning_liquidType_removed | D66-1 liquidType removed (old to new migration) |
| 103 | given_old_options_when_create_then_removed_ones_reject_TypeError_naming_replacement_and_kept_ones_are_accepted | D66-1 removed options (old to new migration) |
| 104 | given_old_runtime_exports_when_imported_then_each_fate_holds | old exports (old to new migration) |
| 105 | given_index_when_imported_then_validatePhysicsConfig_absent_and_old_physics_presets_gone | export whitelist (old to new migration) |
| 106 | given_no_listener_when_running_then_no_liquiddom_instance_panic_event | instance-panic removed (old to new migration) |
| 107 | given_api_migration_type_fixture_when_tsc_checks_it_then_exit_code_0 | D66-11 type fixture (old to new migration) |
| 108 | given_soft_body_sources_when_checked_then_deleted_and_lib_rs_declares_only_fluid | retirement (old to new migration) |
| 109 | given_retired_demo_scenes_when_checked_then_deleted_and_acceptance_scene_kept | retirement (scenes) (old to new migration) |
| 110 | given_changeset_when_read_then_SplashOptions_shape_change_colour_regression_and_removed_api_are_documented_B9_E | B9, E changeset [B9] (old to new migration) |
| 111 | given_adapter_index_when_imported_then_exports_are_kept | export whitelist (React adapter) |
| 112 | provider_creates_instance_after_mount | adapter lifecycle (React adapter) |
| 113 | provider_destroys_instance_on_unmount | D66-10 destroy (React adapter) |
| 114 | useLiquidRef_observes_element_when_attached | adapter lifecycle (React adapter) |
| 115 | useLiquidRef_unobserves_on_unmount | adapter lifecycle (React adapter) |
| 116 | given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options | C3 element options (React adapter) |
| 117 | given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them | D66-4 element props (React adapter) |
| 118 | given_LiquidElement_rerendered_with_new_viscosity_when_observed_then_captured_once_D66_4 | D66-4 element props [D66-4] (React adapter) |
| 119 | useLiquid_returns_null_outside_provider | adapter lifecycle (React adapter) |
| 120 | strict_mode_tree_observes_correctly_and_is_idempotent | adapter lifecycle (React adapter) |
| 121 | liquidElement_forwards_html_attrs_and_uses_as_prop | adapter lifecycle (React adapter) |
| 122 | ssr_renderToString_does_not_throw | adapter lifecycle (React adapter) |
| 123 | given_adapter_index_when_imported_then_exports_are_kept | export whitelist (Vue adapter) |
| 124 | provider_creates_instance_after_mount | adapter lifecycle (Vue adapter) |
| 125 | provider_destroys_instance_on_unmount | D66-10 destroy (Vue adapter) |
| 126 | useLiquidRef_observes_element_when_attached | adapter lifecycle (Vue adapter) |
| 127 | useLiquidRef_unobserves_on_unmount | adapter lifecycle (Vue adapter) |
| 128 | given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options | C3 element options (Vue adapter) |
| 129 | given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them | D66-4 element props (Vue adapter) |
| 130 | given_LiquidElement_with_reactive_viscosity_changed_after_mount_then_captured_once_D66_4 | D66-4 element props [D66-4] (Vue adapter) |
| 131 | useLiquid_returns_null_outside_provider | adapter lifecycle (Vue adapter) |
| 132 | liquidElement_forwards_attrs_and_uses_as_prop | adapter lifecycle (Vue adapter) |
| 133 | ssr_renderToString_does_not_throw | adapter lifecycle (Vue adapter) |
| 134 | plugin_install_provides_instance | adapter lifecycle (Vue adapter) |
| 135 | step 8 – given print media when emulated then the liquid canvas is display none | D66-15 print/forced-colors (step 8 modes) |
| 136 | step 8 – given forced-colors active when emulated then the canvas is display none and author backgrounds are restored | D66-3 colour snapshot (step 8 modes) |
| 137 | step 8 – given an inline red background and hover on #splash when on screen then the computed background stays transparent | step 8 modes (D66-15) |
| 138 | step 8 – given the acceptance scene when axe runs then 0 violations and the canvas is aria-hidden | D66-12 pause (step 8 a11y) |
| 139 | given focus on Split via Tab when screenshotted then the focus ring is drawn above the liquid | D66-3 focus ring (step 4 groundwork) (step 8 a11y) |
| 140 | given_root_package_when_read_then_site_not_in_workspaces_and_no_site_override | site freeze (D66-9) (site freeze, versioning, pkg hygiene) |
| 141 | given_vitest_config_when_read_then_site_not_in_projects | site freeze (D66-9) (site freeze, versioning, pkg hygiene) |
| 142 | given_deploy_site_yml_when_read_then_only_workflow_dispatch | site freeze (D66-9) (site freeze, versioning, pkg hygiene) |
| 143 | given_example_react_package_when_read_then_liquiddom_deps_are_star | D66-9 example deps (site freeze, versioning, pkg hygiene) |
| 144 | given_publishable_packages_when_read_then_all_three_at_0_3_0_alpha_0_with_peers_caret_0_3_0_alpha_0 | D66-9 versioning (site freeze, versioning, pkg hygiene) |
| 145 | given_ts_sources_when_scanned_then_only_depth_1_wasm_loader_imports_pkg_via_four_level_specifier_D3 | LiquidWasmLoadError [D3] (site freeze, versioning, pkg hygiene) |
| 146 | given_core_dist_when_scanned_then_no_js_or_d_ts_references_pkg_D3 | D66-9 dist/pkg [D3] (site freeze, versioning, pkg hygiene) |
| 147 | given_core_dist_when_listed_then_no_soft_body_artifacts_remain_D66_9 | retirement [D66-9] (site freeze, versioning, pkg hygiene) |
| 148 | given_pre_json_when_read_then_mode_pre_tag_alpha_and_initial_versions_0_3_0_alpha_0 | D66-9 versioning (site freeze, versioning, pkg hygiene) |
| 149 | given_pending_changesets_when_release_plan_computed_then_all_three_bump_to_0_3_0_alpha_1 | D66-9 versioning (site freeze, versioning, pkg hygiene) |
| 150 | given_core_build_scripts_when_read_then_a_reachable_removal_call_deletes_core_dist_and_the_tsbuildinfo_before_tsc_D66_9 | D66-9 dist/pkg [D66-9] (site freeze, versioning, pkg hygiene) |
| 151 | npm_pack_dry_run_for_core_contains_only_expected_files | modified #2: dist/wasm-loader.js in tarball (D66-9) |
| 152 | adapter_packages_declare_peer_deps | modified #5: peers ^0.3.0-alpha.0 (A1, D66-9) |
| 153 | core_dist_wasm_dynamic_import_resolves_to_packaged_file | modified #8: dynamic import lives in dist/wasm-loader.js (D3) |
| 154 | changeset_config_matches_spec | modified #12: fixed group and onlyUpdatePeerDependentsWhenOutOfRange (D66-9) |

W63's planned rows are covered as follows: border-radius.test.ts keeps its 4 pure tests (A4, a deletion); W64/W65 tests are unchanged.

## Must NOT
- Start before W62 is completed or closed and W50 is closed by Dennis.
- Leave any soft-body code, test or scene reachable.
- Keep silent mock mode anywhere: jsdom tests use `testBackend` and `_fake-canvas.ts`.
- Publish anything (versioning is prepared, not released).

## Must DO
- Gate D66-1 … D66-15 before `wdd ward status 66 red`, and log them in NORTH-STAR.
- Reconcile this Tests table in the red commit.
- Rebuild core before the adapter tests (they import core's `dist`).
- Regenerate `package-lock.json` after the workspaces change; `npm ci` must pass.
- Remove the scene's interim CSS (D64-9).
- Re-run the W65 Playwright specs against the public API.

## Manual Smoke Test
### Setup
`npm ci && npm run build`

### Steps
1. Run: `npm run verify`
   Expected: build, Rust tests, all vitest projects and clippy green.
2. Run: `npm pack --dry-run --workspaces`
   Verify: core ships `dist/wasm/liquiddom_bg.wasm`, and no file references `pkg/`.
3. Run: `npx playwright test --project=canvas2d`
   Expected: steps 1 and 8 (including print) and a11y pass.
4. Run: `npm run dev`, then open `/scenes/acceptance.html`.
   Verify: the scene is unchanged from W64 through the public API; Tab shows the focus ring above the liquid. Take a screenshot and inspect it with vision.
5. Run: `npm run build -w liquiddom-react-example`
   Expected: the build succeeds against the workspace packages.

### Pass criteria
- [ ] The retirement `git grep` returns nothing.
- [ ] The focus-ring screenshot is inspected with vision.

## Verification
`npm run verify` is green, CI e2e (canvas2d) is green, the vision-inspected screenshots are attached, and Dennis approves.
