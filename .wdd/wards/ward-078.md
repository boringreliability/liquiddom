---
ward: 78
revision: null
name: "Drag the liquid"
epic: "fluid-engine"
status: "planned"
dependencies: [77]
layer: "both"
estimated_tests: 53
created: "2026-10-11"
completed: null
---
# Ward 078: Drag the liquid

North star: step 5 (drag "Merge" away and release: the liquid follows the pointer with its label and crawls home within 3 s); the merge and step 5 ✅ are W79.

## Scope
First ward of slice 5 (design `docs/superpowers/specs/2026-10-11-liquiddom-slice-5-drag-merge-design.md` §4). A mouse or pen press past 4 px on an observed element drags its liquid, never its DOM: TS tracks the gesture (`drag-tracker.ts`), writes `DRAGGED` into slot 5 and the offset into slots 6–7; Rust holds the dragged element at `s ≤ 0.5` (it never rests), lets its home velocity include the offset and keeps the pointer field off its particles; the saturated home spring brings it home after release. The click that ends a drag is swallowed once. WebGPU's atlas text rides the liquid as in slice 4; Canvas2D hides the dragged element's DOM glyphs (`liquid-away`) until it is at rest. Spike W78.0 (half a day, throwaway) answers the design §3 question for W79.

Out of scope: neighbour softening, slip tuning, the "labels never overlap" mechanism (W79, D79-1 … D79-3); touch drag (slice 6); keyboard drag; a per-element drag opt-out (slice 6; Dennis 2026-10-11, saga dec_e09cbdf8); per-time pointer decay; stacking behind opaque neighbours (slice 6).

## Inputs
- The slice design §1–§7 and the spec as amended in `c9ecf5e` (§2 damage rules, hover/focus, drag row; §4 DOM model).
- Element buffer slots 5–7 (`INTERACTION_DRAGGED = 3`, `home_dx/dy`) and `home_rect`/`homeRectInto`, which already add the offset (W64, W68).
- `Elements::damage` (W67, W74 D74-7: restAlpha 0 at once), `update_velocities` (W67 D67-14), the soft pointer field (W68 D68-3, W70 D70-3).
- The toggle pattern of `text-toggle.ts` (W74 D74-6) and `halo-toggle.ts` (W75 D75-3), the shared `classHolds` refcount in `stylesheet.ts`.
- `SplashInput` (W67 D67-9) and the reduced-motion gating (W68 D68-5).

## Outputs
- `drag-tracker.ts` (`DragTracker`, `ActiveDrag`, `DRAG_THRESHOLD_PX`), the registry's slot 5–7 writes, `away-toggle.ts` and `liquid-away`, the runtime wiring and cancel paths.
- Rust `Elements::is_dragged`, `interaction::{DRAG_STIFFNESS_CAP, hold_dragged}`, the offset in the home velocity, the pointer-field skip.
- The acceptance scene hook `slots()`; e2e helpers W79 extends (`w78DragMergeToCard`, `w78Slots`).
- The spike W78.0 table (below), which sets W79's constants and its D79-1 mechanism.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D78-1: The label follows the liquid during a drag
Proposal: WebGPU keeps slice 4's atlas text on the liquid (`liquid-text` while restAlpha < 1). Canvas2D draws no liquid text, so while an element is dragged, and after a release until its restAlpha is 1, the runtime sets a new class `liquid-away` that hides its DOM glyphs with the `liquid-text` declarations (`-webkit-text-fill-color: transparent`, `text-decoration-color: transparent`, `text-shadow: none`; never `color`, so the a11y tree, focus and the colour snapshot are untouched), in the `@layer liquiddom` screen + `forced-colors: none` block, so print and forced colours always show the text. A new class, because Canvas2D never sets `liquid-text` (D74-6). Refcounted per element across instances (the shared `classHolds` helper); removed at rest, at once on a cancel, under reduced motion, on `unobserve`, `destroy`, a failed frame or a failed rebuild; never under WebGPU. No halo while it is held (a halo around hidden glyphs), and a halo held by another Canvas2D instance is overridden by a `.liquid-away .liquid-halo` rule. The element observer counts `liquid-away` as liquiddom's own class. Chosen in the brainstorm (Dennis 2026-10-11, saga dec_e541d1bd); it still passes this gate.
Consequence: under Canvas2D the dragged element shows no label while away; the DOM label returns at the frame restAlpha reaches 1 (after the 120 ms rest fade), a small pop. A cancel (Escape, blur) shows the DOM label at the DOM home at once while the liquid still crawls back (the W75 halo covers it). One more class in the shared sheet and in `OWN_CLASSES` (an approved-test change in `element-observer.test.ts`).
Decision: PENDING

