---
ward: 82
revision: null
name: "Under the page"
epic: "fluid-engine"
status: "approved"
dependencies: [81]
layer: "both"
estimated_tests: 31
created: "2026-10-14"
completed: null
---
# Ward 082: Under the page

North star: steps 1, 3 and 6 on the landing page and the acceptance scene (escaped liquid goes under the page's own content in both renderers; the landing page's open W77 findings closed or ruled on); steps 2, 4, 5, 7 and 8 unchanged. Every baseline that moves is shown to Dennis with vision first (D65-7).

## Scope
Third ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §5). The canvas moves under all page content (`z-index: -1` in body mode; container mode needs a stacking context), so a splash or a shake never paints over unobserved page text (slice-4 finding, `.wdd/memory/whole-picture/slice-4.md:53`). The three W77 landing findings still open (`slice-4-addendum.md`, "Still open (not fixed in W77)") are measured and each closed or accepted at the gate: the Canvas2D stair-step edge (3.5 px cell), the dark card reaching past the right viewport edge under shake, and "Book a demo" drawn into a bead chain at f20. The techniques for D82-2 … D82-6 come from the measurement spike W82.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W82.md`, part 1); the rest of the plan (part 2) is written after the gate.

Out of scope: gravity (W83), touch drag (W84), the adapters (W85), the site (W86), liquid above the DOM and border/shadow (spec §7), the other W76 carry-overs (`:hover` colour, icon chips, WebGPU hover tilt).

## Inputs
- The slice design §5, §11, §12 (D82-1 … D82-6) and the spec §4 canvas as amended in `17ede66` (`z-index: -1`, container stacking context).
- `stylesheet.ts` (`createLiquidCanvas`, `mountLiquidCanvas`, `remountLiquidCanvas`, the D7 `data-liquid-stack` rules, `stackingFor`), `runtime.ts` (`STATIC_CONTAINER_WARNING`), `density-grid.ts` (`densityCellPx`), `kernel-params.ts` (`DENSITY_THRESHOLD`, `EDGE_SOFTNESS`), `interaction.rs` (shake), `material.rs` (`TENSION_MAX`), `grid.rs` (walls).
- `demo/scenes/landing.html`, `e2e/landing.spec.ts`, `e2e/lace.ts` (W77 bounds), the 13 Linux baselines.
- Baseline at `455a92e` (W81 complete): see the table under Specification.

## Outputs
- Rust: `src/fluid/viewport.rs` (`Viewport`, `EDGE_MIRROR_PX`, `mirror_outward`), `FluidCore::set_viewport(w, h)`, `shake` mirrors near the viewport edges (D82-5).
- TS: `stacking.ts` (the create and observe checks, D82-1, D82-2); the canvas at `z-index: -1`, the one-way `z-index: 0` fallback with one `console.warn`, `holdStacking`/`releaseStacking` (D82-3); `set_viewport` from the runtime; Canvas2D cell `ceil(R)/6` (D82-4).
- Demo: `demo/scenes/under-page.html` (`?page=body|opaque|wrapper|isolate|relative`, RAF by default).
- Tests: 5 Rust, 15 vitest, 11 e2e (9 canvas2d, 2 webgpu-hw); the approved-test changes listed under Tests.
- Docs: spec §2, §3, §4; CLAUDE.md; CONTEXT (D82-6 as a known limitation); changeset.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D82-1: Stacking — the canvas under all page content
Proposal: body mode puts the canvas at `z-index: -1` in the root stacking context, so every page box, its text and the observed elements paint above escaped liquid. Container mode: the canvas sits at `z-index: -1` inside the container when the container is a stacking context (`isolation: isolate`, a `z-index` other than `auto`, …); when it is not, one `console.warn` at `create()` and the instance falls back to `z-index: 0` (today's behaviour), because without a stacking context the liquid escapes under the container's own background and every observed element vanishes (W82.0 Q1d). liquiddom never restyles the container, `<html>` or `<body>` (brainstorm 2026-10-13, saga dec_645b54e4; the container fallback is new from the spike).
Consequence: escaped liquid never covers page text (Q1a: covered glyph pixels on the hero paragraph 86 → 0 under a strength-2 splash, 137 → 0 under a strength-2 shake, both renderers); two z-0 bugs disappear (the label of an element inside a transformed ancestor, author dropdowns hidden by the liquid; Q1c). All 13 Linux baselines are pixel-identical (Docker, maxDiffPixelRatio 0, twice). Approved tests change at red: `a11y.spec.ts:53-55` and `webgpu-robust.spec.ts:906` (they assert canvas z-index 0), `stylesheet.test.ts` (the canvas style and the D7 rules). At HEAD the default splash and shake no longer reach page text (W77 calmed them), so the red e2e uses strength 2.
Decision: APPROVED 2026-10-14 — canvas at z-index -1 in body mode; in container mode -1 when the container is a stacking context, else one console.warn and a z-index 0 fallback; container, html and body never restyled; confirms the brainstorm choice (saga dec_5cee9fcb)

### D82-2: Opaque `<html>` and `<body>` backgrounds
Proposal: at `create()` (the canvas's ancestor chain) and at `observe()` (the element's ancestor chain) liquiddom looks for an opaque background between the canvas and the root stacking context: any ancestor box with a non-transparent `background-color` or a `background-image`; `<body>` counts only when `<html>` has its own background (otherwise body's background propagates to the canvas, which is fine). On the first hit: one `console.warn` naming the element and the fix ("make it transparent or give liquiddom a container with `isolation: isolate`"), and the instance falls back to `z-index: 0` with the D7 rules (today's behaviour) for the rest of its life.
Consequence: pages with opaque html + body, an opaque wrapper (`.wrap`, a white `<main>`) or html with any alpha keep working as today (Q1b: without the fallback the liquid is 0 px visible and the CTAs become invisible); everyone else gets the canvas under the page. A check of only "html and body both opaque" misses the wrapper and `<main>` cases (measured). Cost: a computed-style walk per observe (outside the frame loop); the fallback is per instance and one-way.
Decision: APPROVED 2026-10-14 — ancestor-chain check at create() and observe() (body counts only when html has its own background); the first opaque hit gives one console.warn and the instance falls back to z-index 0 with the D7 rules (saga dec_aee06d64)

### D82-3: The observed-element `z-index: 1` rule (D7)
Proposal: drop the `data-liquid-stack` rules (`position: relative; z-index: 1` and `z-index: 1`) for an instance whose canvas sits at `z-index: -1`; keep them for an instance that fell back to `z-index: 0` (D82-1 container fallback, D82-2).
Consequence: liquiddom stops restyling authors' elements in the normal case (Q1c: text, children, focus ring, a positioned `z-index: auto` element and an element inside a transform all paint above the liquid without the rule; the acceptance scene is pixel-identical); keeping the rule at z −1 would make card text paint through author dropdowns. `stackingFor`/`data-liquid-stack` stay for the fallback, so the refcounted decoration keeps one code path.
Decision: APPROVED 2026-10-14 — drop the data-liquid-stack rules at z-index -1, keep them for an instance that fell back to z-index 0 (saga dec_94c7834f)

### D82-4: Canvas2D edge on the landing (stair-step at a 3.5 px cell)
Proposal: Canvas2D's density cell becomes `ceil(R)/6` instead of `ceil(R)/4` (`DENSITY_CELLS_PER_RADIUS` 4 → 6), the 2 px floor and the fine-spacing bound kept; `EDGE_SOFTNESS` stays 0.1 (it is shared with WebGPU).
Consequence: the moving Canvas2D edge on the landing page is smooth (Q2: roughness f10/f20 0.225/0.269 → 0.180/0.196 px, WebGPU 0.116/0.149; vision: the notches on the dark card's left edge are gone); no Linux baseline moves (the acceptance scene stays on the 2 px floor). Cost: Canvas2D render time on pages with large kernels ≈ 2.8× (landing 2.6 → 7.4 ms per frame on this Mac); the acceptance and stress scenes are unchanged. `/5` is the compromise (1.5× for half the gain); a softer threshold was rejected (transparent stripes inside the card, alpha < 240 pixels 1170 → 5231). Approved tests change at red: the `kernel-params` / `density-grid` unit tests that pin 4 and the 13.04 → 3.5 px example.
Decision: APPROVED 2026-10-14 — Canvas2D density cell ceil(R)/6 (DENSITY_CELLS_PER_RADIUS 6), 2 px floor and fine-spacing bound kept, EDGE_SOFTNESS 0.1 kept (saga dec_34ee6dd6)

### D82-5: Liquid past the viewport edge under shake
Proposal: shake mirrors its outward direction per element when the element's home rect lies within 80 px of a viewport edge, so an element near the edge sloshes inward instead of being clipped flat; Rust learns the viewport through one new scalar call `set_viewport(w, h)` (buffer px, called by the runtime at create and from `resizeCanvas()`; the world stays `max(screen, inner)`).
Consequence: the dark landing card no longer reaches past the right edge (Q3: particles outside the viewport 112 → 0, dark pixels in column 1279 181 → 0; "Sign in" no longer leaves the top: 78 particles above y 0 over 29 frames → 0); elements still slosh; acceptance step-6 diff 0; W77 tear 13/61 (bound 400); cargo 223 green. The wall itself was never the problem (it sits at x 1488, the card peaked at 1285); a per-particle wall term and world = inner measured no effect. Cost: one new scalar call (FFI addition, no layout change). Alternative: accept (the canvas clips at the viewport).
Decision: APPROVED 2026-10-14 — shake mirrors its outward direction per element within 80 px of a viewport edge; new scalar call set_viewport(w, h) from create and resizeCanvas (saga dec_adb31552)

### D82-6: Thin wide elements beading under shake ("Book a demo" at f20)
Proposal: accept the "Book a demo" bead chain as a known limitation in W82 (CONTEXT): it lasts 5 frames (f18–f23) of a strength-1 shake and every element re-forms within budget (76/139/136 of 180 frames).
Consequence: no physics change. Yield is the wrong lever (Q4: a lower yield for thin elements gives more beads, a higher one changes nothing because J never reaches 1.46 there); the beads come from the shake's sinus profile stretching a 54 px strip along its long axis. The fix that works, a thickness-scaled profile amplitude, breaks D70-5's slosh floor on the acceptance pills (Split 7.7–8.4 px against the floor of 10), three golden tests and the step-6 baseline (1.06–1.74 %); scaling only the long-axis component is untested. Alternative: that fix, with D70-5 amended.
Decision: APPROVED 2026-10-14 — accept the Book a demo bead chain as a known limitation in W82, no physics change (saga dec_09c2f0ea)

## Spike W82.0 result (2026-10-14, throwaway copies of `bc4deaa`, 1280 × 800, seed 1, manual clock; reports in `.superpowers/sdd/W82/spike-Q1.md`, `spike-Q2.md`, `spike-Q34.md`, stills inspected with vision)

| Q | Candidate | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1a | canvas `z-index: -1` vs 0 | covered glyph pixels on the hero paragraph, strength-2 splash 86 → 0, shake 137 → 0 (14 px antialiased edges), both renderers; default splash/shake reach no text at HEAD | text over the liquid at −1; "SQL", "Riverbase" covered at 0 | −1 (D82-1) |
| Q1b | html/body backgrounds at −1 | body only, html only, neither: work; html + body opaque, an opaque wrapper, a white `<main>`, html with any alpha: liquid 0 px visible, the CTAs vanish | confirmed (CTA labels invisible) | ancestor-chain check + warn + z-0 fallback (D82-2) |
| Q1c | D7 `z-index: 1` rule at −1 | acceptance scene pixel-identical with and without; text, children, focus ring, positioned `z-index: auto`, element in a transform all above the liquid without it; at z 0 a label in a transformed ancestor and author dropdowns are hidden today | — | drop at −1, keep for the fallback (D82-3) |
| Q1d | container | `isolation: isolate` or a `z-index`: liquid above the container background, under its text (0 glyph px); `position: relative` only with a background: 0 px visible, elements vanish | — | stacking context or warn + z-0 fallback (D82-1) |
| Q1e | Docker Canvas2D, no update | 13 / 13 baselines 0 changed pixels (z −1 with and without the rule); only the a11y z-index asserts fail | — | no baseline moves |
| Q2 | density cell /4 (3.25 px), /5, /6, /8, softness 0.2 | roughness (7-px window) f10/f20: 0.225/0.269, —, 0.180/0.196, 0.170/0.185, 0.153/0.172 (WebGPU 0.116/0.149); landing render 2.6, 3.9, 7.4, 18.1, 2.6 ms; no baseline moves except softness 0.2 (step 6: 477 px) | /4 notched, /6 and /8 smooth, softness 0.2 striped | /6 (D82-4) |
| Q3 | (i) accept, (ii) per-particle wall term, (ii-c) per-element mirror within 80 px of the viewport, (iii) world = inner | dark card past x 1280: 112 particles / 181 px in col 1279 (i), unchanged (ii), 0 / 0 (ii-c), unchanged (iii); "Sign in" above y 0: 78 particles × 29 frames → 0 (ii-c); step-6 diff 0; W77 tear 13/61 | (i) clipped flat at the edge; (ii-c) sloshes inward | (ii-c) + `set_viewport` (D82-5) |
| Q4 | (i) thickness yield, (ii-p) thickness profile amplitude, (ii-v) thickness speed, (iii) accept | lobes ≥ 3 frames: 5 (HEAD), more with lower yield, 5 with higher, 0 (ii-p, refs 80–200 px) but Split slosh 7.7–8.4 px < D70-5 floor 10 and step-6 1.06–1.74 %; (ii-v) pills tame (RMS 5.6 px, 2.4 %); re-form 76/139/136 of 180 everywhere | chain of 3–4 beads at f20 in both renderers | accept in W82 (D82-6) |

## Specification
**Values.** `CANVAS_Z_UNDER = "-1"`, `CANVAS_Z_FALLBACK = "0"`; `EDGE_MIRROR_PX = 80`; `DENSITY_CELLS_PER_RADIUS = 6`, `FINE_CELL_STEPS_PER_PX = 4` (the 2 px floor and `EDGE_SOFTNESS` 0.1 unchanged); `CONTAINER_STACKING_WARNING`, `OPAQUE_BACKGROUND_WARNING` (`stacking.ts`).

**Stacking (TS, D82-1 … D82-3).** `createFluidRuntime` runs `canvasBlocker(container)` before the mount: container mode → `formsStackingContext(container)` or `CONTAINER_STACKING_WARNING`; body mode → `opaqueAncestor(body)` (body counts only when html has its own background) or `opaqueBackgroundWarning(body)`. The canvas mounts at `-1`, or at `0` with that warning logged once in `buildRuntime`. Every fresh `observe()` of an instance still under the page runs `opaqueAncestor(el.parentElement, container ?? null)` (any alpha > 0 or a `background-image`; `.liquid-element` ancestors skipped); a hit calls `fallBack()`: the current canvas to `0`, `registry.stackAll()`, one `console.warn`, for good. A fallback instance's registry holds `data-liquid-stack` on each observed element (`holdStacking` at observe and at the fallback, `releaseStacking` at unobserve; refcounted per element across instances, the author's value restored); `decorateElement` no longer stacks; `remountLiquidCanvas` keeps the old canvas's z-index. The sheet text is unchanged.

**Viewport (D82-5).** Rust: `set_viewport(w, h)` stores `Viewport::sanitized` (finite > 0 per axis, ≤ `WORLD_MAX_PX`, else unknown); `shake_slot` mirrors the outward component of the element's direction per axis when its home rect lies `< 80` px from that axis's edge (not when near both edges, not on an unknown axis). TS: `sendViewport(w, h)` (the canvas's CSS size: `innerWidth × innerHeight` or the container's client box) once before the first frame and from `resizeCanvas()` when it changed; never after a failed frame.

**Canvas2D (D82-4).** `densityCellPx = max(2, min(ceil(maxR) / 6, floor(4 · minR / 2.3) / 4))`.

**Baseline (2026-10-14, `455a92e`).**

| Suite | Count |
|---|---|
| cargo | 223 passed; 0 failed; 2 ignored |
| vitest | 737 passed, 4 skipped (741), 72 files |
| Playwright `--list` | canvas2d 85, webgpu 51, webgpu-hw 95, perf 6 |

## Tests

| # | Test Name | Verifies | Red outcome | Gold outcome |
|---|-----------|----------|-------------|---|
| 1 | viewport.rs: given_set_viewport_values_when_sanitized_then_finite_positive_extents_are_kept_up_to_world_max_and_the_rest_is_unknown | D82-5 sanitising | ❌ the stub keeps nothing (`Viewport { w: 0.0, h: 0.0 }`) | ✅ cargo (228 passed) |
| 2 | viewport.rs: given_a_home_rect_within_80_px_of_a_viewport_edge_when_mirrored_then_only_the_outward_component_flips | D82-5 rule, W82 RF4 | ❌ "outward right flips" (stub); round 1 adds the strict 80 px bound (guard), a rect beyond the edge, a half-unknown viewport (not reached at red) | ✅ cargo (228 passed) |
| 3 | viewport.rs: given_an_element_40_px_from_the_right_edge_whose_shake_points_outward_when_shaken_with_the_viewport_then_its_x_velocity_is_mirrored_bit_for_bit_and_the_far_card_is_untouched | D82-5 in the core, RF4 | ❌ "vx mirrored" (shake not wired) | ✅ cargo (228 passed) |
| 4 | viewport.rs: given_no_element_within_80_px_of_an_edge_when_shaken_and_ticked_with_and_without_the_viewport_then_the_core_is_bit_identical | W81 bit-identity, RF4 | ✅ passes (guard) | ✅ guard: bit-identical away from the edges and before `set_viewport` |
| 5 | viewport.rs: given_reduced_motion_when_set_viewport_and_shake_then_nothing_moves | reduced motion | ✅ passes (guard) | ✅ cargo (228 passed) |
| 6 | stacking.test: given_computed_styles_when_formsStackingContext_then_isolation_a_z_index_on_a_positioned_box_or_a_flex_item_opacity_transforms_and_the_other_triggers_form_one_and_a_plain_relative_box_does_not | D82-1 container test | ❌ stub (always true) | ✅ vitest (752 passed) |
| 7 | stacking.test: given_computed_colours_when_hasOwnBackground_then_any_alpha_above_0_or_an_image_counts_and_transparent_does_not_in_every_colour_syntax | D82-2 "opaque" | ❌ stub | ✅ vitest (752 passed) |
| 8 | stacking.test: given_a_dom_when_opaqueAncestor_walks_up_then_body_counts_only_when_html_has_a_background_an_opaque_wrapper_counts_the_stop_ends_the_walk_and_an_observed_element_is_skipped | D82-2 chain rule | ❌ stub (null); round 1 adds html-only (guard) | ✅ vitest (752 passed) |
| 9 | stacking.test: given_a_container_or_the_body_when_canvasBlocker_then_a_stacking_context_container_and_a_page_without_an_opaque_body_pass_and_each_warning_names_the_fix | D82-1, D82-2 at create, warning text | ❌ stub (null); round 1 adds html-only and an isolated container on an opaque page (guards) | ✅ vitest (752 passed) |
| 10 | under-page-runtime.test: given_body_mode_without_an_opaque_page_when_created_and_observing_then_the_canvas_is_at_z_index_minus_1_nothing_warns_and_no_element_gets_data_liquid_stack | D82-1, D82-3 | ❌ z-index "0" | ✅ vitest (752 passed) |
| 11 | under-page-runtime.test: given_opaque_html_and_body_when_created_then_one_console_warn_names_body_the_canvas_is_at_z_index_0_and_every_observed_element_is_stacked_D7 | D82-2 at create | ❌ no warning | ✅ vitest (752 passed) |
| 12 | under-page-runtime.test: given_an_opaque_wrapper_when_an_element_inside_it_is_observed_then_one_warn_names_it_the_canvas_drops_to_z_index_0_every_observed_element_is_stacked_and_the_fallback_is_one_way | D82-2 at observe, RF1 | ❌ z-index "0" before the wrapper | ✅ vitest (752 passed) |
| 13 | under-page-runtime.test: given_container_mode_when_the_container_is_or_is_not_a_stacking_context_then_minus_1_without_a_warning_or_one_container_warning_and_the_z_0_fallback | D82-1 container, never restyled | ❌ z-index "0"; round 1 runs it on an opaque page | ✅ vitest (752 passed) |
| 14 | under-page-runtime.test: given_one_element_observed_by_an_instance_under_the_page_and_by_one_in_the_fallback_when_destroyed_in_either_order_then_data_liquid_stack_is_held_while_the_fallback_instance_observes_it_and_the_element_is_restored_exactly | D82-3 shared refcount, RF2 | ❌ the body instance's canvas is at "0" (round 1), the instance under the page stacks | ✅ vitest (752 passed) |
| 15 | under-page-runtime.test: given_renderer_auto_without_webgpu_when_the_canvas_is_remounted_then_it_keeps_the_instance_z_index_under_the_page_and_in_the_fallback | design resolution 1, RF3 | ❌ z-index "0"; round 1 proves the remount happened (guard, passes now) | ✅ vitest (752 passed) |
| 16 | stylesheet.test: given_a_fresh_mount_and_a_canvas_at_z_index_0_when_remounted_then_the_fresh_one_is_at_minus_1_and_a_remount_keeps_the_old_z_index | D82-1 mount, RF3 | ❌ z-index "0" | ✅ vitest (752 passed) |
| 17 | stylesheet.test: given_holdStacking_twice_when_released_once_and_twice_then_data_liquid_stack_stays_until_the_last_release_and_the_author_value_is_restored | D82-3 hold | ❌ stub (no attribute) | ✅ vitest (752 passed) |
| 18 | viewport-runtime.test: given_body_mode_when_created_and_the_window_resizes_then_set_viewport_gets_the_inner_size_before_the_first_tick_and_again_from_the_resize_handler | D82-5 in the runtime | ❌ no set_viewport call; round 1 adds an unchanged resize sends nothing (not reached at red) | ✅ vitest (752 passed) |
| 19 | viewport-runtime.test: given_container_mode_when_created_and_the_container_resizes_then_set_viewport_gets_its_client_box_and_after_a_failed_frame_nothing_is_called | D82-5 container, stopped core | ❌ no set_viewport call | ✅ vitest (752 passed) |
| 20 | fluid-ffi.test: given_the_real_core_with_a_pill_40_px_from_the_right_edge_when_shaken_after_set_viewport_then_an_outward_shake_turns_inward_and_the_acceptance_elements_stay_bit_identical | the WASM export, RF4 | ❌ no seed mirrored (stub) | ✅ vitest (752 passed) |
| 21 | e2e under-page (canvas2d): D82-1 – given the landing page when Start free splashes at strength 2 then no liquid covers a glyph of the hero paragraph (page-pixel probe) | D82-1 body mode, RF5 | ❌ covered 79 of 1399 ink px at f36 | ✅ 0 covered ink px; liquid behind the lede 893 px (macOS), 765 px (Linux) |
| 22 | e2e under-page (canvas2d): D82-1 – given the landing page when the instance shakes at strength 2 then no liquid covers a glyph of the hero paragraph (page-pixel probe) | D82-1 body mode, RF5 | ❌ covered 102 at f26 | ✅ 0 covered ink px; liquid behind the lede 2013 px (macOS), 1978 px (Linux) |
| 23 | e2e under-page (canvas2d): D82-5 – given the landing page when the instance shakes then the dark card's liquid never reaches the right viewport edge and Sign in's never reaches the top edge | D82-5 | ❌ Σ 1693 dark px in the last column (peak 181) | ✅ right column dark px Σ 0 (181 at HEAD), top row tint Σ 0, macOS + Linux |
| 24 | e2e under-page (canvas2d): D82-4 – given the landing page shaken when the Canvas2D renderer draws the moving liquid then its density cell is ceil(R)/6, at most 14/6 px | D82-4 | ❌ cell 3.25 px | ✅ cell 2.17 px (13/6) at shake f10, macOS + Linux |
| 25 | e2e under-page (canvas2d): D82-1 – given a page whose only background is body's when created then no warning, the canvas sits at z-index -1, the pill carries no data-liquid-stack and its liquid shows on the page | D82-1, D82-3 in the browser | ❌ z-index "0" | ✅ macOS + Linux (Docker) |
| 26 | e2e under-page (canvas2d): D82-2 – given opaque html and body backgrounds when created then one console.warn names <body>, the canvas falls back to z-index 0, the pill is stacked and its liquid shows | D82-2 at create | ❌ no warning | ✅ macOS + Linux (Docker) |
| 27 | e2e under-page (canvas2d): D82-2 – given an opaque wrapper around the observed pill when observed then one console.warn names <div.wrap>, the canvas falls back to z-index 0 and the liquid shows | D82-2 at observe, RF1 | ❌ no warning; round 1 adds the pill is stacked "z" (not reached at red) | ✅ macOS + Linux (Docker) |
| 28 | e2e under-page (canvas2d): D82-1 – given a container with isolation: isolate when the pill splashes at strength 2 then no warning, the canvas is at z-index -1 inside it, the liquid shows above the container's background and no glyph of its paragraph is covered | D82-1 container, RF5 | ❌ z-index "0" | ✅ 0 covered ink px; liquid behind #note 1319 px (macOS), 1403 px (Linux) |
| 29 | e2e under-page (canvas2d): D82-1 – given a positioned container that is not a stacking context when created then one console.warn names the fix, the canvas falls back to z-index 0 and the liquid shows | D82-1 container fallback | ❌ no warning | ✅ macOS + Linux (Docker) |
| 30 | e2e webgpu-robust (webgpu-hw): W82 D82-1 – given renderer webgpu on the landing page when Start free splashes and the instance shakes at strength 2 then no liquid covers a glyph of the hero paragraph | D82-1 in WebGPU, RF5 | ❌ splash covered 71 at f36, shake 372 at f28 | ✅ Metal: splash 0 covered (830 px behind), shake 0 (3609 px behind) |
| 31 | e2e webgpu-robust (webgpu-hw): W82 D82-1 – given renderer webgpu in a container with isolation: isolate when the pill splashes at strength 2 then the canvas is at z-index -1 inside it and no glyph of the paragraph is covered | D82-1 container in WebGPU, RF5 | ❌ z-index "0" | ✅ Metal: 0 covered (1085 px behind #note) |

Approved-test changes at red (Dennis approves with the tests): `stylesheet.test.ts` (the D66-3 stacking block on a fallback instance; the canvas mount and remount at `z-index: -1`), `facade-fixes.test.ts` (the shared-element test on fallback instances), `kernel-params.test.ts` (four tests: `ceil(R)/6`), `auto-renderer.test.ts` and `device-lost.test.ts` (the W72 container-remount containers get `z-index: 0`), `e2e/a11y.spec.ts` and the W75 a11y test in `e2e/webgpu-robust.spec.ts` (Split unstacked, canvas `z-index: -1`).

**Gold run (2026-10-14, HEAD 9ea44fa).**
- **Counts:** cargo 228 passed, 0 failed, 2 ignored; vitest 75 files, 752 passed, 4 skipped (756); clippy clean (`-D warnings`); `npm run e2e:typecheck` clean; `npm pack --dry-run -w liquiddom` 80 files (W81 78 + `dist/stacking.js`, `dist/stacking.d.ts`).
- **e2e:** canvas2d (macOS) 79 passed, 15 skipped; webgpu-hw (Metal) 53 passed, 44 skipped; Docker Linux canvas2d without `--update-snapshots` 92 passed, 2 skipped, 0 failed (W81: 83/2), `e2e/__screenshots__` untouched: no baseline moved.
- **Probes:** covered glyph ink px on the hero paragraph 0 under a strength-2 splash and shake in Canvas2D (macOS, Linux) and WebGPU (Metal), with the liquid behind the text (893/2013, 765/1978, 830/3609 px; W82.0 at z 0: 86/137); the isolated container 0 (1319/1403/1085 px behind); D82-5 right column dark px 0 (181 at HEAD), top row tint px 0; Canvas2D cell 2.17 px (3.25 before).
- **Vision (approved by Dennis 2026-10-14):** landing splash/shake at strength 2 in both renderers (the lede's letters above the liquid), the default shake at f10/f20 (the dark card sloshes inward, "Sign in" stays on the page, "Book a demo" beads as D82-6 accepts), the Canvas2D card edge at 2× (no 3.5 px steps), `under-page.html` body / opaque / wrapper / isolate / relative (text above the liquid under the page; W81's look with one warning in the three fallbacks).
- **Reviews:** red task review (two Important gaps: html-only background, an isolated container on an opaque page; fixed in fix round 1 with five minors, re-review ✅); W82.2 ✅/✅; W82.3 ✅/✅ with `isNone` fixed for multi-layer `none, none` (9180695). Ward review: ready for gold; doc findings fixed in 9ea44fa (which helpers read screenshots; the container warning names the fix). Parked and documented: a stacking-context `<body>` still falls back, a negative-z ancestor context and ancestors beyond a shadow host are not detected, two warnings for a static non-isolated container, `set_viewport` requested twice at create (deduped). Offered to Dennis at gold: an ink floor in the probes (a box without glyph ink would pass vacuously).
- **Manual smoke:** pending Dennis at the live URLs below (both renderers).

## Must NOT
- Restyle the author's container, `<html>` or `<body>`.
- Move a Linux baseline without Dennis' vision approval (D65-7).
- Copy spike code into the repo (D2).
- Change the FFI layout, the 7-arg constructor or the public API beyond what a gate decision names.

## Must DO
- Keep the canvas `aria-hidden`, `pointer-events: none`, hidden in print and forced colours (D66-15).
- Measure each W77 finding before deciding it (W82.0).

## Manual Smoke Test
### Setup
`npm run dev`, then `http://localhost:3000/scenes/landing.html?renderer=auto` (Metal: WebGPU), `…?renderer=canvas2d`, and `http://localhost:3000/scenes/under-page.html?renderer=auto` with `?page=opaque`, `wrapper`, `isolate`, `relative`.

### Steps
1. Open `http://localhost:3000/scenes/landing.html` (RAF clock), press "Start free" and shake from the console.
   Verify: the liquid passes under the hero paragraph's text, never over it; the observed elements' text stays on top.
2. Same in `?renderer=canvas2d`.
   Verify: the edge as decided in D82-4; "Book a demo" as decided in D82-6; the dark card as decided in D82-5.

### Pass criteria
- [ ] No liquid over unobserved page text in either renderer.
- [ ] The three W77 findings behave as their decisions say.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, `npm run e2e:docker -- --project=canvas2d` (every Linux baseline unchanged, no `--update-snapshots`), vision on the landing page and `under-page.html` in both renderers.
