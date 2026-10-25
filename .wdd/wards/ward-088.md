---
ward: 88
revision: null
name: "Shadows follow the liquid"
epic: "liquid-look"
status: "planned"
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

### D88-7: The handoff
Proposal: the class goes in the frame `restAlpha` reaches 1, and the browser takes over. The renderer's shadow in that frame comes from box-shaped liquid. Alternative if Q3 shows a visible jump: cross-fade the renderer's shadow out over the rest fade.
Consequence: a small jump in size, darkness or offset is possible at the handoff, or a gap or double frame; the cross-fade removes it but needs the browser's shadow to fade in (a scratch opacity) and more renderer state. Spike W88.0 Q3 measures it in both renderers.
Decision: APPROVED 2026-10-25 — instant handoff when restAlpha reaches 1; no cross-fade (saga dec_90ce2674)

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
Decision: APPROVED 2026-10-25 — knockout: each element's shadow masked by its own liquid coverage (saga dec_5af57bbe)

### D88-11: WebGPU pass structure
Proposal:
- Splat each shadowed element's density once, without an offset. Apply each layer's offset in the resolve, by sampling at uv − offset.
- Resolve all layers of a radius group in one pass, as scissored per-element quads.
- Spread uses the mass-scaled, widened kernel, with one density per distinct spread (most layers have 0).
- Scissor every pass to the bounds, and use a quarter-resolution target for blur ≥ 32 px.
Consequence: spike W88.0 showed that the GPU cost is the pass count (two full-target passes per layer, two blur passes per group), not the blur taps. About 2 + 2·groups passes instead of 2·layers + 2·groups. Not measured in the spike.
Decision: APPROVED 2026-10-25 — one density splat per element, offset in the resolve, one resolve pass per radius group, scissored (saga dec_0dba6795)

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

Written after the W88.0 gate (part 2 of the plan): the technique details, the numbers of spike W88.0 and the file-level changes.

## Tests
Written in part 2 of the plan after the D88 gate (W88.1 red).

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
Written in part 2 of the plan after the D88 gate (W88.1 red).

## Verification
`npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green; vision of `demo/scenes/shadows.html` and the site hero in both renderers; no acceptance step regresses.
