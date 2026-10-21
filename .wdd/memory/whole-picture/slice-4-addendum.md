# Slice-4 addendum (W77): step 6 and the landing page after the closed-liquid fix

**Date:** 2026-10-11 · **Based on:** 9770e37 · **Ward:** W77 · **Amends:** [slice-4.md](slice-4.md) (W76, not rewritten)

W77 changes the physics and the kernel, not the scene: default stretch yield `TENSION_MAX` max 0.90 (cohesion 0.5 now maps to 0.46), `SHAKE_PROFILE_AMPLITUDE` 0.35, kernel R = 2.3 × spacing capped at 16 px (was 8 px), the Canvas2D density cell `densityCellPx(maxR, minR)`, the honey preset `{viscosity: 0.9, cohesion: 0.7, recovery: 0.8}`, and the demo index linking scenes with `?renderer=auto` (D77-4).

## Step 6 (shake) per renderer

**Status: ✅ in both renderers (Dennis, W77 gold, 2026-10-11).** W76 rated it ❌ (lace on wide surfaces); W77 closes it. Evidence below.

| Guard | Bound | macOS Canvas2D | Metal WebGPU | Linux Canvas2D | Before W77 |
|---|---|---|---|---|---|
| acceptance lace f10/f20 | ≤ 300 | 103/161 | 53/79 | 103/161 | 1175/831 |
| landing lace (dark card) f10/f20 | ≤ 400 | 10/42 | 0/1 | 8/40 | 5232/1805 |
| specks on Book a demo | ≤ 16 | 0 | 0 | 0 | 307 |
| re-form after splash water/honey/jelly (frames) | ≤ 180 | 130/155/115 | same | same | honey 285 |
| re-form after shake water/honey/jelly | ≤ 180 | 118/152/106 | same | same | |
| perf ratio (landing vs before) | ≤ 1.29 | 0.83 (1.50 with the cell forced to 2 px, so the guard bites) | | | |

Vision (W77.5; Dennis approved the baselines for steps 2, 3, 4 and 6 on 2026-10-11):
- Step 6 shake f20: the diagonal band of diamonds is gone; the card bends as one closed body with 3–4 thin stripes.
- Step 4 Split f30: holes in the pill are largely filled, near-solid orange in the focus ring.
- Step 3 splash: the ring is a little smaller and more closed, with fewer beads.
- Step 2: small edge changes only.
- Step 1, the a11y focus case and reduced motion are unchanged.

## Landing findings W77 closes

- Lace on wide surfaces under shake (dark card 5232/1805 before, 10/42 after on Canvas2D).
- Specks next to a splash in a neighbouring element (Book a demo 307 before, 0 after), from the 8 px kernel cap on pages with a large observed area.
- Honey re-form above the 3 s budget (285 frames before, 155 after).

## Still open (not fixed in W77)

- Canvas2D edge on the landing page is slightly stair-stepped (3.5 px cell; WebGPU is smooth).
- Under landing shake the three cards merge into one sheet and the dark card reaches past the right edge of the viewport.
- "Book a demo" is drawn out into a bead chain at f20.
- Faint residual lace.
- Carried from W76: escaped liquid over page text, border/shadow at rest, `:hover` colour, icon chips, WebGPU hover tilt.
