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
Proposal: `resolveOptions` is a whitelist. `capacity` → "use maxElements"; `physics` → "use material"; `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex` and `maxDt` → "removed, see the migration notes". An unknown key → `TypeError`.
Consequence: an old config fails loudly at `create()` instead of being silently ignored.
Decision: PENDING

### D66-2: auto means Canvas2D until slice 3
Proposal: `renderer: 'auto'` → Canvas2D without probing. Explicit `'webgpu'` → an infrastructure-only WebGPU renderer that clears, plus one `console.warn`. `isFallbackAdapter` handling moves to slice 3. `silentFallback` is validated but has no effect in slices 1–2 (B13).
Consequence: `activeRenderer` is `'canvas2d'` for every `auto` user until slice 3.
Decision: PENDING

### D66-3: Stacking via the data-liquid-stack attribute
Proposal: on `observe`, a statically positioned element gets `data-liquid-stack="relative"` (`position: relative; z-index: 1`); a positioned element with `z-index: auto` gets `data-liquid-stack="z"` (`z-index: 1`); an explicit z-index is left alone. `unobserve` restores the element exactly.
Consequence: no inline style writes, and the stacking is visible in devtools.
Decision: PENDING

### D66-4: Adapter element options are flat props
Proposal: React `useLiquidRef({ viscosity, recovery })` and `<LiquidElement viscosity recovery>`, and the same in Vue, captured at observe time.
Consequence: `liquidType` disappears from the adapters. The prop types keep their names but change shape (B10).
Decision: PENDING

### D66-5: The old instance getters and types are removed, with a complete mapping
Proposal:
- `isReducedMotion`, `isScrolling` and `pointerActive` are removed.
- The old→new mapping in the migration test and changeset covers every member of spec §5 plus `isReducedMotion`, `isScrolling`, `pointerActive`, `LiquidPhysicsConfig`, the old `SplashOptions` (`threshold/count/jitter…`, now `{strength, at}`; B9), `UseLiquidRefOptions` and `LiquidElementProps` (B10).

Consequence: a complete migration story; the three getters have no replacement.
Decision: PENDING

### D66-6: Capacity bounds
Proposal: `particles` must be an integer in [256, 65536] and `maxElements` an integer in [1, 256]; anything else is a `TypeError`.
Consequence: protects WASM memory sizing from accidental huge values.
Decision: PENDING

### D66-7: The default seed is a random u32
Proposal: when `seed` is omitted, a random u32 (`crypto.getRandomValues`) is used.
Consequence: different splashes per page load unless a seed is fixed. Scenes and tests always fix it.
Decision: PENDING

### D66-8: validateMaterial lands here [BOUNDARY]
Proposal: `validateMaterial(m: Partial<Material>)` (`@internal`) throws `TypeError` on NaN or out-of-range values: viscosity and cohesion in [0,1], recovery in [0.2,3] s.
Consequence: `resolveOptions` and the later `setMaterial` (W68) share one validator.
Decision: PENDING

### D66-9: Versioning per the amended spec
Proposal:
- Hand-set all three packages to `0.3.0-alpha.0`, peers to `^0.3.0-alpha.0`, and the example's deps to `"*"`.
- `.changeset/config.json` gets `fixed: [["liquiddom","@liquiddom/react","@liquiddom/vue"]]` and `"___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH": { "onlyUpdatePeerDependentsWhenOutOfRange": true }`.
- Run `npx changeset pre enter alpha` and add minor changesets.
- The release-plan test uses `@changesets/get-release-plan` (no git, no `sinceRef`) and expects `0.3.0-alpha.1` for all three.

Consequence: replaces the skeleton's D66-9 range, which changesets cannot satisfy (simulation: `0.2.0-alpha.1` or `1.0.0-alpha.1`). What happens to the published `0.2.0-rc.0` stays open (spec §7).
Decision: PENDING

### D66-10: Errors after capacity and after destroy
Proposal: `observe` beyond `maxElements` throws `RangeError`. Every method after `destroy()` throws `Error`, except `unobserve` and `destroy`, which are silent no-ops.
Consequence: matches the old API's lifecycle strictness, and StrictMode double-unmounts stay quiet.
Decision: PENDING

### D66-11: Type-level absence is checked by a tsc fixture
Proposal: `packages/core/ts/__tests__/__fixtures__/api-migration-types/` (following the pattern of `__fixtures__/types-smoke`) uses `// @ts-expect-error` imports of `LiquidInstancePanicDetail`, `SpawnDropletOptions`, `LiquidPhysicsConfig` and the old `SplashOptions` fields. A vitest runs it with `npx tsc --noEmit -p` (A3).
Consequence: erased types are really checked, because test files themselves are never type-checked.
Decision: PENDING

### D66-12: Known regression documented
Proposal: the changeset documents that the per-element MutationObserver colour auto-refresh (W52/W54) is gone until slice 4, so colour changes need `refresh(el)`. It also calls out the `SplashOptions` shape change (B9).
Consequence: an honest alpha changelog.
Decision: PENDING

### D66-13: The area hint comes from the autoObserve candidates
Proposal: the facade computes `A_hint` from the rounded-rect areas of the `[data-liquid]` candidates (when `autoObserve`) plus any `initialElements`, and passes it to the `FluidCore` constructor (B5).
Consequence: the acceptance scene keeps the same cell size before and after W66, so the W65 and W68 baselines do not shift.
Decision: PENDING

### D66-14: Resolved options carry a full Material
Proposal: `ResolvedOptions.material: Material` (fully resolved, not `Partial`) (B11).
Consequence: downstream code never re-applies defaults.
Decision: PENDING

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
- Gate D66-1 … D66-14 before `wdd ward status 66 red`, and log them in NORTH-STAR.
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