### D78-2: Mouse and pen drag with pointer capture past 4 px
Proposal: a `pointerdown` on an observed element with `pointerType` mouse or pen, `button === 0` and `isPrimary` starts a press; it becomes a drag once the pointer is more than 4 px from the down point (the spikes' 6 px is not adopted), and only then does the tracker call `setPointerCapture` (capturing at `pointerdown` would retarget every plain click, e.g. a link inside the card). One drag per instance; the innermost observed element takes the press. While a press is live, `selectstart` and `dragstart` are prevented on the document. Release: `pointerup` of that pointer (anywhere in the document). Cancel: `pointercancel`, window `blur`, `Escape`, `lostpointercapture`, a move with the primary button up, `unobserve`, `destroy`, reduced motion switched on, the element detached (next frame), a lost device, a failed frame. Touch and keyboard never drag in slice 5. Chosen in the brainstorm (Dennis 2026-10-11, saga dec_e541d1bd); the capture timing and the selection guard are this plan's resolutions.
Consequence: every observed element is draggable with a mouse or pen; there is no per-element opt-out in slice 5 (it comes in slice 6; accepted by Dennis 2026-10-11, saga dec_e09cbdf8). While a press is live the tracker blocks text selection inside observed elements, so mouse text selection that starts inside an observed element is no longer possible (keyboard selection is; accepted, saga dec_e09cbdf8). Touch users get no drag until slice 6 (`touch-action` and scroll). The spec's drag row is amended to "pointer capture once > 4 px" in W78.6.
Decision: PENDING

### D78-3: Spec physics with the offset in the home velocity; spike first
Proposal: Rust follows the spec model. A dragged element gets `damage(id, 0.5)` in every substep right after `update_stiffness` (spec §2 damage rule; once per tick would let s recover to ≈ 0.51 between substeps). `update_velocities` adds the offset delta to the rect delta while slot 5 is DRAGGED, so the home spring damps relative to the moving home; the release frame (offset → 0) adds no velocity (the anchor returns to the DOM, it does not move at −offset/dt). Slip stays as is (rate 3/s, max 160 px/s, × s²). Neighbour softening under the dragged home, slip tuning and the label-overlap mechanism are W79, with constants from spike W78.0 (half a day, throwaway, D2), which runs before this gate. Chosen in the brainstorm (Dennis 2026-10-11, saga dec_e541d1bd).
Consequence: W78 alone has no neighbour softening, so a drag into the card pushes the card's stiff liquid rather than merging with it (the MPM spike's finding); W78's into-card e2e checks only slots, the label, the click and re-form ≤ 180 frames, and the merge look is W79's. Fallback (Dennis 2026-10-11, saga dec_e09cbdf8): if the spike's "W78 alone" row shows the into-card release takes more than 180 frames for either element (Merge or the card), W78's e2e drags into free space and the into-card flow moves to W79; the spike's answer line (3) decides which applies. The hold costs one pass over the element slots per substep.
Decision: PENDING

### D78-4: DRAGGED beats hover and focus; the pointer field skips the dragged liquid
Proposal: the registry writes slot 5 as `DRAGGED (3) > hover (1) > focus (2) > idle (0)`, and 0 under reduced motion. The hover swell stays off while dragged (Rust swells on HOVER only, unchanged). The soft pointer field skips the dragged element's particles (its liquid follows its home, not the pointer field); other elements still feel the pointer.
Consequence: a dragged element under the pointer does not get a second, pointer-field pull; the card under a dragged Merge still feels the pointer field and its own hover swell. D68-2's "hover beats focus until slice 5" stays (focus has no engine effect yet).
Decision: PENDING

### D78-5: A dragged element never rests
Proposal: the hold's `damage` sets restAlpha to 0 in every substep and `s ≤ 0.5 < REST_S_MIN (0.95)`, so the rest condition cannot hold while slot 5 is DRAGGED; after release the existing rules (`s > 0.95`, `maxDev < 0.75 px`, `‖F − I‖ < 0.05`, 150 ms hold, 120 ms fade) apply against the DOM home.
Consequence: a drag held still never draws the exact rest contour at the displaced home (Canvas2D keeps the density splat, WebGPU keeps the atlas text); re-form starts at release and s recovers from 0.5, so a re-form after any drag takes at least ≈ 113 frames with the default recovery 0.7 s (s > 0.95 after 0.7·ln 10 = 1.61 s, plus hold and fade). A per-element `recovery` above ≈ 1.1 s cannot re-form within 3 s after a drag (as after a splash).
Decision: PENDING

