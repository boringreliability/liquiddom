---
ward: 80
revision: null
name: "Scroll follows"
epic: "fluid-engine"
status: "planned"
dependencies: [79]
layer: "both"
estimated_tests: 50
created: "2026-10-13"
completed: null
---
# Ward 080: Scroll follows

North star: step 7 (scroll 300 px and back: the liquid follows with no snap and every element is at rest within the step-7 budget), in both renderers; steps 1–6 and 8 unchanged. Step 7 ✅ in S6 is claimed in W87, after W81's parking.

## Scope
First ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §3). Buffer space stays the viewport. TS reads the scroll delta once per frame (`scroll-tracker.ts`: the window's `scrollX/Y`, or the container's `scrollLeft/Top`) and calls a new scalar FFI call `scroll_shift(dx, dy, ivx, ivy)` after `registry.sync()` and before `tick`, only on frames with a scroll. Rust moves every particle of an element that moves with the page by whole cells and the grid's lattice origin by the sub-cell rest, and that element's previous home rect by the delta, so a scroll does not excite the liquid and the simulation equals the unscrolled one up to f32 rounding; a light, capped inertia lets the liquid lag and settle. A dragged element is not shifted; its drag offset grows by the scroll, so the dragged liquid stays under the pointer. Container mode keeps the canvas on the container's visible window with a `transform` on the canvas. The acceptance scene gets a spacer so it can scroll; step 7 gets a re-form budget (D80-3); a container scene covers container scroll. Spike W80.0 (half a day, throwaway) sets the inertia constants, the budget, the fill bound and answers the 1-frame-lag question (D80-4).

Out of scope: parking and grid reallocation (W81), canvas stacking under page content (W82), gravity (W83), touch drag (W84), zoom (beyond W75's DPR path).

## Inputs
- The slice design §1–§3, §11, §12 and the spec as amended in `17ede66` (§2 grid, walls, interaction table scroll row; §4 scroll row; §6 step 7).
- `Elements::update_velocities` (W67 D67-14, W78 D78-3: rect delta + drag offset delta while dragged), `Elements::is_dragged` (W78), the drag tracker's press and offset (W78 D78-2).
- `Scratch::invalidate_bounds` (D68-10), `Grid::to_grid/to_px/clamp_pos` and the fixed grid origin `(−margin, −margin)` (W64 B2, B15).
- The runtime's frame order, `readOffset`, the canvas mount and remount (`stylesheet.ts`, W72 D72-3).

## Outputs
- Rust `scroll.rs` (`ScrollShift`, `SCROLL_INERTIA_VMAX_PX_S`, `shifts_with_scroll`, `apply`), `Grid::{base_origin_px, scroll_origin}`, `Elements::shift_prev`, `FluidCore::scroll_shift`.
- TS `scroll-tracker.ts` (`ScrollTracker`, `ScrollSample`, `SCROLL_INERTIA`, `SCROLL_INERTIA_MAX_PX_S`), `DragTracker.scrolled`, `FluidCoreLike.scroll_shift`, the runtime wiring.
- The acceptance scene's spacer; `demo/scenes/scroll-container.html` (hook `__scrollContainer`); e2e helpers `e2e/scroll.ts` W81 and W87 reuse.
- The spike W80.0 table (below) that sets D80-2's constants, D80-3's budget and `FILL_MIN`, and D80-4.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D80-1: Scroll model — rigid scroll_shift in viewport space, whole cells plus a lattice-origin rest
Proposal: buffer space stays the viewport (body mode) or the container's visible window (container mode). `scroll-tracker.ts` (one per instance) reads the window's `scrollX/scrollY` or the container's `scrollLeft/scrollTop` once per frame after `applyDomChanges()`; Δ = now − previous (an instance's first frame 0; a non-finite read gives 0 and keeps the last good position; a canvas remount does not reset it; a frame resumed after a pause shifts the whole Δ). After `registry.sync()` and before `tick` the runtime calls `core.scroll_shift(dx, dy, ivx, ivy)`, only on frames with a scroll. Rust moves every particle of an element that moves with the page by whole cells and the grid's lattice origin by the sub-cell rest (`Grid::scroll_origin`, the origin kept within half a cell of `−margin`), so the particles keep their lattice phase and move by exactly (−dx, −dy) px; that element's previous home rect moves with it, so its home velocity is 0 and nothing un-rests. A dragged element is not shifted (its particles stay put in px); TS adds the scroll to its drag offset in the same frame (a press below the 4 px threshold accumulates it, but a scroll alone never starts a drag), so the dragged liquid stays under the pointer; in container mode a page scroll around the container counts for the drag too (`dragDx = Δscroll − Δoffset`) and shifts nothing else. Container mode: `transform: translate(scrollLeft, scrollTop)` on liquiddom's canvas keeps it on the container's visible window (written only on change, re-applied to a remounted canvas; never on author DOM). Sanitised in Rust: NaN/Inf → 0, shift clamped to ±`WORLD_MAX_PX` (a negative one, overscroll, is kept), inertia capped at 2000 px/s; `invalidate_bounds()` (D68-10). Reduced motion: the shift applies, the inertia is 0 (TS and Rust). No parking (W81). Chosen in the brainstorm (Dennis 2026-10-13, saga dec_645b54e4); the lattice-origin split, the drag rules, the remount rule and the container rules are the plan's resolutions.
Consequence: the spec's "without inertia the simulation is bit-identical to an unscrolled page" becomes "identical up to f32 rounding" (positions rewritten in f32 cannot be bit-exact; the plan validation measured ≤ 0.0031 px over 300 px down and back, also with a splash in flight, where a plain shift by fractions of a cell diverged by 5.05 px within 60 frames). A zero shift is a bit-exact no-op and an idle page never calls `scroll_shift`, so runs without a scroll stay bit-identical to W79. The grid's walls move by up to half a cell (≤ 4 px). Elements scrolled beyond the 200 px grid margin clamp to the walls until W81 parks them. One new scalar FFI call, no new slot.
Decision: APPROVED 2026-10-13 — as proposed: rigid scroll_shift in viewport space, whole cells plus a lattice-origin rest, a dragged element is not shifted (its drag offset grows by the scroll), a canvas remount keeps the delta, container mode via a transform on liquiddom's canvas (saga dec_bf3e91f4)

