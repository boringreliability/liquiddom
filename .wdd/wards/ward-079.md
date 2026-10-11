---
ward: 79
revision: null
name: "Merge and separate"
epic: "fluid-engine"
status: "red"
dependencies: [78]
layer: "both"
estimated_tests: 23
created: "2026-10-11"
completed: null
---
# Ward 079: Merge and separate

North star: step 5 ✅ (drag "Merge" into the card and release: displacement merge, separation, both re-form within 3 s, and the labels never overlap), in both renderers; steps 1–4, 6 and 8 unchanged.

## Scope
Second and last ward of slice 5 (design `docs/superpowers/specs/2026-10-11-liquiddom-slice-5-drag-merge-design.md` §5). Rust softens every element whose home rect overlaps the dragged home rect grown by 16 px to `s ≤ 0.2` every substep, so the card makes room for the dragged "Merge" instead of pushing it back, and gives the elements of a merge a faster slip (4.5/s, 240 px/s) until they rest again, so they separate and re-form within 3 s. WebGPU's text pass writes a per-texel element-id target and the text composite drops the text where two elements' text-carrying liquids meet, so no pixel carries both labels. Canvas2D needs no change (no liquid text; W78 hides the dragged label). The step-5 merge is checked in both renderers, with a Linux baseline, a perf guard and gold vision. Constants come from spike W78.0 (ward-078.md); a ≤ 2 h confirmation measurement on this plan's code sets the Canvas2D closed-region bound.

Out of scope: touch and keyboard drag, scroll (slice 6); owner-aware physics (an immiscibility term or per-element velocity fields; slip stays the separation mechanism, design §1); the W77 open findings; stacking behind opaque neighbours (slice 6); a mechanism for the softened card's torn glyph fragments after the release (D79-5).

## Inputs
- The slice design §1, §5–§7 and the spec as amended in `c9ecf5e` (§2 damage rules: "elements whose home rect overlaps the dragged home are softened too").
- Spike W78.0 (ward-078.md "## Spike W78.0 result"): dragged cap 0.5, neighbour cap 0.2, slip 4.5/s / 240 px/s (room 0.15, Merge in 0.26, rest 113/132, browser 132); D79-1 candidates (a) ≤ +0.27 ms GPU per frame (estimate) and (b) +0.46 ms CPU per tick; its five risks.
- W78: `hold_dragged`, `is_dragged`, the drag tracker and slots, the acceptance hook `slots()`, the e2e helpers `w78DragMergeToCard`, `w78Slots`, `w78Centre`, `canvasTextPixelsIn`.
- W74 text pass (T1/T1w, D74-4) and D74-2's F slip; W77 kernel cap 16 px (D77-1) and the lace method (`e2e/lace.ts`).

