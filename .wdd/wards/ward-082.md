---
ward: 82
revision: null
name: "Under the page"
epic: "fluid-engine"
status: "planned"
dependencies: [81]
layer: "both"
estimated_tests: 0
created: "2026-10-14"
completed: null
---
# Ward 082: Under the page

North star: steps 1, 3 and 6 on the landing page and the acceptance scene (escaped liquid goes under the page's own content in both renderers; the landing page's open W77 findings closed or ruled on); steps 2, 4, 5, 7 and 8 unchanged. Every baseline that moves is shown to Dennis with vision first (D65-7).

## Scope
Third ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §5). The canvas moves under all page content (`z-index: -1` in body mode; container mode needs a stacking context), so a splash or a shake never paints over unobserved page text (slice-4 finding, `.wdd/memory/whole-picture/slice-4.md:53`). The three W77 landing findings still open (`slice-4-addendum.md`, "Still open (not fixed in W77)") are measured and each closed or accepted at the gate: the Canvas2D stair-step edge (3.5 px cell), the dark card reaching past the right viewport edge under shake, and "Book a demo" drawn into a bead chain at f20. The techniques for D82-2 … D82-6 come from the measurement spike W82.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W82.md`, part 1); the rest of the plan (part 2) is written after the gate.

Out of scope: gravity (W83), touch drag (W84), the adapters (W85), the site (W86), liquid above the DOM and border/shadow (spec §7), the other W76 carry-overs (`:hover` colour, icon chips, WebGPU hover tilt).

## Inputs
- The slice design §5, §11, §12 (D82-1 … D82-6) and the spec §4 canvas as amended in `17ede66` (`z-index: -1`, container stacking context).
- `stylesheet.ts` (`createLiquidCanvas`, `mountLiquidCanvas`, `remountLiquidCanvas`, the D7 `data-liquid-stack` rules, `stackingFor`), `runtime.ts` (`STATIC_CONTAINER_WARNING`), `density-grid.ts` (`densityCellPx`), `kernel-params.ts` (`DENSITY_THRESHOLD`, `EDGE_SOFTNESS`), `interaction.rs` (shake), `material.rs` (`TENSION_MAX`), `grid.rs` (walls).
- `demo/scenes/landing.html`, `e2e/landing.spec.ts`, `e2e/lace.ts` (W77 bounds), the 13 Linux baselines.
- Baseline at `455a92e` (W81 complete): see the table under Specification.

## Outputs
- Set after the gate (part 2 of the plan).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D82-1: Stacking — the canvas under all page content
Proposal: body mode puts the canvas at `z-index: -1` in the root stacking context, so every page box, its text and the observed elements paint above escaped liquid. Container mode: the canvas sits at `z-index: -1` inside the container when the container is a stacking context (`isolation: isolate`, a `z-index` other than `auto`, …); when it is not, one `console.warn` at `create()` and the instance falls back to `z-index: 0` (today's behaviour), because without a stacking context the liquid escapes under the container's own background and every observed element vanishes (W82.0 Q1d). liquiddom never restyles the container, `<html>` or `<body>` (brainstorm 2026-10-13, saga dec_645b54e4; the container fallback is new from the spike).
Consequence: escaped liquid never covers page text (Q1a: covered glyph pixels on the hero paragraph 86 → 0 under a strength-2 splash, 137 → 0 under a strength-2 shake, both renderers); two z-0 bugs disappear (the label of an element inside a transformed ancestor, author dropdowns hidden by the liquid; Q1c). All 13 Linux baselines are pixel-identical (Docker, maxDiffPixelRatio 0, twice). Approved tests change at red: `a11y.spec.ts:53-55` and `webgpu-robust.spec.ts:906` (they assert canvas z-index 0), `stylesheet.test.ts` (the canvas style and the D7 rules). At HEAD the default splash and shake no longer reach page text (W77 calmed them), so the red e2e uses strength 2.
Decision: APPROVED 2026-10-14 — canvas at z-index -1 in body mode; in container mode -1 when the container is a stacking context, else one console.warn and a z-index 0 fallback; container, html and body never restyled; confirms the brainstorm choice (saga dec_5cee9fcb)

### D82-2: Opaque `<html>` and `<body>` backgrounds
Proposal: at `create()` (the canvas's ancestor chain) and at `observe()` (the element's ancestor chain) liquiddom looks for an opaque background between the canvas and the root stacking context: any ancestor box with a non-transparent `background-color` or a `background-image`; `<body>` counts only when `<html>` has its own background (otherwise body's background propagates to the canvas, which is fine). On the first hit: one `console.warn` naming the element and the fix ("make it transparent or give liquiddom a container with `isolation: isolate`"), and the instance falls back to `z-index: 0` with the D7 rules (today's behaviour) for the rest of its life.
Consequence: pages with opaque html + body, an opaque wrapper (`.wrap`, a white `<main>`) or html with any alpha keep working as today (Q1b: without the fallback the liquid is 0 px visible and the CTAs become invisible); everyone else gets the canvas under the page. A check of only "html and body both opaque" misses the wrapper and `<main>` cases (measured). Cost: a computed-style walk per observe (outside the frame loop); the fallback is per instance and one-way.
Decision: APPROVED 2026-10-14 — ancestor-chain check at create() and observe() (body counts only when html has its own background); the first opaque hit gives one console.warn and the instance falls back to z-index 0 with the D7 rules (saga dec_aee06d64)

### D82-3: The observed-element `z-index: 1` rule (D7)
Proposal: drop the `data-liquid-stack` rules (`position: relative; z-index: 1` and `z-index: 1`) for an instance whose canvas sits at `z-index: -1`; keep them for an instance that fell back to `z-index: 0` (D82-1 container fallback, D82-2).
Consequence: liquiddom stops restyling authors' elements in the normal case (Q1c: text, children, focus ring, a positioned `z-index: auto` element and an element inside a transform all paint above the liquid without the rule; the acceptance scene is pixel-identical); keeping the rule at z −1 would make card text paint through author dropdowns. `stackingFor`/`data-liquid-stack` stay for the fallback, so the refcounted decoration keeps one code path.
Decision: APPROVED 2026-10-14 — drop the data-liquid-stack rules at z-index -1, keep them for an instance that fell back to z-index 0 (saga dec_94c7834f)

### D82-4: Canvas2D edge on the landing (stair-step at a 3.5 px cell)
Proposal: Canvas2D's density cell becomes `ceil(R)/6` instead of `ceil(R)/4` (`DENSITY_CELLS_PER_RADIUS` 4 → 6), the 2 px floor and the fine-spacing bound kept; `EDGE_SOFTNESS` stays 0.1 (it is shared with WebGPU).
Consequence: the moving Canvas2D edge on the landing page is smooth (Q2: roughness f10/f20 0.225/0.269 → 0.180/0.196 px, WebGPU 0.116/0.149; vision: the notches on the dark card's left edge are gone); no Linux baseline moves (the acceptance scene stays on the 2 px floor). Cost: Canvas2D render time on pages with large kernels ≈ 2.8× (landing 2.6 → 7.4 ms per frame on this Mac); the acceptance and stress scenes are unchanged. `/5` is the compromise (1.5× for half the gain); a softer threshold was rejected (transparent stripes inside the card, alpha < 240 pixels 1170 → 5231). Approved tests change at red: the `kernel-params` / `density-grid` unit tests that pin 4 and the 13.04 → 3.5 px example.
Decision: APPROVED 2026-10-14 — Canvas2D density cell ceil(R)/6 (DENSITY_CELLS_PER_RADIUS 6), 2 px floor and fine-spacing bound kept, EDGE_SOFTNESS 0.1 kept (saga dec_34ee6dd6)

### D82-5: Liquid past the viewport edge under shake
Proposal: shake mirrors its outward direction per element when the element's home rect lies within 80 px of a viewport edge, so an element near the edge sloshes inward instead of being clipped flat; Rust learns the viewport through one new scalar call `set_viewport(w, h)` (buffer px, called by the runtime at create and from `resizeCanvas()`; the world stays `max(screen, inner)`).
Consequence: the dark landing card no longer reaches past the right edge (Q3: particles outside the viewport 112 → 0, dark pixels in column 1279 181 → 0; "Sign in" no longer leaves the top: 78 particles above y 0 over 29 frames → 0); elements still slosh; acceptance step-6 diff 0; W77 tear 13/61 (bound 400); cargo 223 green. The wall itself was never the problem (it sits at x 1488, the card peaked at 1285); a per-particle wall term and world = inner measured no effect. Cost: one new scalar call (FFI addition, no layout change). Alternative: accept (the canvas clips at the viewport).
Decision: APPROVED 2026-10-14 — shake mirrors its outward direction per element within 80 px of a viewport edge; new scalar call set_viewport(w, h) from create and resizeCanvas (saga dec_adb31552)

### D82-6: Thin wide elements beading under shake ("Book a demo" at f20)
Proposal: accept the "Book a demo" bead chain as a known limitation in W82 (CONTEXT): it lasts 5 frames (f18–f23) of a strength-1 shake and every element re-forms within budget (76/139/136 of 180 frames).
Consequence: no physics change. Yield is the wrong lever (Q4: a lower yield for thin elements gives more beads, a higher one changes nothing because J never reaches 1.46 there); the beads come from the shake's sinus profile stretching a 54 px strip along its long axis. The fix that works, a thickness-scaled profile amplitude, breaks D70-5's slosh floor on the acceptance pills (Split 7.7–8.4 px against the floor of 10), three golden tests and the step-6 baseline (1.06–1.74 %); scaling only the long-axis component is untested. Alternative: that fix, with D70-5 amended.
Decision: APPROVED 2026-10-14 — accept the Book a demo bead chain as a known limitation in W82, no physics change (saga dec_09c2f0ea)

## Spike W82.0 result (2026-10-14, throwaway copies of `bc4deaa`, 1280 × 800, seed 1, manual clock; reports in `.superpowers/sdd/W82/spike-Q1.md`, `spike-Q2.md`, `spike-Q34.md`, stills inspected with vision)

| Q | Candidate | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1a | canvas `z-index: -1` vs 0 | covered glyph pixels on the hero paragraph, strength-2 splash 86 → 0, shake 137 → 0 (14 px antialiased edges), both renderers; default splash/shake reach no text at HEAD | text over the liquid at −1; "SQL", "Riverbase" covered at 0 | −1 (D82-1) |
| Q1b | html/body backgrounds at −1 | body only, html only, neither: work; html + body opaque, an opaque wrapper, a white `<main>`, html with any alpha: liquid 0 px visible, the CTAs vanish | confirmed (CTA labels invisible) | ancestor-chain check + warn + z-0 fallback (D82-2) |
| Q1c | D7 `z-index: 1` rule at −1 | acceptance scene pixel-identical with and without; text, children, focus ring, positioned `z-index: auto`, element in a transform all above the liquid without it; at z 0 a label in a transformed ancestor and author dropdowns are hidden today | — | drop at −1, keep for the fallback (D82-3) |
| Q1d | container | `isolation: isolate` or a `z-index`: liquid above the container background, under its text (0 glyph px); `position: relative` only with a background: 0 px visible, elements vanish | — | stacking context or warn + z-0 fallback (D82-1) |
| Q1e | Docker Canvas2D, no update | 13 / 13 baselines 0 changed pixels (z −1 with and without the rule); only the a11y z-index asserts fail | — | no baseline moves |
| Q2 | density cell /4 (3.25 px), /5, /6, /8, softness 0.2 | roughness (7-px window) f10/f20: 0.225/0.269, —, 0.180/0.196, 0.170/0.185, 0.153/0.172 (WebGPU 0.116/0.149); landing render 2.6, 3.9, 7.4, 18.1, 2.6 ms; no baseline moves except softness 0.2 (step 6: 477 px) | /4 notched, /6 and /8 smooth, softness 0.2 striped | /6 (D82-4) |
| Q3 | (i) accept, (ii) per-particle wall term, (ii-c) per-element mirror within 80 px of the viewport, (iii) world = inner | dark card past x 1280: 112 particles / 181 px in col 1279 (i), unchanged (ii), 0 / 0 (ii-c), unchanged (iii); "Sign in" above y 0: 78 particles × 29 frames → 0 (ii-c); step-6 diff 0; W77 tear 13/61 | (i) clipped flat at the edge; (ii-c) sloshes inward | (ii-c) + `set_viewport` (D82-5) |
| Q4 | (i) thickness yield, (ii-p) thickness profile amplitude, (ii-v) thickness speed, (iii) accept | lobes ≥ 3 frames: 5 (HEAD), more with lower yield, 5 with higher, 0 (ii-p, refs 80–200 px) but Split slosh 7.7–8.4 px < D70-5 floor 10 and step-6 1.06–1.74 %; (ii-v) pills tame (RMS 5.6 px, 2.4 %); re-form 76/139/136 of 180 everywhere | chain of 3–4 beads at f20 in both renderers | accept in W82 (D82-6) |

## Specification
Set after the gate (part 2 of the plan).

**Baseline (2026-10-14, `455a92e`).**

| Suite | Count |
|---|---|
| cargo | 223 passed; 0 failed; 2 ignored |
| vitest | 737 passed, 4 skipped (741), 72 files |
| Playwright `--list` | canvas2d 85, webgpu 51, webgpu-hw 95, perf 6 |

## Tests

Set at red (part 2 of the plan).

| # | Test Name | Verifies |
|---|-----------|----------|

## Must NOT
- Restyle the author's container, `<html>` or `<body>`.
- Move a Linux baseline without Dennis' vision approval (D65-7).
- Copy spike code into the repo (D2).
- Change the FFI layout, the 7-arg constructor or the public API beyond what a gate decision names.

## Must DO
- Keep the canvas `aria-hidden`, `pointer-events: none`, hidden in print and forced colours (D66-15).
- Measure each W77 finding before deciding it (W82.0).

## Manual Smoke Test
### Setup
`npm run dev`.

### Steps
1. Open `http://localhost:3000/scenes/landing.html` (RAF clock), press "Start free" and shake from the console.
   Verify: the liquid passes under the hero paragraph's text, never over it; the observed elements' text stays on top.
2. Same in `?renderer=canvas2d`.
   Verify: the edge as decided in D82-4; "Book a demo" as decided in D82-6; the dark card as decided in D82-5.

### Pass criteria
- [ ] No liquid over unobserved page text in either renderer.
- [ ] The three W77 findings behave as their decisions say.

## Verification
Set after the gate (part 2 of the plan): `npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:webgpu-hw`, Docker Canvas2D baselines, vision in both renderers.
