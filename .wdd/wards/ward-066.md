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
| 1 | given_no_options_when_resolved_then_defaults_8000_particles_32_elements_auto_material_defaults_gravity_none_autoObserve_true_forceReducedMotion_false_silentFallback_false_random_u32_seed | defaults (C4) |
| 2 | given_non_integer_or_out_of_range_particles_or_maxElements_when_resolved_then_TypeError | D66-6 |
| 3 | given_removed_option_capacity_physics_colorDefault_colorHover_colorSource_theme_refraction_preserveBackgrounds_snapDurationMs_canvasZIndex_maxDt_when_resolved_then_TypeError_naming_replacement | D66-1 |
| 4 | given_unknown_option_when_resolved_then_TypeError | whitelist |
| 5 | given_material_out_of_range_or_nan_when_resolved_then_TypeError | D66-8 |
| 6 | given_gravity_options_when_resolved_then_validated_and_accepted | gravity option |
| 7 | given_silentFallback_when_resolved_then_validated_boolean_and_inert_in_slices_1_2 | B13 |
| 8 | given_two_instances_when_created_then_one_style_element_per_document | stylesheet |
| 9 | given_last_instance_destroyed_when_destroying_then_style_element_removed | refcount |
| 10 | given_static_element_when_observed_then_class_and_stack_relative_z1 | D66-3 |
| 11 | given_positioned_element_with_z_auto_when_observed_then_only_z1 | D66-3 |
| 12 | given_positioned_element_with_explicit_z_when_observed_then_stacking_untouched | D66-3 |
| 13 | given_css_text_when_read_then_print_and_forced_colors_hide_canvas_and_neutralise_classes_with_important | modes |
| 14 | given_unobserve_when_called_then_element_class_and_attr_exactly_restored | exact restore |
| 15 | given_canvas_when_mounted_then_aria_hidden_true_pointer_events_none_fixed_z0_last_in_body | canvas |
| 16 | given_container_mode_when_mounted_then_canvas_inside_container | container |
| 17 | given_element_with_background_when_observed_then_color_snapshotted_before_class | colour |
| 18 | given_refresh_when_called_then_class_temporarily_removed_and_colors_reread | refresh |
| 19 | given_transparent_background_when_observed_then_default_liquid_color | colour |
| 20 | given_testBackend_when_create_then_instance_with_particleCapacity_and_elementCapacity | facade |
| 21 | given_maxElements_reached_when_observe_then_RangeError | D66-10 |
| 22 | given_observe_with_viscosity_2_when_called_then_TypeError | element options (C3) |
| 23 | given_autoObserve_when_create_then_data_liquid_elements_observed | autoObserve |
| 24 | given_autoObserve_candidates_when_create_then_area_hint_is_their_summed_rounded_rect_area | D66-13 |
| 25 | given_autoDiscover_when_data_liquid_node_added_or_removed_then_observed_or_unobserved | autoDiscover |
| 26 | given_pause_when_called_then_no_frames_and_isPaused_true_and_resume_restarts | pause |
| 27 | given_hidden_tab_when_visibilitychange_then_paused_and_resumed | visibility |
| 28 | given_destroy_when_called_twice_then_idempotent_and_methods_throw_after | D66-10 |
| 29 | given_renderer_auto_when_create_then_activeRenderer_canvas2d | D66-2 |
| 30 | given_renderer_webgpu_unavailable_when_create_then_WebGPUUnavailableError | webgpu |
| 31 | given_wasm_load_failure_without_testBackend_when_create_then_rejects_LiquidWasmLoadError | loud failure |
| 32 | given_two_instances_when_one_destroyed_then_other_keeps_ticking | multi-instance |
| 33 | given_gravity_option_when_create_then_accepted_but_tick_receives_zero_gravity | gravity interim |
| 34 | gravity effect tests `it.skip("slice 6 ward: …")` | slice-6 reference |
| 35 | requestOrientationPermission_* (kept) | orientation |
| 36 | given_root_index_when_imported_then_export_keys_equal_whitelist | whitelist |
| 37 | given_instance_when_inspected_then_grow_tween_impulse_spawnDroplet_despawnDroplet_setPhysicsConfig_getPhysicsConfig_refreshTheme_refreshShadow_setBackgroundTexture_getBuffer_pointerX_pointerY_preserveBackgrounds_isScrollSnapping_capacity_isReducedMotion_isScrolling_pointerActive_absent | retirement |
| 38 | given_observe_with_number_when_called_then_TypeError_mentioning_liquidType_removed | migration hint |
| 39 | given_no_listener_when_running_then_no_liquiddom_instance_panic_event | W61 workaround gone |
| 40 | given_index_when_imported_then_validatePhysicsConfig_absent_and_no_physics_shaped_presets | A2 |
| 41 | given_api_migration_types_fixture_when_tsc_noEmit_then_exit_code_0 | D66-11 |
| 42 | given_useLiquidRef_with_viscosity_when_attached_then_observe_called_with_element_options | React |
| 43 | given_LiquidElement_with_viscosity_and_recovery_props_when_mounted_then_observe_receives_them | React + Vue |
| 44 | provider_creates_instance_after_mount (ported to `config={{ testBackend }}`) | adapters |
| 45 | strict-mode and SSR tests (ported; `getBuffer` assertions removed) | adapters |
| 46 | core_dist_wasm_dynamic_import_resolves_to_packaged_file (→ `dist/wasm-loader.js`) | publish |
| 47 | given_root_package_when_read_then_site_not_in_workspaces_and_no_site_override | site freeze |
| 48 | given_vitest_config_when_read_then_site_not_in_projects | site freeze |
| 49 | given_deploy_site_yml_when_read_then_only_workflow_dispatch | site freeze |
| 50 | given_example_react_package_when_read_then_liquiddom_deps_are_star | D66-9 |
| 51 | peer dependency test #5 → `^0.3.0-alpha.0` | D66-9 |
| 52 | peer range test #10 → satisfied by `0.3.0-alpha.0` | D66-9 |
| 53 | changeset_config_matches_spec (fixed group + onlyUpdatePeerDependentsWhenOutOfRange) | D66-9 |
| 54 | given_pre_json_when_read_then_mode_pre_tag_alpha | pre mode |
| 55 | given_pending_changesets_when_release_plan_computed_then_all_three_bump_to_0_3_0_alpha_1 | D66-9 |
| 56 | step 8 – given print media when emulated then the liquid canvas is display none (un-fixme'd) | step 8 print |
| 57 | step 8 – given the acceptance scene when axe runs then 0 violations and the canvas is aria-hidden | a11y |
| 58 | given focus on Split via Tab when screenshotted then the focus ring is drawn above the liquid | focus (step 4 groundwork) |

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
