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
Proposal: a primary touch `pointerdown` on a draggable observed element (the innermost, D67-9) starts a 350 ms timer (runtime clock-independent: a real `setTimeout`, cancelled on every end path); a move of more than 8 px from the down point, `pointerup`, `pointercancel`, `blur`, unobserve, destroy or reduced motion cancels it. When it fires the press becomes a drag at offset (0, 0) and the pointer is captured; while it is live the browser's scroll is prevented by a non-passive `touchmove` listener (which one from W84.0 Q1). A tap stays a click; the click ending a touch drag is swallowed as W78's. Mouse and pen are unchanged (4 px, no timer). (Brainstorm 2026-10-13, slice design §12.)
Consequence: from W84.0 Q1.
Decision: PENDING

### D84-2: Per-element opt-out
Proposal: `observe(el, { drag: false })`, validated (a boolean) and captured once like `viscosity`; the element never drags by mouse, pen or touch and keeps the browser's own long-press behaviour (no context-menu or callout suppression, D84-5). A press on an opted-out element nested in a draggable observed one drags nothing (the innermost observed element decides, D67-9). `drag: true` or absent: as today.
Consequence: a new element option (the whitelist grows by one); the adapters carry it in W85.
Decision: PENDING

### D84-3: Pointer decay per time
Proposal: the idle decay becomes `v ← v · 0.8^(dt·60)` with `dt` the runtime clock's time since the last sample (the 120 ms hold before it unchanged), so 60 Hz and 120 Hz have the same idle tail in wall time and `?clock=manual` stays deterministic.
Consequence: from W84.0 Q3 (whether a 1/60 s manual step gives exactly ×0.8, and which states or baselines move).
Decision: PENDING

### D84-4: Feedback at the long-press
Proposal: from W84.0 Q2 — (i) the drag starts at offset (0, 0) and W78's hold softens the liquid (no new engine rule), (ii) as (i) plus the 2 % hover swell while a touch drag is live, or (iii) as (i) or (ii) plus a short `navigator.vibrate` where the browser has it.
Consequence: from W84.0 Q2 (stills in both renderers, inspected with vision).
Decision: PENDING

### D84-5: Context menu, callout and selection on touch
Proposal: `contextmenu` is prevented only while a touch press on a draggable observed element is live (pending or dragging), so a desktop right-click and the keyboard menu key are untouched; `-webkit-touch-callout: none` applies to draggable observed elements in the `@layer liquiddom` sheet (an opted-out element keeps it); text selection is already blocked while a press is live (W78's `selectstart`).
Consequence: on a phone a long-press on a draggable observed element no longer selects text or opens the link preview or menu (`drag: false` restores both).
Decision: PENDING

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
