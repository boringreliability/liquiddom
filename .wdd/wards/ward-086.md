---
ward: 86
revision: null
name: "The site"
epic: "fluid-engine"
status: "planned"
dependencies: [85]
layer: "typescript"
estimated_tests: 0
created: "2026-10-23"
completed: null
---
# Ward 086: The site

North star: none — the site is the third consumer of the 0.3 API (slice design §9); the 8 acceptance steps are unchanged. Its landing is the real long page of scroll and parking (step 7) and the page W87 records.

## Scope
Seventh ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §9, refined by `docs/superpowers/specs/2026-10-23-liquiddom-site-design.md`, brainstorm with Dennis 2026-10-22). The Astro site, frozen since W66, is rebuilt on the 0.3 API: a dark "Deep water" landing that tells the engine's story in nine scrolling chapters (arrival splash, rest, poke, materials, drag and merge, tilt, scroll and parking, reduced motion, install), a playground port of `demo/scenes/playground.html` (gravity, drag per element, "Copy as code"), five short docs pages, and the site back in the root workspaces, vitest and CI (`e2e:site` blocking on Canvas2D). Whether Astro 6 runs on the root's vite 8 and TypeScript 6, what particle pool a nine-chapter page carries, and what the arrival looks like come from the time-boxed spike W86.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W86.md`, part 1); part 2 is written after the gate.

Out of scope: glow and shadow (a renderer ward after W87), a parking counter (no public API), web fonts, dispatching `deploy-site.yml` and publishing `0.3.0-alpha.x` (Dennis' calls), any change to the engine or the public API.

## Inputs
- The slice design §9, §11, §12 (D86-1); the site design (all sections).
- The public API of `liquiddom`, `@liquiddom/react`, `@liquiddom/vue` at W85 (`create()` options incl. `onError`, `forceReducedMotion`, `gravity`; `observe(el, { drag })`; `splash`, `shake`, `setMaterial`, `setGravity`, `requestOrientationPermission`, `presets`).
- `site/` (Astro ^6.3.7, vite ^7.3.3, TypeScript ^5.4, Tailwind ^4.2.4, `liquiddom: "*"`, `astro.config.mjs` site `https://liquiddom.vsplat.io`, `trailingSlash: "always"`); the 0.2 showcases and docs; `SITE.md`; `.github/workflows/deploy-site.yml` and `ci.yml`.
- `demo/scenes/playground.html`, `playground.ts`, `playground-state.ts` (W69, key `liquiddom-playground-v2`), their tests `packages/core/ts/__tests__/playground.test.ts` and `e2e/scenes.spec.ts` (the playground test).
- `packages/core/__tests__/workspace-publish.test.ts` "W66: site freeze" (`:336-358`).
- Baseline at `0698e3d`: see Specification.

## Outputs
- `site/`: the landing, `/playground/`, `/docs/…` (five pages), shared chrome; a workspace consuming core's `dist`.
- The vitest project `./site`, the Playwright project `site` (`e2e:site`, :4176), the CI build and run.
- `SITE.md`, `deploy-site.yml` (still `workflow_dispatch` only) corrected.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). -->
### D86-1: Site content
Proposal: the site is a landing, a playground and short docs on the 0.3 API; the 0.2 showcases (`squish`, `fusion`, `hero-blobs`), the soft-body docs, their components and the eight 0.2 site tests are deleted (chosen in the slice-6 brainstorm, Dennis 2026-10-13; this gate makes it formal).
Consequence: nothing of the 0.2 site survives except the Astro/Tailwind setup and the CNAME; the site only uses public API (no `@internal` hook, no `runtimeOf()`, no scene hook).
Decision: APPROVED 2026-10-23 — landing + playground + short docs on the 0.3 API; every 0.2 page, component and site test deleted; public API only (saga dec_1a032be5)

