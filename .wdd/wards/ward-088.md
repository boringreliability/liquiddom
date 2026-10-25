---
ward: 88
revision: null
name: "Shadows follow the liquid"
epic: "liquid-look"
status: "red"
dependencies: [87]
layer: "typescript"
estimated_tests: 0
created: "2026-10-25"
completed: null
---
# Ward 088: Shadows follow the liquid

North star: none — W88 adds visual fidelity: the author's `box-shadow` follows the liquid. The 8 acceptance steps and the slice matrix are unchanged, and the acceptance scene has no `box-shadow`.

## Scope
First ward of Epic 16 "Liquid look" (design `docs/superpowers/specs/2026-10-24-liquiddom-shadows-design.md`, brainstorm with Dennis 2026-10-24, approved 2026-10-25). Today the stylesheet sets `box-shadow: none !important` on every `.liquid-element`, so `box-shadow: 0 0 24px cyan` on a button vanishes once it is observed. W88 keeps the author's shadow: the browser draws it at rest (pixel-exact, free), and while the element's liquid is away (`restAlpha < 1` or dragged) the new toggle class `liquid-shadow-away` hides the browser's shadow and the renderer draws the element's outer shadow layers from the liquid's shape. A splash stretches the glow with the liquid, a drag carries it, and two merged liquids share one shadow. There is no new API: the author writes CSS.

Out of scope: inset shadows in motion (they show at rest and hide in motion), borders and outlines, CSS `filter: drop-shadow()`, per-corner radii, an option to switch shadows off, any Rust, FFI or public-API change, any Linux baseline move.

## Inputs
- The shadows design (all sections) and Epic 16's file `.wdd/epics/16-liquid-look.md`.
- The toggle pattern of `away-toggle.ts` and `halo-toggle.ts`; the refcounted `classHolds(...)` in `stylesheet.ts`; the runtime's toggle order after `render()` (`syncText` → `syncAway` → `syncHalo`).
- W75's colour snapshot and triggers (`element-registry.ts`, `color.ts` incl. the W86 colour probe, `runtime.ts` `onTransitionEnd` and `colourPending`).
- `RenderFrame` / `ElementPaint` (`renderers/frame.ts`); Canvas2D's density grid (`fluid-canvas2d.ts`, `density-grid.ts`); the WebGPU passes (`webgpu-renderer.ts`, `shaders.ts`).
- Docs that say shadows are not drawn: `site/src/pages/docs/getting-started.md:44`, `site/src/pages/docs/limitations.md:14`, `packages/core/README.md:24` and `:120`.
- Baseline at `38165db`: see Specification.