### D78-6: The click that ends a drag is swallowed once
Proposal: after a drag that crossed the threshold, the next `click` whose target lies inside the dragged element is stopped at the window's capture phase (`stopImmediatePropagation` and `preventDefault`) and the swallow is cleared; it is also cleared in the task after the press's `pointerup` (or at the next press), so a later click splashes normally. After a cancel the swallow lasts until that press's `pointerup`. A press that never crosses 4 px stays a click (splash). The swallow lives in `drag-tracker.ts`; `SplashInput` is unchanged.
Consequence: the author's click handlers on the dragged element (and on its ancestors) do not see the click that ends a drag: a drag is not an activation, as with native drag and drop. With two instances on one element the first instance's listener stops the click for both.
Decision: PENDING

## Specification
**Values (slice design §4).** `DRAG_THRESHOLD_PX = 4` (strictly more than 4 px from the down point); `DRAG_STIFFNESS_CAP = 0.5`; re-form after release ≤ 180 frames (NORTH-STAR step 5, 3 s at 60 Hz). Interaction codes `IDLE 0, HOVER 1, FOCUSED 2, DRAGGED 3` (unchanged).

**Gesture state machine (`drag-tracker.ts`).** idle → (mouse/pen primary `pointerdown` on an observed element, not reduced motion, no press live) → pressed → (move > 4 px) → dragging [capture, `lostpointercapture` listener] → (`pointerup`: release | `pointercancel`, `blur`, `Escape`, `lostpointercapture`, move with the button up, `detach`, `cancel()`, `frame()` on a detached element, `destroy`: cancel) → idle. A pressed (below-threshold) press ends silently. `onEnd(el, how)` fires only for a press that was dragging. Release arms the click swallow and clears it in the next task; cancel arms it until that press's `pointerup`; the next press clears it.

**Frame order (`runtime.ts`).** `applyDomChanges → dragTracker.frame → registry.sync (slots 0–7) → pointer sample → core.tick → atlas/paints → render → syncText → syncAway → syncHalo`.

**Engine (Rust).** Per substep: `update_stiffness(dt)` → `hold_dragged` (`damage(id, 0.5)` for each active element with slot 5 within ±0.5 of 3) → `substep_with` (pointer term skipped for particles whose element row is dragged). Per tick with steps > 0: `update_velocities(window)`: `v = (Δrect + [dragged] Δoffset) / window`, `prev_off ← offset if dragged else 0`.

**Label (Canvas2D).** `wantsAway = canvas2d ∧ ¬reducedMotion ∧ (dragged ∨ (held ∧ restAlpha < 1))`; NaN restAlpha counts as at rest. Held elements are passed to the halo sync as `suppressed`.

**Baseline (2026-10-11, `c9ecf5e`; re-measured unchanged at `5978a88`).**

| Suite | Count |
|---|---|
| cargo test | 170 passed; 0 failed; 2 ignored |
| vitest | 633 passed, 4 skipped (637), 61 files |
| Playwright --list canvas2d / webgpu / webgpu-hw / perf | 58 / 33 / 68 / 3 |

