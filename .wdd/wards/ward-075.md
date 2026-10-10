---
ward: 75
revision: null
name: "Text that stays true"
epic: "fluid-engine"
status: "planned"
dependencies: [74]
layer: "typescript"
estimated_tests: 43
created: "2026-10-10"
completed: null
---
# Ward 075: Text that stays true

North star: step 8 gains "+ forced-colors ✅" (S4 column): with `liquid-text` active mid-splash under WebGPU, forced colours and print show the DOM text at once; step 3 "✅ W with text" stays true when text, fonts, DPR or colours change; steps 3, 4 and 6 in Canvas2D keep the DOM text readable while the liquid is away (halo).

## Scope
W74 makes the text flow with its liquid under WebGPU. This ward keeps it true to the DOM while the page changes under it, and closes the Canvas2D contrast gap carried since the slice-2 check:
- a per-element `MutationObserver` (`childList`, `characterData`, `subtree`, `style`/`class`) that never reacts to liquiddom's own class writes or to the colour snapshot, coalesced to one application per frame;
- colour auto-refresh (D66-12's promise) on a `style`/`class` change and on `transitionend` for `color`/`background-color`, with `refresh()`'s method (W74's `liquid-text` rule never sets `color`, so no extra lift);
- atlas re-render on text mutations, `document.fonts` `loadingdone` and a DPR/zoom change (`matchMedia` resolution listener plus the resize path), through W74's runtime-owned `TextAtlas.invalidate(id)`;
- forced colours and print with `liquid-text` active (live switches mid-splash), `refresh()` mid-motion, axe and the focus ring under WebGPU;
- the Canvas2D halo: `liquid-halo` while an element moves under Canvas2D, a `text-shadow` in its own background colour through one rule per element in the refcounted sheet, no inline style; new Canvas2D Linux baselines approved by Dennis.

Out of scope: the atlas itself, F, the text pass and the `liquid-text` toggle (W74); detecting colour changes outside the element without a colour transition (a new stylesheet rule, an ancestor class: `refresh(el)` stays); drag/merge (slice 5); scroll, resize, parking (slice 6); any Rust change.

## Inputs
- W74: `renderers/webgpu/text-atlas.ts` (`TextAtlas.invalidate(id)`, `stale`, `version`), owned by the runtime (`textAtlas`, rebuilt in `frameBody` while stale, before `render()`); `RenderFrame.textAtlas`, `ElementPaint.atlasRect`; `text-toggle.ts` (`syncTextClasses`, `clearTextClasses`, `releaseTextClass`); `stylesheet.ts` `TEXT_CLASS`, `addTextClass`/`removeTextClass` and the `-webkit-text-fill-color` text rule; the runtime's `syncText()` after `render()` and its fail-safe paths; test helpers `forceRestAlpha`, `_fake-atlas.ts`.
- W66/W72: `color.ts` `snapshotColorsWithout` (class lift, `transition: none`, exact attribute restore), `element-registry.ts` (`refresh`, decorate/undecorate), `stylesheet.ts` (`acquireLiquidStyles`, `LIQUID_CSS` with the D66-15 media scope), `runtime.ts` (frame order, `resizeCanvas`, destroy), the acceptance scene hook, `e2e/webgpu-robust.spec.ts` helpers, `e2e/modes.spec.ts` / `e2e/a11y.spec.ts` patterns, the slice-2 report's Carried row "DOM text contrast while the liquid is away" (halo proposal) and D72-5 (the halo waits for slice 4).

## Outputs
- `element-observer.ts`: `ElementObserver` (`observe`, `unobserve`, `disconnect`, `drain`, `size`), `OWN_CLASSES`, `OBSERVER_INIT`, `authorClasses`, `DomChange`, `MutationObserverFactory`.
- `halo-toggle.ts`: `wantsHalo`, `syncHaloClasses`, `clearHaloClasses`, `releaseHaloClass` (W74's `text-toggle.ts` pattern: per-instance `held`, sweep).
- `stylesheet.ts`: `HALO_CLASS`, `HALO_ID_ATTR`, `HALO_BLUR_PX`, `haloRule`, `acquireHaloRule`, `updateHaloRule`, `releaseHaloRule`, `addHaloClass`, `removeHaloClass`; one private `classHolds` helper behind both the text and the halo class; the sheet = `LIQUID_CSS` + halo rules.
- `color.ts` unchanged: the registry keeps lifting only `liquid-element`.
- `runtime.ts`: `applyDomChanges()` per frame (calls `textAtlas.invalidate(id)`), `syncHalo()`, `@internal textInvalidations`, halo cleared on a failed frame or rebuild; scene hook `textInvalidations`.
- e2e: `e2e/halo.spec.ts` (canvas2d, blocking), the W75 block in `e2e/webgpu-robust.spec.ts` (webgpu-hw); regenerated Canvas2D baselines for steps 3, 4, 6.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D75-1: Per-element MutationObserver and atlas re-render triggers
Proposal: one `MutationObserver` per observed element with `childList`, `characterData`, `subtree`, `attributes` filtered to `style` and `class`, `attributeOldValue`. Per (node, attribute) only the first record of a batch is compared (its old value is the value before the batch) with the value now; `class` is compared with `liquid-element`, `liquid-text` and `liquid-halo` removed. A changed `style`/`class` marks the element colour + text dirty; `childList`/`characterData` marks it text dirty. The callback only records; the runtime drains once per frame before `registry.sync()` (`takeRecords()` included). Text dirty → the runtime calls W74's `TextAtlas.invalidate(id)` (the runtime owns the atlas; no renderer hook); W74's frame rebuilds a stale atlas and the paints before `render()` in the same frame, so the first frame after the change already draws the new text and no frame draws stale glyphs. `document.fonts` `loadingdone` and a DPR change (a `matchMedia("(resolution: Ndppx)")` listener re-armed per change, plus the resize path) invalidate every observed element once on the next frame.
Consequence: up to `maxElements` (32) observers per instance; liquiddom's own writes (toggles, the snapshot's class lift and `transition: none` round trip) never loop because they are net-zero inside one task. An author change reverted within the same task is invisible (net zero). An author who rewrites an element's inline style every frame causes one colour snapshot (a forced style flush) and one atlas re-render per frame; the DOM text stays visible during those frames. The atlas is re-rendered per element, never per frame without a change.
Decision: AMENDED 2026-10-10 — per-element MutationObserver as proposed; amendment A (W74's double-buffered atlas draws the old page 1–2 frames): an element whose text changed gets a new owner token, is masked on the old page and its textReady stays false until the new page is confirmed, so liquid-text drops and the new DOM text shows meanwhile — never stale glyphs (saga dec_25b4cea6)

### D75-2: Colour auto-refresh on mutation and transitionend
Proposal: a `style`/`class` change of the element or a descendant, and a `transitionend` whose target is the element itself with `propertyName` `background-color` or `color`, re-snapshot its colours on the next frame with `refresh()`'s method. The snapshot lifts `liquid-element` (with `transition: none !important`, exact attribute restore, D66-3); W74's `liquid-text` rule hides glyphs with `-webkit-text-fill-color` and never sets `color`, so a refresh (and an atlas rebuild) while the element moves under WebGPU reads the author's text colour without lifting it. The paint, the halo rule and the atlas entry follow. `refresh(el)` stays public and also re-renders the atlas entry.
Consequence: no manual `refresh()` after a class or inline-style colour change (D66-12's "until slice 4" ends). Colour changes outside the element are caught only when they end a `color` transition on it; a `background-color` transition never runs on a decorated element (its background is held transparent by the layered rule), so an ancestor theme change without a text-colour transition, or a new stylesheet rule, still needs `refresh(el)` (documented in README and CONTEXT). One forced style flush per refreshed element per change.
Decision: APPROVED 2026-10-10 — colour auto-refresh on style/class mutation and on color/background-color transitionend, refresh(el) kept for ancestor/stylesheet changes (saga dec_86b58e7b)

### D75-3: Canvas2D DOM-text halo
Proposal: under Canvas2D only, while an element moves (`restAlpha < 1`) and reduced motion is off, the runtime sets `liquid-halo` on it (refcounted holds across instances through the same refcount helper as W74's text class, written only when the hold changes). Each observed element gets one rule in the refcounted `liquiddom-styles` sheet, keyed by a document-unique `data-liquid-id="h<n>"` (never the slot id: the sheet is shared by instances), inside `@layer liquiddom` and `@media screen and (forced-colors: none)`: `.liquid-halo[data-liquid-id="h<n>"] { text-shadow: 0 0 1px C, 0 0 2px C, 0 0 4px C, 0 0 8px C !important; }` with C the snapshotted background colour. The rule is written at observe, rewritten on a colour change, removed (and the attribute restored) at the last release. No inline style (D66-3). Never under WebGPU (the text rides its liquid).
Consequence: Canvas2D DOM text is readable on the page while its liquid is away (the slice-2 Carried contrast gap closes for Canvas2D); a blurred halo is not a solid backdrop for very thin glyphs. Visible change: the Canvas2D Linux baselines of steps 3, 4 and 6 (and 2 if an element still moves at its frame) are regenerated in the pinned image and approved by Dennis (D65-7). `text-shadow` inherits to descendants that do not set their own. The sheet text is rewritten on observe, unobserve and colour changes (a style recalc), never per frame. A new attribute `data-liquid-id` appears on observed elements.
Decision: APPROVED 2026-10-10 — Canvas2D liquid-halo text-shadow rule per element keyed by data-liquid-id, never under WebGPU; Canvas2D baselines 3/4/6 regenerated with Dennis' vision approval (saga dec_c537bf43)

## Specification
Plan: `docs/superpowers/plans/2026-10-10-fluid-slice-4/W75.md` (complete code for every task). Slice design: `docs/superpowers/specs/2026-10-10-liquiddom-slice-4-liquid-text-design.md` §4–§6; spec `2026-10-02-liquiddom-fluid-design.md` §3 "Text atlas", "Colour", §4.
- **Frame order:** `applyDomChanges()` (drain the observers, add `transitionend` elements, fonts/DPR "all"; calls `textAtlas.invalidate(id)`) → `registry.sync()` → `core.tick()` → `syncGeneration()` / W74's atlas rebuild while `textAtlas.stale` / paints → `renderer.render()` → W74's `syncText()` → `syncHalo()`. A colour change refreshes the registry record, rebuilds the paints and invalidates the atlas entry; a text change invalidates the entry; the runtime's `invalidateText` also marks the paints dirty (the atlas rect may move).
- **Cleanup:** `unobserve` releases W74's text hold, then the halo hold, disconnects the element's observer and removes the `transitionend` listener before the registry releases the halo rule and the decoration; `destroy` does the same for every element and removes the fonts and DPR listeners; a failed frame and a failed Canvas2D rebuild release the halo holds; after a device loss the halo starts with the next frame (`activeRenderer` is already `canvas2d`).
- **README interface corrections** (W75 is the producer): halo API keyed by element (`acquireHaloRule(el, bg)`, `updateHaloRule`, `releaseHaloRule`, `addHaloClass`, `removeHaloClass`), not `setHaloRule(id, bg)`; `ElementObserver` with `drain()`. The runtime calls W74's `TextAtlas.invalidate(id)` directly (cross-ward ruling 2026-10-10: the runtime owns the atlas; no `Renderer.invalidateText`).
- **W74 dependencies checked in W75.0 (verified against W74.md 2026-10-10):** the atlas rebuild after `invalidate(id)` runs before `render()` in the same frame, so no frame draws stale glyphs; the atlas reads the computed `color`, which W74's text-fill rule leaves untouched, so a rebuild while `liquid-text` is on draws the author colour.

## Tests

Red run (2026-10-10, W75.1): baseline measured before the tests was cargo 170 passed / 2 ignored (plan: 168), vitest 582 passed | 4 skipped (586) in 58 files (plan: 566 | 4 (570)), Playwright --list canvas2d 39, webgpu 26, webgpu-hw 45. Targets recomputed with the plan's deltas: vitest 610 passed | 4 skipped (614) in 61 files (+28 tests, +3 files), canvas2d 45, webgpu-hw 54, webgpu 26. No W74 name differed from the plan's. Test 16 was renamed as written in the brief. In tests 21, 24 and 42 the plan's setup lacked W74's atlas-confirm step (W74 review I1: first render uploads the page, `textReady` is true only after its error scope resolves): `clock.advance(1); await flush();` was added before `setRestAlpha(id, 0.4)`, as W74's own `text-runtime.test.ts` does.

| # | Test Name | Verifies | Red outcome |
|---|-----------|----------|-------------|
| 1 | element-observer: given_an_author_class_change_when_drained_then_one_entry_with_colour_and_text_D75_1 | D75-1 options and classification | FAIL (import: module missing) |
| 2 | element-observer: given_only_liquiddom_class_toggles_when_drained_then_no_entry_and_authorClasses_drops_own_classes_RF2 | Review Focus 2 | FAIL (import: module missing) |
| 3 | element-observer: given_a_refresh_snapshot_round_trip_of_class_and_style_when_drained_then_no_entry_RF2 | Review Focus 2 (first old value per batch) | FAIL (import: module missing) |
| 4 | element-observer: given_characterData_and_childList_mutations_in_the_subtree_when_drained_then_a_text_only_entry | D75-1 text triggers | FAIL (import: module missing) |
| 5 | element-observer: given_many_mutations_in_one_frame_when_drained_twice_then_one_entry_then_none_even_before_the_callback_ran | D75-1 coalescing, takeRecords | FAIL (import: module missing) |
| 6 | element-observer: given_a_descendant_class_or_style_change_when_drained_then_a_colour_entry_for_the_observed_element | D75-1 subtree attributes | FAIL (import: module missing) |
| 7 | element-observer: given_unobserve_or_disconnect_when_mutated_afterwards_then_nothing_is_pending_and_both_are_idempotent | cleanup | FAIL (import: module missing) |
| 8 | element-observer: given_data_liquid_id_or_data_liquid_stack_writes_when_drained_then_no_entry | attribute filter | FAIL (import: module missing) |
| 9 | stylesheet: given_an_acquired_halo_rule_when_the_sheet_is_read_then_one_layered_screen_only_rule_keyed_by_a_document_unique_data_liquid_id_D75_3 | D75-3 rule text and scope | FAIL (halo exports missing) |
| 10 | stylesheet: given_two_elements_and_a_shared_element_when_claimed_and_released_then_keys_differ_rules_are_refcounted_and_the_last_release_restores_the_attribute | D75-3 keys, refcount, restore | FAIL (halo exports missing) |
| 11 | stylesheet: given_updateHaloRule_when_the_background_changes_then_only_the_rule_text_changes_and_no_inline_style_is_written_D66_3 | D75-2/3, D66-3 | FAIL (halo exports missing) |
| 12 | stylesheet: given_every_halo_released_when_the_sheet_is_read_then_it_is_byte_identical_to_LIQUID_CSS | sheet composition | FAIL (halo exports missing) |
| 13 | stylesheet: given_two_halo_votes_when_one_is_removed_then_the_class_stays_until_the_last | shared elements across instances | FAIL (halo exports missing) |
| 14 | halo-toggle: given_canvas2d_and_restAlpha_below_1_when_synced_then_liquid_halo_once_and_removed_at_rest | D75-3 toggle, one write | FAIL (import: module missing) |
| 15 | halo-toggle: given_webgpu_or_reduced_motion_or_nan_when_synced_then_no_halo_and_an_existing_vote_is_withdrawn | D75-3 Canvas2D only | FAIL (import: module missing) |
| 16 | halo-toggle: given_clearHaloClasses_releaseHaloClass_or_a_missed_release_when_called_then_this_instance_lets_go_and_others_keep_their_hold | cleanup across instances | FAIL (import: module missing) |
| 17 | color-snapshot: given_liquid_text_on_when_colours_are_snapshotted_lifting_only_liquid_element_then_the_author_text_colour_is_read_and_attributes_are_restored | D75-2; pins W74's text-fill rule (no rule sets `color`) | PASS at red (pins W74's no-`color` rule) |
| 18 | runtime-text-true: given_an_author_class_change_when_the_next_frame_runs_then_colours_are_re_snapshotted_once_and_the_paint_carries_them_D75_2 | D75-2 | FAIL (refresh not called) |
| 19 | runtime-text-true: given_own_class_toggles_and_a_refresh_every_frame_when_60_frames_run_then_no_extra_snapshot_and_no_text_invalidation_RF2 | Review Focus 2 in the runtime | FAIL (textInvalidations undefined) |
| 20 | runtime-text-true: given_transitionend_for_background_color_or_color_on_the_element_when_the_next_frame_runs_then_one_refresh_and_other_properties_or_bubbled_events_none_D75_2 | D75-2 transitionend | FAIL (refresh not called) |
| 21 | runtime-text-true: given_webgpu_and_a_text_mutation_mid_motion_when_the_next_frame_runs_then_one_invalidate_before_render_and_that_render_already_draws_the_rebuilt_atlas_RF3 | Review Focus 3 (no stale glyphs, new rest-UV rect, no blink) | FAIL (invalidate not called) |
| 22 | runtime-text-true: given_document_fonts_loadingdone_when_the_next_frame_runs_then_every_observed_element_is_invalidated_once_RF5 | Review Focus 5 fonts | FAIL (no invalidate on loadingdone) |
| 23 | runtime-text-true: given_a_dpr_change_on_the_resolution_query_when_fired_then_the_canvas_is_resized_every_element_is_invalidated_and_the_query_is_re_armed_RF5 | Review Focus 5 DPR | FAIL (no DPR listener) |
| 24 | runtime-text-true: given_liquid_text_on_mid_motion_when_refresh_runs_then_the_author_text_colour_is_read_and_the_atlas_is_rebuilt_in_it_before_the_render | refresh() under WebGPU; atlas glyph colour mid-motion | FAIL (invalidate not called with id) |
| 25 | runtime-text-true: given_canvas2d_and_a_moving_element_when_frames_run_then_liquid_halo_on_once_off_at_rest_with_a_rule_in_the_background_colour_and_no_inline_style_D75_3 | D75-3 in the runtime | FAIL (no data-liquid-id / halo) |
| 26 | runtime-text-true: given_unobserve_and_destroy_when_mutations_and_transitionend_follow_then_no_refresh_and_class_attribute_rule_and_listeners_are_gone | cleanup | FAIL (no halo rule to release) |
| 27 | halo.spec (canvas2d): D75-3 – given a splash on Splash when it moves then #splash carries liquid-halo with a text-shadow in its own background colour and no inline style, and at rest neither | D75-3 in Chromium | FAIL (no data-liquid-id key) |
| 28 | halo.spec (canvas2d): D75-3 – given a shake when every element moves then each one carries the halo in its own background colour and the card's paragraph inherits it | D75-3 per element | FAIL (no halo class) |
| 29 | halo.spec (canvas2d): D75-3 – given print or forced colours while the halo class is on then the computed text-shadow is none, and back on screen it returns | D66-15 scope | FAIL (no halo class) |
| 30 | halo.spec (canvas2d): D75-3 – given reduced motion (?rm=1) when Splash is clicked then no element ever carries liquid-halo | reduced motion | PASS at red (trivially: no halo exists; deviation from the plan's 6 failed) |
| 31 | halo.spec (canvas2d): D75-2 – given an author class change on #split at rest when the next frame runs then the liquid paints the new colour without refresh() and the halo follows | D75-2 in Chromium | FAIL (liquid keeps old colour) |
| 32 | halo.spec (canvas2d): D75-2 – given an ancestor theme change with a colour transition on #split when the transition ends then the liquid follows without refresh() | D75-2 transitionend | FAIL (liquid keeps old colour) |
| 33 | webgpu-robust (webgpu-hw): W75 D75-3 – given renderer webgpu and a splash when it moves then no element ever carries liquid-halo | D75-3 Canvas2D only | PASS at red |
| 34 | webgpu-robust (webgpu-hw): W75 step 8 – given liquid-text on mid-splash when forced colours switch on live then the DOM text is visible at once and the canvas hidden, and switching back restores liquid-text while moving | step 8 forced colours | PASS at red |
| 35 | webgpu-robust (webgpu-hw): W75 step 8 – given liquid-text on mid-splash when print is emulated live then the DOM text has its author colour at once and the canvas is hidden | step 8 print | PASS at red |
| 36 | webgpu-robust (webgpu-hw): W75 – given refresh() mid-motion after an author colour change when the next frame renders then the liquid and the liquid text show the new colours | refresh() under WebGPU | FAIL at red (yellow text pixels 0; the plan allowed a pass) |
| 37 | webgpu-robust (webgpu-hw): W75 RF3 – given a text change mid-splash when the next frame runs then exactly one atlas re-render, own class toggles never re-render, and the new text is DOM-visible at rest | Review Focus 2, 3 | FAIL (textInvalidations undefined) |
| 38 | webgpu-robust (webgpu-hw): W75 RF5 – given a web font that finishes loading after observe when the next frame runs then every observed element's atlas entry is re-rendered once | Review Focus 5 fonts | FAIL (textInvalidations undefined) |
| 39 | webgpu-robust (webgpu-hw): W75 RF5 – given a DPR change from 1 to 2 when the next frame runs then the canvas backing doubles and every atlas entry is re-rendered once | Review Focus 5 DPR | FAIL (canvas never resizes on DPR change, timeout) |
| 40 | webgpu-robust (webgpu-hw): W75 a11y – given renderer webgpu at rest and mid-splash with liquid-text on when axe runs then 0 violations, and contrast in print 0 | a11y under WebGPU | PASS at red |
| 41 | webgpu-robust (webgpu-hw): W75 a11y – given Tab and Enter on Split under webgpu when ticking then the focus ring stays visible above the liquid at every 10th frame | focus ring under WebGPU | PASS at red |
| 42 | runtime-text-true: given_liquid_text_on_under_webgpu_when_the_device_is_lost_then_liquid_text_goes_and_the_halo_applies_from_the_next_frame_under_canvas2d | halo after the WebGPU → Canvas2D switch | FAIL (no halo after the switch) |
| 43 | runtime-text-true: given_the_halo_on_when_a_frame_throws_or_the_canvas2d_rebuild_after_a_lost_device_fails_then_this_instance_withdraws_every_halo | halo on the fail-safe paths | FAIL (no halo to withdraw) |

## Must NOT
- Write an inline style on an observed element that outlives one synchronous snapshot (D66-3), or any per-frame DOM write besides class toggles on change.
- Let liquiddom's own class toggles or the colour snapshot trigger a re-snapshot or an atlas re-render (Review Focus 2).
- Key a halo rule by the slot id, set `liquid-halo` under WebGPU or reduced motion, or let a halo rule apply in print or forced colours.
- Show stale atlas glyphs after a text change: the invalidate must land before W74's per-frame atlas rebuild, which precedes `render()` (Review Focus 3).
- Change Rust, the FFI, W74's atlas or text pass, or commit a Linux baseline without Dennis' approval (D65-7).

## Must DO
- Apply DOM, colour, font and DPR changes once per frame, before `registry.sync()`.
- Lift `liquid-element` when snapshotting colours (W74's `liquid-text` rule never sets `color`), and restore the exact attribute strings.
- Release the halo on every fail-safe path W74 releases the text class on (a failed frame, a failed Canvas2D rebuild, unobserve, destroy).
- Remove every observer, listener, halo vote, rule and `data-liquid-id` on unobserve and destroy.
- Regenerate the changed Canvas2D baselines in the pinned image, inspect each with vision, and STOP for Dennis' approval.
- Gold: Metal stills at the same manual-clock frames, inspected with vision.

## Manual Smoke Test
### Setup
`npm run build:wasm && npm run dev` (Vite on :3000), Chromium with WebGPU on Dennis' Mac.

### Steps
1. Run: open `http://localhost:3000/scenes/acceptance.html?renderer=canvas2d`, click "Splash".
   Verify: the "Splash" label keeps a soft blue halo while its liquid is away and loses it when the pill is back.
2. Run: in the console, `document.querySelector("#split").classList.add("x")` after adding a rule `.btn--split.x { background: rgb(200, 30, 30) }` with DevTools.
   Verify: the Split liquid turns red on the next frame without calling `refresh()`.
3. Run: open `http://localhost:3000/scenes/acceptance.html?renderer=webgpu`, click "Splash", and toggle DevTools Rendering → "Emulate CSS media feature forced-colors: active" during the splash.
   Verify: the canvas disappears and the DOM text is visible at once; turning it off brings the liquid back.
4. Run: zoom the page to 200 % (Cmd +) and click "Splash".
   Verify: the liquid text is sharp, not blurred, at the new zoom.

### Pass criteria
- [ ] Canvas2D labels are readable during a splash and a shake; no halo at rest.
- [ ] Colour changes through classes reach the liquid without `refresh()`.
- [ ] Forced colours and print show the DOM text at once mid-splash under WebGPU.
- [ ] Liquid text stays sharp after a zoom change and follows a text change.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:dist`, `npm run e2e:webgpu-hw` (Metal), `npm run e2e:typecheck`; `npm run e2e:docker -- --project=canvas2d` with the approved baselines; vision on the gold stills; ward code review; STOP at gold for Dennis.
