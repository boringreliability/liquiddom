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
Decision: PENDING

### D88-2: Scope of the layers
Proposal: outer layers only, at most 4 per element (more draw the first 4, documented). Inset shows at rest and hides in motion. Out of scope: borders and outlines, `filter: drop-shadow()`, per-corner radii, an opt-out option. Settled in the brainstorm (saga dec_c7b5f5d4).
Consequence: an inset shadow pops off when the liquid leaves rest and returns at the handoff; a fifth layer never draws in motion; no switch exists if the cost proves a problem (YAGNI until it does).
Decision: PENDING

### D88-3: Snapshot and triggers
Proposal: `snapshotShadow(el)` parses the computed `box-shadow` into `{ color, dx, dy, blur, spread, inset }` (colours through `parseCssColor` and the W86 probe, so oklch works). It runs at `observe`, on W75's own `class`/`style` triggers, on `transitionend` for `box-shadow` (the runtime's `onTransitionEnd` list grows), and on `refresh(el)`. It lifts `liquid-shadow-away` while reading, as the colour snapshot lifts `liquid-element`. `ElementPaint` gains `shadows: readonly ShadowLayer[]`, scaled by DPR in the renderer.
Consequence: a `:hover` shadow change without a transition shows the old shadow until `refresh(el)`, exactly like colours; `InternalRecord` and `ElementPaint` grow; computed values are already resolved, so `currentColor` and CSS variables reach the parser as `rgb(...)`.
Decision: PENDING

### D88-4: Draw order
Proposal: every shadow is drawn before all liquid, so no shadow lies on another element's liquid and merged liquids share their shadows. No shadow for parked (W81) or inactive elements; in container mode the container's canvas clips the shadow.
Consequence: differs from CSS, where a later element's shadow can fall on an earlier one (for liquid that would read as a dark stain); a shadow larger than the container is clipped.
Decision: PENDING

### D88-5: Canvas2D technique
Proposal: a per-element alpha mask at the density cell size, drawn once per layer with `shadowColor`/`shadowBlur`/`shadowOffset`, off-screen with the offset compensated so only the shadow lands. Spread comes from an 8-direction dilation. Then the density image is drawn as today. The spike adds the cost and a ceiling if needed.
Consequence: new per-element work for every shadowed element in motion (today every moving element shares one density grid); spread is approximated by 8 shifted draws. Spike W88.0 Q1 settles the cost, whether `shadowBlur` matches CSS blur, and whether a ceiling on layers drawn per frame is needed.
Decision: PENDING

### D88-6: WebGPU technique
Proposal: a half-resolution shadow splat, then a separable gaussian blur in radius buckets (proposal: 4, 8, 16, 32, 64 px, nearest bucket; one target and blur per bucket used in the frame). It is composited under the liquid in the screen pass.
Consequence: a blur radius is rounded to its nearest bucket (a size error or banding is possible); each bucket in use costs a target and two blur passes per frame. Spike W88.0 Q2 sets the buckets, the target scale (a quarter resolution for large buckets is tried) and the cost.
Decision: PENDING

### D88-7: The handoff
Proposal: the class goes in the frame `restAlpha` reaches 1, and the browser takes over. The renderer's shadow in that frame comes from box-shaped liquid. Alternative if Q3 shows a visible jump: cross-fade the renderer's shadow out over the rest fade.
Consequence: a small jump in size, darkness or offset is possible at the handoff, or a gap or double frame; the cross-fade removes it but needs the browser's shadow to fade in (a scratch opacity) and more renderer state. Spike W88.0 Q3 measures it in both renderers.
Decision: PENDING

### D88-8: Scene, site and docs
Proposal: a new `demo/scenes/shadows.html` (drop shadow, multi-layer glow, spread, inset; hook `window.__shadows`; RAF by default, `?clock=manual`, `?renderer`). The site hero pills and drops get a CSS glow. Corrections in `getting-started.md:44`, `limitations.md:14` and `packages/core/README.md:24`/`:120`.
Consequence: no Linux baseline moves (the acceptance scene has no `box-shadow`); the demo landing's card shadow becomes visible at rest (that page has no baseline); the README lines are not named in the design but need the same correction.
Decision: PENDING

### D88-9: The gate covers Epic 16
Proposal: `wdd-docs.test.ts` `discoverFluidWards` also takes `epic: "liquid-look"` wards (renamed `discoverGatedWards`), so W88 gets the North-star, Decisions and PENDING guards.
Consequence: this changes an approved test, so it is flagged to Dennis at the gate; without it a W88 with `epic: "liquid-look"` escapes the guards, because discovery keeps only `epic: "fluid-engine"` wards.
Decision: PENDING

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