### D86-2: "Deep water" and the nine-chapter story
Proposal: a night-blue radial gradient on `<html>` (body and sections transparent, W82), luminous liquid colours (cyan `oklch(0.82 0.15 205)`, magenta `oklch(0.72 0.2 340)`, lime `oklch(0.88 0.18 125)`, coral `oklch(0.68 0.22 25)`, tuned at gold), a bold system grotesk, no glow; nine chapters of about one viewport each (0 hero "The DOM, but liquid.", 1 "It's still a button.", 2 "Poke it.", 3 "Water, honey, jelly.", 4 "Grab it. Merge it.", 5 "Tilt your phone.", 6 "It follows you down.", 7 "Calm when you need it.", 8 "Pour it into your app."), English copy, one column on mobile (brainstorm saga dec_94e73a65, dec_e35e6fc4, dec_9a7b3106).
Consequence: the page must stand without glow; every observed element's ancestors stay transparent or the instance falls back to `z-index: 0` with a warning (the W72 fixture fails on none, but the e2e checks the canvas z-index).
Decision: APPROVED 2026-10-23 — Deep water (gradient on <html>, transparent body and sections, luminous cyan/magenta/lime/coral, system grotesk, no glow) and the nine chapters of the site design (saga dec_acb4c4c2)

### D86-3: Instances, pool and the failure line
Proposal: one body-mode instance carries the story (`renderer: 'auto'`, particles and `maxElements` from spike Q2, `onError` set); chapter 3 adds three container instances (`presets.water`, `presets.honey`, `presets.jelly`, one "Shake all"), chapter 7 two (one `forceReducedMotion: true`, one "Splash both"); each container `position: relative; isolation: isolate`, never observed by the body instance. `onError` of any instance hides the controls that drive the liquid and shows "The liquid stopped; the page works as usual." (brainstorm saga dec_59d99679).
Consequence: six instances on one page (six WASM cores, six canvases, one shared module); the pool numbers are measured, not guessed; no parking counter.
Decision: APPROVED 2026-10-23 — body instance particles 18000, maxElements 48 (re-measured at W86.2); five container instances particles 1000, maxElements 2, paused off-screen (IntersectionObserver + pause()/resume()), padded 60–80 px; onError hides the liquid controls and shows one line (saga dec_4016d938)

### D86-4: The arrival and the hint
Proposal: right after the body instance's `create()` resolves, one `splash()` per hero element at a strength chosen in spike Q3, so the liquid flies apart and gathers within 3 s; after about 4 s without a pointer, key, touch or scroll, one soft `shake()` as a hint, cancelled by the first interaction; neither under reduced motion (brainstorm saga dec_40a58bb0).
Consequence: the first frame the visitor sees is moving liquid, not rest; the hero text stays DOM text (Canvas2D halo, WebGPU atlas).
Decision: APPROVED 2026-10-23 — arrival splash 0.8 per hero element, hint shake 0.5 after ~4 s without interaction; neither under reduced motion (saga dec_7265d4e7)

