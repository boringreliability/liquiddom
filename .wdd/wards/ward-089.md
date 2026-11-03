---
ward: 89
revision: null
name: "Text dissolves like ink"
epic: "liquid-look"
status: "planned"
dependencies: [88]
layer: "typescript"
estimated_tests: 0
created: "2026-11-03"
completed: null
---
# Ward 089: Text dissolves like ink

North star: step 5, visual only. Where Merge's and the card's liquids mix, the labels dissolve into ink in both renderers instead of being cut (WebGPU, D79-1) or floating crisp over the liquid (Canvas2D). The re-form within 3 s, the pixel-identical rest and the slice matrix are unchanged. Whether "the labels never overlap" needs a note is D89-4.

## Scope
Second ward of Epic 16 "Liquid look" (design `docs/superpowers/specs/2026-11-02-liquiddom-ink-design.md`, brainstorm with Dennis 2026-10-31 … 2026-11-02, saga mem_20261031_07c6640a, approved 2026-11-03).

When two elements' liquids meet and mix, the text in the mixing zone dissolves like ink in water: it flows out, softens and drifts with the liquid. When the liquids separate and come to rest, the text is crisp again, exactly as today.

Today the two renderers handle this moment differently:
- Under WebGPU, rule D79-1 cuts a card's text hard where another element's liquid enters it. On a light card this reads as damage.
- Under Canvas2D the DOM text floats crisp over the moving liquid, which Dennis called flat.

W89 uses spike variant C in both renderers: per-particle ink, splatted with the density kernel and resolved as ink / Σw, and a mixing zone from the kernel-splatted element ids.
- Canvas2D gets the text atlas. It uses `liquid-text` to hide a mixing element's DOM text while it draws that element's atlas text and the ink.
- There is no new API or option, and no Rust or FFI change.

Out of scope:
- ink on splash, shake or any motion without a second element;
- strengthening or widening the zone beyond the spike's level;
- the readability glow (shelved);
- Canvas2D text that moves with its liquid outside the zone.

## Inputs
- The ink design (all sections, including §9, the author's calls) and spike W89.0 (`.superpowers/sdd/W89/spike-report.md`; branch `spike/w89-ink` `72c8b42`, reference only, D2).
- The WebGPU text pass and composite (`renderers/webgpu/webgpu-renderer.ts`, `shaders.ts` `TEXT_WGSL` / `TEXT_COMPOSITE_WGSL`, `gpu-buffers.ts`): T1/T1w/T1id and W79's id gather (D79-1).
- Canvas2D's density grid (`renderers/density-grid.ts`, `fluid-canvas2d.ts`).
- The text atlas (`renderers/webgpu/text-atlas.ts`, D74-5) and the `liquid-text` toggle (`text-toggle.ts`, D74-6) with its fail-safe paths in `runtime.ts`.
- W78's `liquid-away` (the dragged label under Canvas2D) and W75's halo with the M7 precedence rule.
- Baseline at `8ac786c`: see Specification.

## Outputs
- Ink in the mixing zone in both renderers.
- The Canvas2D atlas, the Canvas2D mixing report, and `liquid-text` for mixing elements under Canvas2D.
- The D79-1 amendment and its amended test.
- Unit tests and e2e in both renderers; vision on stills and recordings.
- Corrected docs (`site/src/pages/docs/limitations.md:31`, `accessibility.md:29`).
- Dennis' answers to D89-1 … D89-12 (and any candidate below that becomes a decision), recorded.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D89-1: The mixing gate
Proposal: ink appears only where two elements' liquids meet. The per-pixel computation (a WebGPU texel or a Canvas2D cell), from kernel-splatted sums:
- lo and hi are the smallest and largest element ids present;
- p = (Σw·id / Σw − lo) / (hi − lo);
- mix = 4p(1 − p);
- fade = smoothstep(0.03, 0.3, mix);
- the output text is crisp × (1 − fade) + ink × fade.

Where only one element is present, mix = 0 and today's path is untouched. Nothing persists between frames. The spike's thresholds are the starting point (D89-11).
Consequence: splash, shake without contact, drag without contact, scroll and gravity look exactly as today, including WebGPU text tearing with its own liquid. As the liquids separate, mix → 0 and the text is crisp again. At rest it is pixel-identical to today. p is exact only for two elements; with three or more, fade is still > 0 where they mix, and vision must confirm it stays ink-like. A shake that brings two neighbours' liquids into contact does show ink, because "two liquids meet" (approved halo test A7 is re-checked at red).
Decision: PENDING

### D89-2: The ink technique (variant C)
Proposal: per-particle ink and a splatted ink field.
- **Per-particle ink:** the mean of the premultiplied atlas texels over the particle's own rest cell (a spacing² square at `rest_uv`, a 4 × 4 sample grid). That is the text colour × the fraction of the cell the glyphs cover.
  - It changes only when the static view's generation or the atlas page changes, so it is computed then and cached.
  - WebGPU: the atlas becomes visible to the vertex stage (spec §3). The ink is either computed in the text pass's vertex shader (the spike's way, 16 taps × 6 vertices per particle per frame) or once per generation/atlas version into a per-particle buffer. The builder picks the cheaper one and measures it under D89-9.
  - Canvas2D: computed once in TS from the atlas page's pixels, read only over the elements' rects.
