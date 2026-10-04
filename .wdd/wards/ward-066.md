---
ward: 66
revision: null
name: "Public API swap and soft-body retirement"
epic: "fluid-engine"
status: "planned"
dependencies: [65, 62]
layer: "both"
estimated_tests: 58
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
- Tests: `options.test.ts`, `stylesheet.test.ts`, `api-migration.test.ts`, the type fixture `packages/core/ts/__tests__/__fixtures__/api-migration-types/`, `e2e/a11y.spec.ts`. Rewritten tests: `liquiddom-api`, `multi-instance`, `auto-renderer`, `runtime-truth`, `renderer-abstraction`, `gravity`, `webgpu-renderer` (retargeted to `renderers/frame.ts`), `border-radius` (slot[8] block deleted).
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
Decision: APPROVED 2026-10-04 — injected CSS in `@layer liquiddom` with `!important`; `@media print, (forced-colors: active)` hides the canvas and neutralises both classes with `revert-layer !important`; two axe passes (screen WCAG 2.1 A/AA without `color-contrast`, then print with `color-contrast` only) (saga dec_2911ef26)

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
| 1 | given_no_options_when_resolved_then_defaults_8000_particles_32_elements_auto_material_defaults_gravity_none | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 2 | given_seed_omitted_when_resolved_repeatedly_then_each_seed_is_a_u32_and_not_all_equal | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 3 | given_explicit_seed_when_resolved_then_kept_and_invalid_seed_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 4 | given_non_integer_or_out_of_range_particles_or_maxElements_when_resolved_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 5 | given_removed_option_capacity_physics_colorDefault_colorHover_colorSource_theme_refraction_preserveBackgrounds_snapDurationMs_canvasZIndex_maxDt_when_resolved_then_TypeError_naming_replacement | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 6 | given_unknown_option_when_resolved_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 7 | given_material_out_of_range_or_nan_when_resolved_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 8 | given_gravity_options_when_resolved_then_validated_and_accepted | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 9 | given_renderer_option_when_resolved_then_only_auto_webgpu_canvas2d_accepted | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 10 | given_boolean_options_when_non_boolean_then_TypeError_and_silentFallback_is_validated_only | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 11 | given_container_testBackend_loader_or_clock_of_wrong_shape_when_resolved_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 12 | given_option_whitelist_when_read_then_equals_spec_section_5_plus_internal_hooks | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 13 | given_valid_partial_when_validated_then_no_throw_and_input_not_mutated | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 14 | given_non_object_or_unknown_key_when_validated_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 15 | given_element_options_out_of_range_nan_or_unknown_when_validated_then_TypeError | options/material validation (D66-1, D66-6, D66-8, C3, C4) |
| 16 | given_two_instances_when_created_then_one_style_element_per_document | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 17 | given_last_instance_destroyed_when_destroying_then_style_element_removed | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 18 | given_style_element_removed_externally_when_next_acquire_then_reinserted_and_refcount_kept | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 19 | given_css_text_when_read_then_print_and_forced_colors_hide_canvas_and_neutralise_classes_with_important | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 20 | given_stackingFor_table_when_evaluated_then_static_relative_auto_z_else_null | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 21 | given_static_element_when_observed_then_class_and_stack_relative_z1 | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 22 | given_positioned_element_with_z_auto_when_observed_then_only_z1 | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 23 | given_positioned_element_with_explicit_z_when_observed_then_stacking_untouched | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 24 | given_unobserve_when_called_then_element_class_and_attr_exactly_restored | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 25 | given_canvas_when_mounted_then_aria_hidden_true_pointer_events_none_fixed_z0_last_in_body | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 26 | given_container_mode_when_mounted_then_canvas_inside_container | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 27 | given_element_with_background_when_observed_then_color_snapshotted_before_class | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 28 | given_refresh_when_called_then_class_temporarily_removed_and_colors_reread | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 29 | given_transparent_background_when_observed_then_default_liquid_color | injected stylesheet, stacking, colour snapshot (D66-3, D66-15) |
| 30 | given_class_present_when_snapshotColorsWithout_then_reads_original_colour_and_restores_class | colour snapshot with class lifted (D66-3) |
| 31 | given_class_absent_when_snapshotColorsWithout_then_equals_snapshotColors_and_class_not_added | colour snapshot with class lifted (D66-3) |
| 32 | given_started_loop_when_clock_advances_3_then_onFrame_runs_3_times | loop control (D66-12) |
| 33 | given_paused_when_advancing_then_no_frames_and_resume_restarts | loop control (D66-12) |
| 34 | given_hidden_document_when_visibilitychange_then_paused_until_visible | loop control (D66-12) |
| 35 | given_user_paused_when_tab_becomes_visible_then_still_paused | loop control (D66-12) |
| 36 | given_destroyed_when_advancing_then_no_frames_listener_removed_and_idempotent | loop control (D66-12) |
| 37 | given_runtime_when_created_then_canvas_has_liquid_canvas_class_aria_hidden_and_styles_injected | runtime additions (D66-2, D66-12) |
| 38 | given_renderer_init_failure_when_creating_runtime_then_canvas_removed_and_core_freed | runtime additions (D66-2, D66-12) |
| 39 | given_runtime_pause_when_frames_advance_then_no_tick_until_resume | runtime additions (D66-2, D66-12) |
| 40 | given_webgpu_renderer_when_typed_then_satisfies_frame_Renderer_contract_and_error_is_reexported | infra-only WebGPU renderer (D66-2) |
| 41 | given_navigator_gpu_missing_when_init_then_WebGPUUnavailableError | infra-only WebGPU renderer (D66-2) |
| 42 | given_requestAdapter_null_or_throwing_when_init_then_WebGPUUnavailableError_with_cause | infra-only WebGPU renderer (D66-2) |
| 43 | given_requestDevice_rejects_when_init_then_WebGPUUnavailableError_with_cause | infra-only WebGPU renderer (D66-2) |
| 44 | given_getContext_webgpu_null_when_init_then_WebGPUUnavailableError_and_device_destroyed | infra-only WebGPU renderer (D66-2) |
| 45 | given_successful_init_when_configured_then_alphaMode_premultiplied_and_no_shader_or_pipeline_created | infra-only WebGPU renderer (D66-2) |
| 46 | given_initialised_renderer_when_render_then_one_clear_pass_transparent_and_submitted | infra-only WebGPU renderer (D66-2) |
| 47 | given_device_lost_when_rendering_then_one_console_warn_and_render_noop | infra-only WebGPU renderer (D66-2) |
| 48 | given_destroy_when_called_before_init_after_failure_and_twice_then_no_throw_and_device_destroyed_once | infra-only WebGPU renderer (D66-2) |
| 49 | given_both_renderers_when_typed_then_satisfy_frame_Renderer_init_render_resize_destroy | single Renderer contract, retirement (D66-2, D64-5) |
| 50 | given_soft_body_renderer_modules_when_checked_then_deleted | single Renderer contract, retirement (D66-2, D64-5) |
| 51 | given_selectRenderer_auto_or_canvas2d_when_called_then_FluidCanvas2DRenderer_active_canvas2d | single Renderer contract, retirement (D66-2, D64-5) |
| 52 | given_selectRenderer_canvas2d_with_null_2d_context_when_called_then_rejects_D64_5 | single Renderer contract, retirement (D66-2, D64-5) |
| 53 | given_renderer_auto_when_create_then_activeRenderer_canvas2d_and_webgpu_never_probed | renderer selection (D66-2, B13) |
| 54 | given_renderer_omitted_or_canvas2d_when_create_then_activeRenderer_canvas2d | renderer selection (D66-2, B13) |
| 55 | given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError_and_nothing_left_behind | renderer selection (D66-2, B13) |
| 56 | given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_and_one_console_warn | renderer selection (D66-2, B13) |
| 57 | given_webgpu_init_bug_that_is_not_unavailable_when_create_then_rejects_with_that_error | renderer selection (D66-2, B13) |
| 58 | given_silentFallback_true_or_false_when_create_with_auto_then_validated_and_no_console_info_B13 | renderer selection (D66-2, B13) [B13] |
| 59 | given_testBackend_when_create_then_instance_with_particleCapacity_and_elementCapacity | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 60 | given_wasm_load_failure_without_testBackend_when_create_then_rejects_LiquidWasmLoadError | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 61 | given_root_index_when_imported_then_export_keys_equal_whitelist | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 62 | given_maxElements_reached_when_observe_then_RangeError | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 63 | given_observe_with_out_of_range_element_options_when_called_then_TypeError_and_valid_options_reach_slots_8_9 | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 64 | given_refresh_on_unobserved_element_when_called_then_noop | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 65 | given_autoObserve_when_create_then_data_liquid_elements_observed | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 66 | given_autoObserve_candidates_when_create_then_area_hint_comes_from_their_rects_B5 | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 67 | given_more_data_liquid_elements_than_maxElements_when_create_then_extra_skipped_with_one_warn | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 68 | given_autoDiscover_when_data_liquid_node_added_or_removed_then_observed_or_unobserved | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 69 | given_stopAutoDiscover_when_nodes_added_then_not_observed | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 70 | given_container_option_when_create_then_canvas_inside_container_and_autoObserve_scoped_to_it | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 71 | given_pause_when_called_then_no_frames_and_isPaused_true_and_resume_restarts | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 72 | given_hidden_tab_when_visibilitychange_then_paused_and_resumed | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 73 | given_user_pause_when_tab_becomes_visible_again_then_stays_paused_D66_12 | public facade (T3, C3, D66-10, D66-12, D66-13) [D66-12] |
| 74 | given_destroy_when_called_twice_then_idempotent_and_methods_throw_after | public facade (T3, C3, D66-10, D66-12, D66-13) |
| 75 | given_two_instances_created_in_one_task_when_resolved_then_two_canvases_two_cores_one_stylesheet | multi-instance facade (D66-3) |
| 76 | given_two_instances_when_one_destroyed_then_other_keeps_ticking | multi-instance facade (D66-3) |
| 77 | given_two_instances_when_destroyed_in_either_order_twice_then_idempotent_and_stylesheet_removed_after_last | multi-instance facade (D66-3) |
| 78 | given_gravity_fixed_vector_when_create_then_accepted | gravity interim state (spec 6) |
| 79 | given_gravity_source_none_default_when_create_then_no_throw | gravity interim state (spec 6) |
| 80 | given_gravity_fixed_without_vector_when_create_then_no_throw | gravity interim state (spec 6) |
| 81 | given_invalid_gravity_when_create_then_TypeError | gravity interim state (spec 6) |
| 82 | given_gravity_option_when_create_then_accepted_but_tick_receives_zero_gravity | gravity interim state (spec 6) |
| 83 | slice 6 ward: given_gravity_fixed_when_ticking_then_tick_receives_the_vector | skipped until slice 6 |
| 84 | slice 6 ward: given_orientation_event_when_ticking_then_beta_gamma_mapped_to_gx_gy | skipped until slice 6 |
| 85 | slice 6 ward: given_reduced_motion_when_ticking_then_gravity_clamped_to_zero | skipped until slice 6 |
| 86 | slice 6 ward: given_orientation_source_when_destroyed_then_deviceorientation_listener_removed | skipped until slice 6 |
| 87 | requestOrientationPermission_handles_unsupported_jsdom_default | gravity interim state (spec 6) |
| 88 | requestOrientationPermission_handles_unsupported_explicit_stub | gravity interim state (spec 6) |
| 89 | requestOrientationPermission_handles_ios_grant_and_deny | gravity interim state (spec 6) |
| 90 | given_npm_pack_when_dry_run_then_tarball_ships_wasm_binary_and_wasm_loader_but_no_soft_body_files | runtime truth (D66-9, D3) |
| 91 | given_root_export_when_imported_then_internals_are_not_leaked | runtime truth (D66-9, D3) |
| 92 | given_pkg_glue_when_read_then_FluidCore_exported_and_LiquidCore_gone | runtime truth (D66-9, D3) |
| 93 | given_public_create_with_testBackend_when_manual_frames_advance_then_core_tick_receives_raw_dt_in_seconds | runtime truth (D66-9, D3) |
| 94 | given_old_instance_members_when_inspected_then_each_fate_holds | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 95 | given_instance_when_inspected_then_grow_tween_impulse_spawnDroplet_despawnDroplet_setPhysicsConfig_getPhysicsConfig_refreshTheme_refreshShadow_setBackgroundTexture_getBuffer_pointerX_pointerY_preserveBackgrounds_isScrollSnapping_capacity_absent | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 96 | given_instance_when_inspected_then_isReducedMotion_isScrolling_pointerActive_absent_D66_5 | old to new migration (T4, B9, B10, D66-5, D66-11) [D66-5] |
| 97 | given_observe_with_number_when_called_then_TypeError_mentioning_liquidType_removed | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 98 | given_old_options_when_create_then_removed_ones_reject_TypeError_naming_replacement_and_kept_ones_are_accepted | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 99 | given_old_runtime_exports_when_imported_then_each_fate_holds | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 100 | given_index_when_imported_then_validatePhysicsConfig_absent_and_old_physics_presets_gone | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 101 | given_no_listener_when_running_then_no_liquiddom_instance_panic_event | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 102 | given_api_migration_type_fixture_when_tsc_checks_it_then_exit_code_0 | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 103 | given_soft_body_sources_when_checked_then_deleted_and_lib_rs_declares_only_fluid | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 104 | given_retired_demo_scenes_when_checked_then_deleted_and_acceptance_scene_kept | old to new migration (T4, B9, B10, D66-5, D66-11) |
| 105 | given_changeset_when_read_then_SplashOptions_shape_change_colour_regression_and_removed_api_are_documented_B9_E | old to new migration (T4, B9, B10, D66-5, D66-11) [B9] |
| 106 | given_adapter_index_when_imported_then_exports_are_kept | React adapter on fluid API (T5, B10) |
| 107 | provider_creates_instance_after_mount | React adapter on fluid API (T5, B10) |
| 108 | provider_destroys_instance_on_unmount | React adapter on fluid API (T5, B10) |
| 109 | useLiquidRef_observes_element_when_attached | React adapter on fluid API (T5, B10) |
| 110 | useLiquidRef_unobserves_on_unmount | React adapter on fluid API (T5, B10) |
| 111 | given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options | React adapter on fluid API (T5, B10) |
| 112 | given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them | React adapter on fluid API (T5, B10) |
| 113 | useLiquid_returns_null_outside_provider | React adapter on fluid API (T5, B10) |
| 114 | strict_mode_tree_observes_correctly_and_is_idempotent | React adapter on fluid API (T5, B10) |
| 115 | liquidElement_forwards_html_attrs_and_uses_as_prop | React adapter on fluid API (T5, B10) |
| 116 | ssr_renderToString_does_not_throw | React adapter on fluid API (T5, B10) |
| 117 | given_adapter_index_when_imported_then_exports_are_kept | Vue adapter on fluid API (T5, B10) |
| 118 | provider_creates_instance_after_mount | Vue adapter on fluid API (T5, B10) |
| 119 | provider_destroys_instance_on_unmount | Vue adapter on fluid API (T5, B10) |
| 120 | useLiquidRef_observes_element_when_attached | Vue adapter on fluid API (T5, B10) |
| 121 | useLiquidRef_unobserves_on_unmount | Vue adapter on fluid API (T5, B10) |
| 122 | given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options | Vue adapter on fluid API (T5, B10) |
| 123 | given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them | Vue adapter on fluid API (T5, B10) |
| 124 | useLiquid_returns_null_outside_provider | Vue adapter on fluid API (T5, B10) |
| 125 | liquidElement_forwards_attrs_and_uses_as_prop | Vue adapter on fluid API (T5, B10) |
| 126 | ssr_renderToString_does_not_throw | Vue adapter on fluid API (T5, B10) |
| 127 | plugin_install_provides_instance | Vue adapter on fluid API (T5, B10) |
| 128 | step 8 – given print media when emulated then the liquid canvas is display none | step 8 print (D66-15) |
| 129 | step 8 – given the acceptance scene when axe runs then 0 violations and the canvas is aria-hidden | step 8 a11y (D66-3, D66-15) |
| 130 | given focus on Split via Tab when screenshotted then the focus ring is drawn above the liquid | step 8 a11y (D66-3, D66-15) |
| 131 | given_root_package_when_read_then_site_not_in_workspaces_and_no_site_override | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 132 | given_vitest_config_when_read_then_site_not_in_projects | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 133 | given_deploy_site_yml_when_read_then_only_workflow_dispatch | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 134 | given_example_react_package_when_read_then_liquiddom_deps_are_star | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 135 | given_publishable_packages_when_read_then_all_three_at_0_3_0_alpha_0_with_peers_caret_0_3_0_alpha_0 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 136 | given_ts_sources_when_scanned_then_only_depth_1_wasm_loader_imports_pkg_via_four_level_specifier_D3 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) [D3] |
| 137 | \\ | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 138 | given_core_dist_when_scanned_then_no_js_or_d_ts_references_pkg_D3 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) [D3] |
| 139 | \\ | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 140 | given_core_dist_when_listed_then_no_soft_body_artifacts_remain_D66_9 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) [D66-9] |
| 141 | given_pre_json_when_read_then_mode_pre_tag_alpha_and_initial_versions_0_3_0_alpha_0 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 142 | given_pending_changesets_when_release_plan_computed_then_all_three_bump_to_0_3_0_alpha_1 | site freeze, versioning, pkg hygiene (D66-9, A1, D3) |
| 143 | npm_pack_dry_run_for_core_contains_only_expected_files | modified #2: dist/wasm-loader.js in tarball (D66-9) |
| 144 | adapter_packages_declare_peer_deps | modified #5: peers ^0.3.0-alpha.0 (A1, D66-9) |
| 145 | core_dist_wasm_dynamic_import_resolves_to_packaged_file | modified #8: dynamic import lives in dist/wasm-loader.js (D3) |
| 146 | changeset_config_matches_spec | modified #12: fixed group and onlyUpdatePeerDependentsWhenOutOfRange (D66-9) |

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