### D80-2: Inertia — Δ · 60 · SCROLL_INERTIA, capped (values from W80.0)
Proposal: `iv = Δ · 60 · SCROLL_INERTIA` px/s (equal to the design's `Δ / frameDt · SCROLL_INERTIA` at 60 Hz) with the direction of the scroll (down → ivy > 0 → the liquid lags below its home), its speed capped at `SCROLL_INERTIA_MAX_PX_S`; 0 on a frame without elapsed time (the first after a pause or a hidden tab) and under reduced motion. Rust adds it to the shifted particles' velocities. Values from the spike; the plan carries provisional `SCROLL_INERTIA` 0.05 and `SCROLL_INERTIA_MAX_PX_S` 120 (plan validation, Rust, 10 px/frame: the card lags ≤ 5.9 px, worst maxDev 7.06 px, every restAlpha 1 26 frames after the scroll back).
Consequence: per distance, not per Δ/dt: the design's form doubles a scroll's total impulse at 120 Hz (Rust adds `iv` once per call; the D68-4 limitation); this one is the same at any frame rate. A fast scroll un-rests the elements for a moment (Canvas2D draws the density instead of the exact rect, WebGPU the liquid text) and they settle within the budget; a slow one stays at rest while its lag is under 0.75 px. `FILL_MIN` (D80-3) follows from these values.
Decision: AMENDED 2026-10-13 — SCROLL_INERTIA 0.02, SCROLL_INERTIA_MAX_PX_S 30, the cap scaled per 1/60 s: the per-call cap is SCROLL_INERTIA_MAX_PX_S · dt · 60, so 60 Hz and 120 Hz give the same total impulse (W80.0: 0.05 / 120 tears the liquid off at 15–50 px/frame; a per-call cap doubles the impulse at 120 Hz) (saga dec_67a169e6)

### D80-3: Step-7 budget and "no snap"
Proposal: NORTH-STAR step 7 and spec §6 step 7 change together to `7. Scroll 300 px and back: the liquid follows with no snap and every element is at rest within **3 s** after the scroll.` (seconds from the spike; the recommended 3 s matches steps 3, 5 and 6), so `e2e/north-star.ts` gives a step-7 budget. "No snap" is measured per frame as the fill of every visible element's DOM shape (its rounded rect inset 4 px) by its own colour or by liquid text, ≥ `FILL_MIN` (provisional 0.75; the gate sets min(0.9, the spike's lowest browser fill − 0.05)), at 1, 10 and 300 px per frame, during a smooth `scrollTo`, mid-drag and in a container. The acceptance scene gets a 640 px spacer below the stage (document 1160 px, max scroll 360 px at 1280×800); Linux baselines are viewport screenshots at scroll 0 with hidden scrollbars, so none moves; two new Canvas2D baselines (mid-scroll at 150 px, scrolled 300 px at rest), and "scrolled back" is checked against `acceptance-step1.png`.
Consequence: step 7 carries a number the e2e, the whole picture (W87) and the recording read. A fill bound is a proxy: a liquid that trails by less than a few px passes it; the vision check at gold covers what it cannot see. If the spike shows a re-form above 3 s at 300 px per frame, this gate decides between a larger budget and lower inertia.
Decision: APPROVED 2026-10-13 — step 7 "… with no snap and every element is at rest within **3 s** after the scroll" in NORTH-STAR and spec §6 together; FILL_MIN 0.85 (W80.0: min(0.9, 0.908 − 0.05)); the step-7 tests gain a 30 px/frame row (saga dec_08b53a98)

### D80-4: The 1-frame lag behind native scroll
Proposal: the canvas is `fixed` (body mode) and redrawn in RAF, so during a compositor (wheel, touch) scroll the liquid can trail the DOM by one frame. Accepted if the spike shows it invisible at rest: at rest Canvas2D draws the exact rect and WebGPU the rest SDF, and the DOM text never lags. Evidence: RAF-clock recordings of a 300 px wheel scroll and a smooth `scrollTo` in Chromium headless (Canvas2D) and on Metal (WebGPU), inspected frame by frame with vision, plus a logged, never-gated probe in `webgpu-hw` (canvas card edge minus DOM card edge per screenshot, `w80-lag-webgpu.json`). If it is visible at rest: STOP and re-plan "a canvas that scrolls with the content" as a new decision before red.
Consequence: a trailing frame during a fast native scroll stays a known, documented limitation (spec §4, CONTEXT). The probe is diagnostic: screenshots and DOM reads are not in one atomic frame, so it reports an uncertainty with each sample.
Decision: APPROVED 2026-10-13 — accept and document: invisible at rest (probe 0.0 px); in motion the DOM labels sit 60–100 px off their liquid for one frame per scroll step in both renderers; a canvas that scrolls with the content stays the known alternative, revisited at W87 on real devices (saga dec_f06ddc93)

