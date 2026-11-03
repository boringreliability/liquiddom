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
Decision: APPROVED 2026-11-03 — ink only where two liquids meet; mix = 4p(1−p), fade = smoothstep(0.03, 0.3, mix) (saga dec_65b5e308)

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
Decision: APPROVED 2026-11-03 — variant C: per-particle ink splatted with the density kernel, resolved ink/Σw × gain × edge coverage; A and B ruled out (saga dec_efb79947)

### D89-3: Every liquid counts, both texts feed the ink
Proposal: every particle of a moving active element enters Σw, Σw·id and lo/hi, text-less elements included, so mix fires at any interface between two elements. Only particles of elements with atlas text carry non-zero ink, so a text-less blob dilutes the card's ink, as ink in water does.
- Both texts feed the ink in both renderers, the dragged element's too. In step 5, Merge's label dissolving into a drifting ghost is part of the look.
- WebGPU: today the text pass splats only moving elements with a valid text record (`shaders.ts:317-323`). The spike kept that, so it never tested a text-less blob. W89 lets text-less moving elements into the text pass with coverage 0, writing Σw (into the ink resolve's Σw), Σw·id and their id, but no crisp text.
- Canvas2D: the ids come from every moving element's particles (see D89-9 for the cost).

Consequence: this goes beyond the spike (the spike counted only text-carrying liquids). The WebGPU text pass does more work whenever a text-less element moves with a text element. If text-less particles also enter T1w, the card's crisp text dims slightly at the overlap's outer edge (as torn particles do today, D74-3). The builder may keep T1w text-only and give the resolve its own all-liquid Σw (part of D89-7's byte budget). The text pass still runs only while some element with atlas text moves (`hasMovingText`).
Decision: APPROVED 2026-11-03 — every moving liquid counts, text-less too; both texts incl. the dragged one feed ink; a separate all-liquid Σw keeps T1w text-only (saga dec_b2c1c6a2)

### D89-4: D79-1 becomes a soft guarantee
Proposal: W79's hard cut (coverage 0 where lo < hi, `shaders.ts:418-419`) becomes the continuous fade of D89-1. Its guarantee "no pixel carries two labels" becomes: no two crisp labels overlap in the zone. At the outer edge of a kernel overlap (fade ≈ 0 but lo < hi), the two crisp texts may overlap faintly with weight p; the spike saw no visible ghosting.
- Approved test A1 is amended: `e2e/webgpu-robust.spec.ts:1128`, "W79 step 5 – given Merge dragged into the card, held 90 frames and released then no frame has a text pixel where two elements' text splats meet, …", assertion `worst mixedTextPx = 0` at `:1159`.
- Proposal for the amended test:
  - mixed texels where fade ≥ a small bound carry no crisp text of both elements;
  - the meet frames, the card's own text and the re-form stay asserted;
  - at rest there are no mixed texels.
- NORTH-STAR step 5 keeps its wording ("the labels never overlap"), which still holds for crisp labels, with a note in this ward. Rewording it would change the fluid design's §6 in the same commit (`wdd-docs.test.ts`).

Consequence: an approved-test change. The D79-1 row in NORTH-STAR stays as history, and W89's rows record the amendment. A pixel with a faint double label at fade ≈ 0 is accepted if vision shows no ghosting. The hook's report (`demo/text-id-report.ts`) needs a fade-aware count, or the amended test needs a capture of the ink weight.
Decision: APPROVED 2026-11-03 — D79-1 becomes a soft guarantee; A1 amended (no crisp text of both elements where fade ≥ a small bound); NORTH-STAR step 5 wording kept with a note (approved-test change) (saga dec_fac79d1f)
Note (pre-red gate, 2026-11-03, saga dec_d2a8df49): A1's bound is fade ≥ 0.9 (argued: a pixel test cannot tell one glyph from two); the red run logs text pixels per fade band and the bound is lowered if the bands allow; "at rest no mixed texels" is asserted. Approved-test changes also: A7 (`e2e/halo.spec.ts:78`, halo colour checked only where no `liquid-text` holds) and B1–B6 (`webgpu-renderer`, `gpu-buffers`, `webgpu-shaders` tests). NORTH-STAR step 5 and the fluid design §6 keep their wording: "the labels never overlap" holds for crisp labels.

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
Decision: APPROVED 2026-11-03 — Canvas2D builds the atlas lazily at the first mix with a prewarm (amends D74-5) and sets liquid-text for mixing elements (amends D74-6); A2, A3, A5 changed, A4, A7 re-checked (approved-test change) (saga dec_e1b67b60)

### D89-6: Canvas2D hide/show hysteresis and what is drawn
Proposal:
- **The mixing report:** the renderer reports per element whether it mixes. The spike's entry threshold was ≥ 6 cells at fade > 0.3 against another id.
- **Enter fast:** the class is set within at most 2 frames of crossing the entry threshold.
- **Release slow:** the class is released after 10 frames under a lower exit threshold (proposal: ≥ 1 cell at fade > 0.1), so the class does not flicker. It is also released at once when the element's restAlpha reaches 1, so the rest stays pixel-identical.
- **What is drawn while hidden:** the element's atlas text at its home rect, masked by 1 − fade, plus the ink in the zone. Ink is drawn only for elements whose DOM text is hidden, so there is never a double image. Outside the zone the text looks like the DOM text; inside it softens into ink, coarser than WebGPU (the density cell) but never noisy.
- **The dragged element** is skipped for the DOM-hide report only: its label is already hidden by W78's `liquid-away`, and its atlas text still feeds the ink (D89-3). Approved test A6 (`drag-runtime.test.ts:199`, "never liquid-text under Canvas2D" for the dragged element) stays green and pins the skip.

Consequence: a short lag at entry (≤ 2 frames) is acceptable if vision shows no pop. The 10-frame release keeps the canvas text for up to 10 frames after the zone ends; the forced release at rest bounds it. The canvas atlas text is the atlas's `fillText` and not the browser's DOM text, so it may differ by subpixel anti-aliasing while hidden. An e2e checks for no flicker over a long hold.
Decision: APPROVED 2026-11-03 — enter ≤ 2 frames, release after 10 frames under a lower exit threshold, forced release at rest; ink only while the DOM text is hidden; dragged element skipped for the hide report only (saga dec_c8668af2)
Note (pre-red gate, 2026-11-03, saga dec_d2a8df49): the mixing report skips W78's whole away set (the dragged slot and a released slot crawling home while `liquid-away` holds), not only the dragged slot; its ink still feeds the zone. The class arrives one frame after the report enters.

### D89-7: WebGPU targets within 32 B per sample
Proposal: the ink and Σw·id are extra targets of the existing text pass, at 1× the backing size.
- Today the pass has three targets: T1 `rgba16float` (8 B), T1w `r16float` (2 B) and T1id `rg16float` (4 B), so 14 B per sample.
- Adding `rgba16float` ink (8 B) and an `r16float` Σw·id (2 B) gives 24 B in 5 attachments, under the 32 B `maxColorAttachmentBytesPerSample` default and the 8-attachment limit.
- If D89-3 needs a separate all-liquid Σw, it joins Σw·id in one `rg16float` (26 B).
- The atlas and sampler become visible to the vertex stage.
- lo/hi stay W79's T1id gather, unchanged, so W79's capture hook (`captureTextIds`, `demo/text-id-report.ts`) keeps working. If the builder restructures targets anyway (for example to fit D89-8's `r32float`), lo/hi stay exact and approved test A8 (`text-id-report.test.ts`) changes only with Dennis' approval.

Consequence: +10 to +12 B per backing pixel, about +41 to +49 MB of GPU memory at 1280 × 800 × DPR 2 (today's text targets are about 57 MB). They are allocated only once text has moved (as T1 today). It adds one more blended write per text fragment. GPU time is measured under D89-9.
Decision: APPROVED 2026-11-03 — ink rgba16float + rg16float (Σw·id, all-liquid Σw) in the text pass, 26 B per sample; lo/hi stay W79's gather (saga dec_a567ca91)

### D89-8: Σw·id precision
Proposal: f16 Σw·id is not exact for slot ids up to 255 (`maxElements ≤ 256`). With Σw ≈ 1 and id ≈ 200, the f16 step is 0.125–0.25, and additive blending of about 15 fragments accumulates the rounding. With hi − lo = 1 that is a visible error in p. Two options:
- (a) ids relative to a per-frame dense rank: the renderer numbers the moving elements of the text pass 0 … k−1 in id order in the element record, splats Σw·rank in `r16float`, and the resolve maps lo/hi to ranks. k is small in practice; the precision is exact enough for k up to about 64.
- (b) `r32float` Σw·id, which needs the `float32-blendable` device feature (requested when the adapter has it). Without the feature, fall back to (a).

Proposal: (a) everywhere, with one code path and no device feature.
Consequence: (a) adds a rank field per element and a rank-to-id map in the resolve; a frame with more than about 64 moving elements degrades p gracefully (fade stays > 0 where they mix). (b) costs 4 B instead of 2 and a second code path. A unit test pins p for ids near 255.
Decision: APPROVED 2026-11-03 — (a) per-frame dense rank in f16 everywhere, no device feature (saga dec_29db2b54)

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
Decision: APPROVED 2026-11-03 — Canvas2D +2 ms at 6 elements via a dedicated ink splat (4 px ink grid as fallback); WebGPU +1 ms GPU, else CPU within 3.76 ms (saga dec_2ba27aef)

### D89-10: Reduced motion: no ink
Proposal: under reduced motion nothing moves and nothing mixes, but production gates it explicitly (the spike did not).
- Both renderers draw no ink and no Canvas2D atlas text while `frame.reducedMotion`.
- The mixing report is false.
- The media listener clears `liquid-text` at once (as today).
- When reduced motion switches on while the loop is paused, the canvas is repainted without ink and atlas text (W88's `repaintWithoutShadows` pattern, `runtime.ts:846-865`), so the DOM text never shows next to stale canvas text.

Consequence: one more flag in both renderers' text paths and in the paused repaint. Print and forced colours are unchanged (the canvas is hidden).
Decision: APPROVED 2026-11-03 — no ink under reduced motion; the paused repaint also removes WebGPU's liquid text (saga dec_060cfd55)
Note (pre-red gate, 2026-11-03, saga dec_d2a8df49): a stop repaints once without ink, atlas text or liquid text whenever a text class was held, and `unobserve(el)` of a text-held element repaints once without that element's text (`RenderFrame.textOff`), in both renderers, paused or running.

### D89-11: Tuning freedom
Proposal: gain (spike 1.2), an ink alpha cap (spike suggestion ≈ 0.6) and the fade thresholds (0.03 / 0.3), plus Canvas2D's entry and exit thresholds, may be tuned without a new decision to avoid noise or glow. The cases are light-on-light pairs, two bold white labels meeting and three-way mixing. The limit: the zone is never made wider, and the ink never stronger, than the spike's look. Vision is the judge, and every tuned value is logged in this ward.
Consequence: values may move between red and gold without a gate. A change that widens or strengthens the zone needs a new decision.
Decision: APPROVED 2026-11-03 — gain, alpha cap and thresholds tunable within the spike's look, logged in the ward (saga dec_c28300ce)

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
Decision: APPROVED 2026-11-03 — no new scene; two docs pages corrected; two Canvas2D step-5 mid-hold baselines move after vision approval, the rest one must not (saga dec_a9a90d32)

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

**Architecture.** One pure module holds the ink maths and the tunable constants (`renderers/ink.ts`); the WGSL interpolates the constants.
- **WebGPU** keeps one text pass and widens it: T1ink (`rgba16float`, Σw·ink) and T1mix (`rg16float`, r = Σw·rank, g = the all-liquid Σw) join T1/T1w/T1id (26 B per sample). Every moving element enters the pass; a text-less one writes T1id and T1mix only, so T1w stays text-only. The vertex stage samples the atlas over the particle's rest cell (the per-particle ink). The text composite maps W79's gathered lo/hi ids to ranks through the element records (`EG.RANK`), takes fade = smoothstep(0.03, 0.3, 4p(1 − p)) and returns `crisp × (1 − fade) + ink × fade`; D79-1's cut is gone.
- **Canvas2D** gets the atlas lazily: the renderer reports `wantsAtlas()` once two elements move, and the runtime builds the page on the next frame. A dedicated `InkCanvas2D` (`renderers/ink-canvas2d.ts`) splats every moving particle into its own monomorphic `InkGrid` (Σw, Σw·rank, lo/hi rank, Σw·ink) only when two elements move and one of them has atlas text. It resolves fade and ink per cell, steps the `MixReport` hysteresis per slot, and draws after the resting rects: the ink, and for each slot it reports, the atlas text at the element's DOM box with 1 − fade cut out. `textMixing(id)` says what the last render drew; under Canvas2D the runtime's `liquid-text` follows it.
- **Runtime:** reduced motion and a stop repaint the canvas once with `suppressText` where a text class was held (W88's repaint, widened); the device-lost rebuild keeps the atlas. Rust, the FFI and the public API are untouched.

**Decisions (approved 2026-11-03; as recorded in `ward-089.md`):**

| Item | What this plan implements |
|---|---|
| D89-1 Mixing gate (dec_65b5e308) | `mixOf`, `fadeOf`, `inkFade`, `blendInk`; the WGSL composite and the Canvas2D cell resolve use them; one element → fade 0 → today's path |
| D89-2 Variant C (dec_efb79947) | `particleInk` (Canvas2D, once per generation/paints/page version); the vertex-stage mirror in `TEXT_WGSL`; `inkScale` (gain 1.2, cap 0.6) × the all-liquid edge coverage |
| D89-3 Every liquid counts (dec_b2c1c6a2) | text-less moving elements in the text pass (coverage 0, `acc_w = w × has_text`) and in the `InkGrid`; both texts feed ink, the dragged one's too |
| D89-4 Soft guarantee (dec_fac79d1f) | the composite's fade replaces the cut; A1 amended to "no crisp text where fade ≥ 0.9 (resolution 15), ink present, at rest no mixed texels"; `summarizeInk` in the W79 hook; the step 5 note in the ward only |
| D89-5 Canvas2D atlas and class (dec_e1b67b60) | `wantsAtlas()` → `atlasWanted` → `rebuildAtlas`/`atlasDue` open for Canvas2D; no text → no page; the toggle reads `textMixing` under Canvas2D; A2, A3, A5 changed; A4 re-checked (green), A7 re-checked and changed (resolution 13) |
| D89-6 Hysteresis (dec_c8668af2) | `MixReport` (enter 6 cells at fade > 0.3; release after 10 frames under 1 cell at fade > 0.1; off at once when ineligible); drawn from the frame after entry; away slots skipped (resolution 2) |
| D89-7 Targets (dec_a567ca91) | T1ink `rgba16float` + T1mix `rg16float`, 26 B; atlas and sampler visible to the vertex stage; lo/hi stay W79's gather; `captureTextIds({ mix: true })` (resolution 8) |
| D89-8 Dense rank (dec_29db2b54) | `denseRanks`; `EG.RANK = 13` (WGSL `Element.rank`, was `_pad0`); the composite reads the element records (binding 7) |
| D89-9 Perf (dec_2ba27aef) | the `InkGrid` path only with ≥ 2 moving elements and atlas text; `INK_CELL_FACTOR` 1 → 2 is the fallback; W89.6 Step 3 measures 6 elements |
| D89-10 Reduced motion (dec_060cfd55) | both renderers draw no ink/atlas text/liquid text under `reducedMotion` or `suppressText`; the paused repaint runs when a text class was held |
| D89-11 Tuning (dec_c28300ce) | gain, alpha cap, fade and report thresholds are constants; row 7 pins the limit (never wider, never stronger); values logged in the ward |
| D89-12 Docs and baselines (dec_a9a90d32) | W89.6 Steps 4–5 |

**Design resolutions this plan makes.** Resolutions 2, 4, 13 and 14 extend an approved decision or approved tests, and resolution 15 sets A1's bound; W89.1 Step 0 presents them before any red test.
1. **The class follows what was drawn.** Canvas2D decides the report from frame N's cells and draws a reported slot's atlas text and ink from frame N + 1; `textMixing(id)` is "the last render drew it", and the toggle runs after `render()`. Entry therefore lags one frame (D89-6: ≤ 2), and the class and the canvas text always change in the same frame.
2. **"Dragged" means W78's away set (extends D89-6).** The report skips a slot while it is DRAGGED **or** while this instance holds `liquid-away` on it (released, crawling home), read from `RenderFrame.awaySlots`. Without it, Merge after the release would report mixing and the canvas would draw its atlas text at its DOM box while its liquid is still away. D89-6's reason ("its label is already hidden by W78's `liquid-away`") covers both.
3. **Ink only where the DOM text is hidden.** A particle feeds the ink grid's Σw·ink only while its slot is drawn (resolution 1) or away; every moving particle feeds Σw, Σw·rank and lo/hi. A cell counts toward the report for its smallest and its largest rank only: with three liquids in one cell the middle one is not counted there, because p (and so the fade) describes the lo|hi pair; the middle element is counted at its own interfaces with each neighbour, where it is lo or hi, so a three-way mix still enters through those cells.
4. **A stop repaints without text (extends D89-10 to the stop path, Review Focus 1).** W88's `repaintWithoutShadows` becomes one repaint with `suppressShadows` and `suppressText` whenever a shadow class or a text class was held. It runs on a stop (a failed frame or a failed rebuild) and when reduced motion turns on while paused. Under WebGPU this also removes the liquid text a stopped canvas kept until now.
5. **Per-particle ink in the vertex stage (D89-2's builder choice).** 16 taps × 6 vertices per particle, no new buffer or pass. W89.6 Step 3 measures the GPU time; over +1 ms, the cached per-particle buffer of D89-2 replaces it (a note, no new decision).
6. **T1w stays text-only:** `out.acc_w = w * in.has_text;` the all-liquid Σw lives in T1mix.g (D89-3's separate Σw).
7. **Rank map.** `packElements` writes the dense rank of every drawable slot with restAlpha < 1 and mass > 0 into `EG.RANK` (0 elsewhere; existing records keep their zeros). The composite reads `elements[lo].rank` and `elements[hi].rank`, so T1id, `TEXT_ID_EMPTY` and A8 are untouched.
8. **`captureTextIds(opts?: { mix?: boolean })`.** Only `{ mix: true }` also copies T1mix and returns `mix` and `ranks`, so W79's capture and its four tests stay as they are; the acceptance hook asks for it.
9. **`INK_ALPHA_CAP` starts at 0.6** (the spike's suggestion; D89-11 allows weaker). The amended A1 needs it: at fade ≥ 0.9 the crisp text weighs ≤ 0.1, and with ink alpha ≤ 0.6 no zone pixel can reach W79's text threshold (200).
10. **The ink grid is the density cell** (`INK_CELL_FACTOR = 1`); D89-9's 4 px fallback is factor 2.
11. **Canvas2D draws ink and atlas text after the resting rects**, above all liquid, as the DOM text it replaces sits.
12. **The lazy atlas.** `atlasWanted` is set after a render whose renderer reports `wantsAtlas()` (Canvas2D only) and stays set; it also arms `atlasDeferred`, so the next frame builds the page. The device-lost rebuild keeps `atlasRects` and `atlasFrame` and sets `atlasWanted` when a page existed (D89-5).
13. **Approved tests.** A1, A2, A3, A5 as approved at the gate. **A7 changes too:** the gate left it to a re-check at red, and the validation's prototype run failed it (after a shake, Split's liquid mixes with a neighbour's within 5 frames, so `liquid-text` beats its halo by M7, as D89-1's consequence foresaw); its halo colour is now checked only where no `liquid-text` holds. Seven more are pinned by tests the gate did not name (found by the plan validation):
    - B1, B2: `webgpu-renderer.test.ts:164` (targets, storage 12 → 13, buffers 24 → 25) and `:535` (attachments);
    - B3: `gpu-buffers.test.ts:106` (`EG` gains `RANK: 13`);
    - B4a, B4b: `webgpu-shaders.test.ts:52` (name only) and `:65` (`out.acc_w = w * in.has_text;`);
    - B5: `webgpu-shaders.test.ts:77` (`let crisp = text * coverage;`);
    - B6: `webgpu-shaders.test.ts:95` (the D79-1 cut becomes the fade; the unit twin of A1).

    Re-checked and unchanged: A4 (a splash on Splash mixes with nobody in 30 frames), A6 and A8.
14. **`unobserve(el)` repaints without that element's text (extends D89-10's repaint, Review Focus 1).** When this instance holds `liquid-text` on `el`, `unobserve` releases the class and repaints once, paused or running, with `RenderFrame.textOff = id`: Canvas2D draws no atlas text and no ink for that slot; WebGPU writes a zeroed text record for it for that render (the next pack restores it; `textReady` keeps its answer) and skips the pass when no other text moves. So the canvas never keeps an unobserved element's text next to its returned DOM text, not even on a paused instance.
15. **A1's "small bound" is `INK_ZONE_FADE = 0.9` (D89-4 left the bound open; Step 0 item 6).** A pixel test cannot tell one element's crisp glyph from two elements'. Below fade ≈ 0.2 a pixel keeps ≥ 0.8 of one element's own crisp text, which reaches W79's text threshold (200) by itself. This is argued, not measured: the validation prototype counted up to 58 text pixels on mixed texels below fade 0.9 but did not split them by fade. The W89.1 red run therefore logs A1's text-pixel count per fade band (0.1–0.2, 0.2–0.5, 0.5–0.9) so the bound is backed by a measurement before gold; if the bands show 0 below 0.9, the bound is lowered to the smallest band that holds 0 (a tuning within D89-4, logged in the ward). At 0.9 the crisp weight is ≤ 0.1, and with `INK_ALPHA_CAP` 0.6 no zone pixel can reach 200: zero there means no crisp label at all. D89-4's soft edge (fade < 0.9) stays logged as `worst`. A1 keeps D89-4's "at rest no mixed texels".
16. **Accepted:** the canvas atlas text differs from the DOM text by sub-pixel anti-aliasing while hidden (D89-6). With three liquids in a pixel p is approximate (row 4; vision in W89.6). **The WGSL resolve (rank → p → fade → ink) has no automated parity test with `ink.ts`**: the unit rows pin the shader text (40, B4b–B6), and A1 and G2 pin the behaviour on Metal.

**Pre-red gate (Dennis "ja" 2026-11-03, saga dec_d2a8df49):** resolutions 2, 4, 14 and 15, A7 and B1–B6 approved as recommended. A1 additionally logs the text-pixel count on mixed texels per fade band 0.1–0.2, 0.2–0.5, 0.5–0.9 and >= 0.9 (worst frame of the flow; `summarizeInkBands`, log only, no assertion on the bands).

## Tests

Red was measured in the repo at W89.1 (commit f8a758c, 2026-11-03) and matches the plan validation row for row. **A** = an assertion fails (no import or type error anywhere). ✅ at red = a guard or a test-only change.

| # | Test (file: name) | Pins | Red |
|---|---|---|---|
| 1 | ink.test: given_one_element_lo_equal_hi_or_no_liquid_when_mixed_then_mix_and_fade_are_0_D89_1 | D89-1 | ✅ (the stub returns 0) |
| 2 | ink.test: given_a_50_50_mix_when_inkFade_then_mix_1_and_fade_1_and_a_25_75_mix_gives_mix_0_75_D89_1 | D89-1 | ❌ A (0 ≠ 1) |
| 3 | ink.test: given_mix_values_around_the_thresholds_when_fadeOf_then_smoothstep_from_INK_FADE_LO_to_INK_FADE_HI_D89_1 | D89-1 | ❌ A |
| 4 | ink.test: given_three_ranks_in_one_pixel_when_inkFade_then_the_fade_stays_above_0_where_they_mix_review_focus_4 | D89-1, RF4 | ❌ A |
| 5 | ink.test: given_crisp_ink_and_fade_when_blendInk_then_crisp_times_1_minus_fade_plus_ink_times_fade_with_fade_clamped_D89_1 | D89-1 | ❌ A |
| 6 | ink.test: given_sums_when_inkScale_then_gain_over_sum_w_capped_at_INK_ALPHA_CAP_and_0_without_liquid_D89_2 | D89-2, D89-11 | ❌ A |
| 7 | ink.test: given_the_tunable_values_when_read_then_the_zone_is_never_wider_and_the_ink_never_stronger_than_the_spike_D89_11 | D89-11 | ✅ (guard) |
| 8 | ink.test: given_an_atlas_page_when_particleInk_then_the_mean_premultiplied_texel_over_the_rest_cell_is_text_colour_times_coverage_D89_2 | D89-2 | ❌ A |
| 9 | ink.test: given_a_rest_cell_partly_off_the_page_or_a_blank_cell_when_particleInk_then_off_page_taps_count_as_transparent_and_a_blank_cell_is_0_D89_2 | D89-2 | ❌ A |
| 10 | ink.test: given_moving_slots_with_ids_up_to_255_when_denseRanks_then_ranks_0_to_k_minus_1_in_id_order_and_minus_1_elsewhere_D89_8 | D89-8, RF5 | ❌ A |
| 11 | ink.test: given_15_fragments_accumulated_in_f16_when_p_is_read_from_ranks_then_it_matches_the_exact_p_for_ids_254_and_255_review_focus_5 | D89-8, RF5 | ❌ A |
| 12 | mix-report.test: given_the_thresholds_when_read_then_the_exit_is_lower_than_the_entry_and_the_release_takes_10_frames_D89_6 | D89-6, D89-11 | ✅ (guard) |
| 13 | mix-report.test: given_entry_cells_below_and_at_the_threshold_when_stepped_then_off_then_on_in_that_same_step | D89-6 | ❌ A |
| 14 | mix-report.test: given_on_when_the_exit_cells_stay_below_the_exit_threshold_then_off_only_in_the_10th_frame_and_a_frame_at_the_exit_threshold_restarts_the_count | D89-6 | ❌ A |
| 15 | mix-report.test: given_on_when_the_slot_stops_being_eligible_then_off_at_once_and_it_needs_the_entry_threshold_again | D89-6 | ❌ A |
| 16 | mix-report.test: given_two_slots_when_one_releases_or_reset_runs_then_each_slot_keeps_its_own_state_and_reset_turns_all_off | D89-6 | ❌ A |
| 17 | fluid-canvas2d-ink.test: given_two_moving_text_elements_whose_liquids_overlap_when_rendered_then_both_report_textMixing_from_the_next_frame_and_their_atlas_text_is_drawn_at_their_dom_boxes_D89_5_D89_6 | D89-5, D89-6, res. 1, RF1 | ❌ A |
| 18 | fluid-canvas2d-ink.test: given_mixing_elements_when_rendered_then_the_atlas_text_is_masked_by_one_minus_fade_with_destination_out_and_the_ink_lies_only_where_the_liquids_mix_D89_2_D89_6 | D89-2, D89-6 | ❌ A (no scratch canvas) |
| 19 | fluid-canvas2d-ink.test: given_one_moving_element_beside_one_at_rest_when_rendered_then_no_atlas_read_no_ink_canvas_and_neither_textMixing_nor_wantsAtlas_D89_9 | D89-9 | ✅ (guard: no cost) |
| 20 | fluid-canvas2d-ink.test: given_two_moving_elements_when_rendered_then_wantsAtlas_turns_true_and_stays_and_the_page_is_read_once_per_version_D89_5 | D89-5 | ❌ A |
| 21 | fluid-canvas2d-ink.test: given_the_dragged_element_or_one_held_away_when_it_mixes_then_it_never_reports_textMixing_and_its_atlas_text_is_not_drawn_but_its_ink_feeds_the_zone_D89_3_D89_6 | D89-3, D89-6, res. 2, 3 | ❌ A |
| 22 | fluid-canvas2d-ink.test: given_a_text_less_partner_when_the_liquids_mix_then_the_text_element_reports_mixing_and_its_ink_is_diluted_review_focus_3 | D89-3, RF3 | ❌ A |
| 23 | fluid-canvas2d-ink.test: given_restAlpha_1_while_the_report_holds_when_rendered_then_textMixing_is_false_in_that_frame_and_its_atlas_text_is_not_drawn_review_focus_2 | D89-6, RF2 | ❌ A (precondition) |
| 24 | fluid-canvas2d-ink.test: given_reduced_motion_or_suppressText_while_the_report_holds_when_rendered_then_no_ink_no_atlas_text_and_textMixing_false_D89_10 | D89-10, RF6 | ❌ A (precondition) |
| 25 | fluid-canvas2d-ink.test: given_the_liquids_part_while_both_still_move_when_rendered_then_the_atlas_text_stays_for_10_frames_and_goes_in_the_11th_D89_6 | D89-6 | ❌ A |
| 25a | fluid-canvas2d-ink.test: given_thin_liquid_in_the_overlap_when_rendered_then_the_fade_is_full_but_the_ink_takes_the_liquids_edge_coverage_smoothstep_0_4_0_6_and_is_0_D89_2 | D89-2 | ❌ A (precondition) |
| 25b | fluid-canvas2d-ink.test: given_the_same_generation_paints_and_page_when_the_rest_uvs_change_then_the_per_particle_ink_is_cached_and_a_new_generation_recomputes_it_D89_2 | D89-2 | ❌ A (precondition) |
| 25c | fluid-canvas2d-ink.test: given_textOff_for_a_mixing_slot_when_rendered_then_that_slots_atlas_text_is_left_out_and_the_other_keeps_its_own_review_focus_1 | RF1, res. 14 | ❌ A (precondition) |
| 26 | ink-runtime.test: given_canvas2d_and_two_overlapping_text_elements_moving_when_frames_run_then_one_atlas_page_is_built_and_read_once_and_each_frame_holds_liquid_text_exactly_on_the_elements_whose_atlas_text_it_drew | D89-5, D89-6, res. 1, 12, RF1 | ❌ A (last frame {0, 0}) |
| 27 | ink-runtime.test: given_canvas2d_and_two_text_less_elements_moving_together_when_frames_run_then_no_atlas_page_and_no_class | D89-5 | ✅ (guard) |
| 27a | ink-runtime.test: given_canvas2d_and_no_OffscreenCanvas_when_two_text_elements_mix_then_no_atlas_page_no_class_and_todays_look_D89_5 | D89-5 | ✅ (guard) |
| 28 | ink-runtime.test: given_canvas2d_liquid_text_held_when_unobserve_runs_paused_or_running_then_the_class_goes_at_once_and_one_repaint_leaves_out_that_elements_atlas_text_and_destroy_clears_the_rest_review_focus_1 | RF1, res. 14 | ❌ A (precondition) |
| 28a | ink-runtime.test: given_webgpu_liquid_text_held_when_unobserve_runs_then_the_class_goes_and_one_repaint_leaves_out_that_elements_liquid_text_review_focus_1 | RF1, res. 14 | ❌ A (no repaint) |
| 29 | ink-runtime.test: given_canvas2d_liquid_text_held_when_a_frame_throws_then_the_class_goes_and_the_stop_repaint_draws_no_ink_and_no_atlas_text_review_focus_1 | RF1, res. 4 | ❌ A (precondition) |
| 30 | ink-runtime.test: given_canvas2d_liquid_text_held_and_the_loop_paused_when_reduced_motion_switches_on_then_the_class_goes_at_once_and_one_repaint_draws_no_atlas_text_D89_10 | D89-10, RF6 | ❌ A (precondition) |
| 31 | ink-runtime.test: given_webgpu_liquid_text_held_and_the_loop_paused_when_reduced_motion_switches_on_then_one_repaint_runs_no_text_pass_D89_10 | D89-10, RF6 | ❌ A (no repaint) |
| 32 | ink-runtime.test: given_webgpu_liquid_text_held_when_a_frame_throws_then_the_stop_repaint_runs_no_text_pass_review_focus_1 | RF1, res. 4 | ❌ A (no repaint) |
| 33 | ink-runtime.test: given_webgpu_and_two_mixing_text_elements_when_the_device_is_lost_then_the_class_goes_at_once_and_returns_under_canvas2d_once_it_draws_their_text_D89_5 | D89-5, RF1 | ❌ A |
| 34 | webgpu-ink.test: given_init_when_built_then_the_text_pipeline_writes_five_targets_in_26_bytes_per_sample_within_the_32_byte_limit_D89_7 | D89-7 | ❌ A |
| 35 | webgpu-ink.test: given_init_when_built_then_the_atlas_and_sampler_are_visible_to_the_vertex_stage_and_the_text_composite_binds_T1ink_T1mix_and_the_element_records_D89_2_D89_8 | D89-2, D89-8 | ❌ A |
| 36 | webgpu-ink.test: given_a_moving_text_element_when_rendering_then_the_text_pass_clears_T1ink_and_T1mix_at_1x_the_composite_reads_them_and_they_follow_resize_and_destroy_D89_7 | D89-7 | ❌ A |
| 37 | webgpu-ink.test: given_reduced_motion_suppressText_or_textOff_for_the_only_text_slot_when_rendering_a_moving_text_element_then_no_text_pass_and_no_text_composite_D89_10 | D89-10, RF6, res. 14 | ❌ A |
| 38 | webgpu-ink.test: given_moving_and_resting_slots_with_ids_up_to_255_when_packElements_then_EG_RANK_holds_the_dense_rank_of_the_moving_drawable_slots_in_id_order_D89_8 | D89-8, RF5 | ❌ A |
| 39 | webgpu-ink.test: given_a_capture_armed_with_mix_when_the_text_pass_runs_then_it_also_carries_the_T1mix_texels_and_each_slots_rank_and_a_plain_capture_stays_W79s_D89_4 | D89-4, res. 8 | ❌ A |
| 40 | webgpu-ink.test: given_the_shaders_when_read_then_the_text_pass_lets_text_less_liquid_in_and_samples_ink_in_the_vertex_stage_and_the_composite_fades_with_the_shared_constants_instead_of_the_D79_1_cut_D89_1_D89_3_D89_4 | D89-1, D89-3, D89-4 | ❌ A |
| 41 | ink-report.test: given_a_capture_with_T1mix_and_ranks_when_summarized_then_zone_texels_are_mixed_texels_at_or_above_the_fade_bound_and_text_and_ink_pixels_on_them_are_counted | D89-4 | ❌ A (zone 0) |
| 42 | ink-report.test: given_a_capture_without_T1mix_or_ranks_or_without_a_text_pass_when_summarized_then_an_empty_ink_report | D89-4 | ✅ (guard) |
| 43 | text-toggle.test: given_canvas2d_and_a_renderer_with_a_mixing_report_when_synced_then_the_class_follows_textMixing_not_textReady_and_reduced_motion_or_rest_still_win_D89_5 | D89-5 | ❌ A |
| A1 | webgpu-robust.spec (webgpu-hw): W79 step 5 – … where the two liquids mix no crisp text shows and the ink does … (W89, D89-4); fade bound 0.9, at rest no mixed texels | D89-4, res. 15 | ❌ A (zone in 0/90 hold frames) |
| A2 | text-runtime.test: given_canvas2d_when_a_single_element_moves_then_liquid_text_is_never_set_and_no_atlas_is_built (renamed) | D89-5 | ✅ (test-only) |
| A3 | text-toggle.test: given_canvas2d_reduced_motion_no_textReady_or_nan_rest_alpha_… (case relabelled) | D89-5 | ✅ (test-only) |
| A5 | modes.spec (canvas2d): step 8 – given print media … (message only) | D89-5 | ✅ (test-only) |
| A7 | halo.spec (canvas2d): D75-3 – given a shake … (the halo colour is checked where no liquid-text holds) | D89-1, D89-5 | ✅ (test-only; red at gold without it) |
| B1 | webgpu-renderer.test: given_successful_init_when_built_then_eleven_pipelines_… (five text targets; 13 storage, 25 buffers) | D89-7, D89-8 | ❌ A |
| B2 | webgpu-renderer.test: given_a_text_atlas_and_a_moving_element_with_an_atlas_rect_… (five attachments) | D89-7 | ❌ A |
| B3 | gpu-buffers.test: given_the_element_record_when_read_then_16_floats_64_bytes_… (EG.RANK) | D89-8 | ✅ (the stub adds RANK) |
| B4a | webgpu-shaders.test: given_TEXT_WGSL_when_read_then_it_splats_t1_and_t1w_…_skips_resting_or_unpainted_elements (renamed) | D89-3 | ✅ (test-only) |
| B4b | webgpu-shaders.test: given_TEXT_WGSL_when_read_then_f_inverse_is_norm_clamped_… (`out.acc_w = w * in.has_text;`) | D89-3 | ❌ A |
| B5 | webgpu-shaders.test: given_TEXT_COMPOSITE_WGSL_when_read_then_t1_over_t1w_is_thresholded_… (`let crisp = text * coverage;`) | D89-1 | ❌ A |
| B6 | webgpu-shaders.test: given_TEXT_COMPOSITE_WGSL_when_read_then_it_gathers_the_ids_…_and_fades_the_text_into_ink_where_two_elements_meet_D89_4 (was …_coverage_0_…) | D89-4 | ❌ A |
| E1 | ink.spec (canvas2d): W89 step 5 (canvas2d) – … the card's DOM text hides exactly while the canvas draws it (and the canvas draws none while it shows) …, the rest is pixel-identical … | D89-5, D89-6, RF1, RF2 | ❌ A (hidden 0/90) |
| E2 | ink.spec (canvas2d): W89 long hold (canvas2d) – … liquid-text never flickers | D89-6 | ❌ A (hidden 0/300) |
| E3 | ink.spec (canvas2d): W89 text-less blob (canvas2d) – … a text-less liquid counts, D89-3 | D89-3, RF3 | ❌ A (hidden 0/90) |
| E4 | ink.spec (canvas2d): W89 reduced motion (canvas2d) – … the canvas shows no card text (D89-10) | D89-10, RF6 | ❌ A (precondition) |
| G1 | webgpu-robust.spec (webgpu-hw): W89 rest (webgpu) – … pixel-identical to before the merge | RF2 | ✅ (guard) |
| G2 | webgpu-robust.spec (webgpu-hw): W89 text-less blob (webgpu) – … its liquid enters the text pass … | D89-3, RF3 | ❌ A (meets 0/90) |
| G3 | webgpu-robust.spec (webgpu-hw): W89 reduced motion (webgpu) – … the class goes at once | D89-10, RF6 | ✅ (guard; the repaint is row 31) |

**Counts.**
- Baseline (`4e741b1`): vitest `946 passed (946)`, 95 files; Playwright `--list` canvas2d 110 / webgpu 51 / webgpu-hw 102 / perf 6 / dist 2 / site 7 / record 4 / record-webgpu 4; cargo `245 passed; 0 failed; 1 ignored`.
- **Red (W89.1):** `994` tests, **`948 passed`, `46 failed`**, 101 files. Rows 2–6, 8–11, 13–18, 20–25c, 26, 28–41, 43 and B1, B2, B4b, B5, B6 fail, each on an assertion; rows 1, 7, 12, 19, 27, 27a, 42 and A2, A3, B3, B4a pass.
- **After W89:** vitest **`994 passed (994)`**, **101** files (+48 tests, +6 files); Playwright `--list` canvas2d **114** (+4, `ink.spec.ts`), webgpu-hw **105** (+3, the W89 block), the others unchanged; cargo unchanged at 245.

**Measured at W89.1 red (2026-11-03):** vitest 994 tests, 948 passed, 46 failed, 101 files, every failure an assertion. `npm run e2e:typecheck` clean. `--list`: canvas2d 114, webgpu-hw 105. canvas2d `ink.spec.ts`: E1–E4 fail on assertions (hidden 0/90, 0/300, 0/90, precondition); modes, acceptance, halo: 44 passed, 15 skipped (A4, A5, A7 green). webgpu-hw on Metal (`-g "W79 step 5|W89"`): A1 and G2 fail on assertions, G1 and G3 pass. A1 log at red: 160 frames, max mixed texels 8008, zone 0/90, Merge|card pair 90/90; per fade band worst frame (0.1–0.2, 0.2–0.5, 0.5–0.9, >= 0.9): 0, 0, 0, 0 (the zone is empty at red, so the bands are zeros until W89.3 captures T1mix).

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
Dennis' smoke at gold (W89.6 Step 7), after `wdd ward status 89 gold`:
1. `npm run dev`, `scenes/acceptance.html?renderer=webgpu`: drag Merge into the card, hold, wiggle and release. The text dissolves into ink and is crisp at rest.
2. The same with `?renderer=canvas2d`.
3. Drag a text-less element into the card (devtools: empty Merge's text).
4. System "Reduce motion" on mid-merge, with the tab paused and resumed.
5. The site's chapter 4.

## Verification
- `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green.
- Vision of acceptance step 5 and site chapter 4 in both renderers (stills and a recording), judged against the anti-goal.
- Perf within D89-9's bounds.
- No acceptance step regresses.
