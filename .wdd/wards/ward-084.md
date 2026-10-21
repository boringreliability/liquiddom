---
ward: 84
revision: null
name: "Touch and opt-out"
epic: "fluid-engine"
status: "planned"
dependencies: [83]
layer: "both"
estimated_tests: 32
created: "2026-10-21"
completed: null
---
# Ward 084: Touch and opt-out

North star: step 5 (drag and merge) on a phone — a long-press on an element picks up its liquid with a finger, as the mouse does since W78, while a quick swipe still scrolls the page; the other 7 steps are unchanged (mouse and pen keep W78's gesture; the pointer field's idle tail is per time, bit-identical at 60 Hz or with a measured, vision-checked change, D84-3).

## Scope
Fifth ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §7). Touch can drag after a long-press: a primary touch `pointerdown` on an observed element starts a 350 ms timer; moving more than 8 px, `pointerup` or `pointercancel` before it fires cancels it and the page scrolls as usual; when it fires the drag starts (DRAGGED, as W78) with visible feedback, and the browser is kept from scrolling while the drag is live. The long-press context menu and callout are suppressed on draggable observed elements; a tap is still a click and the click ending a drag is swallowed as for the mouse. `observe(el, { drag: false })` opts an element out of every drag (mouse, pen, touch), captured once like `viscosity`. The pointer field's idle decay becomes per unit of time (`0.8^(dt·60)`), closing D68-4's limitation. How the browser can be kept from scrolling (the `touchmove` listener strategy), what the feedback at the long-press looks like and whether the per-time decay moves anything at 60 Hz come from the time-boxed spike W84.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W84.md`, part 1); part 2 of the plan is written after the gate.

Out of scope: the adapters' `drag` prop (W85), the site (W86), keyboard drag (never: drag is decoration), multi-touch gestures beyond "a second finger is not a drag".

## Inputs
- The slice design §7, §11 (vitest: long-press timer, move/cancel paths, swallowed click, `drag: false`, per-time decay; e2e: touch long-press drag via CDP), §12 (D84-1 … D84-3).
- `drag-tracker.ts` (W78/W80: mouse/pen only, `D78-2: no touch drag in slice 5`), `pointer-tracker.ts` (`POINTER_IDLE_DECAY` per sampled frame), `options.ts` `validateElementOptions` (`viscosity`, `recovery`), `stylesheet.ts` (no touch rules), `registry.ts` (slots 5–7).
- W83's shared interfaces: gravity acts on a dragged element's liquid like on every cell with mass; a touch drag on a tilting phone needs no new rule.
- Baseline at `93f5a03` (W83 complete + the platform-bound W81 golden, PR #4 merged as `fa0b821`): see Specification.

## Outputs
- TS: the touch long-press path in `drag-tracker.ts` (`LONG_PRESS_MS` 350, `TOUCH_SLOP_PX` 8, `attach(el, draggable)`, a non-passive `touchmove` listener per draggable observed element, `contextmenu` while a touch press is live, the child-capture filter); `drag?: boolean` in `ElementOptions` and its validation; the callout rule and `holdDragMode`/`releaseDragMode` (`data-liquid-drag="off"`) in `stylesheet.ts`, held by the registry; the per-time decay (`idleDecay`, `IDLE_DECAY_SNAP`) in `pointer-tracker.ts`. The feedback at the long-press is W78's hold (D84-4: no code).
- Demo: `?nodrag=<ids>` on the acceptance scene; the touch e2e drives the acceptance scene (its `slots()` hook) with CDP touches on the RAF clock.
- Tests: 25 vitest (4 new files), 5 canvas2d e2e (`e2e/touch.spec.ts`) and 1 webgpu-hw e2e; the approved-test changes listed under Tests.
- Docs: spec §2 (drag row), §5 (`drag` element option, the per-time decay); CLAUDE.md; CONTEXT; core README; changeset.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D84-1: Touch drag on long-press
Proposal: a primary touch `pointerdown` on a draggable observed element (the innermost, D67-9) starts a 350 ms timer (runtime clock-independent: a real `setTimeout`, cancelled on every end path); a move of more than 8 px from the down point, `pointerup`, `pointercancel`, `blur`, unobserve, destroy or reduced motion cancels it. When it fires the press becomes a drag (the pointer's own offset (0, 0) plus the scroll since the down point, W80) and the pointer is captured; while it is live the browser's scroll is prevented by a non-passive `touchmove` listener on every draggable observed element (attached at `observe()`, detached at `unobserve()`, none on a `drag: false` element) that calls `preventDefault()` only while a touch drag is live (W84.0 Q1 strategy (a)). A tap stays a click; the click ending a touch drag is swallowed as W78's. Mouse and pen are unchanged (4 px, no timer). (Brainstorm 2026-10-13, slice design §12.)
Consequence: W84.0 Q1 (Chromium, CDP touch): a long-press + 120 px move scrolls 0 px (105 px without a listener), no `pointercancel`, every `touchmove` cancelable, no intervention; a 30 px swipe still scrolls and cancels the press; a tap gives exactly one click. All three strategies work in Chromium; (a) is the only one present before `touchstart`, which iOS Safari needs. Its cost: the observed elements' rects (only those) become blocking touch regions, so a swipe starting on one waits for the main thread (up to about one engine frame). Not confirmable in emulation: iOS Safari, Android swipe latency, the 8 px / 350 ms feel with a real finger (Dennis' phone at gold). The red e2e must not use `page.waitForFunction` (Playwright's listeners make the whole document a blocking region and hide a failing strategy).
Decision: APPROVED 2026-10-21 — 350 ms long-press, 8 px cancel, drag at pointer offset (0, 0) plus the scroll since the down point, a non-passive touchmove listener per draggable observed element from observe() that prevents only while a touch drag is live; tap stays a click, the ending click is swallowed, mouse and pen unchanged (saga dec_6a102bba)

### D84-2: Per-element opt-out
Proposal: `observe(el, { drag: false })`, validated (a boolean) and captured once like `viscosity`; the element never drags by mouse, pen or touch and keeps the browser's own long-press behaviour (no context-menu or callout suppression, D84-5). A press on an opted-out element nested in a draggable observed one drags nothing (the innermost observed element decides, D67-9). `drag: true` or absent: as today.
Consequence: a new element option (the whitelist grows by one); the adapters carry it in W85. W84.0 Q4: a nested opted-out element still claims the `pointerdown` (so the outer one ignores it): nothing drags by touch or mouse, the page scrolls natively under a touch.
Decision: APPROVED 2026-10-21 — observe(el, { drag: false }), a boolean captured once; no mouse, pen or touch drag and no menu/callout suppression; a nested opted-out element drags nothing (innermost rule) (saga dec_a530a18b)

### D84-3: Pointer decay per time
Proposal: the idle decay becomes `v ← v · 0.8^e` with `e = dtMs · 0.06` (`dtMs` the runtime clock's time since the last sample; the 120 ms hold before it unchanged), and `e` snapped to exactly 1 when `|e − 1| < 1e-9`, so a 60 Hz frame is exactly today's ×0.8 and 60 Hz and 120 Hz have the same idle tail in wall time.
Consequence: W84.0 Q3: the manual clock accumulates time, so without the snap only 7 of 100 000 frames give exactly 0.8 (off by ≤ 1e-12); with it 100 000 of 100 000, so every existing test, baseline and e2e number is bit-identical. 60 vs 120 Hz tails equal to < 1e-14 (today 120 Hz reaches 1 % in 175 ms instead of 350 ms). Closes D68-4's limitation.
Decision: APPROVED 2026-10-21 — v · 0.8^e with e = dtMs · 0.06, snapped to exactly 1 when |e − 1| < 1e-9; the 120 ms hold unchanged (saga dec_09b1860f)

### D84-4: Feedback at the long-press
Proposal: (i) no extra feedback: the drag starts when the timer fires and W78's hold softens the liquid at once (no new rule, no engine change). Not (ii) the 2 % swell, not (iii) `navigator.vibrate`.
Consequence: W84.0 Q2 (stills inspected with vision): from the first frame after the fire the rim goes ragged and wobbly in both renderers; under Canvas2D the label hides (W78's `liquid-away`), under WebGPU it stays on the liquid — read as "picked up" in both. (ii) adds ≈ 5 px on the card, 2–3 px on a pill, not visible by eye; (iii) is missing on iOS Safari and gated by user activation on Android (the first long-press on a page would not vibrate).
Decision: APPROVED 2026-10-21 — (i) no extra feedback: the drag starts on fire and W78's hold softens the liquid at once; no swell, no vibrate (saga dec_afacafb2)

### D84-5: Context menu, callout and selection on touch
Proposal: `contextmenu` is prevented only while a touch press on a draggable observed element is live (pending or dragging), so a desktop right-click and the keyboard menu key are untouched; `-webkit-touch-callout: none` applies to draggable observed elements in the `@layer liquiddom` sheet (an opted-out element keeps it); text selection is already blocked while a press is live (W78's `selectstart`).
Consequence: on a phone a long-press on a draggable observed element no longer selects text or opens the link preview or menu (`drag: false` restores both). W84.0 Q4: a desktop right-click stays one unprevented `contextmenu`. Chromium's emulation never fires `contextmenu` on a touch hold, so the suppression itself is checked only on Dennis' phone (and in jsdom by dispatching the event).
Decision: APPROVED 2026-10-21 — contextmenu prevented only while a touch press on a draggable observed element is live; -webkit-touch-callout: none on draggable observed elements in the layer; selection as W78 (saga dec_bfdd623c)

## Spike W84.0 result (2026-10-21, a throwaway copy of `7d3adfe`, deleted; report `.superpowers/sdd/W84/spike-Q.md`, stills in `.superpowers/sdd/W84/stills/`, inspected with vision)

| Q | Candidates | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1 | `touchmove` listener (a) per element from `observe()`, (b) on the document from the touch `pointerdown`, (c) from the fire | long-press + 120 px: scroll 0 px in all three (105 px without), no `pointercancel`, 11–12/11–12 moves cancelable and prevented, no intervention; swipe 30 px scrolls, press cancels; tap = 1 click; blocking regions: (a) the observed rects, (b) the whole document while pending, (c) after the fire; the latency cost is not measurable over CDP | — | (a): the only one present at `touchstart` (iOS Safari) (D84-1) |
| Q2 | (i) the hold alone, (ii) + 2 % swell (TS rect), (iii) vibrate | (ii) +5 px card, +2–3 px pill; vibrate: iOS none, Android activation-gated | (i) rim ragged/wobbly from frame 0 in both, Canvas2D label hides, WebGPU text rides; (ii) indistinguishable from (i) | (i) (D84-4) |
| Q3 | `0.8 ** (dtMs·0.06)` plain or snapped | plain exact in 7/100 000 manual frames, snapped 100 000/100 000; f32 input equal 40/40; 60 vs 120 Hz < 1e-14 | — | snapped (D84-3) |
| Q4 | nested opt-out, right-click, tilt, scroll while pending | nested `drag: false`: nothing drags, page scrolls; right-click unprevented; tilt during a drag fine; a scroll while pending carries into the offset (W80) | — | D84-2 as proposed; D84-1 offset wording fixed |

Harness: `page.waitForFunction` and CDP `Log.enable` add document touch listeners that make every touch sequence blocking; the touch e2e polls with `page.evaluate` / `expect.poll` and reads interventions with a `ReportingObserver`.

## Specification
**Baseline (2026-10-21, `795661c`, recounted on the plan-validation copy).**

| Suite | Count |
|---|---|
| cargo | 240 passed; 0 failed; 1 ignored |
| vitest | 772 passed (772), 76 files |
| Playwright `--list` | canvas2d 97, webgpu 51, webgpu-hw 98, perf 6 |

**Values.** `LONG_PRESS_MS = 350`, `TOUCH_SLOP_PX = 8`, `DRAG_THRESHOLD_PX = 4` (unchanged) in `drag-tracker.ts`; `IDLE_DECAY_SNAP = 1e-9`, `POINTER_IDLE_DECAY = 0.8`, `POINTER_IDLE_MS = 120` (unchanged) in `pointer-tracker.ts`; `DRAG_ATTR = "data-liquid-drag"` in `stylesheet.ts`.

**Touch (D84-1, D84-4).** A `pointerdown` with `pointerType` touch, button 0 and `isPrimary` on a draggable observed element (the innermost one, D67-9), with no press live and no reduced motion, starts a press and a real `setTimeout(LONG_PRESS_MS)`. Before it fires, the finger's own offset from the down point past 8 px ends the press (a swipe: the page scrolls), as do `pointerup` (a tap: its click passes), `pointercancel`, window blur, Escape, a move with the button up, `detach` (unobserve), `cancel()` (reduced motion, a lost device, a failed frame), a detached element at `frame()` and `destroy`; every end clears the timer, and a press that never dragged calls no `onEnd`. A scroll (W80 `scrolled()`) never ends a pending press and accumulates into its offset. When the timer fires (reduced motion or a detached element then cancels instead) the down point moves to where the finger rests and the press drags: offset = (0, 0) + the scroll since the down point, the element captures the pointer, the registry writes DRAGGED and the offset (slots 5–7) and W78's `hold_dragged` softens the liquid from the next substep (no swell, no vibrate). From then on the press behaves as W78's mouse drag: moves update the offset, `pointerup` releases and the following pointer click is swallowed once, every cancel path cancels. A `lostpointercapture` ends the drag only when its target is the dragged element itself. A non-primary pointer never starts a press and never touches the live one. Mouse and pen are unchanged (4 px, capture past it, no timer).

**Scroll prevention (D84-1).** Every draggable observed element carries one `touchmove` listener `{ passive: false }` from `observe()`; `unobserve()` and `destroy()` remove the same function; an opted-out element has none. It calls `preventDefault()` only while a touch drag is live and the event is cancelable.

**Menu, callout, selection (D84-5).** While a touch press is live (pending or dragging) the document's `contextmenu` is prevented; a mouse press, a desktop right-click (no press) and an opted-out element are untouched. The layer's screen block (`@media screen and (forced-colors: none)`) holds `.liquid-element:not([data-liquid-drag="off"]) { -webkit-touch-callout: none !important; }`. `selectstart`/`dragstart` stay prevented while any press is live (W78).

**Opt-out (D84-2).** `ElementOptions.drag?: boolean`; `validateElementOptions` allows `drag` and throws `TypeError` "drag must be a boolean" for anything but `true`, `false` or `undefined`. Captured once per instance with the registry record (a later `observe(el, …)` of an observed element changes nothing). The tracker attaches such an element opted out: its `pointerdown` is claimed (an observed ancestor never presses for it) and nothing starts, for mouse, pen and touch. The registry holds the drag mode with the decoration (`holdDragMode(el, drag !== false)`, released at unobserve): `data-liquid-drag="off"` while every observing instance opted out, otherwise the attribute the first hold found (none for an element without one); the last release restores it. Each instance follows its own `drag`.

**Decay (D84-3).** While the pointer is inside and has not moved for more than 120 ms, each `sample(now)` multiplies the velocity by `idleDecay(now − previous sample)`: `0.8^e`, `e = Δt · 0.06`, exactly 0.8 when `|e − 1| < 1e-9`, 1 for a zero, negative or non-finite Δt.

**Unchanged.** Rust, the FFI layout, every scalar call, the constructor, the engine's drag and merge rules, mouse and pen drag, every Linux baseline.

## Tests

| # | Test Name | Verifies | Red outcome |
|---|-----------|----------|-------------|
| 1 | drag-tracker-touch.test: given_the_approved_decisions_when_reading_the_touch_constants_then_350_ms_and_8_px_and_the_mouse_threshold_stays_4_px | D84-1 values | ✅ passes (guard) |
| 2 | drag-tracker-touch.test: given_a_primary_touch_press_held_still_when_350_ms_pass_then_it_drags_at_offset_0_0_and_captures_and_at_349_ms_it_is_still_pending | D84-1 fire | ❌ "a pending press": null (touch ignored, D78-2) |
| 3 | drag-tracker-touch.test: given_a_pending_touch_press_when_the_finger_moves_exactly_8_px_then_it_stays_pending_and_past_8_px_it_ends_without_a_drag_a_capture_or_onEnd | D84-1 slop | ❌ pressed null |
| 4 | drag-tracker-touch.test: given_a_finger_that_drifts_6_px_before_the_fire_when_the_long_press_fires_then_the_offset_is_0_0_and_later_moves_count_from_where_it_rested | D84-1 offset (design resolution 1) | ❌ "the liquid does not jump by the slop": null |
| 5 | drag-tracker-touch.test: given_a_pending_touch_press_when_it_ends_by_any_path_then_no_timer_is_left_and_nothing_drags_later | RF1 | ❌ "the long-press timer runs": 0 timers |
| 6 | drag-tracker-touch.test: given_reduced_motion_when_a_touch_press_starts_or_it_switches_on_before_the_fire_then_nothing_drags | reduced motion | ✅ passes (guard) |
| 7 | drag-tracker-touch.test: given_a_tap_when_released_before_the_fire_then_its_click_passes_and_the_click_ending_a_touch_drag_is_swallowed_once | tap = click, W78 swallow | ❌ "the click ending a touch drag is swallowed": false |
| 8 | drag-tracker-touch.test: given_a_second_finger_when_it_presses_alone_or_during_a_pending_or_dragging_touch_press_then_it_starts_nothing_and_never_disturbs_the_first | RF2 | ❌ pressed null |
| 9 | drag-tracker-touch.test: given_a_pending_touch_press_when_the_page_scrolls_50_px_then_the_press_lives_and_the_drag_starts_at_offset_0_50 | W80 during a pending press | ❌ "a scroll alone never ends the press": null |
| 10 | drag-tracker-touch.test: given_a_draggable_element_when_attached_then_one_non_passive_touchmove_listener_prevents_only_while_a_touch_drag_is_live_and_detach_removes_it | RF5 | ❌ "one touchmove listener": 0 |
| 11 | drag-tracker-touch.test: given_a_draggable_and_an_opted_out_element_when_attached_and_destroyed_then_only_the_draggable_one_carried_a_touchmove_listener_and_destroy_removed_it | RF5, D84-2 | ❌ 0 touchmove listeners |
| 12 | drag-tracker-touch.test: given_contextmenu_when_a_touch_press_is_live_then_it_is_prevented_and_a_desktop_right_click_a_mouse_press_an_opted_out_element_or_no_press_are_untouched | RF4, D84-5 | ❌ "a pending touch press": not prevented |
| 13 | drag-tracker-touch.test: given_an_opted_out_element_inside_a_draggable_one_when_pressed_by_touch_mouse_or_pen_then_nothing_drags_and_the_outer_one_gets_no_press | RF3, D84-2 | ❌ "mouse": the inner element is pressed |
| 14 | drag-tracker-touch.test: given_a_touch_drag_started_on_a_child_when_the_child_loses_its_implicit_capture_then_the_drag_stays_and_the_elements_own_lostpointercapture_cancels | design resolution 2 | ❌ no drag (undefined) |
| 15 | pointer-decay.test: given_the_manual_clocks_accumulated_1_60_s_frames_when_the_pointer_idles_then_every_frame_decays_by_exactly_0_8_bit_identical_to_W68 | D84-3 bit-identity | ✅ passes (guard) |
| 16 | pointer-decay.test: given_120_hz_frames_when_the_pointer_idles_then_its_velocity_tail_equals_60_hz_in_wall_time | D84-3, closes D68-4 | ❌ "150 ms: 120 Hz 192 vs 60 Hz 240" |
| 17 | pointer-decay.test: given_frame_lengths_when_idleDecay_then_0_8_per_1_60_s_snapped_within_1e_9_and_no_decay_for_a_zero_negative_or_non_finite_frame | D84-3 snap, design resolution 5 | ❌ stub 0.8 vs √0.8 |
| 18 | touch-opt-out.test: given_element_options_with_drag_when_validated_then_booleans_pass_anything_else_throws_a_TypeError_naming_drag_and_an_unknown_key_lists_drag | D84-2 validation | ❌ "unknown element option drag" |
| 19 | touch-opt-out.test: given_css_text_when_read_then_the_callout_rule_keys_on_observed_elements_not_opted_out_inside_the_screen_block_only | D84-5 callout, D66-15 scope | ❌ no callout rule |
| 20 | touch-opt-out.test: given_holdDragMode_from_two_observers_when_one_drags_and_one_opts_out_then_data_liquid_drag_is_off_only_while_every_holder_opted_out_and_the_last_release_restores_it | design resolution 3 | ❌ stub: "author" vs "off" |
| 21 | touch-opt-out.test: given_two_instances_observing_one_element_one_with_drag_false_when_destroyed_in_either_order_then_data_liquid_drag_is_off_only_while_no_instance_drags_it_and_the_element_is_restored_exactly | design resolution 3, exact restore | ❌ "validated like viscosity": unknown element option |
| 22 | touch-runtime.test: given_a_touch_long_press_on_an_observed_element_when_frames_run_then_slots_5_7_carry_dragged_and_the_finger_offset_its_touchmoves_are_prevented_and_the_release_swallows_the_click | D84-1 through the runtime, RF4, RF5 | ❌ slots [0, 0, 0] vs [3, 0, 0] |
| 23 | touch-runtime.test: given_a_touch_tap_when_released_before_350_ms_then_its_click_splashes_once_and_no_slot_changes | tap = click | ✅ passes (guard) |
| 24 | touch-runtime.test: given_observe_with_drag_false_when_pressed_by_mouse_or_touch_then_slots_stay_idle_the_click_splashes_the_menu_stays_and_a_later_observe_cannot_change_it | D84-2, D84-5 through the runtime, RF3, RF4 | ❌ no `data-liquid-drag` |
| 25 | touch-runtime.test: given_a_pending_touch_press_when_the_instance_is_destroyed_the_element_is_unobserved_or_reduced_motion_switches_on_then_no_timer_is_left_and_no_frame_drags | RF1 | ❌ "destroy: the long-press timer runs": 0 |
| 26 | api-migration.test: given_api_migration_type_fixture_when_tsc_checks_it_then_exit_code_0 (approved-test change: `drag` lines in the fixture) | D84-2 type | ✅ passes (guard; the type is red scaffolding) |
| 27 | e2e touch (canvas2d): D84-1 – given the Split pill when a finger holds it 350 ms and moves 120 px up then its liquid follows the finger, the page does not scroll, no pointercancel or intervention, and the release lets it go without a click | D84-1 in Chromium, RF5 | ❌ "Split is dragged": 0 (the page scrolls 105 px) |
| 28 | e2e touch (canvas2d): D84-1 – given the card's heading when a finger holds it 350 ms and moves 120 px up then the card (its observed ancestor) is dragged and stays dragged until the release | a press on a child | ❌ card not dragged |
| 29 | e2e touch (canvas2d): D84-1 – given the Split pill when a finger swipes 30 px up within 100 ms then the page scrolls and nothing is dragged, also after the long-press time | D84-1 swipe, RF5 | ✅ passes (guard; scrollY 15) |
| 30 | e2e touch (canvas2d): D84-1 – given the Splash pill when a finger taps it then exactly one click arrives and nothing is dragged | tap = click | ✅ passes (guard) |
| 31 | e2e touch (canvas2d): D84-2 – given Split observed with drag false when a finger holds it and moves or the mouse drags it then its liquid never moves and the finger scrolls the page | D84-2 in Chromium, RF3 | ❌ the scene fails to start: unknown element option "drag" |
| 32 | e2e webgpu-robust (webgpu-hw): W84 D84-1 – given renderer webgpu when a finger holds Split 350 ms and moves 120 px up then its liquid follows the finger, the page does not scroll and no pointercancel or intervention arrives | D84-1 in WebGPU | ❌ not dragged (scroll 105 px) |

Approved-test changes at red (Dennis approves with the tests): `drag-tracker.test.ts` test 2 (name and message only: a touch press that moves 30 px at once still never drags, but touch now drags after a long-press) and `__fixtures__/api-migration-types/index.ts` (`{ drag: false }` compiles, `{ drag: "no" }` does not; checked by row 26).

## Must NOT
- Change mouse or pen drag (W78), the engine's drag rules, Rust or the FFI layout.
- Block a touch scroll that starts on an observed element and moves before the long-press fires.
- Suppress a desktop right-click, or the context menu or callout of an opted-out element.
- Leave a long-press timer running after its press ended (any path, including `destroy`).
- Add a `touchmove` listener later than `observe()`, or to an opted-out element.
- Move a Linux baseline without Dennis' vision approval; change an approved test without his approval.

## Must DO
- Cancel the long-press timer on every end path (no timer survives `destroy`).
- Keep a tap a click (splash, the author's handlers); swallow the click ending a touch drag (W78).
- Let the innermost observed element decide, also when it opted out.
- Keep the manual clock's idle decay exactly ×0.8 per frame (every existing number unchanged).
- Test the touch path with Playwright `hasTouch` and CDP touch events in the blocking canvas2d project, without `page.waitForFunction` or CDP `Log.enable`.

## Manual Smoke Test
### Setup
On the Mac: `npm run dev -- --host` (Vite also listens on the LAN; the console prints a `Network:` URL) and `ipconfig getifaddr en0` for the Mac's Wi-Fi IP; allow Node's incoming connections if macOS asks. On the phone, on the same Wi-Fi: `http://<that IP>:3000/scenes/acceptance.html` (canvas2d), `…/scenes/acceptance.html?renderer=auto` (WebGPU where the phone has it) and `…/scenes/acceptance.html?nodrag=split`.

### Steps
1. On a phone, long-press a pill in the acceptance scene and drag it.
   Verify: after about a third of a second the liquid goes soft and then follows the finger, the page does not scroll, no context menu, text selection, callout or link preview appears; on release it springs home and no splash fires.
2. Swipe quickly over the same pill.
   Verify: the page scrolls at once; nothing drags.
3. Tap a pill.
   Verify: one splash.
4. Long-press the card's heading and drag.
   Verify: the card's liquid (with its text) follows the finger.
5. With `?nodrag=split`, long-press Split, then drag.
   Verify: Split's liquid never moves; the browser's own long-press behaviour (if it has one for a button) is back; a swipe scrolls.

### Pass criteria
- [ ] Long-press drag works on Dennis' phone, a swipe scrolls, a tap splashes.
- [ ] No context menu, callout or selection during a long-press on a draggable element.
- [ ] A `drag: false` element never drags and keeps its context menu.

## Verification
`npm run verify`, `npm run e2e:canvas2d` (with `e2e/touch.spec.ts`), `npm run e2e:webgpu-hw`, `npm run e2e:docker -- --project=canvas2d` (every Linux baseline unchanged, no `--update-snapshots`), vision on stills of the touch drag in both renderers, Dennis' smoke on his phone.