### D86-5: The playground port
Proposal: `/playground/` ports `demo/scenes/playground.html` (Tweakpane in the Deep-water style; three drops, a card, two pills): material live via `setMaterial`, presets, splash/shake with strength, pause/resume, init-only particles/seed/renderer/`forceReducedMotion` via URL params; new: gravity (`none`, `fixed` with a dial, `orientation` on a phone), drag on/off per element (`unobserve` + `observe`), "Copy as code", `onError` with a Restart button. The state module lives once, in the site (`site/src/playground/state.ts`); `demo/scenes/playground.*` is deleted, `playground.test.ts` moves to the site project and the playground test in `e2e/scenes.spec.ts` moves to `e2e:site`. The persisted key becomes `liquiddom-playground-v3`; v1 and v2 are discarded (precedent D69-1).
Consequence: two approved tests (W69) move and change key; the dev server loses its playground scene (the site's `astro dev` is the playground); Tweakpane moves from the root devDependencies to the site's dependencies.
Decision: APPROVED 2026-10-23 — the playground port with gravity, drag per element, Copy as code and Restart; the state lives only in site/src/playground/state.ts, the demo playground is deleted, the W69 tests move, key liquiddom-playground-v3 (saga dec_e625d9ee)

### D86-6: Docs
Proposal: five short Markdown pages in one docs layout (Getting started, API, Adapters, Accessibility, Limitations), Astro's built-in Shiki in a dark theme, no liquid on them; shared header (liquiddom, Playground, Docs, GitHub, a "0.3 alpha" pill) and footer (MIT, GitHub); a drift-guard test fails when an option of `create()`'s whitelist or a method of `LiquidDOMInstance` is missing from the API page.
Consequence: the API page must be kept in step with core; the guard makes a new option a failing test until it is documented.
Decision: APPROVED 2026-10-23 — five Markdown docs pages, dark Shiki, shared chrome, the drift guard (saga dec_1e5620c8)

### D86-7: The site back in the workspace and CI
Proposal: root workspaces `["packages/*", "examples/*", "site"]`; the site consumes core's `dist` like the examples; vite aligns with the root (^8), TypeScript with ^6 (or what spike Q1 shows Astro 6 needs); the lockfile is regenerated; `site/dist` and the `site/node_modules` leftovers are deleted; `ci.yml` builds the site after core; `deploy-site.yml` stays `workflow_dispatch` only, its "fails until slice 6" header goes and its steps are corrected; `SITE.md` is rewritten.
Consequence: the lockfile moves (Astro's tree joins it); CI time grows by the site build and `e2e:site`; dispatching the deploy stays Dennis' call.
Decision: AMENDED 2026-10-23 — Astro 7 (astro ^7.4.2) instead of Astro 6 (every astro@6 needs vite 7); root and site vite ^8.3.5, typescript ^6.0.2; e2e:site serves site/dist with vite preview; a favicon link; rest as proposed (saga dec_2dd947a2)

### D86-8: Tests
Proposal: a vitest project `./site` (the landing's structure, the playground state and "Copy as code", the docs drift guard, `deploy-site.yml` on `workflow_dispatch` only; no `astro build` in vitest); the approved test "W66: site freeze" (`workspace-publish.test.ts:336-358`) is inverted to pin the site in (workspaces, lockfile, vitest project), its `workflow_dispatch`-only pin stays; a Playwright project `site` (`npm run e2e:site`, `vite preview` of the built site on :4176, Canvas2D, blocking in CI): the landing's instances and canvases, scrolling to chapter 6 brings parked cards in at rest, chapter 3's instances run, the playground and every docs page load, no `console.error`; WebGPU locally on Metal; no pixel baselines (vision at gold, the recording in W87). Carried from W85: the Vue twin of React's row 20; `CONTEXT.md` is trimmed before W86 writes to it (8186 of 8192 B).
Consequence: three approved tests change (the W66 freeze, the two W69 playground tests of D86-5) and are approved at red; no Linux baseline moves.
Decision: APPROVED 2026-10-23 — vitest ./site, the inverted W66 freeze test, the moved W69 tests, e2e:site on :4176 blocking on Canvas2D, no pixel baselines, the Vue twin of row 20, CONTEXT.md trimmed first (saga dec_636f1077)

### D86-9: CSS colours the liquid cannot read (oklch)
Proposal: found by spike W86.0: `parseCssColor` (`packages/core/ts/src/color.ts:63`) reads only `rgb()/rgba()` and hex, and Chromium's computed `background-color` of an `oklch()` (or `lab()`, `color()`) value stays in that syntax, so such an element's liquid falls back to the default purple in both renderers. Tailwind 4's default palette is oklch, so every Tailwind 4 app hits it. (a) Fix it in core in W86: a colour the parser does not read is normalised through a 1 × 1 canvas (`fillStyle` = the computed value, one `fillRect`, `getImageData`, cached per string), so every CSS colour the browser paints reaches the liquid as sRGB; a `patch` changeset. (b) Leave core; the site uses hex/rgb for observed backgrounds and the docs list it as a known limitation; fix it in a later ward.
Consequence: (a) touches core's colour snapshot (no API change, one new branch in the snapshot path, jsdom tests through the fake canvas) and closes a bug every Tailwind 4 user hits; (b) keeps W86 site-only but ships the site's own stack (Tailwind 4) with a trap in it.
Decision: APPROVED 2026-10-23 — (a) core normalises a computed colour parseCssColor does not read through a 1 × 1 canvas, cached per string; patch changeset, no API change (saga dec_a223c2a5)

## Spike W86.0 result
Throwaway copy of `ef7e197` (deleted), rough Astro site with the design's nine chapters (35 body elements, 534 511 px², five container instances), Playwright 1.63 at 1280 × 800, DPR 1; Canvas2D in the headless shell, WebGPU in new headless Chromium on Metal; 600 RAF frames per cell after a 2.5 s settle; stills on the manual clock, inspected with vision.

| Q | Finding | Recommendation |
|---|---|---|
| Q1 Astro on vite 8 / TS 6 | Every `astro@6.x` hard-depends on `vite ^7.3`: npm nests vite 7 under Astro, and with Tailwind 4 on the hoisted vite 8 `astro build` fails (`Missing field 'tsconfigPaths' on BindingViteResolvePluginConfig.resolveOptions`); without Tailwind it builds but `astro dev` warns "Astro requires Vite 7". `astro@7.4.2` depends on `vite ^8.3.4`: with root and site `vite ^8.3.5`, `typescript ^6.0.2`, `@astrojs/check ^0.9.12`, Tailwind 4.3.3, install has no peer warning and no override, one vite in the tree; check 0/0/0, build, dev, `astro preview` and `vite preview` serve `application/wasm`; Canvas2D, WebGPU and `auto` create an instance with no console error. Lockfile +5 889 / −1 497 lines. Astro 7's `dev`/`preview` daemonise without a TTY (useless as a Playwright `webServer`); `vite preview` of `site/dist` works. New headless Chromium requests `/favicon.ico` (a 404 `console.error` without a `<link rel="icon">`). Root vitest on vite 8.3.5: green except the three expected failures (no `.git` in the copy, the W66 freeze, the spike's scratch export). | D86-7 amended: **Astro 7** (`astro ^7.4.2`), root and site `vite ^8.3.5`, `typescript ^6.0.2`; `e2e:site` serves `site/dist` with `vite preview`; the layout carries a favicon link |
| Q2 pool | Body cell 8 px, budget = particles · 32 px²: the over-budget warning is silent from 16 704 particles. Body tick ≈ 0.14 ms per 1000 particles per fixed step (at rest p95 1.4 / 1.9 / 2.4 ms at 8k / 12k / 16k, hero view). Hero splashing every second: WebGPU never missed a frame up to 20 000; Canvas2D (headless software raster) misses from 16–17k. Over budget the re-forming liquid is visibly hollow (pills as rings, holes, WebGPU labels missing until rest); at 17 000 solid fills, legible text. Containers: 5 × 2000 cost 4 ms per frame and tick off-screen; 5 × 1000 look like 2000, 500 is noisy and over budget; paused off-screen (an `IntersectionObserver` calling the public `pause()`/`resume()`) they cost 0. Container liquid is clipped hard at the container's box. Parking on the long page works (ch6 cards at rest 2 frames after entering); no z-index fallback warning anywhere. | D86-3: body `particles: 18000`, `maxElements: 48` (re-measured on the real layout at W86.2); containers `particles: 1000`, `maxElements: 2`, paused off-screen, each padded 60–80 px around its card |
| Q3 arrival | Time to rest 2.25–2.5 s at every strength (0.5 / 0.8 / 1.0), both renderers and pools. 0.5 dents, pills keep their shape; 0.8 and 1.0 burst every element into a ring that closes by f30–f60 (1.0 throws more droplets). Within budget (17 000) Canvas2D labels are readable throughout (halo), WebGPU labels are fragments at f10, mostly readable at f30, clean at f90; over budget (8 000) WebGPU labels are gone until rest. Hint from rest: `shake(0.3)` barely visible, `shake(0.5)` a clear, gentle slosh with readable labels; rest 2.33 s. | D86-4: arrival 0.8 (needs the pool within budget), hint 0.5 |
| Found | The site's oklch palette never reached the liquid (default purple) until converted to hex: `#00dff2`, `#f269cb`, `#bdeb58`, `#ff4c4d`. | New D86-9 |

## Specification
**Baseline at `0698e3d`** (W85 complete `c9c1a1a` plus the site design): cargo `245 passed; 0 failed; 1 ignored`; vitest `833 passed (833)`, 84 files; Playwright `--list` canvas2d 102 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2.

Written after the W86.0 gate (part 2 of the plan).

## Tests
Red results were measured after W86.1 (stubs in place, `npm run build` then `npm test`: 861 tests, 836 passed, 25 failed, 88 files; every failure is an assertion, none an import or syntax error). Gold is after W86.4.

| # | Test (file: name) | Verifies | Red (measured) | Gold |
|---|---|---|---|---|
| 1 | color.test: given_a_colour_parseCssColor_cannot_read_when_parsed_then_the_probe_result_is_used | D86-9 | ❌ `parseCssColor` returns null, the probe is never called | ✅ |
| 2 | color.test: given_the_probe_rejects_the_string_when_parsed_then_null | D86-9, `garbage` stays null | ✅ | ✅ |
| 3 | color.test: given_the_same_unread_colour_twice_when_parsed_then_the_probe_runs_once | cache | ❌ null instead of the probed colour | ✅ |
| 4 | color.test: given_the_probe_returns_alpha_zero_when_parsed_then_null | transparent stays null | ✅ | ✅ |
| 5 | color.test: given_an_oklch_background_when_snapshotted_then_the_liquid_takes_the_probed_colour | snapshot path | ❌ default purple `[83,52,131,1]` | ✅ |
| 6 | color.test: given_rgb_or_hex_when_parsed_then_the_probe_is_never_called | fast path unchanged; `transparent`, `rgba(0, 0, 0, 0)` and `#0000` stay null and never reach the probe | ✅ | ✅ |
| 7 | landing.test: given_the_chapters_when_read_then_nine_in_order_with_the_design_titles | D86-2 | ❌ `CHAPTERS` is empty | ✅ |
| 8 | landing.test: given_the_config_when_read_then_the_gate_values | D86-3, D86-4 | ❌ zeros in `BODY_OPTIONS` | ✅ |
| 9 | landing.test: given_hero_elements_when_the_arrival_starts_then_each_is_splashed_at_0_8_at_once | D86-4 | ❌ no `splash` call | ✅ |
| 10 | landing.test: given_reduced_motion_when_the_arrival_starts_then_no_splash_and_no_hint | D86-4 | ✅ (the stub does nothing) | ✅ |
| 11 | landing.test: given_no_interaction_for_4_s_when_waiting_then_one_shake_at_0_5 | hint | ❌ no `shake` call | ✅ |
| 12 | landing.test: given_an_interaction_before_4_s_when_waiting_then_no_shake_and_the_listeners_are_gone | hint cancel (pointerdown, keydown, touchstart, wheel, scroll) | ❌ no `removeEventListener` calls (first type, pointerdown) | ✅ |
| 13 | landing.test: given_dial_angles_when_mapped_then_unit_vectors_with_0_down_and_90_right | ch5 dial, playground | ❌ `[0, 0]` | ✅ |
| 14 | landing.test: given_a_pool_when_it_leaves_and_enters_the_viewport_then_pause_and_resume | D86-3 | ❌ `pause` not called | ✅ |
| 15 | landing.test: given_a_stop_when_shown_then_controls_hidden_and_the_line_visible_once | D86-3 `onError` | ❌ controls not hidden | ✅ |
| 16 | landing.test: given_the_code_samples_when_read_then_public_names_and_the_alpha_install_line | resolution 9 | ❌ `INSTALL_LINE` is empty | ✅ |
| 17 | playground-state.test: given_saved_v1_or_v2_state_when_loading_then_discarded_and_null | moved W69, v3 | ❌ `LEGACY_STORAGE_KEYS` lacks the v2 key | ✅ |
| 18 | playground-state.test: given_valid_v3_state_when_loading_then_material_gravity_and_drag_restored | moved W69 + new fields | ❌ `PLAYGROUND_ELEMENT_IDS` not exported yet | ✅ |
| 19 | playground-state.test: given_corrupt_json_when_loading_then_null_and_entry_cleared | moved W69 | ✅ | ✅ |
| 20 | playground-state.test: given_v3_payload_with_out_of_range_material_init_gravity_or_drag_when_loading_then_null_and_entry_cleared | moved W69 + new fields | ✅ (schema 2 rejects every v3 payload) | ✅ |
| 21 | playground-state.test: given_material_bounds_when_checked_then_isValidMaterial_agrees_with_core_validateMaterial_and_defaults_match | moved W69 | ✅ | ✅ |
| 22 | playground-state.test: given_url_params_particles_seed_renderer_when_parsed_then_validated_and_stripped | moved W69 | ✅ | ✅ |
| 23 | playground-state.test: given_material_binding_change_when_applied_then_setMaterial_called_with_partial | moved W69 | ✅ | ✅ |
| 24 | playground-state.test: given_rejected_material_change_when_applied_then_state_reverted_to_instance_material | moved W69 | ✅ | ✅ |
| 25 | playground-state.test: given_material_equal_to_a_preset_within_slider_rounding_when_detected_then_preset_name_else_custom | moved W69 | ✅ | ✅ |
| 26 | codegen.test: given_a_state_when_generated_then_the_exact_create_and_observe_code | "Copy as code" | ❌ stub returns "" | ✅ |
| 27 | codegen.test: given_states_across_every_gravity_source_when_generated_then_the_code_parses | "Copy as code" | ❌ "" has no `vector: [0.55, 0.835]` | ✅ |
| 28 | docs-drift.test: given_the_api_page_when_read_then_every_public_create_option_is_documented | D86-6 | ❌ `api.md` does not exist (ENOENT) | ✅ |
| 29 | docs-drift.test: given_the_api_page_when_read_then_every_instance_member_is_documented | D86-6 | ❌ `api.md` does not exist (ENOENT) | ✅ |
| 30 | docs-drift.test: given_the_docs_folder_when_listed_then_five_pages_with_layout_and_title | D86-6 | ❌ `src/pages/docs` does not exist (ENOENT) | ✅ |
| 31 | deploy-workflow.test: given_deploy_site_yml_when_read_then_dispatch_only_and_it_builds_and_uploads_the_site | D86-7 | ❌ FROZEN header still there | ✅ |
| 32 | workspace-publish: given_root_package_when_read_then_site_in_workspaces_and_in_the_lockfile | inverted W66 | ✅ (infra in W86.1) | ✅ |
| 33 | workspace-publish: given_vitest_config_when_read_then_site_is_a_project | inverted W66 | ✅ | ✅ |
| 34 | workspace-publish: given_deploy_site_yml_when_read_then_only_workflow_dispatch | kept W66 | ✅ | ✅ |
| 35 | workspace-publish: given_site_package_when_read_then_astro_7_and_the_root_vite_and_typescript | D86-7 | ✅ | ✅ |
| 36 | workspace-publish: given_changeset_config_when_read_then_the_private_site_is_ignored | D86-7 | ✅ | ✅ |
| 37 | workspace-publish: given_tweakpane_when_located_then_only_a_site_dependency | D86-5 | ✅ | ✅ |
| 38 | wdd-docs (W77, changed): given_demo_index_when_read_then_it_links_the_scenes_and_no_playground | D86-5 | ✅ | ✅ |
| 39 | vue-error-drag: given_a_config_onError_that_is_not_a_function_when_the_provider_mounts_then_create_rejects_with_its_TypeError_and_the_error_state_holds_it | W85 row 20 twin | ✅ (behaviour exists) | ✅ |
| 40 | e2e-harness: given_the_site_project_when_routed_then_only_site_spec_on_its_own_port_and_blocking | D86-8 | ❌ `routedTo("site")` is `[]` (no project) | ✅ |
| 41 | ci-workflow: given_ci_yml_when_read_then_the_site_is_built_and_its_project_runs_blocking | D86-8 | ❌ no `e2e:site:build` step | ✅ |
| (v) | e2e-harness (changed pin, `:86`): canvas2d runs every spec except smoke, webgpu liquid, perf, record, dist and site | resolution 8 (v) | ❌ `site.spec.ts` still routes to canvas2d | ✅ |
| (v) | e2e-harness (changed pin, `:97-104`): blocking projects are canvas2d, dist, site | resolution 8 (v) | ❌ `['canvas2d', 'dist']` | ✅ |
| (vi) | e2e-harness (changed pin): `PROJECT_RENDERER` gains `site: "canvas2d"` | resolution 8 (vi) | ❌ no `site` entry | ✅ |
| E1 | site.spec: given the landing when it loads then one liquid canvas under the page, nine chapters and no liquiddom warning | D86-2, W82 | ❌ not run: no page (`site/dist` builds 0 pages); listed under canvas2d | ✅ |
| E2 | site.spec: given chapters 3 and 7 when scrolled into view then three and two container canvases and their buttons work | D86-3 | ❌ not run (no page) | ✅ |
| E3 | site.spec: given the last chapter 6 card when scrolled to then its liquid appears at rest | step 7, D86-3 | ❌ not run (no page) | ✅ |
| E4 | site.spec: given reduced motion when the landing rests then the hero drop's liquid has its oklch colour, not the default purple | D86-9, D86-4 | ❌ not run (no page) | ✅ |
| E5 | site.spec: given the playground when the honey preset is applied and the page reloaded then the material is restored from liquiddom-playground-v3 and v1/v2 are gone | moved W69 e2e: v1 and v2 seeded before every load and null after each load; the instance holds honey right after `applyPreset` and after the reload | ❌ not run (no page) | ✅ |
| E6 | site.spec: given every docs page when loaded then it has its title and no liquid canvas | D86-6 | ❌ not run (no page) | ✅ |
| E7 | site.spec: given a 390 px phone viewport when the landing loads then nothing scrolls sideways | mobile | ❌ not run (no page) | ✅ |

The E rows were listed (`npx playwright test --list`: canvas2d 108, webgpu 51, webgpu-hw 99, perf 6, dist 2) and type-checked (`npm run e2e:typecheck` clean), not run; they need the built site (W86.4).

## Must NOT
- Use `@internal` API, `runtimeOf()` or a scene test hook in the site.
- Change the engine or the public API of any package.
- Move a Linux baseline; dispatch `deploy-site.yml`; publish.
- Change a test Dennis approved without his approval.
- Copy spike code (D2).

## Must DO
- Keep every ancestor of an observed element transparent (W82).
- Run under reduced motion with every control usable and nothing moving.

## Manual Smoke Test
Written after the W86.0 gate (part 2 of the plan).

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:site`, `npm run e2e:dist`; WebGPU locally; vision of the landing, the playground and the docs in both renderers, desktop and phone width.