## Specification
**Values (slice design §3, set at the gate 2026-10-13 from W80.0).** `SCROLL_INERTIA = 0.02`, `SCROLL_INERTIA_MAX_PX_S = 30` per 1/60 s (TS; the per-call cap is `SCROLL_INERTIA_MAX_PX_S · dt · 60`, D80-2 amended); `SCROLL_INERTIA_VMAX_PX_S = 2000` (Rust sanitiser, the pointer's cap); shift clamp ±`WORLD_MAX_PX` (8192); step-7 budget 3 s (180 frames); `FILL_MIN = 0.85`, `FILL_INSET_PX = 4`; step-7 speeds 1, 10, 30, 300 px per frame (D80-3); acceptance spacer 640 px.

**Frame order (`runtime.ts`).** `coord offset → applyDomChanges → scrollTracker.sample → scrollTracker.placeCanvas → dragTracker.scrolled (if dragDx/dragDy ≠ 0) → dragTracker.frame → registry.sync → core.scroll_shift (if dx, dy, ivx or ivy ≠ 0) → pointer sample → core.tick → atlas/paints → render → syncText → syncAway → syncHalo`.

**Engine (Rust).** `scroll_shift`: `s = ScrollShift::sanitized(…, reduced_motion)`; none → return; `(kx, ky) = grid.scroll_origin(dx, dy)` (origin −= rest; `k = round((d − drift)/cell)`); each homed particle: follower (`!is_dragged(home)`) `x −= kx, y −= ky` (grid units, clamped) and `v += iv/cell`; other `x += rest/cell` (stays put in px); each follower element `shift_prev(−dx, −dy)` (only with a previous sample); `invalidate_bounds()`.

**Baseline (2026-10-13, `17ede66`; re-measured at `dc9c02e` in W80.0 with the same counts).**

| Suite | Count |
|---|---|
| cargo test | 193 passed; 0 failed; 2 ignored |
| vitest | 695 passed, 4 skipped (699), 68 files |
| Playwright --list canvas2d / webgpu / webgpu-hw / perf | 66 / 41 / 80 / 4 |

## Spike W80.0 result

Run 2026-10-13 in a throwaway export of `dc9c02e` (`$S/w80spike/repo`, never committed, D2): the plan's W80.1 Steps 1–3 and W80.2/W80.3 applied by the plan-validation script (each block checked verbatim against `docs/superpowers/plans/2026-10-13-fluid-slice-6/W80.md`), plus copy-only knobs (`?inertia=` / `?cap=` in `scroll-tracker.ts`; thread-local `KNOB_INERTIA` / `KNOB_CAP` in `scroll_tests.rs`). In the copy, `scroll_tests` passed 11/11 (test 5: 0.0031 / 0.0009 / 0.0003 px; test 8: lag 5.94 px, maxDev 7.06 px, rest after 26 frames, as in the plan), and the plan's canvas2d step-7 and container e2e passed (9 passed, 3 visual skipped on macOS). Evidence stays in `$S/w80spike/` (matrix.txt, speeds2.txt, hz120.txt, browser.jsonl, stills/, sheets/).

**Question (slice design §3, verbatim):** with a rigid shift, which inertia factor and cap make a 300 px scroll at 1, 3 and 10 px/frame visibly "liquid" yet re-form within the step-7 budget, and is the 1-frame lag behind native scroll visible at rest (Canvas2D exact `roundRect` vs the DOM rect during `scrollTo`, Chromium and Metal recordings)?

**Rust matrix** (`w80_spike_matrix`, release, acceptance layout, seed 1, 300 px down and back; `iv = Δ · 60 · SCROLL_INERTIA` capped per call). Card lag = mean (particle y − home y) of the card at the bottom of the scroll (max while scrolling down). Min inside = the lowest per-frame fraction of an element's particles inside its rect inset 4 px (at rest it is **0.832**, the edge ring sits cell/2 ≈ 3.1 px inside the edge, so 0.832 is "untouched"). Rest frames = frames after the scroll back until every restAlpha is 1. Tick p95 = one release run, shift + tick per scroll frame / a still core's tick (3.744 ms); single runs on a busy laptop, so the spread (3.2–6.9 ms) is noise: no systematic cost of the shift is visible (test 49 measures the ratio).

| inertia | cap px/s | px/frame | card lag px | worst maxDev px | min inside | rest frames | tick p95 scroll / still ms |
|---|---|---|---|---|---|---|---|
| 0 | 60 | 1 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 4.006 / 3.744 |
| 0 | 60 | 10 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 3.618 / 3.744 |
| 0 | 60 | 300 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 3.230 / 3.744 |
| 0 | 120 | 1 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 3.829 / 3.744 |
| 0 | 120 | 10 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 6.431 / 3.744 |
| 0 | 120 | 300 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 3.177 / 3.744 |
| 0 | 240 | 1 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 4.134 / 3.744 |
| 0 | 240 | 10 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 4.342 / 3.744 |
| 0 | 240 | 300 | -0.00 (max 0.00) | 0.00 | 0.832 | 0 (never left rest) | 3.153 / 3.744 |
| 0.02 | 60 | 1 | 0.23 (max 0.23) | 0.24 | 0.831 | 0 (never left rest) | 4.846 / 3.744 |
| 0.02 | 60 | 10 | 2.34 (max 2.41) | 3.53 | 0.818 | 23 | 6.605 / 3.744 |
| 0.02 | 60 | 300 | 0.77 (max 0.77) | 0.77 | 0.832 | 8 | 3.334 / 3.744 |
| 0.02 | 120 | 1 | 0.23 (max 0.23) | 0.24 | 0.831 | 0 (never left rest) | 3.654 / 3.744 |
| 0.02 | 120 | 10 | 2.34 (max 2.41) | 3.53 | 0.818 | 23 | 3.798 / 3.744 |
| 0.02 | 120 | 300 | 1.54 (max 1.54) | 1.54 | 0.820 | 10 | 3.304 / 3.744 |
| 0.02 | 240 | 1 | 0.23 (max 0.23) | 0.24 | 0.831 | 0 (never left rest) | 4.078 / 3.744 |
| 0.02 | 240 | 10 | 2.34 (max 2.41) | 3.53 | 0.818 | 23 | 3.692 / 3.744 |
| 0.02 | 240 | 300 | 3.39 (max 3.39) | 3.39 | 0.812 | 18 | 3.555 / 3.744 |
| 0.05 | 60 | 1 | 0.58 (max 0.59) | 0.59 | 0.831 | 0 (never left rest) | 4.327 / 3.744 |
| 0.05 | 60 | 10 | 5.81 (max 5.93) | 7.06 | 0.783 | 26 | 4.195 / 3.744 |
| 0.05 | 60 | 300 | 0.77 (max 0.77) | 0.77 | 0.832 | 8 | 3.323 / 3.744 |
| 0.05 | 120 | 1 | 0.58 (max 0.59) | 0.59 | 0.831 | 0 (never left rest) | 3.869 / 3.744 |
| 0.05 | 120 | 10 | 5.81 (max 5.93) | 7.06 | 0.783 | 26 | 3.655 / 3.744 |
| 0.05 | 120 | 300 | 1.54 (max 1.54) | 1.54 | 0.820 | 10 | 3.438 / 3.744 |
| 0.05 | 240 | 1 | 0.58 (max 0.59) | 0.59 | 0.831 | 0 (never left rest) | 5.648 / 3.744 |
| 0.05 | 240 | 10 | 5.81 (max 5.93) | 7.06 | 0.783 | 26 | 6.943 / 3.744 |
| 0.05 | 240 | 300 | 3.39 (max 3.39) | 3.39 | 0.812 | 18 | 5.574 / 3.744 |
| 0.1 | 60 | 1 | 1.13 (max 1.27) | 2.40 | 0.815 | 31 | 4.791 / 3.744 |
| 0.1 | 60 | 10 | 43.96 (max 43.96) | 87.68 | 0.000 | 57 | 4.854 / 3.744 |
| 0.1 | 60 | 300 | 0.77 (max 0.77) | 0.77 | 0.832 | 8 | 3.487 / 3.744 |
| 0.1 | 120 | 1 | 1.13 (max 1.27) | 2.40 | 0.815 | 31 | 4.605 / 3.744 |
| 0.1 | 120 | 10 | 43.96 (max 43.96) | 87.68 | 0.000 | 57 | 4.070 / 3.744 |
| 0.1 | 120 | 300 | 1.54 (max 1.54) | 1.54 | 0.820 | 10 | 3.408 / 3.744 |
| 0.1 | 240 | 1 | 1.13 (max 1.27) | 2.40 | 0.815 | 31 | 4.974 / 3.744 |
| 0.1 | 240 | 10 | 43.96 (max 43.96) | 87.68 | 0.000 | 57 | 4.931 / 3.744 |
| 0.1 | 240 | 300 | 3.39 (max 3.39) | 3.39 | 0.812 | 18 | 5.267 / 3.744 |

At 1, 10 and 300 px/frame the cap bites only at 300 px/frame (one frame), so the cap barely shows in the 36 runs. **Intermediate speeds** (`w80_spike_speeds`; 3 px/frame is the design question's middle speed, 15–100 px/frame is a wheel fling or a smooth `scrollTo`, whose per-frame Δ peaks at 60–65 px in Chromium) show where it matters: a per-call impulse above ≈ 40 px/s sustained for ≥ 6 frames saturates the home spring and the liquid tears off its element.

| inertia | cap px/s | px/frame | card lag px | worst maxDev px | min inside | rest frames |
|---|---|---|---|---|---|---|
| 0.02 | 30 | 3 | 0.69 (max 0.70) | 0.71 | 0.831 | 0 |
| 0.02 | 30 | 15 | 3.58 (max 3.58) | 4.70 | 0.815 | 24 |
| 0.02 | 30 | 20 | 4.72 (max 4.72) | 5.81 | 0.806 | 35 |
| 0.02 | 30 | 30 | 5.27 (max 5.27) | 5.80 | 0.802 | 36 |
| 0.02 | 30 | 50 | 3.67 (max 3.67) | 3.81 | 0.812 | 26 |
| 0.02 | 30 | 100 | 1.68 (max 1.68) | 1.69 | 0.818 | 24 |
| 0.02 | 120 | 3 | 0.69 (max 0.70) | 0.71 | 0.831 | 0 |
| 0.02 | 120 | 15 | 3.58 (max 3.58) | 4.70 | 0.815 | 24 |
| 0.02 | 120 | 20 | 4.72 (max 4.72) | 5.81 | 0.806 | 35 |
| 0.02 | 120 | 30 | 6.31 (max 6.31) | 6.85 | 0.777 | 37 |
| 0.02 | 120 | 50 | 7.83 (max 7.83) | 7.99 | 0.742 | 38 |
| 0.02 | 120 | 100 | 7.68 (max 7.68) | 8.24 | 0.734 | 28 |
| 0.05 | 30 | 3 | 1.64 (max 1.82) | 2.96 | 0.818 | 32 |
| 0.05 | 30 | 15 | 5.92 (max 5.93) | 7.06 | 0.782 | 26 |
| 0.05 | 30 | 20 | 5.89 (max 5.89) | 6.97 | 0.783 | 26 |
| 0.05 | 30 | 30 | 5.27 (max 5.27) | 5.80 | 0.802 | 36 |
| 0.05 | 30 | 50 | 3.67 (max 3.67) | 3.81 | 0.812 | 26 |
| 0.05 | 30 | 100 | 1.68 (max 1.68) | 1.69 | 0.818 | 24 |
| 0.05 | 120 | 3 | 1.64 (max 1.82) | 2.96 | 0.818 | 32 |
| 0.05 | 120 | 15 | 8.91 (max 8.97) | 10.77 | 0.699 | 36 |
| 0.05 | 120 | 20 | 21.59 (max 21.59) | 30.08 | 0.299 | 43 |
| 0.05 | 120 | 30 | 32.56 (max 32.56) | 35.14 | 0.174 | 46 |
| 0.05 | 120 | 50 | 23.19 (max 23.19) | 26.07 | 0.359 | 43 |
| 0.05 | 120 | 100 | 7.68 (max 7.68) | 8.24 | 0.734 | 28 |

**120 Hz** (`w80_spike_120hz`; the same speed in px per 1/60 s delivered in two calls of `tick(1/120)`): the per-distance form is frame-rate independent until the per-call cap bites; then a 120 Hz display gets twice the impulse per second.

| inertia | cap px/s | px per 1/60 s | Hz | card lag max px | worst maxDev px | min inside | rest frames (60 Hz) |
|---|---|---|---|---|---|---|---|
| 0.05 | 30 | 10 | 60 | 5.93 | 7.06 | 0.783 | 26 |
| 0.05 | 30 | 10 | 120 | 5.93 | 7.06 | 0.783 | 26 |
| 0.05 | 30 | 20 | 60 | 5.89 | 6.97 | 0.783 | 26 |
| 0.05 | 30 | 20 | 120 | 21.59 | 27.35 | 0.351 | 43 |
| 0.05 | 30 | 30 | 60 | 5.27 | 5.80 | 0.802 | 36 |
| 0.05 | 30 | 30 | 120 | 13.91 | 14.32 | 0.618 | 40 |
| 0.05 | 30 | 50 | 60 | 3.67 | 3.81 | 0.812 | 26 |
| 0.05 | 30 | 50 | 120 | 7.83 | 7.99 | 0.742 | 38 |
| 0.02 | 30 | 10 | 60 | 2.41 | 3.53 | 0.818 | 23 |
| 0.02 | 30 | 10 | 120 | 2.41 | 3.53 | 0.818 | 23 |
| 0.02 | 30 | 20 | 60 | 4.72 | 5.81 | 0.806 | 35 |
| 0.02 | 30 | 20 | 120 | 4.72 | 5.81 | 0.806 | 35 |
| 0.02 | 30 | 30 | 60 | 5.27 | 5.80 | 0.802 | 36 |
| 0.02 | 30 | 30 | 120 | 6.31 | 6.85 | 0.777 | 37 |
| 0.02 | 30 | 50 | 60 | 3.67 | 3.81 | 0.812 | 26 |
| 0.02 | 30 | 50 | 120 | 7.83 | 7.99 | 0.742 | 38 |
| 0.05 | 120 | 10 | 60 | 5.93 | 7.06 | 0.783 | 26 |
| 0.05 | 120 | 10 | 120 | 5.93 | 7.06 | 0.783 | 26 |
| 0.05 | 120 | 20 | 60 | 21.59 | 27.35 | 0.351 | 43 |
| 0.05 | 120 | 20 | 120 | 21.59 | 27.35 | 0.351 | 43 |
| 0.05 | 120 | 30 | 60 | 32.56 | 35.14 | 0.174 | 46 |
| 0.05 | 120 | 30 | 120 | 32.56 | 35.14 | 0.174 | 46 |
| 0.05 | 120 | 50 | 60 | 23.19 | 26.07 | 0.359 | 43 |
| 0.05 | 120 | 50 | 120 | 31.66 | 37.22 | 0.130 | 44 |

**Browser** (`e2e/zz-w80spike.spec.ts` in the copy, manual clock, the plan's `scrollPathFills`; canvas2d = Chromium headless shell, webgpu = `webgpu-hw` on Metal). Fill = the lowest per-frame fill of any visible element's DOM shape inset 4 px (1.000 at rest before the scroll in both renderers). Rows: inertia 0, the two best cap-30 rows (cap 30 is not among the matrix caps 60/120/240; it was added because every higher cap tears at 15–50 px/frame), and the provisional 0.05 / 120. The 30 px/frame and smooth columns are extra; the manual-clock smooth `scrollTo` gives only 8 sampled frames (≈ 75 px per sample), so it is a coarse proxy.

| inertia / cap | renderer | 1 px/f fill | 10 px/f fill | 30 px/f fill | 300 px/f fill | smooth fill | rest frames 1 / 10 / 30 / 300 / smooth |
|---|---|---|---|---|---|---|---|
| 0 / 120 | canvas2d | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0 / 0 / 0 / 0 / 0 |
| 0 / 120 | webgpu | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0 / 0 / 0 / 0 / 0 |
| 0.02 / 30 | canvas2d | 1.000 | 1.000 | 0.976 (#split @ 0) | 1.000 | 1.000 | 0 / 23 / 36 / 0 / 0 |
| 0.02 / 30 | webgpu | 1.000 | 0.908 (#splash @ 280) | 0.924 (#merge @ 0) | 1.000 | 1.000 | 0 / 23 / 36 / 0 / 0 |
| 0.05 / 30 | canvas2d | 1.000 | 0.946 (#split @ 130) | 0.976 (#split @ 0) | 1.000 | 1.000 | 0 / 26 / 36 / 0 / 0 |
| 0.05 / 30 | webgpu | 1.000 | 0.893 (#splash @ 290) | 0.924 (#merge @ 0) | 1.000 | 1.000 | 0 / 26 / 36 / 0 / 0 |
| 0.05 / 120 | canvas2d | 1.000 | 0.946 (#split @ 130) | **0.218** (#merge @ 240) | 1.000 | 1.000 | 0 / 26 / 46 / 10 / 33 |
| 0.05 / 120 | webgpu | 1.000 | 0.893 (#splash @ 290) | **0.210** (#splash @ 240) | 0.960 (#card @ 300) | 0.954 (#card @ 0) | 0 / 26 / 46 / 10 / 33 |

Every browser rest-frame count equals the Rust one for the same row (23, 26, 36, 46, 10): the browser runs the engine exactly as the Rust tests do.

**D80-4 lag probe** (test 48 in the copy, `webgpu-hw`, RAF clock, three 100 px wheel events down and three up, 4 screenshots each): with the provisional 0.05 / 120, worst |offset| beyond the timing uncertainty **4.0 px** (offsets +4, +3, +2 px after each step down, −2…0 up: the inertia lag decaying, not a frame lag); rerun with `inertia=0` and with 0.05 / 30: **0.0 px**; the same probe in canvas2d (spike copy, 0.05 / 30): **0.0 px**. The first screenshot after each wheel event straddles the scroll (DOM top moved 100 px between the two reads, uncertainty 50 px), so the probe cannot see a 1-frame lag; it confirms only that nothing trails once the scroll has landed.

**Vision on the RAF recordings** (`record` / `record-webgpu` with video, 1280×800; Chromium headless applies a wheel event as an instant 100 px jump; `scrollTo({ behavior: "smooth" })` animates 300 px in ≈ 20 frames with a per-frame Δ peaking at 60–65 px; stills at 60 fps from a ≈ 25 fps screencast, contact sheets in `$S/w80spike/sheets/`):
- *At rest (both renderers, every config):* the liquid sits exactly on the DOM; Canvas2D draws the exact rounded rects, WebGPU the rest SDF, the DOM labels sit centred. Nothing trails after any scroll.
- *Wheel jump, inertia 0, Canvas2D and WebGPU* (`canvas2d-i0-158-165`, `webgpu-i0`): for one screencast frame (stills 159–161) the DOM has moved 100 px and the liquid has not: the white labels float on the page background above their pills and the card title overlaps Split. The next frame is aligned.
- *Smooth `scrollTo`, inertia 0* (`canvas2d-i0-379-394`, `webgpu-i0-382-397`): during the 3–4 fastest frames the labels sit 20–60 px above their liquid (one frame's Δ), then align as the scroll slows. Clearly visible in motion; gone at rest.
- *Smooth `scrollTo`, 0.05 / 30, Canvas2D* (`canvas2d-i005c30-390-411`): the same one-frame offset at the peak (labels ≈ 40–65 px above the pills, readable thanks to the halo), then the liquid trails a few px with soft, slightly wobbly edges and settles; no tear.
- *Smooth `scrollTo`, 0.05 / 30, WebGPU* (`webgpu-i005c30-383-404`): the elements un-rest, so the label is liquid text riding the liquid and no label sits off its liquid during the smooth scroll; the wheel jump still shows the one-frame offset in its first frame (`webgpu-i005c30-166-180`, still 168).
- *Smooth `scrollTo`, 0.05 / 120, WebGPU* (`webgpu-i005c120-380-401`): the liquid trails ≈ 20 px below the DOM with a pale rest-SDF band above each element and wobbly edges for ≈ 10 frames; no tear in this short smooth scroll, but the 30 px/frame rows above show it tears under a sustained fast scroll.

**Answer (five lines):**
1. D80-2: **`SCROLL_INERTIA` 0.02, `SCROLL_INERTIA_MAX_PX_S` 30** — lag 0.7 px at 3 px/frame (stays at rest), 2.4 px at 10, ≤ 5.3 px at any speed at 60 Hz (worst maxDev 5.8 px, min inside ≥ 0.80); at 120 Hz worst 7.8 px lag, maxDev 8.0 px, min inside 0.74 (50 px per 1/60 s). The provisional 0.05 / 120 tears the liquid off under a sustained 15–50 px/frame scroll (Rust min inside 0.17, browser fill 0.21 at 30 px/frame in both renderers). 0.05 / 30 is as good at 60 Hz and more visibly "liquid" (1.6 px at 3 px/frame, 5.9 at 10), but the per-call cap doubles its impulse at 120 Hz (min inside 0.35 at 20 px per 1/60 s); it needs the cap applied per 1/60 s (`cap · 60 · dt`, a D80-2 formula change) if Dennis prefers it.
2. D80-3: budget **3 s** (worst re-form of 0.02 / 30: 38 frames in Rust including 120 Hz, 36 in the browser, ≈ 0.6 s); **`FILL_MIN` = min(0.9, 0.908 − 0.05) = 0.858 → 0.85** (lowest browser fill of 0.02 / 30: WebGPU, 10 px/frame; for 0.05 / 30 it would be 0.893 − 0.05 → 0.84).
3. D80-4: **not visible at rest** in either renderer (probe 0.0 px once the scroll has landed; every still at rest aligned). In motion it is visible: for one frame per scroll step the DOM labels sit off their liquid by that frame's Δ (up to 65 px in a smooth `scrollTo`, 100 px on a headless wheel jump) in Canvas2D, and in WebGPU while the elements are at rest (inertia 0 or a slow scroll); WebGPU's liquid text hides it once the inertia un-rests the elements.
4. Yes: the lattice-origin split behaved in the browser as in Rust: inertia 0 never left rest and kept fill 1.000 at every speed in both renderers, every rest-frame count matches the Rust matrix, and the copy's Rust test 5 reproduced 0.0031 / 0.0009 / 0.0003 px.
5. W81 inherits: elements scrolled beyond the 200 px grid margin clamp to the walls until parked (step 7's 300 px stays inside it, a longer page does not); `resize_world` must keep the lattice phase (`origin − base_origin_px`); the 1-frame lag in motion (if D80-4 is accepted, a documented limitation); the per-call inertia cap is frame-rate dependent (moot at 0.02 / 30 below 50 px per 1/60 s); the manual-clock smooth-scroll e2e (test 39) samples only ≈ 8 frames, a coarse proxy for RF4.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | scroll_tests.rs: given_nan_inf_and_huge_values_when_sanitized_then_the_shift_is_finite_and_clamped_and_the_inertia_is_capped | D80-1 sanitiser, W80 RF5 (negative shift kept) |
| 2 | scroll_tests.rs: given_scroll_deltas_when_the_grid_origin_is_split_then_whole_cells_plus_the_rest_equal_the_delta_and_the_origin_stays_within_half_a_cell | D80-1 lattice origin |
| 3 | scroll_tests.rs: given_a_zero_shift_and_zero_inertia_when_scroll_shift_then_the_core_is_bit_identical | no-op (guard) |
| 4 | scroll_tests.rs: given_a_scroll_shift_when_called_then_every_homed_particle_moves_by_minus_the_delta_and_the_fused_aabb_is_invalidated | D80-1 shift, D68-10 |
| 5 | scroll_tests.rs: given_a_page_scrolled_down_and_back_without_inertia_when_a_splash_is_in_flight_then_every_particle_matches_an_unscrolled_core_up_to_f32_rounding | D80-1 "unscrolled up to rounding" at 1, 10, 300 px/frame |
| 6 | scroll_tests.rs: given_a_scroll_with_the_rects_moved_by_it_when_the_next_tick_simulates_then_the_home_velocity_is_0_and_nothing_un_rests | no excitation, W80 RF2 (0-step tick between shifts) |
| 7 | scroll_tests.rs: given_a_dragged_element_when_the_page_scrolls_then_its_particles_and_previous_rect_stay_and_the_others_move | D80-1 drag skip |
| 8 | scroll_tests.rs: given_scroll_down_with_inertia_when_ticking_then_the_liquid_lags_below_its_home_and_every_rest_alpha_is_1_within_the_step_7_budget | D80-2 sign and bound, D80-3 |
| 9 | scroll_tests.rs: given_reduced_motion_when_scroll_shift_with_inertia_then_no_velocity_is_added_and_the_shift_still_applies | reduced motion |
| 10 | scroll_tests.rs: given_a_shift_that_carries_particles_past_the_grid_when_scroll_shift_then_every_position_stays_inside_the_grid | clamp, no panic |
| 11 | scroll_tests.rs: given_the_acceptance_area_hint_when_constructed_then_the_cell_is_not_a_whole_px_divisor_of_the_scroll_steps | test 5 is not vacuous (guard) |
| 12 | scroll-tracker.test: given_a_new_tracker_when_the_first_frame_samples_a_scrolled_page_then_delta_and_inertia_are_0 | first frame |
| 13 | scroll-tracker.test: given_body_mode_when_scrollY_grows_by_1_px_then_delta_is_1_and_the_inertia_is_delta_times_60_times_SCROLL_INERTIA_downwards | D80-2 formula and sign |
| 14 | scroll-tracker.test: given_a_fast_diagonal_scroll_when_sampled_then_the_inertia_is_capped_at_SCROLL_INERTIA_MAX_PX_S_with_its_direction | D80-2 cap |
| 15 | scroll-tracker.test: given_the_same_scroll_at_60_hz_and_at_120_hz_when_sampled_then_the_summed_inertia_is_the_same | D80-2 per distance, the cap per 1/60 s (also when it bites), W80 RF2 |
| 16 | scroll-tracker.test: given_container_mode_when_the_container_and_the_page_scroll_then_delta_reads_only_the_container_and_dragDelta_subtracts_the_offset_change | W80 RF3 |
| 17 | scroll-tracker.test: given_reduced_motion_or_a_frame_without_elapsed_time_when_the_page_scrolls_then_the_delta_is_kept_and_the_inertia_is_0 | reduced motion, resume |
| 18 | scroll-tracker.test: given_two_scrolls_between_frames_when_sampled_then_one_delta_is_their_sum | W80 RF2 |
| 19 | scroll-tracker.test: given_overscroll_with_a_negative_scroll_position_when_sampled_then_the_negative_delta_is_kept | W80 RF5 |
| 20 | scroll-tracker.test: given_a_non_finite_scroll_position_when_sampled_then_the_frame_gives_0_and_the_last_good_position_is_kept | robustness |
| 21 | scroll-tracker.test: given_reset_when_the_next_frame_samples_then_delta_is_0 | reset |
| 22 | scroll-tracker.test: given_container_mode_when_placeCanvas_runs_then_the_canvas_is_translated_by_the_container_scroll_written_only_on_change_and_a_new_canvas_gets_it | container canvas, remount |
| 23 | scroll-tracker.test: given_body_mode_when_placeCanvas_runs_then_the_fixed_canvas_is_never_restyled | body mode (guard) |
| 24 | drag-tracker.test: given_an_active_drag_when_the_page_scrolls_40_px_then_the_offset_grows_by_40_and_later_moves_keep_it | D80-1 mid-drag |
| 25 | drag-tracker.test: given_a_press_below_the_threshold_when_the_page_scrolls_40_px_then_no_drag_starts_and_the_drag_that_starts_later_includes_the_scroll | W80 RF1 |
| 26 | drag-tracker.test: given_no_press_when_the_page_scrolls_then_nothing_changes | no press |
| 27 | scroll-runtime.test: given_body_mode_when_the_window_scrolls_30_px_between_frames_then_scroll_shift_gets_the_delta_and_inertia_after_sync_and_before_tick | frame order |
| 28 | scroll-runtime.test: given_no_scroll_when_frames_run_then_scroll_shift_is_never_called | idle bit-identity (guard) |
| 29 | scroll-runtime.test: given_reduced_motion_when_the_page_scrolls_then_scroll_shift_gets_the_delta_with_zero_inertia | reduced motion |
| 30 | scroll-runtime.test: given_a_mouse_drag_when_the_page_scrolls_40_px_then_slots_6_7_grow_by_40_in_that_frame_and_the_release_zeroes_them | D80-1 mid-drag in the runtime |
| 31 | scroll-runtime.test: given_container_mode_when_the_container_scrolls_then_scroll_shift_gets_the_container_delta_and_the_canvas_sits_on_its_visible_window | container, W80 RF3 |
| 32 | scroll-runtime.test: given_the_loop_paused_while_the_page_scrolls_when_resumed_then_the_first_frame_shifts_by_the_whole_delta_with_zero_inertia | W80 RF2 (pause) |
| 33 | fluid-ffi.test: given_the_real_core_when_scroll_shift_runs_before_a_zero_step_tick_then_every_homed_particle_moves_by_minus_the_delta_in_the_dynamic_view | the WASM export |
| 34 | whole-picture-tooling.test: given_north_star_scene_step_7_when_parsed_then_its_scroll_budget_is_d80_3_and_spec_section_6_agrees_W80 | D80-3 (guard after the gate) |
| 35 | e2e acceptance (canvas2d): step 7 – given the acceptance scene when read then the page can scroll 300 px at 1280×800 and every element is at rest at the top | the spacer |
| 36 | e2e acceptance (canvas2d): step 7 – … at 1 px per frame … | step 7 slow |
| 37 | e2e acceptance (canvas2d): step 7 – … at 10 px per frame … | step 7 |
| 38 | e2e acceptance (canvas2d): step 7 – … at 300 px per frame … | step 7 jump |
| 39 | e2e acceptance (canvas2d): step 7 – given a smooth scrollTo of 300 px … (W80 RF4) | W80 RF4 |
| 40 | e2e acceptance (canvas2d): step 7 – given Merge dragged 30 px up when the page scrolls 40 px mid-drag then … | D80-1 mid-drag, W80 RF1 |
| 41 | e2e acceptance (canvas2d, Linux): step 7 – given the page scrolled 150 px down at 10 px per frame when screenshotted then it matches the baseline | baseline `acceptance-step7-scroll-mid` |
| 42 | e2e acceptance (canvas2d, Linux): step 7 – given the page scrolled 300 px down when every restAlpha is 1 then it matches the baseline | baseline `acceptance-step7-scrolled-300` |
| 43 | e2e acceptance (canvas2d, Linux): step 7 – given the page scrolled 300 px and back when every restAlpha is 1 then it matches the step 1 baseline (no residue) | `acceptance-step1` reused |
| 44 | e2e scroll (canvas2d): step 7 (container) – … at 10 px per frame … | container scroll |
| 45 | e2e scroll (canvas2d): step 7 (container) – … at 200 px per frame … | container jump |
| 46 | e2e scroll (canvas2d): step 7 (container) – given the page scrolled 300 px around the container … (W80 RF3) | W80 RF3 |
| 47 | e2e webgpu-robust (webgpu-hw): W80 step 7 – given renderer webgpu and a scroll of 300 px down and back at 10 px per frame … | step 7 in WebGPU |
| 48 | e2e webgpu-robust (webgpu-hw): W80 D80-4 – … the offset of the canvas card edge from the DOM card edge per screenshot is logged (never gated) | D80-4 probe |
| 49 | e2e perf (perf): perf – W80: a Canvas2D frame that scrolls 10 px costs at most 1.15 × the same frame without the scroll (both after a shake) | slice design §11 perf |
| 50 | e2e acceptance (canvas2d): step 7 – … at 30 px per frame … | D80-3 gate: a sustained fast scroll (W80.0: the provisional 0.05 / 120 tore here) |

## Must NOT
- Excite the liquid on a rigid scroll; call the core on a frame without a scroll.
- Move a dragged element's liquid with the page; start a drag from a scroll alone.
- Restyle the container or any author element (the transform is on liquiddom's canvas only).
- Change a resting frame or one of the eleven existing Linux baselines.
- Park elements or reallocate the grid (W81).

## Must DO
- Run the spike before the gate and record its table here; carry approved constants into the code before red.
- Change NORTH-STAR and spec §6 step 7 in one commit (D80-3).
- Shift whole cells and move the lattice origin by the rest (D80-1).
- Regenerate only the two new Canvas2D Linux baselines, with Dennis' vision approval (D65-7).

## Manual Smoke Test
### Setup
`npm run dev`, then open `http://localhost:3000/scenes/acceptance.html?renderer=auto` (Metal: WebGPU), `…?renderer=canvas2d` and `http://localhost:3000/scenes/scroll-container.html`.

### Steps
1. Scroll the acceptance page down and back with the wheel, slowly and fast.
   Expected: the liquid stays on its elements; a fast scroll lets it lag slightly and settle; no tearing, no snap.
2. Drag "Merge" up and scroll the wheel while holding.
   Verify: the dragged liquid stays under the pointer; after release it crawls home.
3. Scroll the container, then the page around it.
   Verify: the liquid follows the container's scroll; the page scroll moves container and liquid together.

### Pass criteria
- [ ] No console error or warning in either renderer.
- [ ] The DOM never moves because of liquiddom; keyboard focus and the a11y tree are unchanged.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, the perf project's W80 guard, Docker canvas2d baselines (two new, eleven unchanged), vision on the scroll in both renderers.
