# liquiddom ink (Epic 16, W89): design

Agreed with Dennis in a brainstorm on 2026-10-31 to 2026-11-02 (saga mem_20261031_07c6640a), after the throwaway spike W89.0 (branch `spike/w89-ink`, report in the W89 ward file once it exists). It is the second ward of Epic 16 "Liquid look". The W89 direction gate turns the choices below into `D89-x` decisions.

## 1. Intent

When two elements' liquids meet and mix, the text in the mixing zone dissolves like ink in water: it flows out, softens and drifts with the liquid. When the liquids separate and come to rest, the text is crisp again, exactly as today.

Why: today, under WebGPU, rule D79-1 cuts a card's text hard where another element's liquid enters it. On a light card (site chapter 4, acceptance step 5) the result reads as damage to the page: strokes and smeared fragments with a sharp edge. Under Canvas2D the DOM text simply stays put over the moving liquid, which Dennis called flat. Ink makes the same moment look intended.

What Dennis decided:
- **Only when two liquids meet.** Splash, shake, drag without contact, scroll and gravity look exactly as today, including WebGPU text tearing with its own liquid.
- **Readability is not required** while the liquids are mixed. Dissolving like ink is the point.
- **Both renderers.** WebGPU is the smoothest. Canvas2D may be coarser, and there the DOM text is hidden while the liquids mix, so the ink can take over.
- **The look is spike variant C** (ink as a splatted field), at the spike's level: the zone is a narrow band along the interface during a still hold and spreads over the moving blob during movement. Dennis judged that level right ("det er ok"); it is not to be strengthened or widened.
- **Anti-goal (Dennis' words): it must not look like pixel noise instead of ink.** Spike variant A (point dabs) is exactly that and is ruled out; so is B (dabs + blur, glowing lumps).

There is no new API and no new option. Rust, the FFI and the public API stay as Epic 15 left them; this is TypeScript/WGSL rendering only.

## 2. Look and technique (spike variant C)

The spike's evidence (contact sheets and recordings in `spike-w89-ink/spike-out/`, judged by vision) is binding for the look; the spike's code is reference only (D2) and is never copied.

- **Per-particle ink.** Each particle carries an ink colour: the mean of the premultiplied text-atlas texels over the particle's own rest cell (a spacing² square at its `rest_uv`), i.e. text colour × the fraction of that cell the glyphs cover. It changes only when the static view's generation or the atlas page changes.
- **Ink field.** The ink is splatted with the same kernel as the density, into ink channels Σw·ink alongside Σw. The ink colour at a pixel is Σw·ink / Σw × gain, multiplied by the liquid's own edge coverage. Every pixel therefore averages many particles, which is why it is as smooth as the liquid and never speckle. Spike gain: 1.2.
- **Mixing zone.** Per pixel (WebGPU texel, Canvas2D cell), from kernel-splatted sums: lo and hi are the smallest and largest element ids present, p = (Σw·id / Σw − lo) / (hi − lo), mix = 4p(1 − p), fade = smoothstep(0.03, 0.3, mix). The output text is crisp × (1 − fade) + ink × fade. Where only one element is present, mix = 0 and today's path is untouched. Spike thresholds are the starting point.
- **Return to crisp.** Nothing persists between frames. As the liquids separate, mix → 0 and the text is today's again; at rest it is pixel-identical to today (spike `*-contact-rest.png`).

## 3. WebGPU

- The ink and the Σw·id channel are extra targets of the existing text pass (spike: `rgba16float` ink + `r16float` Σw·id, 24 B per sample, within the 32 B colour-attachment limit). The atlas becomes visible to the vertex stage, where the per-particle ink is computed.
- The text composite does the mix/fade resolve. lo and hi come from W79's existing per-texel element-id gather.
- **D79-1 changes.** Its guarantee is "no pixel carries two labels". With ink, the hard cut becomes a continuous fade inside the zone. At the outer edge of a kernel overlap (fade ≈ 0 but lo < hi) the two crisp texts may overlap faintly with weight p. The spike saw no visible ghosting, but the guarantee becomes a soft one, and W79's test `mixedTextPx = 0` must be amended (approved-test change). This is a gate decision.

## 4. Canvas2D

- **Atlas and class.** Canvas2D gets the text atlas (today WebGPU-only, D74-6) and uses the existing `liquid-text` toggle to hide an element's DOM text while it mixes with another element. a11y is unchanged: the DOM text stays in the accessibility tree, as with WebGPU today. Print, forced colours and reduced motion show the DOM text as today.
- **When the DOM text hides.** The renderer reports per element whether it is mixing (spike: at least 6 grid cells at fade > 0.3 against another id, held for 10 frames), with hysteresis so the class does not flicker at the threshold. The dragged element is skipped; its label is already hidden by W78's `liquid-away`.
- **What is drawn.** While an element's DOM text is hidden, the renderer draws that element's atlas text at its home rect, masked by 1 − fade, and the ink in the zone. Outside the zone the text looks like the DOM text; inside it softens into ink. It is coarser than WebGPU (the density grid's cell size) but must never be noisy.
- **Cost must be fixed, not accepted.** The spike's Canvas2D ink cost about +21 ms per frame, all of it in the extended density splat. Production must splat ink only where it can matter (elements with atlas text whose liquid is away, i.e. restAlpha < 1) through a dedicated monomorphic path, or on a coarser ink grid. Budget: the same as W88, +2 ms at 6 elements on a quiet machine, measured interleaved against today.

## 5. Modes and edge cases

- **Reduced motion:** no ink (nothing moves and nothing mixes); the spike did not gate it, production must.
- **More than two elements in one pixel:** p is exact only for two. With three or more the formula still gives fade > 0 where they mix; the look must stay ink-like and never noisy, verified with vision.
- **Many elements:** Σw·id must keep precision for slot ids in the hundreds (r32float or ids relative to lo).
- **Light on light, bold on bold:** the spike tested white text on a dark card and a green blob. Two bold white labels meeting can glow; ink alpha may need a cap (spike suggestion ≈ 0.6). Light-on-light pairs must be checked.
- **Lost device, stop, destroy, unobserve:** the `liquid-text` class follows its existing fail-safe paths in both renderers.
- **Elements without text:** no atlas text, no ink, no cost.

## 6. Scope

In: ink in the mixing zone in both renderers; Canvas2D atlas and `liquid-text` for mixing elements; the D79-1 amendment; tests, scene check, docs.

Out (non-goals):
- Ink on splash, shake or any motion without a second element.
- Strengthening or widening the zone beyond the spike's level.
- The readability glow behind text first sketched for this ward (shelved by Dennis).
- Any Rust, FFI or public API change.
- Canvas2D text that moves with its liquid outside the mixing zone (Canvas2D's DOM text stays put, as designed).

## 7. Where it shows

Acceptance step 5 (drag Merge into the card and release) in both renderers, and the site's chapter 4 ("Grab it. Merge it."). Both re-form exactly as today. NORTH-STAR's step 5 promise "the labels never overlap" still holds in the sense that no two crisp labels overlap; whether its wording or the matrix needs a note is a gate question.

## 8. Tests and verification

- Unit: per-particle ink (colour × coverage), the mix/fade formula (0 for one element, 1 at 50/50), reduced motion off, the Canvas2D mixing report and its hysteresis, the class lifecycle, precision with large ids.
- The D79-1 test amended (approved-test change).
- e2e in both renderers: in step 5 mid-hold the zone carries ink and no crisp text overlaps; at rest the text is pixel-identical to today; no flicker of the Canvas2D class over a long hold.
- Vision on stills and a recording in both renderers, judged against the anti-goal (ink, not pixel noise).
- Perf: Canvas2D within +2 ms at 6 elements; WebGPU GPU time measured (timestamp queries where available) as well as CPU.

## 9. Answers to the builder check (2026-11-02)

Answered by the conversation:
- **Both texts feed the ink, the dragged element's too, in both renderers.** Two texts' ink may run together (Dennis accepted the playback). In step 5, Merge's label dissolving into a drifting ghost is part of the look. Its DOM label is already hidden by W78's `liquid-away`; its atlas text still feeds the ink. The Canvas2D skip in §4 is only about the DOM-hide report, not the ink.
- **A text-less liquid counts as a liquid.** "When two liquids meet" includes a blob without text. Every particle of an active element enters Σw, Σw·id and lo/hi, so mix fires at any interface between two elements. Only particles of elements with atlas text carry non-zero ink, so where a text-less blob mixes in, the card's ink is diluted, which is what ink in water does.

The author's calls (marked as such; the gate may change them):
- **Canvas2D enter and exit.** Ink is drawn only while that element's DOM text is hidden, so there is never a double image. Hiding is fast (spike thresholds, at most 2 frames), and release is slow (the 10-frame hold applies to release, with an exit threshold below the entry one). A short lag at entry is acceptable if vision shows no pop.
- **Approved tests to amend at the gate.** Besides W79's `mixedTextPx = 0`: D74-6 and the e2e "never `liquid-text` under Canvas2D", plus whatever atlas-build gating tests (D74-3) and stylesheet tests pin Canvas2D's exclusion. The plan lists each one as an approved-test change.
- **Canvas2D atlas build** is the builder's choice (eager or lazy), under two constraints: no visible hitch at the first merge, and no atlas at all for an instance whose elements have no text.
- **WebGPU attachment budget** includes the existing T1, T1w and T1id targets. If ink plus Σw·id does not fit in 32 B per sample, the builder merges or restructures targets (or adds a pass). lo/hi must stay exact, and W79's id capture must keep working.
- **Perf bounds.** Canvas2D: +2 ms at 6 elements, quiet machine, interleaved against today. A coarser ink grid (e.g. 4 px) is allowed if vision still says ink. WebGPU: at most +1 ms of GPU time at 6 elements × DPR 2 where timestamp queries exist, otherwise the CPU frame time within W88's 3.76 ms threshold.
- **Tuning freedom.** Gain, ink alpha cap and the fade thresholds may be tuned to avoid noise or glow (light-on-light, bold-on-bold, three-way mixing) without a new decision. That holds as long as the zone is not made wider or the ink stronger than the spike's look. Vision is the judge.

## 10. Spike W89.0

Answered: variant C reads as ink in both renderers; A is pixel noise, B glows, D is too faint. Open for the plan: the Canvas2D splat cost, gain/alpha tuning, light-on-light, three-way mixing, f16 precision, Canvas2D hysteresis, stress scene and landing page (large kernels, coarser grid).
