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
Proposal: body mode puts the canvas at `z-index: -1` in the root stacking context, so every page box, its text and the observed elements paint above escaped liquid; container mode needs the container to be a stacking context (e.g. `isolation: isolate`), with one `console.warn` at `create()` when it is not (like the static-container warning); liquiddom never restyles the container, `<html>` or `<body>` (brainstorm 2026-10-13, saga dec_645b54e4). Measured in W82.0 Q1a/Q1d/Q1e.
Consequence: escaped liquid can no longer cover page text (slice-4 finding); any page box with its own opaque background now covers the liquid behind it; acceptance baselines may move (W82.0 Q1e lists each).
Decision: PENDING

### D82-2: Opaque `<html>` and `<body>` backgrounds
Proposal: from W82.0 Q1b — either detect both opaque at `create()`, one `console.warn` and fall back to `z-index: 0`, or a documented author rule.
Consequence: from W82.0 Q1b.
Decision: PENDING

### D82-3: The observed-element `z-index: 1` rule (D7)
Proposal: from W82.0 Q1c — keep or drop the `data-liquid-stack` rules once the canvas is at `z-index: -1`.
Consequence: from W82.0 Q1c (dropping it stops restyling authors' elements; keeping it is the known behaviour).
Decision: PENDING

### D82-4: Canvas2D edge on the landing (stair-step at a 3.5 px cell)
Proposal: from W82.0 Q2 — a finer density cell (`ceil(R)/6` or `/8`), a softer threshold, or the current edge.
Consequence: from W82.0 Q2 (edge roughness against Canvas2D frame time).
Decision: PENDING

### D82-5: Liquid past the viewport edge under shake
Proposal: from W82.0 Q3 — accept (the canvas clips at the viewport), a viewport-wall term in shake, or a body-mode world equal to the inner size.
Consequence: from W82.0 Q3.
Decision: PENDING

### D82-6: Thin wide elements beading under shake ("Book a demo" at f20)
Proposal: from W82.0 Q4 — a thickness-dependent yield, a thickness-scaled shake amplitude, or accept.
Consequence: from W82.0 Q4.
Decision: PENDING

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