## Outputs
- Rust `elements::rects_overlap`, `Elements::merge_slip`, `interaction::{NEIGHBOUR_MARGIN_PX, NEIGHBOUR_STIFFNESS_CAP}`, the W79 `hold_dragged`, `solver::{MERGE_SLIP_RATE_PER_S, MERGE_SLIP_MAX_PX_S, slip_velocity_at}`, per-row slip in `ElRow`.
- WebGPU T1id (`rg16float`, min blending), the text composite's drop rule, `@internal` `captureTextIds()` (renderer, runtime) and the hook `__liquidTest.textIds()`.
- Step 5 ✅ in both renderers; the Linux baseline `acceptance-step5-merge-mid`.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D79-1: Labels never overlap: a per-texel element-id target in the text pass (mechanism a)
Proposal: displacement + fade (brainstorm, Dennis 2026-10-11). The physics moves the card's liquid and text out of the dragged liquid's way (D79-2); where two elements' liquids still mix, the text drops. Mechanism (a): the WebGPU text pass gets a third target, T1id, one `rg16float` texture at T1's size, cleared to 4096 and blended with `min` on both channels; every text fragment the kernel covers (torn or not, glyph or transparent: exactly the fragments that add Σw) writes `(id, −id)` of its element, so per texel r is the smallest and −g the largest element id whose text-carrying liquid reached it. One target, not two `r16float` targets with `min` and `max`: a WebGPU blend state has a single `color` operation for all channels of a target, and `min`/`max` require both factors to be `"one"`; storing −id turns the max into a min. `r16float`, `rg16float` and `rgba16float` are blendable in core WebGPU (`r32float` needs `float32-blendable`); 4096 and every slot id (≤ 255) are exact in f16. The text composite gathers the four T1id texels its bilinear T1 sample mixes (`textureGather`) and gives the text coverage 0 where the smallest id is below the largest. Mechanism (b) (Rust flags a particle "foreign" from a per-substep owner-mass pass) is not built: +0.46 ms CPU per tick (+13 %) measured in W78.0, a coarse cell-majority flag that would need hysteresis, and no per-pixel guarantee.
Consequence: Under WebGPU no pixel carries text of two elements; where Merge's and the card's liquids mix, neither shows text (the mixed area is text-free, and two text-carrying liquids that only touch lose their text in a seam about one texel wide); away from the mix both texts show. Cost: one more 4-byte texel per backing pixel (≈ 4 MB at 1280 × 800, DPR 1) and one more blended write per text fragment, estimated ≤ +0.27 ms GPU per frame and only while text moves (W78.0 estimate; logged, not gated, D72-4). W79.0 measured no frame wall-time difference above the ≈ 0.1 ms noise on Metal (card splash, median of 7 × 40 frames: 4.38 / 4.36 ms without, 4.32 / 4.23 ms with the id target), and no text pixel on a mixed texel in 160 frames of the merge (see "W79.0 measurements"). Only elements whose atlas text is drawn take part: a textless element's liquid never drops another element's text, and an element whose atlas text is not ready keeps its DOM text (rare: the atlas is built at observe). Canvas2D is unchanged: it draws no liquid text and hides the dragged label (W78).
Decision: APPROVED 2026-10-11 — displacement + fade: rg16float element-id target with min blending on (id, −id) in the T1 pass, no text where ids differ; proven on Metal (8008 mixed texels, 0 text px); the Canvas2D closed-region check stays a seam guard (bound 90) (saga dec_62c643f9)