- **Ink field:** Σw·ink is splatted with the same kernel as the density, alongside Σw.
- **Resolve:** ink = Σw·ink / Σw × gain (spike: 1.2), multiplied by the liquid's own edge coverage.

Variants A (point dabs: pixel noise, the anti-goal) and B (dabs + blur: glowing lumps) are ruled out. D (blurred advected text) is too faint.
Consequence: every pixel averages about 15 particles, so the ink is as smooth as the liquid and never speckle. The look is bound to the spike's contact sheets and recordings, judged by vision. In WebGPU the text pass gains vertex-stage atlas access and (under the cache option) one per-particle buffer.
Decision: PENDING

### D89-3: Every liquid counts, both texts feed the ink
Proposal: every particle of a moving active element enters Σw, Σw·id and lo/hi, text-less elements included, so mix fires at any interface between two elements. Only particles of elements with atlas text carry non-zero ink, so a text-less blob dilutes the card's ink, as ink in water does.
- Both texts feed the ink in both renderers, the dragged element's too. In step 5, Merge's label dissolving into a drifting ghost is part of the look.
- WebGPU: today the text pass splats only moving elements with a valid text record (`shaders.ts:317-323`). The spike kept that, so it never tested a text-less blob. W89 lets text-less moving elements into the text pass with coverage 0, writing Σw (into the ink resolve's Σw), Σw·id and their id, but no crisp text.
- Canvas2D: the ids come from every moving element's particles (see D89-9 for the cost).

Consequence: this goes beyond the spike (the spike counted only text-carrying liquids). The WebGPU text pass does more work whenever a text-less element moves with a text element. If text-less particles also enter T1w, the card's crisp text dims slightly at the overlap's outer edge (as torn particles do today, D74-3). The builder may keep T1w text-only and give the resolve its own all-liquid Σw (part of D89-7's byte budget). The text pass still runs only while some element with atlas text moves (`hasMovingText`).
Decision: PENDING

### D89-4: D79-1 becomes a soft guarantee
Proposal: W79's hard cut (coverage 0 where lo < hi, `shaders.ts:418-419`) becomes the continuous fade of D89-1. Its guarantee "no pixel carries two labels" becomes: no two crisp labels overlap in the zone. At the outer edge of a kernel overlap (fade ≈ 0 but lo < hi), the two crisp texts may overlap faintly with weight p; the spike saw no visible ghosting.
- Approved test A1 is amended: `e2e/webgpu-robust.spec.ts:1128`, "W79 step 5 – given Merge dragged into the card, held 90 frames and released then no frame has a text pixel where two elements' text splats meet, …", assertion `worst mixedTextPx = 0` at `:1159`.
- Proposal for the amended test:
  - mixed texels where fade ≥ a small bound carry no crisp text of both elements;
  - the meet frames, the card's own text and the re-form stay asserted;
  - at rest there are no mixed texels.
- NORTH-STAR step 5 keeps its wording ("the labels never overlap"), which still holds for crisp labels, with a note in this ward. Rewording it would change the fluid design's §6 in the same commit (`wdd-docs.test.ts`).

Consequence: an approved-test change. The D79-1 row in NORTH-STAR stays as history, and W89's rows record the amendment. A pixel with a faint double label at fade ≈ 0 is accepted if vision shows no ghosting. The hook's report (`demo/text-id-report.ts`) needs a fade-aware count, or the amended test needs a capture of the ink weight.
Decision: PENDING

### D89-5: Canvas2D gets the atlas and `liquid-text`
Proposal:
- **Atlas build:** the runtime builds the text atlas under Canvas2D too. This amends D74-5 ("under WebGPU"). It opens `rebuildAtlas` (`runtime.ts:701`) and `atlasDue` (`:908-909`), and keeps the atlas through the device-lost rebuild (`:1019-1028`).
  - Proposal: lazily, the first time a text element mixes, plus a prewarm when an element with text starts moving next to another, so the first merge shows no hitch.
  - An instance whose elements have no text builds no atlas.
  - A browser without OffscreenCanvas gets no atlas and keeps today's Canvas2D look (DOM text, halo).
- **The class under Canvas2D:** `liquid-text` hides a mixing element's DOM text. This amends D74-6 ("exactly while the active renderer is WebGPU").
  - Today's predicate is `textReady && restAlpha < 1` (`text-toggle.ts:33-38`). Under Canvas2D it becomes the renderer's mixing report, a new internal `Renderer` method; `frame.ts:98` "WebGPU only" goes.
  - a11y, print, forced colours and reduced motion are as today, and every fail-safe path clears the class in both renderers.
  - The halo is beaten by `liquid-text` (M7, `stylesheet.ts:55`). The stylesheet comment `:56` changes; no rule changes.
- **Approved-test changes:**
  - A2: `text-runtime.test.ts:157` `given_canvas2d_when_elements_move_then_liquid_text_is_never_set_and_no_atlas_is_built` becomes "a single moving element sets no class and builds no atlas".
  - A3: `text-toggle.test.ts:53`, the case "canvas2d" at `:57`, becomes Canvas2D without a mixing report.
  - A4: `e2e/acceptance.spec.ts:497` "step 3 (canvas2d) – … no element ever carries liquid-text (D74-6)" stays as long as the splash does not mix with a neighbour (re-checked at red).
  - A5: `e2e/modes.spec.ts:107` changes its message only.
  - A7: `e2e/halo.spec.ts:78` is re-checked at red.

Consequence: Canvas2D now pays for an atlas page (OffscreenCanvas up to 4096², usually far less) and one pixel read per page version, but only once text mixes. The `liquid-text` lifecycle (refcount, every fail-safe) now applies to Canvas2D as well. Approved tests A2–A5 and A7 are listed above.
Decision: PENDING

### D89-6: Canvas2D hide/show hysteresis and what is drawn
Proposal:
- **The mixing report:** the renderer reports per element whether it mixes. The spike's entry threshold was ≥ 6 cells at fade > 0.3 against another id.
- **Enter fast:** the class is set within at most 2 frames of crossing the entry threshold.
- **Release slow:** the class is released after 10 frames under a lower exit threshold (proposal: ≥ 1 cell at fade > 0.1), so the class does not flicker. It is also released at once when the element's restAlpha reaches 1, so the rest stays pixel-identical.
- **What is drawn while hidden:** the element's atlas text at its home rect, masked by 1 − fade, plus the ink in the zone. Ink is drawn only for elements whose DOM text is hidden, so there is never a double image. Outside the zone the text looks like the DOM text; inside it softens into ink, coarser than WebGPU (the density cell) but never noisy.
- **The dragged element** is skipped for the DOM-hide report only: its label is already hidden by W78's `liquid-away`, and its atlas text still feeds the ink (D89-3). Approved test A6 (`drag-runtime.test.ts:199`, "never liquid-text under Canvas2D" for the dragged element) stays green and pins the skip.

Consequence: a short lag at entry (≤ 2 frames) is acceptable if vision shows no pop. The 10-frame release keeps the canvas text for up to 10 frames after the zone ends; the forced release at rest bounds it. The canvas atlas text is the atlas's `fillText` and not the browser's DOM text, so it may differ by subpixel anti-aliasing while hidden. An e2e checks for no flicker over a long hold.
Decision: PENDING

### D89-7: WebGPU targets within 32 B per sample
Proposal: the ink and Σw·id are extra targets of the existing text pass, at 1× the backing size.
- Today the pass has three targets: T1 `rgba16float` (8 B), T1w `r16float` (2 B) and T1id `rg16float` (4 B), so 14 B per sample.
- Adding `rgba16float` ink (8 B) and an `r16float` Σw·id (2 B) gives 24 B in 5 attachments, under the 32 B `maxColorAttachmentBytesPerSample` default and the 8-attachment limit.
- If D89-3 needs a separate all-liquid Σw, it joins Σw·id in one `rg16float` (26 B).
- The atlas and sampler become visible to the vertex stage.
- lo/hi stay W79's T1id gather, unchanged, so W79's capture hook (`captureTextIds`, `demo/text-id-report.ts`) keeps working. If the builder restructures targets anyway (for example to fit D89-8's `r32float`), lo/hi stay exact and approved test A8 (`text-id-report.test.ts`) changes only with Dennis' approval.

Consequence: +10 to +12 B per backing pixel, about +41 to +49 MB of GPU memory at 1280 × 800 × DPR 2 (today's text targets are about 57 MB). They are allocated only once text has moved (as T1 today). It adds one more blended write per text fragment. GPU time is measured under D89-9.
Decision: PENDING

### D89-8: Σw·id precision
Proposal: f16 Σw·id is not exact for slot ids up to 255 (`maxElements ≤ 256`). With Σw ≈ 1 and id ≈ 200, the f16 step is 0.125–0.25, and additive blending of about 15 fragments accumulates the rounding. With hi − lo = 1 that is a visible error in p. Two options:
- (a) ids relative to a per-frame dense rank: the renderer numbers the moving elements of the text pass 0 … k−1 in id order in the element record, splats Σw·rank in `r16float`, and the resolve maps lo/hi to ranks. k is small in practice; the precision is exact enough for k up to about 64.
- (b) `r32float` Σw·id, which needs the `float32-blendable` device feature (requested when the adapter has it). Without the feature, fall back to (a).

Proposal: (a) everywhere, with one code path and no device feature.
Consequence: (a) adds a rank field per element and a rank-to-id map in the resolve; a frame with more than about 64 moving elements degrades p gracefully (fade stays > 0 where they mix). (b) costs 4 B instead of 2 and a second code path. A unit test pins p for ids near 255.
Decision: PENDING

### D89-9: Perf bounds and the Canvas2D splat strategy
Proposal:
- **Canvas2D bound:** +2 ms at 6 elements on a quiet machine, measured interleaved against today.
  - The spike's +21 ms came from the widened `DensityGrid.splat` loop; it is fixed, not accepted.
  - A dedicated monomorphic ink path splats ink only for particles of elements with atlas text and restAlpha < 1, and only when at least two elements move.
  - The id sums (Σw·id, lo/hi) run on the same path, or on a coarser separate ink grid (e.g. 4 px) if vision still says ink.
  - The existing density splat stays unchanged.
- **WebGPU bound:** at most +1 ms of GPU time at 6 elements × DPR 2 where `timestamp-query` exists (Metal does), otherwise the CPU frame time within W88's 3.76 ms threshold.
- **Six elements:** the acceptance scene has 4, so the gold perf uses a 6-element setup (the stress scene, or a scene parameter added in part 2).

Consequence: if the monomorphic path cannot meet +2 ms on the 2 px grid, the coarser ink grid is the fallback, judged by vision. The Canvas2D ink stays coarser than WebGPU's by design. The baseline was taken on a loaded machine (Specification), so the gold perf must be re-measured quietly.
Decision: PENDING

### D89-10: Reduced motion: no ink
Proposal: under reduced motion nothing moves and nothing mixes, but production gates it explicitly (the spike did not).
- Both renderers draw no ink and no Canvas2D atlas text while `frame.reducedMotion`.
- The mixing report is false.
- The media listener clears `liquid-text` at once (as today).
- When reduced motion switches on while the loop is paused, the canvas is repainted without ink and atlas text (W88's `repaintWithoutShadows` pattern, `runtime.ts:846-865`), so the DOM text never shows next to stale canvas text.

Consequence: one more flag in both renderers' text paths and in the paused repaint. Print and forced colours are unchanged (the canvas is hidden).
Decision: PENDING

### D89-11: Tuning freedom
Proposal: gain (spike 1.2), an ink alpha cap (spike suggestion ≈ 0.6) and the fade thresholds (0.03 / 0.3), plus Canvas2D's entry and exit thresholds, may be tuned without a new decision to avoid noise or glow. The cases are light-on-light pairs, two bold white labels meeting and three-way mixing. The limit: the zone is never made wider, and the ink never stronger, than the spike's look. Vision is the judge, and every tuned value is logged in this ward.
Consequence: values may move between red and gold without a gate. A change that widens or strengthens the zone needs a new decision.
Decision: PENDING

### D89-12: Scene, site, docs and baselines
Proposal:
- **Scenes:** no new scene. Acceptance step 5 in both renderers and the site's chapter 4 ("Grab it. Merge it.") are where ink shows; both re-form exactly as today.
- **Docs corrected:**
  - `site/src/pages/docs/limitations.md:31`: "Text in the liquid is WebGPU only … Canvas2D the DOM text stays in place";
  - `site/src/pages/docs/accessibility.md:29`: "With Canvas2D the text never moves …".
  - Both gain the sentence that where two liquids mix, the text dissolves like ink in both renderers.
  - `packages/core/README.md` has no per-renderer text claim and stays.
- **Baselines:**
  - The two Canvas2D step-5 mid-hold Linux baselines (`acceptance-step5-drag-mid-canvas2d-linux.png`, `acceptance-step5-merge-mid-canvas2d-linux.png`) are expected to move. They are updated with Docker only after Dennis' vision approval (D65-7).
  - `acceptance-step5-drag-reformed-canvas2d-linux.png` (at rest) must not move.
  - WebGPU has no step-5 baseline.

Consequence: a Linux baseline moves in this epic for the first time (W88 moved none), which needs Docker and Dennis' vision approval. The slice-5 design keeps its D79-1 text as history.
Decision: PENDING

## Spike W89.0 result

Spike W89.0 asked one question: can particle-carried ink look like ink, not pixel noise? **Answer: yes, with variant C, in both renderers.**
- Branch `spike/w89-ink` (`72c8b42`, local, reference only, D2).
- Report: `.superpowers/sdd/W89/spike-report.md`.
- Stills, contact sheets and recordings: `spike-out/` in the spike worktree.
- Setup: seed 1, `clock=manual`, 1280 × 800 at DPR 1, a 540 × 340 clip around the stage. WebGPU ran on Metal (hardware adapter, new headless Chromium).

### Vision verdict per variant (all stills read, zoomed 3×)

| Variant | WebGPU | Canvas2D |
|---|---|---|
| today | D79-1 cuts the zone: the text stops at the green blob's edge, and Merge's label is cut to "lerge" | The DOM text floats crisp and unchanged over the blob |
| A, point dabs | **Pixel noise**: a dotted lattice of white specks (the anti-goal) | **Pixel noise**: the same lattice |
| B, dabs + blur | Soft, but glowing white lumps; too opaque where bold glyphs meet | Soft white clouds, blobby and glowy |
| **C, splatted ink field** | **Ink**: translucent pale wisps along the interface bleed into "Merge"; during the wiggle Merge's label dissolves into a drifting grey-white ghost; smooth, no speckle | **Ink, coarser**: the same wisps on the 2 px grid; the card's text softly erased in the zone; a bit blockier, never noisy |
| D, blurred advected text | Very faint greenish smear; does not read as ink | not built |

- In every variant the text is back at release + 150 ms. In C a small wisp remains on the separating seam at that moment and is gone by 500 ms.
- At rest the text is pixel-identical to today in both renderers.
- Seen in all variants including today, and not caused by ink:
  - a hole tears in the card's liquid at the pointer at hold150;
  - in WebGPU, stretched heading glyphs at hold150 and grey swirls at hold400 (the existing F⁻¹ text).

### Recommendation
Variant C (D89-1, D89-2): per-particle ink over the rest cell, splatted with the density kernel, resolved as ink / Σw × 1.2 × edge coverage, faded in by mix = 4p(1 − p). Canvas2D hides the DOM text via `liquid-text` while it mixes and draws the atlas text masked by 1 − fade plus the ink. Dennis chose C after the contact sheets.

### Cost (rough: the machine was loaded)
CPU ms per `advance(1)` (tick + render submit), acceptance scene (4 elements; the stress scene and 6 elements were not run), DPR 2, 150 manual frames of merge hold + wiggle. **Load average 17–29** during the measurement, so the machine was not quiet and the numbers are rough.

| | p50 | p95 |
|---|---|---|
| WebGPU today | 4.44 | 4.67 |
| WebGPU C | 4.43 | 4.53 |
| WebGPU B | 4.46 | 4.53 |
| Canvas2D today | 9.86 | 10.91 |
| Canvas2D C | 31.34 | 32.48 |
| Canvas2D B | 30.85 | 31.89 |

- **WebGPU:** no CPU cost. GPU time was not measured (no timestamp queries in the spike).
- **Canvas2D C:** about +21 ms, all in the widened `DensityGrid.splat` loop. With the ink accumulation off it was back at 9.7 ms; skipping the crisp-text mask or the ink draw changed nothing. Fixed, not accepted (D89-9).

### Risks carried into the ward
1. The zone is thin by physics: a narrow band during a still hold, and the whole blob during movement. Dennis judged that level right, and it is not widened (D89-11).
2. Ink gain and colour: two bold white labels can glow, and light-on-light was not tested (D89-11).
3. Removing the D79-1 cut makes its guarantee soft (D89-4).
4. Canvas2D is a behaviour change: the atlas and `liquid-text`, and three-way mixing was not tested (D89-5, D89-6).
5. f16 precision of Σw·id for large ids (D89-8).
6. Canvas2D hysteresis was not checked for flicker over a long recording (D89-6).
7. Not done in the spike: the stress scene and 6 elements, GPU timing, reduced motion and the landing page (large kernels, coarser grid) (D89-9, D89-10).

### New decision candidates
Found by the survey (2026-11-03). Each is folded into a decision above and is presented at the gate as its own point:
- **A text-less liquid is not in today's text pass** (`shaders.ts:321`). The spike never tested a text-less blob, so spec §9's "a text-less liquid counts" is new work → D89-3.
- **Per-particle ink placement:** the spike's per-vertex sampling repeats 16 atlas taps 6 times per particle per frame, although the ink changes only per generation or atlas version → D89-2 (cache option).
- **`r32float` is not blendable in core WebGPU** (`webgpu-renderer.ts:75`), so "r32float" in spec §5 needs a device feature → D89-8.
- **Release at rest:** Canvas2D's 10-frame release could keep canvas atlas text past restAlpha 1 and break the pixel-identical rest; the class is released at once at rest → D89-6.
- **The paused-instance repaint** re-renders the unticked state, so stale ink or atlas text could sit next to the returned DOM text → D89-10. (WebGPU's existing liquid text in that repaint is a question for Dennis, not part of W89 unless he says so.)
- **No OffscreenCanvas:** no atlas, so Canvas2D keeps today's look → D89-5.
- **The brief's "D74-3"** (atlas gating) is D74-5. D74-3 (torn hysteresis) is not touched.

## Specification
**Baseline at `8ac786c`:** measured 2026-11-03 after `npm run build:wasm` and `npm run build -w liquiddom` (only docs changed since `699b5d7`).
- cargo `245 passed; 0 failed; 1 ignored` (the doc-test line is 0 passed).
- vitest `946 passed (946)`, 95 files.
- Playwright `--list`: canvas2d 110 / webgpu 51 / webgpu-hw 102 / perf 6 / dist 2 / site 7 / record 4 / record-webgpu 4.
- Perf of step 5's merge hold + wiggle (CPU ms per `advance(1)`, 150 frames, DPR 2, 4 elements, interleaved, 2 measured repetitions):
  - Canvas2D p50 9.55 / 9.56, p95 10.53 / 10.58;
  - WebGPU p50 4.31 / 4.37, p95 4.49 / 4.51.
  - **Load average 13.7–15.1 (rough).**

Written after the W89.0 gate (part 2 of the plan): the technique details and the file-level changes.

## Tests
Written in part 2 of the plan after the D89 gate (W89.1 red).

## Must NOT
- Change the engine, the FFI or any public API (Rust, `FluidCore`, the strides), or add an option.
- Touch the DOM from a renderer.
- Show ink without two liquids meeting, or widen or strengthen the zone beyond the spike's look.
- Look like pixel noise.
- Hide the DOM text under Canvas2D without the atlas text drawn in its place, or draw both at once.
- Change a test Dennis approved without his approval (A1–A8 in the plan's survey).
- Move a Linux baseline without Dennis' vision approval.
- Copy spike code (D2).

## Must DO
- Keep the rest pixel-identical to today in both renderers.
- Clear `liquid-text` on every fail-safe path in both renderers (unobserve, destroy, a failed frame, a lost device, reduced motion).
- Draw no ink under reduced motion, including the paused repaint.
- Build no atlas for an instance whose elements have no text.
- Inspect every still and recording with vision before reporting a visual result.

## Manual Smoke Test
Written in part 2 of the plan after the D89 gate (W89.1 red).

## Verification
- `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green.
- Vision of acceptance step 5 and site chapter 4 in both renderers (stills and a recording), judged against the anti-goal.
- Perf within D89-9's bounds.
- No acceptance step regresses.