## Outputs
- `snapshotShadow(el)`, `ElementPaint.shadows`, the `liquid-shadow-away` toggle and stylesheet rules, shadow drawing in Canvas2D and WebGPU.
- `demo/scenes/shadows.html` (hook `window.__shadows`), `e2e/shadows.spec.ts`, the site hero glow, corrected docs.
- Dennis' answers to D88-1 … D88-9 (and any decision the spike finds), recorded.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D88-1: The hybrid model
Proposal: the browser draws `box-shadow` at rest. `box-shadow: none` leaves the `.liquid-element` rule. While the liquid is away (`restAlpha < 1` or dragged; both renderers; never under reduced motion), the class `liquid-shadow-away` (`box-shadow: none !important`, same `@layer liquiddom` and `@media screen and (forced-colors: none)` scope) hides the browser's shadow. The class is refcounted per element across instances and cleared on unobserve, destroy, a stop and a lost device. Settled in the brainstorm (saga dec_1b99e860).
Consequence: at rest the shadow is pixel-exact and costs nothing; an observed element's shadow is now visible, so an author's existing shadow reappears (the demo landing's card shadow becomes visible at rest). A new toggle joins the post-`render()` sync, with the same lifecycle burden as `liquid-away` and the halo. Print and forced colours show the element's own shadow.
Decision: APPROVED 2026-10-25 — hybrid: browser at rest, liquid-shadow-away + renderer while the liquid is away, both renderers (saga dec_3e11178b)
Note (pre-red gate 2026-10-25, saga dec_ce23d6e2): the class follows `Renderer.shadowsDrawn(id)`, so the browser's shadow is hidden only for an element whose outer layers the renderer drew this frame (an inset-only element whenever its liquid is away); on a stop the canvas is repainted with `suppressShadows`, or reset when that repaint throws. Accepted limitation: a resting element's browser shadow paints over a neighbour's moving liquid, because the canvas sits under the page. One frame of double shadow after `unobserve` mid-motion is accepted.
Note (pre-red gate 2026-10-25, saga dec_d7b18f84): an author `transition: box-shadow` is held off while the class is written (inline `transition: none` over a style flush, only for elements whose transitions animate box-shadow); another transition running on that element at that moment jumps to its end (common with Tailwind's `transition` utility).

### D88-2: Scope of the layers
Proposal: outer layers only, at most 4 per element (more draw the first 4, documented). Inset shows at rest and hides in motion. Out of scope: borders and outlines, `filter: drop-shadow()`, per-corner radii, an opt-out option. Settled in the brainstorm (saga dec_c7b5f5d4).
Consequence: an inset shadow pops off when the liquid leaves rest and returns at the handoff; a fifth layer never draws in motion; no switch exists if the cost proves a problem (YAGNI until it does).
Decision: APPROVED 2026-10-25 — outer layers only, max 4; inset at rest only; borders, drop-shadow(), per-corner radii, opt-out out (saga dec_acefbc25)

### D88-3: Snapshot and triggers
Proposal: `snapshotShadow(el)` parses the computed `box-shadow` into `{ color, dx, dy, blur, spread, inset }` (colours through `parseCssColor` and the W86 probe, so oklch works). It runs at `observe`, on W75's own `class`/`style` triggers, on `transitionend` for `box-shadow` (the runtime's `onTransitionEnd` list grows), and on `refresh(el)`. It lifts `liquid-shadow-away` while reading, as the colour snapshot lifts `liquid-element`. `ElementPaint` gains `shadows: readonly ShadowLayer[]`, scaled by DPR in the renderer.
Consequence: a `:hover` shadow change without a transition shows the old shadow until `refresh(el)`, exactly like colours; `InternalRecord` and `ElementPaint` grow; computed values are already resolved, so `currentColor` and CSS variables reach the parser as `rgb(...)`.
Decision: APPROVED 2026-10-25 — snapshotShadow at observe, W75 triggers, transitionend box-shadow, refresh; lifts liquid-shadow-away (saga dec_a4fea5a7)

### D88-4: Draw order
Proposal: every shadow is drawn before all liquid, so no shadow lies on another element's liquid and merged liquids share their shadows. No shadow for parked (W81) or inactive elements; in container mode the container's canvas clips the shadow.
Consequence: differs from CSS, where a later element's shadow can fall on an earlier one (for liquid that would read as a dark stain); a shadow larger than the container is clipped.
Decision: APPROVED 2026-10-25 — every shadow before all liquid; none for parked or inactive elements (saga dec_c32cd7eb)

### D88-5: Canvas2D technique
Proposal: a per-element alpha mask at the density cell size, drawn once per layer with `shadowColor`/`shadowBlur`/`shadowOffset`, off-screen with the offset compensated so only the shadow lands. Spread comes from an 8-direction dilation. Then the density image is drawn as today. The spike adds the cost and a ceiling if needed.
Consequence: new per-element work for every shadowed element in motion (today every moving element shares one density grid); spread is approximated by 8 shifted draws. Spike W88.0 Q1 settles the cost, whether `shadowBlur` matches CSS blur, and whether a ceiling on layers drawn per frame is needed.
Decision: APPROVED 2026-10-25 — per-element mask with canvas shadows, 8-direction dilation for spread, no ceiling (saga dec_a36ea6f4)

### D88-6: WebGPU technique
Proposal: a half-resolution shadow splat, then a separable gaussian blur in radius buckets (proposal: 4, 8, 16, 32, 64 px, nearest bucket; one target and blur per bucket used in the frame). It is composited under the liquid in the screen pass.
Consequence: a blur radius is rounded to its nearest bucket (a size error or banding is possible); each bucket in use costs a target and two blur passes per frame. Spike W88.0 Q2 sets the buckets, the target scale (a quarter resolution for large buckets is tried) and the cost.
Decision: AMENDED 2026-10-25 — exact blur radii grouped per distinct value, half res (quarter for blur ≥ 32 px), scissored; buckets {4, 8, 16, 32, 64} only as overflow past about 6 distinct radii per frame (saga dec_8c14c096)
Note (pre-red gate 2026-10-25, saga dec_ce23d6e2): WebGPU draws at most 16 density sources per frame (4 channels × 4 layers); an element past the cap draws no renderer shadow and keeps its browser shadow static at the DOM box while its liquid moves. Canvas2D has no cap.

### D88-7: The handoff
Proposal: the class goes in the frame `restAlpha` reaches 1, and the browser takes over. The renderer's shadow in that frame comes from box-shaped liquid. Alternative if Q3 shows a visible jump: cross-fade the renderer's shadow out over the rest fade.
Consequence: a small jump in size, darkness or offset is possible at the handoff, or a gap or double frame; the cross-fade removes it but needs the browser's shadow to fade in (a scratch opacity) and more renderer state. Spike W88.0 Q3 measures it in both renderers.
Decision: APPROVED 2026-10-25 — instant handoff when restAlpha reaches 1; no cross-fade (saga dec_90ce2674)
Note (pre-red gate 2026-10-25, saga dec_d7b18f84): the handoff holds the author's box-shadow transition off at the class write, so the browser's shadow appears and goes at once (no fade, no double shadow, no gap).

### D88-8: Scene, site and docs
Proposal: a new `demo/scenes/shadows.html` (drop shadow, multi-layer glow, spread, inset; hook `window.__shadows`; RAF by default, `?clock=manual`, `?renderer`). The site hero pills and drops get a CSS glow. Corrections in `getting-started.md:44`, `limitations.md:14` and `packages/core/README.md:24`/`:120`.
Consequence: no Linux baseline moves (the acceptance scene has no `box-shadow`); the demo landing's card shadow becomes visible at rest (that page has no baseline); the README lines are not named in the design but need the same correction.
Decision: APPROVED 2026-10-25 — shadows scene, site hero glow, four docs corrections; no baseline moves (saga dec_30400751)

### D88-9: The gate covers Epic 16
Proposal: `wdd-docs.test.ts` `discoverFluidWards` also takes `epic: "liquid-look"` wards (renamed `discoverGatedWards`), so W88 gets the North-star, Decisions and PENDING guards.
Consequence: this changes an approved test, so it is flagged to Dennis at the gate; without it a W88 with `epic: "liquid-look"` escapes the guards, because discovery keeps only `epic: "fluid-engine"` wards.
Decision: APPROVED 2026-10-25 — the wdd-docs gate also discovers epic liquid-look wards (approved-test change) (saga dec_133bcc13)

### D88-10: Knockout under the element's own liquid
Proposal: the renderer masks each element's shadow by the inverse of that element's own liquid coverage, so a hole or tear in the liquid shows the page and not the shadow. WebGPU masks with the composite's coverage; Canvas2D uses a `destination-out` of the mask (or a per-element composite operation) before the shadow lands. Alternative: accept it as "the liquid is translucent at a tear" and document it.
Consequence: matches CSS, which never paints a `box-shadow` under its own box; spike W88.0 showed grey and cyan flecks inside holes and torn text. It costs one more pass or composite operation, and it was not measured in the spike. Merged liquids still share their shadows outside both.
Decision: AMENDED 2026-10-25 — knockout by the closed own coverage: holes narrower than ≈ 3 kernel radii show the page, wider holes show the shadow on their rim (saga dec_733f4b98)

### D88-11: WebGPU pass structure
Proposal:
- Splat each shadowed element's density once, without an offset. Apply each layer's offset in the resolve, by sampling at uv − offset.
- Resolve all layers of a radius group in one pass, as scissored per-element quads.
- Spread uses the mass-scaled, widened kernel, with one density per distinct spread (most layers have 0).
- Scissor every pass to the bounds, and use a quarter-resolution target for blur ≥ 32 px.
Consequence: spike W88.0 showed that the GPU cost is the pass count (two full-target passes per layer, two blur passes per group), not the blur taps. About 2 + 2·groups passes instead of 2·layers + 2·groups. Not measured in the spike.
Decision: APPROVED 2026-10-25 — one density splat per element, offset in the resolve, one resolve pass per radius group, scissored (saga dec_0dba6795)
Note (pre-red gate 2026-10-25, saga dec_ce23d6e2): the six shadow pipelines (and their five shader modules) are built at init in the liquid's validation scope; the shadow targets are created on first use.

### D88-12: Canvas2D spread without blur
Proposal: give a spread layer with blur 0 a `shadowBlur` floor of one density cell (2–2.7 px), or dilate in 16 directions instead of 8.
Consequence: the spike's 8-direction dilation of the 2 px mask leaves a visibly bumpy fringe (controller vision 2026-10-25). The floor softens a hard CSS edge by about one cell. The mass-widened splat is not an option on the CPU (+4 … +8 ms).
Decision: APPROVED 2026-10-25 — shadowBlur floor of one density cell for spread layers (saga dec_30e72f80)

### D88-13: The liquid composite blends OVER
Proposal: the WebGPU liquid composite pipeline gets `OVER_BLEND`, so the shadows drawn before it in the screen pass survive (today it has no blend and replaces the target).
Consequence: bit-identical where no shadow lies underneath, because the composite writes premultiplied 0 outside the liquid. It changes an approved pipeline, so it is flagged at the gate; no baseline moves.
Decision: APPROVED 2026-10-25 — the liquid composite blends OVER (approved-test change) (saga dec_793867f6)

### D88-14: Canvas2D shadows are scaled by the DPR in the renderer
Proposal: the renderer multiplies `shadowBlur` and `shadowOffsetX/Y`, including the off-canvas compensation offset, by the DPR, because canvas shadows ignore `setTransform`. A fake-canvas test pins it. This is a fact pinned by a test, not a choice.
Consequence: without the scaling, a DPR 2 shadow is half as blurred and half as offset as the CSS one. With it, spike W88.0 matched CSS blur within about 5 %.
Decision: APPROVED 2026-10-25 — the renderer scales shadowBlur and offsets by the DPR, test-pinned (saga dec_668a8f0c)

## Spike W88.0 result

Throwaway copy of `b921313` in `$S/w88spike/` (Vite :4188), deleted after recording (D2). Report: `.superpowers/sdd/W88/spike-W88.0-report.md`.

**Machine:** Apple M4 Pro (14 CPU cores, 20-core GPU, Metal 4; WebGPU adapter `apple`/`metal-3`, `timestamp-query`); Playwright Chromium new headless, HeadlessChrome 153; 1280×800 at DPR 1 and 2; RAF at 60 Hz.

**Setup:**
- Twelve 140×48 pills, all moving: `splash(1)` every 30 frames, 600 measured frames, 12000 particles.
- The first n pills carry the shadows. 1 layer = `0 8px 20px rgba(0,0,0,.4)`; 3 layers = that plus `0 0 12px 2px cyan, 0 0 32px 8px rgba(0,255,255,.5)`.
- The baseline is the same page without shadows.

### Q1: Canvas2D mask cost (D88-5)
The table shows the CPU time of `render()`, p95 in ms, as the change from the baseline (6.75 ms at DPR 1, 6.66 ms at DPR 2). Frame interval p95 was 17.1–18.5 ms in every run: no dropped frames.

| DPR | layers | 1 el | 3 el | 6 el | 12 el |
|---|---|---|---|---|---|
| 1 | 1 | +0.16 | +0.45 | +0.75 | +1.64 |
| 1 | 3 | +0.13 | +0.57 | +0.96 | +1.99 |
| 2 | 1 | +0.37 | +0.58 | +0.99 | +1.84 |
| 2 | 3 | +0.14 | +0.63 | +0.93 | +2.11 |

- **Does `shadowBlur` match CSS blur?** Yes, once blur and offsets are scaled by the DPR (D88-14). At DPR 2, rest, browser against renderer:
  - drop: extent 17.0/17.0 px to the side, 27.5/27.0 px below;
  - glow: 32.5/32.0 and 35.5/35.0 px;
  - spread: 6.0/6.0 and 10.0/12.0 px;
  - energy ratio 0.95–1.01.
- **Spread variant (mass-widened splat):** +4.1 ms at 6×3 and +8.2 … +8.6 ms at 12×3 (frame interval p95 28 ms). Rejected.
- **Vision** (controller vision 2026-10-25 agrees): the drop and the glow match the browser at rest on the dark and the light page. Mid-splash the shadows follow the deformed liquid in both renderers. Holes show the shadow (D88-10). The spread fringe is clearly bumpy (D88-12).

### Q2: WebGPU blur and buckets (D88-6)
Raw Metal timestamps are dominated by the GPU's clock and power state: the same work reads 2–10 ms. The shadow passes were therefore encoded 10× per frame and the time divided by 10. The table shows GPU ms per frame of shadows at DPR 2; the baseline liquid itself is 2.84 ms. CPU encode was 0.33–0.46 ms in every run, and there were no dropped frames at 1×.

| Variant | 1 el × 1 | 6 el × 3 | 12 el × 3 |
|---|---|---|---|
| Buckets, half res | 0.76 | 3.12 | 4.20 |
| Exact radii, half res | 0.92 | 3.76 | 4.87 |
| Buckets, quarter res for blur ≥ 32 | 0.76 | 1.62 | 2.16 |
| Buckets, half res, scissored | 0.67 | 1.88 | 3.03 |

Shadow energy of the renderer relative to the browser (light page, DPR 2). The exact column's ≈ 0.95 floor is the ring metric itself (the labels differ).

| Blur | Bucket (log-nearest) | Buckets | Exact | Canvas2D |
|---|---|---|---|---|
| 12 | 16 | 1.30 | 0.95 | 0.91 |
| 20 | 16 | 0.74 | 0.95 | 0.94 |
| 40 | 32 | 0.75 | 0.95 | 0.96 |

- **Vision** (controller vision 2026-10-25 agrees): the exact radii cannot be told from the browser at 12, 20 and 40 px. Bucketed shadows are visibly the wrong size side by side: 12 is too wide, 20 and 40 are too tight. No banding in any variant. Quarter resolution for 40 px looks the same as half resolution.

### Q3: The handoff (D88-7)
Manual clock, `splash(0.5)` on the drop and glow pills. `restAlpha` reaches 1 at frame N = 131. The table shows the mean absolute pixel difference over the shadow ring (RGB, 0–255) and the ring's shadow energy at N−1 relative to the browser's at N. The ring is ≈ 80 % background, so the ratio to the neighbouring steps is what matters.

| Run | Pill | Diff N−1 → N | Other steps (median / max) | Energy N−1 / N |
|---|---|---|---|---|
| Canvas2D, light | drop / glow | 0.165 / 0.374 | 0.006 / ≤ 0.096 | 1.010 / 1.028 |
| Canvas2D, dark | drop / glow | 0.014 / 0.621 | ≤ 0.011 / ≤ 0.159 | 1.003 / 1.029 |
| WebGPU buckets, light | drop / glow | 0.937 / 0.704 | 0.004 / ≤ 0.020 | 0.853 / 1.060 |
| WebGPU buckets, dark | drop / glow | 0.088 / 1.168 | ≤ 0.006 / ≤ 0.035 | 0.932 / 1.060 |
| Cross-fade, light, both renderers | drop / glow | 0.07 / 0.17 (N−2 → N−1: 0.17–0.22) | — | 0.99 / 0.98 |
| Cross-fade, dark, both renderers | drop / glow | 0.017 / 0.258 (N−2 → N−1: 0.04 / 0.30–0.35) | — | 0.98 |

- **Vision** (controller vision 2026-10-25 agrees): no gap frame and no double frame in any run. Canvas2D shows no visible jump. In WebGPU with buckets the step is subtle but visible: the drop shadow grows at N, the glow shrinks a little. The cross-fade is smooth.

### Recommendations
- **D88-5:** keep the per-element mask at the density cell, drawn per layer with `shadowBlur`·dpr and an off-canvas compensated `shadowOffset`·dpr. **No ceiling:** +0.75 … +0.99 ms at 6 elements, ≈ +2 ms at 12×3. Spread uses the 8-direction dilation plus the D88-12 fringe fix; the mass-widened splat is never used on the CPU.
- **D88-6:**
  - Half resolution, and quarter resolution for blur ≥ 32 px.
  - **Exact radii, grouped per distinct value** and scissored to the bounds. The {4, 8, 16, 32, 64} buckets are only an overflow, past ≈ 6 distinct radii per frame.
  - Restructure the passes per D88-11: the cost is the pass count, not the blur taps.
- **D88-7:** **instant handoff**; no cross-fade. There is no gap or double frame. Canvas2D's step is 1–3 % and invisible. WebGPU's visible step comes from the buckets, and exact radii (D88-6) remove it. The cross-fade would need a per-element alpha hook in the author's CSS, and it shows both shadows while `restAlpha` bounces.

### New decision candidates
- **D88-10:** knockout under the element's own liquid. Holes and tears show the shadow today.
- **D88-11:** WebGPU pass structure: one density splat per element, one resolve pass per group, scissoring, quarter resolution for large blurs.
- **D88-12:** Canvas2D spread without blur: a blur floor of one cell, or 16 directions.
- **D88-13:** the liquid composite blends OVER. It changes an approved pipeline.
- **D88-14:** the DPR scaling of canvas shadow blur and offsets. A fact pinned by a test, not a choice.

### Open points (not measured in the time box)
- The handoff with exact radii in WebGPU.
- Quarter resolution and scissoring combined.
- The D88-11 pass structure.
- The D88-10 knockout and its cost.
- The non-monotonic `restAlpha` before rest (0.14 → 0.97 → 0.83 → 1 between frames 114 and 131). The class toggles more than once in that window, and each toggle is a full renderer ↔ browser switch. Nothing was visible in the spike; the gold e2e should look at that window.
- The GPU costs come from the M4 Pro only. The Canvas2D numbers are CPU time only: Chrome rasterises `shadowBlur` on the GPU out of band.

## Specification
**Baseline at `38165db`:** measured 2026-10-25 after `npm run build:wasm` and `npm run build -w liquiddom` (W87 complete, only docs changed since): cargo `245 passed; 0 failed; 1 ignored` (the doc-test line is 0 passed); vitest `870 passed (870)`, 88 files; Playwright `--list` canvas2d 101 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2 / site 7 / record 4 / record-webgpu 4. These equal the survey's counts.

**Architecture:** one new pure module reads the author's shadow (`shadow.ts`: the parser, the outer-layer cap, `snapshotShadow`, and `liquidAway`, the one "the liquid is away" rule that the toggle and both renderers share). The registry snapshots the shadow wherever it snapshots colours, and the paints carry the outer layers (`ElementPaint.shadows`). The renderers draw a shadow for every painted, active element with outer layers whose liquid is away (`renderers/shadow-plan.ts` `ShadowCasters`, shared), before all liquid, knocked out by the casters' own closed coverage, and report what they drew (`Renderer.shadowsDrawn(id)`). After `render()` the runtime's fourth toggle (`shadow-toggle.ts`, the W74/W75/W78 pattern) holds `liquid-shadow-away` exactly on the elements whose shadow the renderer drew this frame (plus inset-only elements in motion), so the browser's shadow and the renderer's swap in the same frame (D88-7) and never both show or both hide. Canvas2D draws per caster a cell-resolution alpha mask with canvas shadows (`renderers/shadow-canvas2d.ts`); WebGPU splats one density per source into channels of a half-resolution density array and resolves, blurs and accumulates per exact radius group (`renderers/webgpu/shadow-passes.ts`, five new WGSL shaders). Rust, the FFI and the public API are untouched.

Design resolutions (plan Part 2, presented and approved at the pre-red gate 2026-10-25): (1) the class follows `Renderer.shadowsDrawn(id)`; (2) one `liquidAway` rule; (3) the knockout is the closed own coverage (D88-10 amended, `KNOCKOUT_CLOSE_PER_KERNEL` 1.5); (4) a stopped instance repaints once with `suppressShadows`, or resets the canvas bitmap; (5) a shadow-only re-read on `transitionend` for `box-shadow` (`registry.refreshShadow`); (6) WebGPU density channels, four sources per layer and at most 16 sources per frame (an element past the cap draws no renderer shadow and keeps its static browser shadow); (7) the shadow pipelines are built at init in the liquid validation scope; (8) spread by 8 shifted copies in Canvas2D, by a widened mass-scaled kernel in WebGPU; (9) six approved tests change (stylesheet.test box-shadow pin, wdd-docs discovery, webgpu-renderer counts and OVER blend, element-observer OWN_CLASSES, auto-renderer and webgpu-lifecycle pipeline counts); (10) toggle order `syncText, syncAway, syncHalo, syncShadow`; (11) the scene `demo/scenes/shadows.html` lands in red; (12) an author `transition: box-shadow` is held off while the class is written (inline `transition: none` over a style flush; another running transition on that element jumps to its end); accepted limitations: (13) a resting element browser shadow paints over a neighbour moving liquid, (14) one frame of double shadow after `unobserve` mid-motion, (15) CSS layer order across radius groups is approximate.

Counts: baseline (`38165db`) vitest 870 passed, 88 files; Playwright canvas2d 101 / webgpu-hw 99. Red (W88.1): 933 tests, 867 passed, 66 failed. After W88: vitest 933 passed, 94 files (+63 tests); canvas2d 110 (+9), webgpu-hw 102 (+3); cargo unchanged.

## Tests
Red results measured at W88.1 on this worktree (2026-10-25). **A** = an assertion fails. **T** = a TypeError on a result the stub does not produce. **S** = `vi.spyOn` on a method the registry does not have yet (`refreshShadow`, added in W88.2).

| # | Test (file: name) | Verifies | Red | Gold |
|---|---|---|---|---|
| 1 | shadow.test: given_a_computed_value_with_two_layers_when_parsed_then_colour_offsets_blur_spread_and_inset_in_css_order | D88-3 | ❌ A (stub `[]`) | ✅ |
| 2 | shadow.test: given_none_empty_or_garbage_when_parsed_then_no_layers | D88-3 | ✅ (the stub returns `[]`) | ✅ |
| 3 | shadow.test: given_the_specified_form_with_lengths_first_unitless_zero_and_short_alpha_when_parsed_then_the_same_layer_as_the_computed_form | D88-3, jsdom | ❌ A | ✅ |
| 4 | shadow.test: given_an_oklch_layer_when_parsed_then_its_colour_comes_from_the_W86_colour_probe | D88-3 | ❌ A | ✅ |
| 5 | shadow.test: given_a_transparent_or_unreadable_layer_among_others_when_parsed_then_only_that_layer_is_dropped | D88-3 | ❌ A | ✅ |
| 6 | shadow.test: given_zero_blur_and_negative_spread_when_parsed_then_both_are_kept | D88-3 | ❌ A | ✅ |
| 7 | shadow.test: given_six_layers_with_two_inset_when_outerShadows_then_the_first_four_outer_layers_and_the_same_array_twice_D88_2 | D88-2 | ❌ A | ✅ |
| 8 | shadow.test: given_an_element_holding_liquid_shadow_away_when_snapshotted_then_the_author_shadow_is_read_and_class_and_style_are_restored_exactly | D88-3 lift, RF2 | ❌ A | ✅ |
| 9 | shadow.test: given_currentColor_resolved_by_the_browser_when_snapshotted_then_the_layer_carries_the_text_colour_review_focus_5 | RF5 | ❌ A | ✅ |
| 10 | shadow.test: given_restAlpha_and_interaction_when_asked_then_away_below_1_or_dragged_never_under_reduced_motion_and_nan_is_rest | D88-1, res. 2 | ❌ A | ✅ |
| 11 | stylesheet.test (approved-test change (i)): given_css_text_when_read_then_paint_and_stacking_scoped_to_screen_without_forced_colors_and_print_and_forced_colors_hide_canvas | D88-1 | ❌ A (box-shadow still in the rule) | ✅ |
| 12 | stylesheet.test: given_css_text_when_read_then_liquid_shadow_away_hides_the_box_shadow_in_the_layer_and_the_screen_block_only | D88-1 | ❌ A | ✅ |
| 13 | stylesheet.test: given_two_holders_when_addShadowAwayClass_twice_and_removeShadowAwayClass_once_then_the_class_stays_until_the_last_release_and_an_authors_own_class_is_kept | D88-1 | ❌ A | ✅ |
| 13a | stylesheet.test: given_computed_transitions_when_asked_then_runsBoxShadowTransition_is_true_only_for_all_or_box_shadow_with_a_duration_resolution_12 | res. 12 | ❌ A (stub false) | ✅ |
| 13b | stylesheet.test: given_an_element_with_a_box_shadow_transition_when_the_shadow_class_is_added_and_removed_then_each_write_holds_inline_transition_none_and_the_style_attribute_is_restored_exactly_resolution_12 | res. 12, RF10 | ❌ A | ✅ |
| 14 | element-observer.test (approved-test change (iv)): given_only_liquiddom_class_toggles_when_drained_then_no_entry_and_authorClasses_drops_own_classes_RF2 | D88-1, RF9 | ❌ A | ✅ |
| 15 | shadow-toggle.test: given_a_moving_element_whose_outer_shadow_the_renderer_drew_when_synced_then_the_class_once_and_off_in_the_frame_restAlpha_reaches_1 | D88-1, D88-7 | ❌ A | ✅ |
| 16 | shadow-toggle.test: given_outer_layers_the_renderer_did_not_draw_or_no_renderer_when_synced_then_no_class_and_an_existing_hold_is_withdrawn | res. 1, RF8 | ❌ A | ✅ |
| 17 | shadow-toggle.test: given_an_inset_only_element_whose_liquid_is_away_when_synced_then_the_class_hides_the_inset_D88_2 | D88-2 | ❌ A | ✅ |
| 18 | shadow-toggle.test: given_a_dragged_element_at_restAlpha_1_when_synced_then_the_class_D88_1 | D88-1 | ❌ A | ✅ |
| 19 | shadow-toggle.test: given_reduced_motion_or_a_nan_restAlpha_when_synced_then_no_class_and_an_existing_hold_is_withdrawn | D88-1 | ❌ A | ✅ |
| 20 | shadow-toggle.test: given_two_instances_holding_one_element_when_one_releases_then_the_class_stays_until_both_release_review_focus_3 | RF3 | ❌ A | ✅ |
| 21 | shadow-toggle.test: given_clearShadowClasses_or_a_missed_release_when_called_then_this_instance_lets_go | D88-1 | ❌ A | ✅ |
| 22 | shadow-runtime.test: given_an_observed_element_with_an_outer_and_an_inset_layer_when_a_frame_runs_then_the_paint_carries_the_outer_layer_and_shadowLayers_both | D88-2, D88-3 | ❌ A | ✅ |
| 23 | shadow-runtime.test: given_canvas2d_and_a_moving_shadowed_element_when_frames_run_then_the_class_follows_each_render_and_goes_in_the_frame_restAlpha_reaches_1 | D88-7, res. 10 | ❌ A | ✅ |
| 24 | shadow-runtime.test: given_the_class_toggling_every_frame_for_60_frames_when_they_run_then_no_colour_or_shadow_re_read_and_no_atlas_invalidation | RF9 | ❌ S | ✅ |
| 25 | shadow-runtime.test: given_a_box_shadow_transitionend_on_the_element_when_the_next_frame_runs_then_only_the_shadow_is_re_read_and_the_paint_carries_it | D88-3, res. 5 | ❌ S | ✅ |
| 26 | shadow-runtime.test: given_a_shadow_change_without_a_transition_or_mutation_when_frames_run_then_the_old_shadow_until_refresh_and_a_refresh_mid_motion_reads_the_author_shadow_not_none_review_focus_2 | RF2 | ❌ A | ✅ |
| 27 | shadow-runtime.test: given_an_own_class_change_when_the_next_frame_runs_then_the_shadow_is_re_read_with_the_colours | D88-3 | ❌ A | ✅ |
| 27a | shadow-runtime.test: given_an_own_style_change_when_the_next_frame_runs_then_the_shadow_is_re_read | D88-3 | ❌ A | ✅ |
| 28 | shadow-runtime.test: given_the_class_held_when_unobserve_then_destroy_run_then_it_is_gone_each_time | D88-1 | ❌ A | ✅ |
| 29 | shadow-runtime.test: given_the_class_held_when_reduced_motion_switches_on_then_it_goes_at_once_and_the_next_frame_draws_no_shadow | D88-1, res. 4, RF1 | ❌ A | ✅ |
| 30 | shadow-runtime.test: given_the_class_held_when_a_frame_throws_then_the_instance_stops_the_canvas_is_repainted_without_shadows_and_the_class_goes_review_focus_1 | RF1 | ❌ A | ✅ |
| 31 | shadow-runtime.test: given_the_stop_repaint_itself_throws_when_the_instance_stops_then_the_canvas_bitmap_is_reset_and_still_one_console_error | RF1 | ❌ A | ✅ |
| 32 | shadow-runtime.test: given_webgpu_and_the_class_held_when_the_device_is_lost_then_the_class_goes_at_once_and_returns_under_the_canvas2d_rebuild | D88-1, RF8 | ❌ A | ✅ |
| 33 | shadow-runtime.test: given_two_instances_observing_one_element_when_one_moves_then_one_hold_and_the_class_stays_until_the_last_moving_instance_releases_review_focus_3 | RF3 | ❌ A | ✅ |
| 34 | shadow-canvas2d.test: given_a_moving_element_with_one_layer_when_rendered_then_its_shadow_is_drawn_before_the_density_image_with_the_css_colour_blur_and_offset | D88-4, D88-5 | ❌ A | ✅ |
| 35 | shadow-canvas2d.test: given_the_mask_drawn_off_the_canvas_when_rendered_then_the_source_lies_left_of_x_0_and_the_offset_brings_the_shadow_back_to_the_mask_D88_5 | D88-5 | ❌ T | ✅ |
| 36 | shadow-canvas2d.test: given_dpr_2_when_rendered_then_shadowBlur_and_both_offsets_including_the_off_canvas_compensation_are_scaled_by_the_dpr_D88_14 | D88-14 | ❌ T | ✅ |
| 37 | shadow-canvas2d.test: given_three_layers_when_rendered_then_one_shadow_draw_per_layer_with_the_last_css_layer_first | D88-5 | ❌ A | ✅ |
| 38 | shadow-canvas2d.test: given_a_spread_layer_with_blur_0_when_rendered_then_an_8_direction_dilation_and_a_shadowBlur_floor_of_one_cell_D88_5_D88_12 | D88-5, D88-12 | ❌ T | ✅ |
| 39 | shadow-canvas2d.test: given_a_negative_spread_when_rendered_then_the_8_shifted_copies_erode_the_mask_with_destination_in | D88-5, res. 8 | ❌ T | ✅ |
| 40 | shadow-canvas2d.test: given_shadows_when_rendered_then_one_destination_out_draw_of_the_knockout_image_follows_the_shadows_and_precedes_the_density_image | D88-10 | ❌ A | ✅ |
| 41 | shadow-canvas2d.test: given_a_hole_in_the_liquid_when_rendered_then_the_mask_shows_the_hole_and_the_knockout_closes_it_while_the_page_beside_the_liquid_stays_clear | D88-10, res. 3 | ❌ T | ✅ |
| 42 | shadow-canvas2d.test: given_rest_parked_inactive_reduced_motion_suppressed_or_no_layers_when_rendered_then_no_shadow_draw_no_knockout_and_shadowsDrawn_false | D88-4 | ❌ A | ✅ |
| 43 | shadow-canvas2d.test: given_two_elements_and_a_dragged_one_at_rest_when_rendered_then_shadowsDrawn_is_true_exactly_for_the_casters_of_the_last_render | res. 1, D88-1 | ❌ A | ✅ |
| 44 | shadow-canvas2d.test: given_a_small_container_canvas_and_a_large_blur_partly_outside_it_when_rendered_then_no_throw_and_the_shadow_is_drawn_for_the_canvas_to_clip_review_focus_4 | RF4 | ❌ A | ✅ |
| 45 | shadow-plan.test: given_moving_resting_parked_inactive_dragged_and_shadowless_elements_when_collected_then_only_moving_or_dragged_active_elements_with_layers_with_their_particles_and_bounds | D88-4 | ❌ A | ✅ |
| 46 | shadow-plan.test: given_layers_with_three_distinct_blurs_on_two_elements_when_planned_then_three_exact_groups_one_record_per_layer_last_css_layer_first_and_offsets_in_the_records | D88-6, D88-11 | ❌ A | ✅ |
| 47 | shadow-plan.test: given_a_blur_at_or_above_32_px_when_planned_then_its_group_uses_the_quarter_resolution_targets | D88-6 | ❌ A | ✅ |
| 48 | shadow-plan.test: given_eight_distinct_blurs_when_planned_then_the_first_six_stay_exact_and_the_rest_join_their_log_nearest_bucket_D88_6 | D88-6 | ❌ A | ✅ |
| 49 | shadow-plan.test: given_layers_with_different_spreads_on_one_element_when_planned_then_one_density_source_per_distinct_spread_with_spread_0_first | D88-11 | ❌ A | ✅ |
| 50 | shadow-plan.test: given_more_density_sources_than_four_layers_hold_when_planned_then_whole_elements_that_do_not_fit_are_not_drawn | res. 6 | ❌ A | ✅ |
| 51 | shadow-plan.test: given_a_spread_when_its_kernel_is_widened_and_mass_scaled_then_a_half_plane_of_particles_reads_density_0_5_at_the_spread_distance | D88-11, res. 8 | ❌ A | ✅ |
| 52 | webgpu-shadows.test: given_init_when_built_then_six_shadow_pipelines_in_the_liquids_validation_scope_and_the_liquid_composite_blends_over | D88-11, D88-13 | ❌ A | ✅ |
| 53 | webgpu-shadows.test: given_one_moving_element_with_one_layer_when_rendering_then_density_resolve_blur_h_blur_v_and_knockout_run_between_the_splat_and_the_screen_pass_whose_first_draw_is_the_shadow_composite | D88-4, D88-11 | ❌ A | ✅ |
| 54 | webgpu-shadows.test: given_the_blur_pass_records_when_written_then_sigma_is_blur_over_2_in_target_px_and_the_taps_reach_3_sigma | D88-6 | ❌ T | ✅ |
| 55 | webgpu-shadows.test: given_two_elements_with_the_same_blur_when_rendering_then_one_resolve_pass_draws_both_quads | D88-11 | ❌ A | ✅ |
| 56 | webgpu-shadows.test: given_a_blur_of_40_px_when_rendering_then_its_resolve_blur_and_accumulator_targets_are_quarter_resolution | D88-6 | ❌ T | ✅ |
| 57 | webgpu-shadows.test: given_an_element_at_the_canvas_edge_with_a_far_offset_and_a_large_blur_when_rendering_then_every_scissor_is_clamped_inside_its_attachment_review_focus_4 | RF4 | ❌ A | ✅ |
| 58 | webgpu-shadows.test: given_a_spread_layer_when_rendering_then_its_own_density_source_and_a_knockout_mask_on_the_spread_0_channel_only | D88-10, D88-11 | ❌ T | ✅ |
| 59 | webgpu-shadows.test: given_a_moving_element_without_shadows_or_a_resting_one_when_rendering_then_no_shadow_pass_texture_or_buffer_and_the_screen_pass_starts_with_the_liquid_composite | D88-13 (bit-identical) | ❌ T | ✅ |
| 60 | webgpu-shadows.test: given_a_dragged_element_at_restAlpha_1_when_rendering_then_its_shadow_passes_run_D88_1 | D88-1 | ❌ A | ✅ |
| 61 | webgpu-shadows.test: given_shadows_drawn_when_resized_lost_or_destroyed_then_the_targets_are_rebuilt_at_the_new_size_shadowsDrawn_turns_false_and_nothing_is_left_or_flagged | res. 6, RF8 | ❌ A | ✅ |
| 62 | webgpu-renderer.test (approved-test change (iii)): given_successful_init_when_built_then_eleven_pipelines_with_explicit_layouts_inside_one_validation_error_scope_D71_3_D74_4_D88_11 (renamed from `…five_pipelines…_D74_4`) | D88-11, D88-13 | ❌ A | ✅ |
| 63 | auto-renderer.test (approved-test change (v)): given_renderer_webgpu_available_when_create_then_activeRenderer_webgpu_the_liquid_pipelines_exist_and_no_warning_D71_2 | D88-11 | ❌ A | ✅ |
| 64 | webgpu-lifecycle.test (approved-test change (vi)): given_a_working_surface_when_init_then_exactly_two_balanced_validation_scopes_the_surface_scope_first_and_no_error | D88-11 | ❌ A | ✅ |
| 65 | wdd-docs (approved-test change (ii)): the gate guards iterate GATED_WARDS; discovery test uses discoverGatedWards | D88-9 | ✅ (a test-only change) | ✅ |
| 66 | wdd-docs: given_wards_dir_when_scanned_then_the_gated_wards_hold_every_fluid_engine_ward_and_the_liquid_look_ward_88_D88_9 | D88-9 | ✅ | ✅ |
| E1 | shadows.spec: E1 D88-1 – given the scene at rest when screenshotted then each element's own box-shadow shows around it, no element holds liquid-shadow-away and the canvas draws no shadow | D88-1 | ❌ ring energy 0 | ✅ |
| E2 | shadows.spec: E2 D88-1, D88-5 – given a splash on Drop and Glow when mid-splash then both hold the class, the browser's shadow is off and the canvas's shadow follows the deformed liquid | D88-1, D88-5 | ❌ class false | ✅ |
| E3 | shadows.spec: E3 D88-7 – given a soft splash on Drop and on Glow when they come to rest then the class follows restAlpha frame by frame and the ring never shows a gap or a double shadow | D88-7, RF6 | ❌ f120 restAlpha 0.833, class false | ✅ |
| E4 | shadows.spec: E4 D88-2 – given a splash on the inset card when mid-splash then its inset shadow hides with the class and returns at rest | D88-2 | ❌ inset `none` at rest | ✅ |
| E5 | shadows.spec: E5 D88-3 – given a currentColor glow when the scene loads then the snapshot holds the element's text colour (Review Focus 5) | RF5 | ❌ `[]` | ✅ |
| E6 | shadows.spec: E6 reduced motion – given ?rm=1 when every element is splashed then nothing holds the class and the browser's drop shadow stays as it was | D88-1 | ❌ no browser shadow (NaN) | ✅ |
| E7 | shadows.spec: E7 print – given Drop mid-splash when print is emulated then its own box-shadow is back (the class rule is screen-only) and the canvas is hidden | D88-1 | ❌ class false | ✅ |
| E8 | shadows.spec: E8 D88-10 – given the translucent Glass pill with a black glow mid-splash when its liquid is read then no shadow lies under its own liquid (the knockout) | D88-10 | ❌ class false | ✅ |
| E9 | shadows.spec: E9 resolution 12 – given Fade with an author transition: box-shadow 0.3s when it splashes and comes to rest then its browser shadow goes and comes back at once (no fade: no double shadow, no gap) and no transitionend loop | res. 12, RF10 | ❌ class false | ✅ |
| E2w, E3w, E8w | webgpu-robust.spec, W88 block (webgpu-hw only): the WebGPU twins of E2, E3 (exact radii, RF7) and E8 | D88-6, D88-7, D88-10, D88-11 | ❌ class false | ✅ |

**Counts.**
- Baseline (`38165db`): vitest `870 passed (870)`, 88 files; Playwright `--list` canvas2d 101 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2 / site 7 / record 4 / record-webgpu 4; cargo `245 passed; 0 failed; 1 ignored`.
- **Red (W88.1):** `933` tests, **`867 passed`, `66 failed`**, 94 files. Rows 1, 3–64, 13a, 13b and 27a fail (61 new tests and the 5 approved-test changes (i), (iii)–(vi)); rows 2, 65 and 66 pass.
- **After W88:** vitest **`933 passed (933)`**, **94** files (+63 tests: 10 shadow, 4 stylesheet, 7 toggle, 13 runtime, 11 Canvas2D, 7 plan, 10 WebGPU, 1 wdd-docs; +6 files).
- **Playwright `--list` after W88:** canvas2d **110** (+9, `shadows.spec.ts`), webgpu-hw **102** (+3, the W88 block), the others unchanged; cargo unchanged.

**Measured red (W88.1, 2026-10-25):** vitest 933 tests, 867 passed, 66 failed (auto-renderer 1, element-observer 1, shadow-canvas2d 11, shadow-plan 7, shadow-runtime 13, shadow-toggle 7, shadow 9, stylesheet 5, webgpu-lifecycle 1, webgpu-renderer 1, webgpu-shadows 10). `npm run e2e:typecheck` clean. `playwright --project=canvas2d e2e/shadows.spec.ts`: 9 failed, all on assertions. `--project=webgpu-hw e2e/webgpu-robust.spec.ts -g W88`: 3 failed. `playwright test --list`: canvas2d 110, webgpu-hw 102, webgpu 51, perf 6, dist 2, site 7, record 4, record-webgpu 4.

## Must NOT
- Change the engine, the FFI or any public API (Rust, `FluidCore`, the strides).
- Touch the DOM from a renderer.
- Move a Linux baseline.
- Change a test Dennis approved without his approval (D88-9, any `box-shadow: none` pin).
- Copy spike code (D2).

## Must DO
- Clear `liquid-shadow-away` on unobserve, destroy, a stopped instance, a lost device and under reduced motion.
- Refcount the class per element across instances.
- Keep the class in `@layer liquiddom` and the screen/forced-colors scope.
- Inspect every still and recording with vision before reporting a visual result.

## Manual Smoke Test
1. `npm run dev`, then open `scenes/shadows.html?renderer=auto`: splash each element, drag Glow over Drop and let it merge, and check the glows wrap the merged liquid and come back to the browser's at rest.
2. The same page with WebGPU off (`?renderer=canvas2d`).
3. System "Reduce motion" on: nothing moves, and every shadow is the browser's.
4. Print preview: every shadow is the author's, and there is no canvas.
5. The site (`npm run dev -w @liquiddom/site`): the hero glow at the arrival splash and the hint shake.

## Verification
`npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green; vision of `demo/scenes/shadows.html` and the site hero in both renderers; no acceptance step regresses.