### D79-2: Neighbours under the drag held at s ≤ 0.2; a merge slip only for the elements in a merge
Proposal: every substep, after `update_stiffness`, `hold_dragged` gives each active, non-dragged element whose home rect (as the engine holds it: offset and hover swell included) overlaps the dragged home rect grown by 16 px (the renderers' kernel cap, W77 D77-1; open intervals) `damage(id, 0.2)` (W78.0: neighbour cap 0.2; the dragged cap stays 0.5). The damage stops in the first substep without the overlap, and `s` recovers as after a splash. Slip, option **B (recommended)**: the dragged element and every element softened under it carry a merge-slip flag until their restAlpha is 1 again (also cleared on a slot reset, reduced motion and an inactive slot); their particles slip at 4.5/s, max 240 px/s (W78.0 answer 1); every other element keeps 3/s, 160 px/s; F's slip (D74-2) stays 4.5/s. Option **A**: raise the global `SLIP_RATE_PER_S`/`SLIP_MAX_PX_S` to 4.5/240 (the spike's literal setting).
Consequence: B (W79 plan validation, Rust, seed 1, hold 90): room 0.153, Merge in 0.734, every restAlpha 1 after 132 frames, mixing 0/0, identical to A to the third decimal; without a drag the engine is bit-identical to W78 (all 181 existing Rust tests pass unchanged; splash re-form water 129, honey 155, jelly 114 frames as before), so the step 1/2/3/4/6 and reduced-motion baselines, the W77 lace and speck guards and the honey ≥ 1.15 × water guard cannot move; cost: one bool per element, two floats per `ElRow`, the slip rate read from the row. A: every splash and shake re-forms faster (water 129 → 116, honey 155 → 145, jelly 114 → 104 frames; honey/water 1.20 → 1.25, still ≥ 1.15), the step 3/4/6 Linux baselines move (design §6: steps 4 and 6 must not), D74-2's `F_SLIP = 1.5 × SLIP` relation breaks unless F is pinned at 4.5/s (what the spike measured), and five existing Rust tests fail: four pin the W67/D74-2 slip constants and the D67-15 lock probe reads `max_dev` 0.756 px (> 0.75) at its first rest frame (< 0.11 px 12 frames later), each an approved-test change. Either way: the drag from Merge's centre to the card's centre passes within 16 px of Split during ramp frames 1–4, so Split is softened briefly and re-forms during the hold; under WebGPU an overlapped neighbour leaves rest, so its text moves into the atlas and D79-1 covers it. Dennis' answer at plan review (dec_b00a6c61): option B, a per-element merge slip only for the dragged element and its softened neighbours until rest; the global slip stays unchanged.
Decision: APPROVED 2026-10-11 — option B: neighbours under the drag held at s ≤ 0.2; merge slip 4.5/s, 240 px/s only for the elements in a merge until rest (saga dec_3209c60d)

### D79-3: Merge perf guard: the Canvas2D frame during the merge ≤ 1.15 × a frame after a splash on the card
Proposal: a perf-project test (seed 1, manual clock): the median wall time of `advance(1)` over 40 frames from the press (10 ramp moves, then held) against the median over the first 40 frames after `splash()` on `#card` (strength 1); median of 3 runs each; ratio ≤ 1.15 (the W77 ratio-guard pattern). The card splash is the reference because both move the card's 6035 particles, whose density splat dominates a Canvas2D frame; a splash on "Splash" (655 particles) would measure the card, not W79. WebGPU's id-target cost is logged by the W79.0 measurement and the existing webgpu perf log, not gated (D72-4: no GPU timers on the local adapter).
Consequence: W79 plan validation (Rust tick only, release build, median of 40 frames, 7 runs): merge / card splash 0.904 with W78, 0.965 with W79 (option B), so W79 adds ≈ 6 % per tick against 15 % allowed; the guard rejects a costly mechanism such as an owner-mass pass (+13 % per tick). The perf project is non-blocking (D65-8): the guard runs locally at W79.4 and gold, not in CI. Dennis' answer at plan review (dec_b00a6c61): the perf reference is a splash on the card.
Decision: APPROVED 2026-10-11 — Canvas2D merge frame ≤ 1.15 × a frame after a splash on the card (measured ≈ 0.97) (saga dec_3209c60d)

### D79-4: W79's merge checks hold the drag 90 frames
Proposal: the Rust merge scenario, the canvas2d and webgpu-hw merge e2e and the new Linux baseline hold the drag 90 frames (1.5 s) before the release; W78's tests and its two baselines keep 30 frames (the design's §6 hold). Spike risk 1: after 30 frames Merge's liquid still presses at the card's upper edge (centroid within 16 px of the dragged rect: 0.60 of the particles); it reaches the card centre after 60–120 frames.
Consequence: W79 plan validation (option B, seed 1): hold 30 / 60 / 90 / 120 → room 0.153 / 0.167 / 0.153 / 0.106, Merge in 0.258 / 0.559 / 0.734 / 0.821, every restAlpha 1 after 132 / 132 / 132 / 139 frames. 90 shows a visible merge (¾ of Merge's liquid inside its dragged rect) with the room of 30 and the same re-form. Each merge e2e runs 60 frames longer. W78's `acceptance-step5-drag-mid` (hold 30) moves anyway (the card now softens) and is regenerated with Dennis' vision approval; the new `acceptance-step5-merge-mid` shows the hold-90 merge. Dennis' answer at plan review (dec_b00a6c61): W79's merge checks hold 90 frames; W78's tests stay at 30.
Decision: APPROVED 2026-10-11 — W79's merge checks hold the drag 90 frames (W78's tests stay at 30); re-form 133 frames (saga dec_3209c60d)

### D79-5: The softened card's torn text after the release: no extra mechanism in W79
Proposal: spike risk 2 (under WebGPU the softened card's text tears into streaks and leaves glyph fragments ≈ 30 frames after the release) gets no new mechanism. The fragments are one element's own text, so D79-1 already removes every overlap with Merge's label; they fade as F heals (D74-3). The webgpu-hw e2e reads the id target for 60 frames after the release, so a fragment on Merge's text fails it, and the gold vision of the rel-f30 still decides whether they are acceptable.
Consequence: step 5 under WebGPU can show card glyph fragments for ≈ 0.5 s after the release. If Dennis judges them a defect at gold, a follow-up ward handles them (for example text coverage tied to s), not W79; W79's gold then records it as a known limitation. Dennis' answer at plan review (dec_b00a6c61): accept the WebGPU torn glyph fragments ≈ 0.5 s after the release; the vision at gold decides.
Decision: APPROVED 2026-10-11 — no extra mechanism for the card's torn text after release; vision at gold decides (saga dec_3209c60d)

### D79-6: The e2e proves "no pixel with both labels" through an @internal readback of the id target
Proposal: `WebGPURenderer.captureTextIds()` (`@internal`; reached only through `FluidRuntime.captureTextIds()` and the acceptance hook `__liquidTest.textIds()`) copies the next frame's T1id into a `MAP_READ` buffer in that frame's own submit and resolves with the raw texels (`textPass` false when that frame drew no text; null without a device, after a loss or `destroy()`). The hook runs one manual frame, then counts canvas text pixels (every channel and alpha ≥ 200) on texels whose smallest id is below the largest; the e2e asserts 0 in every frame of the flow, and that such texels exist with Merge and the card (the check is not vacuous). Precedent: `simulateDeviceLoss`, `fragmentEstimate`, `t0Size` (W72).
Consequence: ≈ 70 lines of a test-only path in the renderer (T1id gets `COPY_SRC`; a readback buffer exists only while a capture is armed; a normal frame encodes nothing extra). The check applies the composite's own rule per texel, so it proves the wiring on the real GPU (ids are written where text lands, text drops there), not an independent visual oracle; the gold vision stays the independent check. The readback runs only in `webgpu-hw` (local Metal, W71.0 fallback B). Dennis' answer at plan review (dec_b00a6c61): an @internal `captureTextIds()` readback in the production renderer is OK.
Decision: APPROVED 2026-10-11 — @internal captureTextIds() readback of the id target proves no pixel with both labels (saga dec_3209c60d)

## Specification
**Values.** `NEIGHBOUR_MARGIN_PX = 16`, `NEIGHBOUR_STIFFNESS_CAP = 0.2`, `DRAG_STIFFNESS_CAP = 0.5` (W78); `MERGE_SLIP_RATE_PER_S = 4.5`, `MERGE_SLIP_MAX_PX_S = 240`; `SLIP_RATE_PER_S = 3`, `SLIP_MAX_PX_S = 160` and `F_SLIP_RATE_PER_S = 4.5` unchanged; merge checks hold 90 frames (D79-4); re-form ≤ 180 frames after the release (NORTH-STAR step 5). `T1_ID_FORMAT = "rg16float"`, `TEXT_ID_EMPTY = 4096`, `MIN_BLEND` (`min`, factors `one`/`one`).

**Engine (Rust), per substep.** `update_stiffness(dt)` → `hold_dragged`: for each active dragged element d: `damage(d, 0.5)`, `merge_slip[d] = true`; for each other active, non-dragged n with `rects_overlap(home_rect(d), home_rect(n), 16)`: `damage(n, 0.2)`, `merge_slip[n] = true` → `substep_with` (each `ElRow` slips at 4.5/s, cap 240 px/s when `merge_slip`, else 3/s, 160 px/s; W67's arithmetic for the latter). `merge_slip` clears when restAlpha reaches 1, on `reset_slot`, under reduced motion and for an inactive slot. `rects_overlap(a, b, m)`: open intervals on `a` grown by `m`; NaN gives false.

**WebGPU text.** Text pass targets: T1 (`rgba16float`, additive), T1w (`r16float`, additive), T1id (`rg16float`, min, clear 4096); fragment writes `(id, −id)`. Composite: `lo` = min of the four gathered r, `hi` = −min of the four gathered g; `coverage = select(smoothstep(…), 0, lo + 0.5 < hi)`. `captureTextIds()`: bytesPerRow = ceil(4·w / 256)·256, the copy encoded after the screen pass of the next frame; resolves after `mapAsync`.

**Plan validation (2026-10-11, scratch copies of `c1a52ff`).** Rust red 182 passed / 9 failed, green 191 passed; test 8 room 0.153, Merge in 0.734, 132 frames (W78 alone: 0.023, 0.479, 142); W78 drag test 8 re-forms in 112 frames (was 122). Tick ratio merge / card splash 0.904 (W78) → 0.965 (W79). Vitest red 8 failed in the four affected files, green 70 passed; WGSL validated with naga.

**Baseline (2026-10-11, `c1a52ff`; confirmed unchanged at `e36abc6` in W79.0).**

| Suite | Count |
|---|---|
| cargo test | 181 passed; 0 failed; 2 ignored |
| vitest | 684 passed, 4 skipped (688), 67 files |
| Playwright --list canvas2d / webgpu / webgpu-hw / perf | 64 / 39 / 76 / 3 |

**Known limitations.** Two text-carrying liquids that only touch lose their text in a seam about one texel wide (D79-1). An element whose atlas text is not ready keeps its DOM text above the canvas, outside the id rule. A resting element more than 16 px from the dragged home stays at rest; if the dragged liquid lags far behind its home it can pass under that element's DOM label. The softened card's torn glyph fragments can float ≈ 0.5 s after the release (D79-5). The perf guard runs only locally (perf project, D65-8).

## W79.0 measurements

Confirmation measurement, 2026-10-11, ≈ 15 min of the 2 h box: two throwaway copies of `e36abc6` in the session scratchpad (`red` = W79.1 Steps 1–9 with `0` for both hole numbers, Vite :4191; `green` = also W79.2 Steps 1–4 and W79.3 Steps 1–4, Vite :4192), the plan's code blocks applied by the plan-validation scripts; nothing from the copies is in the repo.

| Measurement (seed 1, macOS, M4 Pro) | W78 alone (`red`) | W79 (`green`) |
|---|---|---|
| `regionHolePixels` around the card at hold f90 (canvas2d) | 6 | 55 (identical on a second run) |
| re-form after the release, canvas2d / webgpu (frames) | — | 133 / 133 |
| `[perf W79]` merge / card-splash frame ratio (two runs) | 0.968, 0.976 | 0.970, 0.963 |
| text ids (webgpu-hw): frames, max mixed texels, max text px on mixed texels | — | 160, 8008, 0 (card-rect text px at hold f90: 1207) |
| SwiftShader pipeline check; W74/W75/W78 webgpu-hw | — | pass (3 passed) / pass (16 passed, 1 skipped) |

**Derived bound:** `W79_MERGE_HOLES_MAX = max(20, ceil(1.5 × 55 / 10) × 10) = 90`.

**Reading.**
- H79 = 55 ≥ H78 = 6 (STOP rule 4): the closed-region check cannot tell W78 from W79. It stays a guard against a seam (✅ at red for the hole assertion; the red copy's test fails earlier, at "the card … s ≤ 0.2", as expected). The extra holes are the notch the softened card opens at its upper edge, where the dragged liquid entered (vision of the Canvas2D hold-f90 still: a background notch open to the outside, no closed seam between the two liquids).
- No other STOP rule fired: no text pixel on a mixed texel in 160 frames, the two elements do meet (8008 mixed texels), no validation error; both re-forms 133 ≤ 180 frames; r79 ≤ 1.15 and r78 ≤ 1.15.
- The Canvas2D frame ratio is the same with and without W79 (≈ 0.97): W79's tick cost is not visible in a Canvas2D frame, which the density splat dominates.
- D79-1 cost, measured as frame wall time (`advance(1)` with the scene's pixel snapshot, webgpu-hw, median of 7 × 40 frames, card splash so the card's text moves; two runs per copy): red 4.375 / 4.360 ms, green 4.320 / 4.230 ms; the text-pass frame minus a rest frame 0.37–0.44 ms (red) and 0.43–0.46 ms (green). No difference above the run-to-run noise (≈ 0.1 ms). The wall time may not include all GPU execution (no GPU timers on the local adapter, D72-4), so the W78.0 estimate (≤ +0.27 ms GPU per frame) stays the bound.
- SwiftShader: the text pipeline with the `rg16float` min-blend target validates at init; the atlas upload fails there with the same warning in `red` and `green` (pre-existing), so SwiftShader never runs the text pass itself.
- Vision (stills, not baselines): Canvas2D hold f90 shows Merge's green only faintly inside the card's dark liquid; WebGPU hold f90 shows the green body clearly, the card's text dropped where the liquids mix and present elsewhere, no label over the other; WebGPU rel f30 shows warped card glyphs (D79-5) and Merge's label back in its own liquid.

## Tests

| # | Test Name | Verifies | Red outcome |
|---|-----------|----------|-------------|
| 1 | merge_tests.rs: given_rects_15_or_17_px_apart_when_rects_overlap_with_the_16px_margin_then_only_the_15px_pairs_overlap_on_every_side_and_nan_never_does | D79-2 overlap rule (open intervals, NaN) | ❌ `15 px right` (stub returns false) |
| 2 | merge_tests.rs: given_merge_dragged_onto_the_card_when_hold_dragged_then_the_card_gets_s_at_most_0_2_rest_alpha_0_and_the_merge_slip_and_splash_and_split_are_untouched | D79-2 hold on Elements | ❌ `D79-2: the overlapped card is held at 0.2, got 1` |
| 3 | merge_tests.rs: given_neighbours_15_and_17_px_from_the_dragged_home_when_hold_dragged_then_only_the_15px_one_is_softened_and_a_second_dragged_element_keeps_its_own_cap | D79-2 margin, dragged never capped at 0.2 | ❌ `15 px: softened` |
| 4 | merge_tests.rs: given_merge_dragged_into_the_card_when_ticking_then_the_cards_s_stays_at_most_0_2_every_held_frame_splash_keeps_s_1_and_split_is_softened_only_while_the_drag_passes_it | D79-2 in the core, Review Focus 1 | ❌ `frame 11: the card is held at s ≤ 0.2 (D79-2), got 1` |
| 5 | merge_tests.rs: given_the_drag_released_after_the_merge_when_ticking_then_the_damage_stops_the_cards_s_rises_every_frame_and_its_merge_slip_ends_at_rest | release, Review Focus 1–2 | ❌ `precondition: the card is softened at the release, s 1` |
| 6 | merge_tests.rs: given_slip_velocity_at_when_called_with_the_merge_rate_then_4_5_per_s_capped_at_240_px_s_and_with_the_base_rate_bit_identical_to_slip_velocity | D79-2 slip values, Review Focus 2 | ❌ `4.5/s × 10 px = 45 px/s: 30` |
| 7 | merge_tests.rs: given_merge_slip_set_when_the_element_comes_to_rest_its_slot_resets_or_reduced_motion_pins_it_then_it_clears | merge-slip lifecycle, Review Focus 2 | ❌ `set` (stub flag is always false) |
| 8 | merge_tests.rs: given_merge_dragged_into_the_card_held_90_frames_and_released_when_ticking_then_the_card_made_room_merge_sits_inside_they_separate_and_every_rest_alpha_is_1_within_180_frames | step 5 in Rust (D79-2, D79-4) | ❌ `the card made room for Merge (displacement merge): 0.0226…` (room 0.023, Merge in 0.479, 142 frames) |
| 9 | merge_tests.rs: given_reduced_motion_and_merge_dragged_over_the_card_when_ticking_then_no_element_is_softened | reduced motion (guard) | ✅ passes (guard) |
| 10 | solver.rs w79_tests: given_one_element_with_the_merge_slip_and_one_without_when_their_rows_are_built_then_only_the_first_slips_at_4_5_per_s_capped_at_240_px_s | per-row slip, W67 bit-identity, Review Focus 2 | ❌ `4.5/s × 10 px: 30` |
| 11 | webgpu-renderer.test: given_text_drawn_when_resized_or_destroyed_then_the_T1id_target_follows_T1_is_copyable_is_bound_to_the_text_composite_and_is_released | D79-1 target lifecycle, Review Focus 4 | ❌ `Cannot read properties of undefined (reading 'format')` (no T1id) |
| 12 | webgpu-renderer.test: given_captureTextIds_when_the_next_frame_draws_text_then_the_T1id_texture_is_copied_after_that_frames_passes_into_a_map_read_buffer_and_resolves_with_256_aligned_rows | D79-6 readback | ❌ `r.captureTextIds is not a function` |
| 13 | webgpu-renderer.test: given_captureTextIds_when_the_next_frame_has_no_text_pass_then_it_resolves_textPass_false_without_a_copy_and_on_destroy_or_a_loss_it_resolves_null | D79-6, Review Focus 5 | ❌ `r.captureTextIds is not a function` |
| 14 | webgpu-shaders.test: given_TEXT_WGSL_when_read_then_every_covered_text_fragment_writes_its_element_id_and_minus_id_to_location_2 | D79-1 id write | ❌ no `@location(7)` id varying |
| 15 | webgpu-shaders.test: given_TEXT_COMPOSITE_WGSL_when_read_then_it_gathers_the_ids_over_the_bilinear_footprint_and_gives_the_text_coverage_0_where_two_elements_meet | D79-1 drop rule | ❌ no `@binding(4)` t1_id |
| 16 | text-runtime.test: given_webgpu_and_moving_text_when_captureTextIds_then_the_next_frame_copies_the_id_target_and_under_canvas2d_it_resolves_null | D79-6 runtime passthrough | ❌ `s.rt.captureTextIds is not a function` |
| 17 | text-id-report.test: given_half_float_bits_when_decoded_then_ids_their_negatives_the_empty_value_and_the_specials_round_trip | test scaffolding (f16 decode) | ✅ passes (scaffolding) |
| 18 | text-id-report.test: given_a_capture_and_its_pixels_when_summarized_then_mixed_texels_are_those_with_min_below_max_and_text_on_them_is_counted | test scaffolding (the e2e oracle) | ✅ passes (scaffolding) |
| 19 | text-id-report.test: given_no_text_pass_or_a_size_mismatch_when_summarized_then_an_empty_report_or_a_throw | test scaffolding | ✅ passes (scaffolding) |
| 20 | e2e acceptance (canvas2d): step 5 – given Merge dragged into the card and held 90 frames when released then the card is softened while overlapped, the two liquids form one closed region and every restAlpha is 1 within 180 frames | step 5 ✅ in Canvas2D | ❌ `the card under the dragged home is held at s ≤ 0.2 (D79-2)` (s 1); the hole assertion is a seam guard (6 ≤ 90, passes on W78) |
| 21 | e2e acceptance (canvas2d, Linux): step 5 – given Merge dragged into the card and held 90 frames when screenshotted then it matches the baseline | baseline `acceptance-step5-merge-mid` | ⏭ skipped (Linux only) |
| 22 | e2e webgpu-robust (webgpu-hw): W79 step 5 – given Merge dragged into the card, held 90 frames and released then no frame has a text pixel where two elements' text splats meet, they do meet, text still shows in the card and every restAlpha is 1 within 180 frames | step 5 ✅ in WebGPU, D79-1, Review Focus 3 | ❌ `FluidRuntime.captureTextIds is missing (W79.3)` (webgpu-hw, local) |
| 23 | e2e perf (perf): perf – W79 D79-3: the Canvas2D frame during the merge costs at most 1.15 × a frame after a splash on the card | D79-3 | ✅ passes (guard): ratio 0.980 ≤ 1.15 |
| 24 | webgpu-renderer.test: given_successful_init_when_built_then_five_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3_D74_4 | approved-test change (D79-1): the text pipeline's third target `rg16float` with min blending | ❌ 2 targets vs 3 (no `rg16float` / `MIN`) |
| 25 | webgpu-renderer.test: given_a_text_atlas_and_a_moving_element_with_an_atlas_rect_when_rendering_then_the_atlas_is_uploaded_once_per_version_the_1x_text_pass_writes_T1_and_T1w_and_the_text_composite_follows_the_rest_quads_d74_4 | approved-test change (D79-1): the text pass's T1id attachment cleared to 4096 | ❌ 2 attachments vs 3 (no `liquiddom T1id`) |

Notes: `estimated_tests` counts new tests (rows 1–23); rows 24–25 are changed tests. Rows 17–19 test e2e scaffolding and pass at red.

## Must NOT
- Change any engine output without a drag (option B is bit-identical): no step 1/2/3/4/6 or reduced-motion baseline, W77 guard or honey/water ratio may move.
- Change W78's tests or their 30-frame hold; touch `F_SLIP_RATE_PER_S` (D74-2).
- Draw text where two elements' text-carrying liquids meet (WebGPU).
- Allocate per frame for the capture, or leave a pending capture hanging after a loss or `destroy()`.
- Add a slot or an FFI call.

## Must DO
- Soften overlapped neighbours in every substep, and stop in the first substep without the overlap.
- Keep the merge slip per element and clear it at rest, on reset, under reduced motion and for an inactive slot.
- Read the id target in every frame of the webgpu-hw merge flow, 60 frames past the release.
- Regenerate only `acceptance-step5-drag-mid` (moved) and add `acceptance-step5-merge-mid`, with Dennis' vision approval (D65-7).

## Manual Smoke Test
### Setup
`npm run dev`, then open `http://localhost:3001/scenes/acceptance.html?renderer=auto` (Metal: WebGPU) and `…?renderer=canvas2d`.

### Steps
1. Press "Merge", drag it to the card's centre, hold about 2 s, release.
   Expected: the card's liquid gives way (a notch, Merge's green liquid inside it), no seam between them; WebGPU: no label on top of the other, text missing only where the two liquids mix; after the release both separate and re-form within 3 s, the DOM labels return.
2. Drag "Merge" past "Split" quickly and back home without touching the card.
   Verify: Split wobbles briefly and re-forms; nothing stays soft.
3. Click "Splash" and shake (the playground or `instance.shake()`).
   Verify: unchanged from W78 (same feel, same re-form).

### Pass criteria
- [ ] No console error or warning in either renderer.
- [ ] No pixel with two labels on top of each other at any point (WebGPU).

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, the perf project (W77 and W79 guards), Docker canvas2d baselines (one new, one moved, nine unchanged), vision on the merge in both renderers.