## Spike W78.0 result
Run 2026-10-11 on a throwaway copy of `5978a88` in the session scratchpad (`w78spike/`, D2: nothing copied into the repo). The copy typed in W78.2 Steps 1–6 and W78.1 Step 2 (`drag_tests.rs`: 8 passed, `W78 drag re-form after release: Some(122) frames`, as the plan predicts) plus four thread-local knobs (dragged cap in `hold_dragged`; neighbour cap = `damage(n, cap_n)` for every other active element whose home rect overlaps the dragged home rect grown by 16 px; slip rate and max; the mechanism (b) owner-mass pass after P2G, stencil-weighted per cell, a particle is "foreign" when the other side's mass in its nearest cell exceeds 50 %). Wall time: well inside the half-day box; every cell below was measured except mechanism (a)'s cost, which the plan asks to estimate.

Question (slice design §3, verbatim): with the spec model (dragged `s ≤ 0.5`, home velocity including the offset, slip separation) plus a neighbour cap under the dragged home, which caps (dragged 0.3–0.5, neighbour 0.2–0.5) and slip (rate, max) make "Merge" dragged into the card (1) merge visibly, (2) separate after release, (3) both re-form within 180 frames, (4) leave no pixel carrying both elements' WebGPU text coverage during and after the merge, and with which mechanism (§5 candidates a/b), at what cost per frame?

Matrix (`cargo test --release --lib w78_spike -- --ignored`, `FluidCore` over the acceptance layout, 8000 particles, seed 1, 30 idle frames, offset ramps to (−164, +146) px over 10 frames, hold 30 frames, release; no pointer). room = fraction of the card particles whose target lies inside Merge's dragged home rect that sit outside it at hold f30; Merge in = fraction of Merge particles inside its dragged home rect at hold f30; rest frames = first frame after release with restAlpha 1 (no row ever dropped below 1 again within 400 frames); mixing = Merge particles inside the card's DOM rect inset 4 px / card particles inside Merge's DOM rect inset 4 px at the first frame both rest; foreign = mechanism (b)'s flag summed over all particles (the dynamics are identical with the pass on and off, asserted); tick p95 = ms per `tick` (one fixed step) over hold + 120 release frames, pass off / on, single runs (outliers above 5 ms are machine noise; see the repeat below).

| dragged cap | neighbour cap | slip rate / max | room | Merge in | rest frames Merge / card | mixing at rest M→C / C→M | foreign hold f30 / rel f30 / rel f90 | tick p95 off / on |
|---|---|---|---|---|---|---|---|---|
| 0.3 | off | 3/s / 160 px/s | 0.01 | 0.00 | 155 / 109 | 0 / 0 | 427 / 113 / 0 | 3.47 / 5.00 ms |
| 0.3 | off | 4.5/s / 240 px/s | 0.01 | 0.00 | 138 / 105 | 0 / 0 | 506 / 79 / 0 | 3.52 / 3.86 ms |
| 0.3 | 0.2 | 3/s / 160 px/s | 0.05 | 0.00 | 155 / 142 | 0 / 0 | 267 / 49 / 0 | 6.53 / 4.58 ms |
| 0.3 | 0.2 | 4.5/s / 240 px/s | 0.05 | 0.00 | 138 / 132 | 0 / 0 | 383 / 34 / 0 | 5.18 / 5.91 ms |
| 0.3 | 0.35 | 3/s / 160 px/s | 0.02 | 0.00 | 159 / 142 | 0 / 0 | 317 / 62 / 0 | 3.83 / 3.90 ms |
| 0.3 | 0.35 | 4.5/s / 240 px/s | 0.02 | 0.00 | 130 / 124 | 0 / 0 | 419 / 47 / 0 | 3.58 / 3.96 ms |
| 0.3 | 0.5 | 3/s / 160 px/s | 0.01 | 0.00 | 155 / 130 | 0 / 0 | 361 / 84 / 0 | 3.25 / 4.03 ms |
| 0.3 | 0.5 | 4.5/s / 240 px/s | 0.02 | 0.00 | 131 / 120 | 0 / 0 | 462 / 61 / 0 | 3.30 / 3.91 ms |
| 0.4 | off | 3/s / 160 px/s | 0.01 | 0.00 | 142 / 121 | 0 / 0 | 568 / 124 / 0 | 3.38 / 3.81 ms |
| 0.4 | off | 4.5/s / 240 px/s | 0.01 | 0.00 | 121 / 103 | 0 / 0 | 634 / 63 / 0 | 7.54 / 4.01 ms |
| 0.4 | 0.2 | 3/s / 160 px/s | 0.09 | 0.01 | 138 / 142 | 0 / 0 | 412 / 42 / 0 | 3.41 / 5.49 ms |
| 0.4 | 0.2 | 4.5/s / 240 px/s | 0.09 | 0.05 | 120 / 132 | 0 / 0 | 523 / 24 / 0 | 3.57 / 4.07 ms |
| 0.4 | 0.35 | 3/s / 160 px/s | 0.05 | 0.00 | 138 / 168 | 0 / 0 | 448 / 73 / 0 | 3.72 / 4.32 ms |
| 0.4 | 0.35 | 4.5/s / 240 px/s | 0.05 | 0.01 | 121 / 123 | 0 / 0 | 566 / 51 / 0 | 3.54 / 4.13 ms |
| 0.4 | 0.5 | 3/s / 160 px/s | 0.02 | 0.00 | 155 / 152 | 0 / 0 | 491 / 106 / 0 | 3.65 / 4.05 ms |
| 0.4 | 0.5 | 4.5/s / 240 px/s | 0.02 | 0.00 | 120 / 124 | 0 / 0 | 601 / 64 / 0 | 3.91 / 4.10 ms |
| **0.5 (W78 alone)** | **off** | **3/s / 160 px/s** | **0.01** | **0.00** | **135 / 116** | **0 / 0** | **630 / 136 / 0** | **7.25 / 4.01 ms** |
| 0.5 | off | 4.5/s / 240 px/s | 0.01 | 0.02 | 113 / 100 | 0 / 0 | 641 / 56 / 0 | 3.65 / 4.13 ms |
| 0.5 | 0.2 | 3/s / 160 px/s | 0.14 | 0.15 | 138 / 149 | 0 / 0 | 525 / 42 / 0 | 3.59 / 4.02 ms |
| **0.5 (best row)** | **0.2** | **4.5/s / 240 px/s** | **0.15** | **0.26** | **113 / 132** | **0 / 0** | **634 / 24 / 0** | **3.63 / 4.28 ms** |
| 0.5 | 0.35 | 3/s / 160 px/s | 0.07 | 0.06 | 138 / 160 | 0 / 0 | 566 / 93 / 0 | 3.51 / 4.10 ms |
| 0.5 | 0.35 | 4.5/s / 240 px/s | 0.08 | 0.15 | 116 / 126 | 0 / 0 | 649 / 52 / 0 | 3.73 / 4.13 ms |
| 0.5 | 0.5 | 3/s / 160 px/s | 0.04 | 0.02 | 155 / 148 | 0 / 0 | 601 / 132 / 0 | 3.54 / 4.32 ms |
| 0.5 | 0.5 | 4.5/s / 240 px/s | 0.04 | 0.09 | 117 / 122 | 0 / 0 | 645 / 73 / 0 | 3.53 / 3.93 ms |

Best row (Step 6 rule: largest room with both rest frames ≤ 180 and the lowest mixing; every row re-forms ≤ 180 and every mixing is 0/0): **dragged 0.5, neighbour 0.2, slip 4.5/s / 240 px/s**. Its 3/160 twin (the row above it) has room 0.14.

Extra measurements (same copy): Merge's centroid at hold f30 / f60 / f120 (target centre (640, 430)): W78 alone (681.8, 370.3) / (665.6, 392.7) / (647.8, 417.7), fraction within 16 px of the dragged rect 0.05 / 0.49 / 1.00; best row (660.8, 395.9) / (652.3, 411.1) / (645.1, 421.9), 0.60 / 0.92 / 1.00. So a 30-frame hold leaves Merge's liquid still pressing in at the card's upper edge; it reaches the card centre only after 60–120 hold frames. Mechanism (b) cost, W78-alone row, 6 alternating repeats: p95 off 3.40–3.72, on 3.80–4.05, medians **3.52 → 3.98 ms per tick (+0.46 ms, +13 %)** with the pass in every substep (8 per tick); once per tick would cost about an eighth of that (not measured (time box)).

Browser (Playwright in the copy on its own Vite server :4190, W78.1's `w78DragMergeToCard` flow with slots 5–7 written by a spike hook instead of the not-yet-built drag tracker, pointer moving with the drag; console clean in all four runs): every restAlpha 1 after **140 frames** (W78 alone) and **132 frames** (best row), identical in canvas2d and webgpu (Metal). Stills in `$S/w78spike/stills/` (`{canvas2d,webgpu}-{w78alone,best}-{hold-f30,rel-f30,rel-f90}.png`, 12 PNGs). Vision notes:
- canvas2d, W78 alone: hold f30 — Merge's green liquid lies as a translucent green smear over the card's upper right, inside the card's outline; the card is barely dented (no visible displacement merge, a blend). rel f30 — the green blob crawls back up out of the card's top-right corner, still attached to it by a thin neck. rel f90 — separated; Merge almost re-formed (ragged edge), card whole.
- canvas2d, best row: hold f30 — the card has a clear notch in its top edge and bulges at the bottom (it made room); Merge's green sits darkened inside the card at the centre-right, a visible merge. rel f30 — Merge is back home with a small tail, the card still shows a notch and a few stray specks near its top centre. rel f90 — both separated and re-formed.
- webgpu, W78 alone: hold f30 — the "Merge" atlas text is squashed into a thin smear right after "Liquid at rest" (adjacent to "rest", no glyph on glyph seen); the card's text is wavy (the card is pushed, so its own liquid text runs). rel f30 — "Merge" rides the green blob back up, slanted. rel f90 — re-formed, both labels at home.
- webgpu, best row: hold f30 — the card is notched, Merge's green liquid sits inside it with "Merge" on top of where "the source of" was; the card's text near it is torn and smeared into a white hook/ring around the green liquid. No two glyphs seen on the same pixels, but the card's torn text streak runs right up to Merge's liquid. rel f30 — Merge home; the card's text "the source of / follows it" is still warped and one torn glyph fragment floats near (700, 385). rel f90 — both re-formed, labels clean.

Mechanism (a) (min/max element id targets in the T1 pass) was not built: estimate only. `perf-webgpu.json` records no separate text-pass time; W74's RAF p95 rose 3.8 → 4.33 ms (ward-074 "Measured"), so W74's text pass costs at most ≈ 0.53 ms per frame (an upper bound that also contains F's CPU cost). With two extra `r16float` targets at 1× backing written by every text splat, the pass costs ≤ 1.5 × 0.53 ≈ 0.8 ms, i.e. **≤ +0.27 ms per frame of GPU work, only while text moves** (estimate, not measured).

Answer:
1. W79 constants: dragged cap 0.5, neighbour cap 0.2, slip 4.5/s / 240 px/s (room 0.15, Merge in 0.26, rest 113 / 132 frames, mixing 0 / 0; browser 132 frames). The visible merge at a 30-frame hold is modest (room ≤ 0.15 in every row); a lower neighbour cap than 0.2 was not in the matrix.
2. D79-1: mechanism (a), estimated ≤ +0.27 ms GPU per frame while text moves, because it guarantees the per-pixel rule directly; (b) is measured at +0.46 ms CPU per tick (+13 %) with the pass in every substep, flags 500–650 particles at hold f30 (a coarse cell-majority signal, would need hysteresis) and only bounds overlap per cell. Neither is proven by the spike for criterion (4): the stills show no glyph on glyph, but the card's torn text runs up to Merge's liquid.
3. Yes: "W78 alone" re-forms both elements within 180 frames after an into-card release (Rust: Merge 135, card 116; browser, every restAlpha 1: 140 frames in canvas2d and in webgpu on Metal). W78's e2e keeps the into-card flow; the free-space fallback (saga dec_e09cbdf8) does not apply.
4. No D78 value should change: with no neighbour cap a lower dragged cap (0.3/0.4) adds no room (0.01) and slows Merge's re-form (0.3: 155 vs 135 frames); 0.5 stays.
5. Risks W79 inherits: a 30-frame hold shows only a partial merge (Merge needs 60–120 hold frames to reach the card centre), so step 5's look may need more than caps; the softened card's WebGPU text tears into streaks and leaves glyph fragments for ≈ 30 frames after release; re-form margins are 113–168 frames against 180 in the Rust matrix (browser +8 frames from hover and the pointer); the mixing measure was 0 in every row, so it did not discriminate between rows; single-run tick p95 values are noisy on this machine (use repeats when W79 gates on cost).

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | drag_tests.rs: given_slot_5_values_when_is_dragged_then_true_only_within_half_of_dragged | D78-4 slot 5 reading |
| 2 | drag_tests.rs: given_a_dragged_element_whose_offset_grows_when_update_velocities_then_the_home_velocity_includes_the_offset_delta | D78-3 home velocity |
| 3 | drag_tests.rs: given_a_drag_released_or_a_stray_offset_on_an_idle_element_when_update_velocities_then_the_offset_adds_no_velocity | D78-3 no release spike |
| 4 | drag_tests.rs: given_d78_cap_when_hold_dragged_then_a_dragged_element_gets_s_at_most_0_5_and_rest_alpha_0_and_an_idle_one_is_untouched | D78-3/D78-5 hold |
| 5 | drag_tests.rs: given_merge_dragged_then_held_still_when_ticking_90_frames_then_its_s_never_exceeds_0_5_its_rest_alpha_stays_0_and_the_others_keep_s_1 | D78-3/D78-5 in the core |
| 6 | drag_tests.rs: given_merge_dragged_150px_up_when_ticking_then_its_liquid_follows_the_displaced_home | home_rect with the offset |
| 7 | drag_tests.rs: given_the_pointer_moving_over_dragged_merge_when_ticking_then_its_liquid_moves_as_without_the_pointer_and_an_idle_merge_is_pushed | D78-4 pointer skip |
| 8 | drag_tests.rs: given_merge_dragged_150px_up_held_60_frames_and_released_when_ticking_then_it_never_rests_while_dragged_and_every_rest_alpha_is_1_within_180_frames | D78-5, re-form ≤ 180 |
| 9 | drag-tracker.test: given_a_mouse_press_when_moved_up_to_4_px_then_no_drag_and_past_4_px_the_drag_starts_with_dx_dy_from_the_down_point_and_only_then_captures | D78-2 threshold, capture timing |
| 10 | drag-tracker.test: given_a_pen_press_when_moved_past_the_threshold_then_it_drags_and_a_touch_press_never_drags | D78-2 pointer types |
| 11 | drag-tracker.test: given_the_right_or_middle_button_or_a_non_primary_pointer_when_pressed_and_moved_then_no_drag | D78-2, README RF3 |
| 12 | drag-tracker.test: given_a_press_on_a_child_of_the_observed_element_when_moved_past_the_threshold_then_the_observed_element_is_dragged_and_captured | README RF1 |
| 13 | drag-tracker.test: given_nested_observed_elements_when_the_inner_one_is_pressed_then_only_the_inner_one_drags | README RF1 |
| 14 | drag-tracker.test: given_a_drag_past_the_threshold_when_released_then_the_next_click_is_swallowed_once_and_a_click_in_a_later_task_passes | D78-6 |
| 15 | drag-tracker.test: given_a_press_that_never_crosses_the_threshold_when_released_then_its_click_passes_and_nothing_is_captured_or_ended | D78-2/D78-6 plain click |
| 16 | drag-tracker.test: given_an_active_drag_when_pointercancel_blur_escape_or_lostpointercapture_then_it_cancels_and_later_moves_do_not_restart_it | D78-2 cancel paths, README RF2 |
| 17 | drag-tracker.test: given_an_active_drag_when_the_pointer_is_released_outside_the_window_then_the_document_pointerup_releases_it_and_a_lost_release_cancels | README RF2 |
| 18 | drag-tracker.test: given_reduced_motion_when_pressed_and_moved_then_no_drag_no_capture_and_the_click_passes | reduced motion ignores drag |
| 19 | drag-tracker.test: given_an_active_drag_when_detach_cancel_or_destroy_then_it_cancels_and_a_detached_or_destroyed_tracker_ignores_presses | README RF5 |
| 20 | drag-tracker.test: given_an_active_drag_when_the_element_leaves_the_document_then_frame_cancels_it | detached element |
| 21 | drag-tracker.test: given_a_live_press_when_selectstart_or_dragstart_fires_then_its_default_is_prevented_and_without_a_press_it_is_not | D78-2 selection guard |
| 22 | drag-tracker.test: given_an_active_drag_when_a_second_pointer_presses_another_element_then_the_first_drag_is_unchanged | one drag per instance |
| 23 | hover-focus.test: given_a_hovered_and_focused_element_when_it_is_dragged_then_slot_5_is_dragged_3 | D78-4 priority |
| 24 | hover-focus.test: given_a_drag_when_synced_then_only_the_dragged_element_carries_the_offset | slots 6–7 |
| 25 | hover-focus.test: given_a_released_drag_when_the_next_sync_runs_then_slot_5_falls_back_to_hover_and_slots_6_7_are_0_in_that_same_sync | release in one sync |
| 26 | hover-focus.test: given_reduced_motion_and_a_drag_when_synced_then_slots_5_7_are_0 | reduced motion |
| 27 | away-toggle.test: given_canvas2d_and_a_dragged_element_when_synced_then_liquid_away_once_kept_after_release_while_restAlpha_below_1_and_removed_at_rest | D78-1 lifecycle |
| 28 | away-toggle.test: given_webgpu_reduced_motion_or_nan_when_synced_then_no_liquid_away_and_an_existing_hold_is_withdrawn | D78-1 gates |
| 29 | away-toggle.test: given_two_instances_holding_one_element_when_one_releases_then_liquid_away_stays_until_both_release_and_an_authors_own_class_is_kept | README RF4 |
| 30 | away-toggle.test: given_clearAwayClasses_or_a_missed_release_when_called_then_this_instance_lets_go | fail-safe |
| 31 | away-toggle.test: given_an_element_held_by_liquid_away_when_the_halo_syncs_with_it_suppressed_then_it_gets_no_halo_and_an_unsuppressed_one_does | D78-1 no halo, README RF4 |
| 32 | stylesheet.test: given_css_text_when_read_then_liquid_away_hides_glyphs_with_the_liquid_text_declarations_inside_the_screen_block_and_beats_a_halo_W78 | D78-1 CSS |
| 33 | element-observer.test: given_only_liquiddom_class_toggles_when_drained_then_no_entry_and_authorClasses_drops_own_classes_RF2 | approved-test change (D78-1): OWN_CLASSES gains liquid-away |
| 34 | drag-runtime.test: given_a_mouse_drag_on_an_observed_element_when_frames_run_then_slots_5_7_carry_dragged_and_the_offset_and_the_release_zeroes_them_in_the_next_frame | runtime wiring |
| 35 | drag-runtime.test: given_a_drag_released_on_its_element_when_the_click_follows_then_the_core_does_not_splash_and_a_click_in_a_later_task_splashes | D78-6 in the runtime |
| 36 | drag-runtime.test: given_a_press_that_moves_3_px_when_released_then_its_click_splashes_once_and_no_slot_changes | plain click (guard) |
| 37 | drag-runtime.test: given_canvas2d_and_a_drag_when_frames_run_then_liquid_away_is_on_while_dragged_kept_after_release_until_restAlpha_1_with_no_halo_meanwhile | D78-1 in the runtime |
| 38 | drag-runtime.test: given_webgpu_and_a_drag_when_frames_run_then_no_liquid_away_is_ever_set | D78-1 WebGPU (guard) |
| 39 | drag-runtime.test: given_a_drag_when_the_element_is_unobserved_mid_drag_then_its_slots_are_zeroed_liquid_away_is_gone_and_it_does_not_resume_after_re_observe | README RF5 |
| 40 | drag-runtime.test: given_a_drag_when_destroyed_then_liquid_away_is_gone_and_later_pointer_events_are_ignored | destroy |
| 41 | drag-runtime.test: given_a_drag_when_reduced_motion_switches_on_then_the_drag_cancels_liquid_away_goes_at_once_and_slots_are_0_next_frame | reduced motion switch |
| 42 | drag-runtime.test: given_two_instances_observing_one_element_when_it_is_dragged_and_released_then_both_write_dragged_the_click_never_splashes_and_liquid_away_stays_until_both_let_go | README RF4 |
| 43 | drag-runtime.test: given_a_drag_cancelled_by_escape_when_frames_run_then_liquid_away_goes_at_once_and_the_halo_takes_over_while_the_liquid_crawls_home | cancel vs release |
| 44 | drag-runtime.test: given_reduced_motion_when_an_element_is_pressed_and_moved_then_slots_stay_0_nothing_is_captured_and_the_click_reaches_the_gated_splash_path | reduced motion (guard) |
| 45 | drag-runtime.test: given_a_drag_under_webgpu_when_the_device_is_lost_then_the_drag_cancels_and_the_canvas2d_rebuild_shows_no_liquid_away | lost device |
| 46 | drag-runtime.test: given_a_drag_when_the_dragged_element_leaves_the_document_then_the_next_frame_cancels_it_and_zeroes_its_slots | detached element |
| 47 | e2e acceptance (canvas2d): step 5 – given Merge dragged into the card and held 30 frames when released then slots follow the drag, the click does not splash, Merge's DOM label hides while away and every restAlpha is 1 within 180 frames | step 5 drag in Canvas2D |
| 48 | e2e acceptance (canvas2d): step 5 – given a press on Merge that moves 2 px when released then it stays a click splash and nothing drags | plain click in the browser |
| 49 | e2e acceptance (canvas2d): step 5 – given Merge dragged into the card when Escape is pressed then the drag cancels … | Escape in the browser |
| 50 | e2e acceptance (canvas2d): step 5 – given a right-button drag on Merge into the card when moved then nothing drags | README RF3 |
| 51 | e2e acceptance (canvas2d, Linux): step 5 – given Merge dragged into the card and held 30 frames when screenshotted then it matches the baseline | baseline `acceptance-step5-drag-mid` |
| 52 | e2e acceptance (canvas2d, Linux): step 5 – given the drag released when every restAlpha is 1 then it matches the baseline | baseline `acceptance-step5-drag-reformed` |
| 53 | e2e webgpu-robust (webgpu-hw): W78 step 5 – given Merge dragged 150 px up into free space and held then it carries liquid-text, never liquid-away, and the canvas shows its white text inside the displaced rect | D78-1 WebGPU text follows |
| 54 | e2e webgpu-robust (webgpu-hw): W78 step 5 – given Merge dragged into the card and released then it carries liquid-text while away and, once every restAlpha is 1, no element carries liquid-text and Merge's DOM text is opaque | step 5 drag in WebGPU |

## Must NOT
- Move the DOM, focus or hit areas during a drag; write any inline style.
- Change a resting frame or one of the eight existing Linux baselines.
- Take a plain click's splash or native target away (no capture below 4 px).
- Drag under touch, keyboard, reduced motion, a non-primary button or pointer.
- Leave `liquid-away` on after a cancel, reduced motion, unobserve, destroy or a failed frame; set it under WebGPU; set `liquid-text` under Canvas2D.
- Use a W79 value (neighbour cap, slip, D79-1).
- Promise re-form within 3 s after a drag for a per-element `recovery` above ≈ 1.1 s: known limitation (as for splash; D78-5; Dennis 2026-10-11, saga dec_e09cbdf8).

## Must DO
- Run the spike before the gate and record its table here.
- Cancel the drag on every path in the Specification.
- Write slots 5–7 for every observed element in every `sync()`.
- Regenerate only the two new Canvas2D Linux baselines, with Dennis' vision approval (D65-7).

## Manual Smoke Test
### Setup
`npm run dev`, then open `http://localhost:3001/scenes/acceptance.html?renderer=auto` (Metal: WebGPU) and `…?renderer=canvas2d`.

### Steps
1. Press "Merge" and drag it into the card; hold; release.
   Expected: the liquid follows the pointer, the DOM button stays put, the label rides on the liquid (WebGPU) or hides while away (Canvas2D); after release the liquid crawls home within 3 s and the DOM label shows; no splash.
2. Click "Merge" without moving.
   Verify: it splashes as before.
3. Drag "Merge" and press Escape.
   Verify: the drag ends, the label shows at once, the liquid crawls home.

### Pass criteria
- [ ] No console error or warning in either renderer.
- [ ] The DOM button never moves; keyboard focus and the a11y tree are unchanged.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, Docker canvas2d baselines (two new, eight unchanged), vision on the drag in both renderers.
