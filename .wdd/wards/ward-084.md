---
ward: 84
revision: null
name: "Touch and opt-out"
epic: "fluid-engine"
status: "planned"
dependencies: [83]
layer: "both"
estimated_tests: 0
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
- TS: the touch long-press path in `drag-tracker.ts`; `drag?: boolean` in `ElementOptions`; the per-time decay in `pointer-tracker.ts`; the context-menu and callout suppression; the feedback at the long-press.
- Demo: a touch path in the acceptance scene's hook (or a scene of its own, per part 2).
- Tests: vitest and canvas2d e2e (CDP touch), listed in part 2.
- Docs: spec §2 (drag row), §5 (`drag` element option); CLAUDE.md; CONTEXT; core README; changeset.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D84-1: Touch drag on long-press
Proposal: a primary touch `pointerdown` on a draggable observed element (the innermost, D67-9) starts a 350 ms timer (runtime clock-independent: a real `setTimeout`, cancelled on every end path); a move of more than 8 px from the down point, `pointerup`, `pointercancel`, `blur`, unobserve, destroy or reduced motion cancels it. When it fires the press becomes a drag (the pointer's own offset (0, 0) plus the scroll since the down point, W80) and the pointer is captured; while it is live the browser's scroll is prevented by a non-passive `touchmove` listener on every draggable observed element (attached at `observe()`, detached at `unobserve()`, none on a `drag: false` element) that calls `preventDefault()` only while a touch drag is live (W84.0 Q1 strategy (a)). A tap stays a click; the click ending a touch drag is swallowed as W78's. Mouse and pen are unchanged (4 px, no timer). (Brainstorm 2026-10-13, slice design §12.)
Consequence: W84.0 Q1 (Chromium, CDP touch): a long-press + 120 px move scrolls 0 px (105 px without a listener), no `pointercancel`, every `touchmove` cancelable, no intervention; a 30 px swipe still scrolls and cancels the press; a tap gives exactly one click. All three strategies work in Chromium; (a) is the only one present before `touchstart`, which iOS Safari needs. Its cost: the observed elements' rects (only those) become blocking touch regions, so a swipe starting on one waits for the main thread (up to about one engine frame). Not confirmable in emulation: iOS Safari, Android swipe latency, the 8 px / 350 ms feel with a real finger (Dennis' phone at gold). The red e2e must not use `page.waitForFunction` (Playwright's listeners make the whole document a blocking region and hide a failing strategy).
Decision: PENDING

### D84-2: Per-element opt-out
Proposal: `observe(el, { drag: false })`, validated (a boolean) and captured once like `viscosity`; the element never drags by mouse, pen or touch and keeps the browser's own long-press behaviour (no context-menu or callout suppression, D84-5). A press on an opted-out element nested in a draggable observed one drags nothing (the innermost observed element decides, D67-9). `drag: true` or absent: as today.
Consequence: a new element option (the whitelist grows by one); the adapters carry it in W85. W84.0 Q4: a nested opted-out element still claims the `pointerdown` (so the outer one ignores it): nothing drags by touch or mouse, the page scrolls natively under a touch.
Decision: PENDING

### D84-3: Pointer decay per time
Proposal: the idle decay becomes `v ← v · 0.8^e` with `e = dtMs · 0.06` (`dtMs` the runtime clock's time since the last sample; the 120 ms hold before it unchanged), and `e` snapped to exactly 1 when `|e − 1| < 1e-9`, so a 60 Hz frame is exactly today's ×0.8 and 60 Hz and 120 Hz have the same idle tail in wall time.
Consequence: W84.0 Q3: the manual clock accumulates time, so without the snap only 7 of 100 000 frames give exactly 0.8 (off by ≤ 1e-12); with it 100 000 of 100 000, so every existing test, baseline and e2e number is bit-identical. 60 vs 120 Hz tails equal to < 1e-14 (today 120 Hz reaches 1 % in 175 ms instead of 350 ms). Closes D68-4's limitation.
Decision: PENDING

### D84-4: Feedback at the long-press
Proposal: (i) no extra feedback: the drag starts when the timer fires and W78's hold softens the liquid at once (no new rule, no engine change). Not (ii) the 2 % swell, not (iii) `navigator.vibrate`.
Consequence: W84.0 Q2 (stills inspected with vision): from the first frame after the fire the rim goes ragged and wobbly in both renderers; under Canvas2D the label hides (W78's `liquid-away`), under WebGPU it stays on the liquid — read as "picked up" in both. (ii) adds ≈ 5 px on the card, 2–3 px on a pill, not visible by eye; (iii) is missing on iOS Safari and gated by user activation on Android (the first long-press on a page would not vibrate).
Decision: PENDING

### D84-5: Context menu, callout and selection on touch
Proposal: `contextmenu` is prevented only while a touch press on a draggable observed element is live (pending or dragging), so a desktop right-click and the keyboard menu key are untouched; `-webkit-touch-callout: none` applies to draggable observed elements in the `@layer liquiddom` sheet (an opted-out element keeps it); text selection is already blocked while a press is live (W78's `selectstart`).
Consequence: on a phone a long-press on a draggable observed element no longer selects text or opens the link preview or menu (`drag: false` restores both). W84.0 Q4: a desktop right-click stays one unprevented `contextmenu`. Chromium's emulation never fires `contextmenu` on a touch hold, so the suppression itself is checked only on Dennis' phone (and in jsdom by dispatching the event).
Decision: PENDING

## Spike W84.0 result (2026-10-21, a throwaway copy of `7d3adfe`, deleted; report `.superpowers/sdd/W84/spike-Q.md`, stills in `.superpowers/sdd/W84/stills/`, inspected with vision)

| Q | Candidates | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1 | `touchmove` listener (a) per element from `observe()`, (b) on the document from the touch `pointerdown`, (c) from the fire | long-press + 120 px: scroll 0 px in all three (105 px without), no `pointercancel`, 11–12/11–12 moves cancelable and prevented, no intervention; swipe 30 px scrolls, press cancels; tap = 1 click; blocking regions: (a) the observed rects, (b) the whole document while pending, (c) after the fire; the latency cost is not measurable over CDP | — | (a): the only one present at `touchstart` (iOS Safari) (D84-1) |
| Q2 | (i) the hold alone, (ii) + 2 % swell (TS rect), (iii) vibrate | (ii) +5 px card, +2–3 px pill; vibrate: iOS none, Android activation-gated | (i) rim ragged/wobbly from frame 0 in both, Canvas2D label hides, WebGPU text rides; (ii) indistinguishable from (i) | (i) (D84-4) |
| Q3 | `0.8 ** (dtMs·0.06)` plain or snapped | plain exact in 7/100 000 manual frames, snapped 100 000/100 000; f32 input equal 40/40; 60 vs 120 Hz < 1e-14 | — | snapped (D84-3) |
| Q4 | nested opt-out, right-click, tilt, scroll while pending | nested `drag: false`: nothing drags, page scrolls; right-click unprevented; tilt during a drag fine; a scroll while pending carries into the offset (W80) | — | D84-2 as proposed; D84-1 offset wording fixed |

Harness: `page.waitForFunction` and CDP `Log.enable` add document touch listeners that make every touch sequence blocking; the touch e2e polls with `page.evaluate` / `expect.poll` and reads interventions with a `ReportingObserver`.

## Specification
**Baseline (2026-10-21, `93f5a03`).** Carried from W83 complete; only one Rust test changed (platform-bound golden, counts unchanged). Recount at red.

| Suite | Count |
|---|---|
| cargo | 240 passed; 0 failed; 1 ignored |
| vitest | 772 passed (772), 76 files |
| Playwright `--list` | canvas2d 97, webgpu 51, webgpu-hw 98, perf 6 |

The rest of the Specification, Tests, Must NOT, Must DO and the Manual Smoke Test are written with plan part 2, after the gate.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at red_ | | |

## Must NOT
- Change mouse or pen drag (W78), the engine's drag rules or the FFI layout.
- Block a touch scroll that starts on an observed element and moves before the long-press fires.
- Suppress a desktop right-click, or the context menu of an opted-out element.

## Must DO
- Cancel the long-press timer on every end path (no timer survives `destroy`).
- Keep a tap a click (splash, the author's handlers).
- Test the touch path with Playwright `hasTouch` and CDP touch events in the blocking canvas2d project.

## Manual Smoke Test
### Setup
Written with plan part 2 (the dev server, opened on a phone on the same network).

### Steps
1. On a phone, long-press a pill in the acceptance scene and drag it.
   Verify: the liquid follows the finger, the page does not scroll, no context menu opens; on release it springs home.
2. Swipe quickly over the same pill.
   Verify: the page scrolls; nothing drags.

### Pass criteria
- [ ] Long-press drag works on Dennis' phone, a swipe scrolls.
- [ ] A `drag: false` element never drags and keeps its context menu.

## Verification
Part 2 (red, gold, vision in both renderers, Dennis' smoke on a phone).
