# Slice-2 addendum (W70): steps 2, 6 and 8

**Date:** 2026-10-06 · **Recorded at:** a1628cd (plus the uncommitted step-8 segment in `e2e/record.spec.ts`, committed with this report) · **Ward:** W70 · **Amends:** [slice-2.md](slice-2.md) (W69, not rewritten)

![Acceptance scene after W70, canvas2d](../../../docs/superpowers/whole-picture/slice-2-addendum-canvas2d.gif)

Recorded with `npx playwright test e2e/record.spec.ts --project=record`, then `node scripts/webm-to-gif.mjs test-results/whole-picture/manifest.json docs/superpowers/whole-picture/slice-2-addendum-canvas2d.gif`. Chromium, 1280×800, DPR 1, seed 1, RAF clock, GIF 640 px at 12 fps, 29.08 s, 1.04 MiB. canvas2d only (no WebGPU fluid renderer before slice 3). The W69 GIF `slice-2-canvas2d.gif` is unchanged.

GIF timeline (s): step 1 0.5–2.5 · step 2 2.5–14.5 (forward sweep to ≈ 10, back to ≈ 14.5) · step 3 click ≈ 15.2, re-formed ≈ 17.6 · step 4 Enter ≈ 18.0, re-formed ≈ 20.4 · step 6 shake ≈ 20.45, re-formed ≈ 22.9 · step 8 (?rm=1) reload 24.5, click + shake ≈ 25.6 · hold to 29.08.

Frame numbers below are the 12 fps extraction of the video (`f0001` = 0 s, `fN` = (N − 1)/12 s), the same timeline as the GIF.

## Re-rated steps

| Step | Scene step | W69 observed | W70 observed | Evidence |
|---|---|---|---|---|
| 2 | Pointer sweep: soft bulge, no holes | ❌ motion yes, bulge not readable (0.14–1.22 px) | ✅ the pill under the pointer visibly swells a few px past its rect with a soft, ragged edge and stays solid inside; readable at 1280 px, subtle in the 640 px GIF | Rust bulge 6.33 / 6.81 / 6.56 px (Splash / Split / Merge, ≥ 5 px), e2e `[W70 bulge]` 7.58 / 7.40 / 7.72 px, pointer-only 0.65–1.20 px (0.35 px guard), no-hole lattice 10 px inside the contour green (pre-plan worst alpha 142 at 10 px, before D70-4; post-D70-4 re-measured worst alpha 250, a margin of 122 over the 128 threshold; 0 empty Rust bins); bulge re-measured post-green: unchanged; GIF frames f0034–f0052 (Splash, 2.75–4.25 s), f0070 (Split, 5.75 s), f0085–f0110 (Merge, 7.0–9.1 s); s2-step2-sweep.png: Merge swollen with a frayed edge, Splash and Split crisp at rest; re-form 105 ms after the pointer leaves |
| 6 | Shake: everything sloshes, re-form within 3 s | ❌ intact blobs sliding (re-form 2179 ms) | ✅ provisional: strength pending Dennis (open point 1): amplitude 0.8 → 0.5 or cap 0.2 → 0.3. Every element deforms as a whole-body wave, none moves as a rigid blob; it reads as violent: Splash bends into a V, Split into an Λ hook, Merge into a filament with a droplet chain, the card is torn into a notched mesh and the DOM labels are left on bare background | slosh peak non-rigid RMS 34.19 / 23.67 / 50.97 / 61.68 px (Splash / Split / Merge / card; ≥ 12 / 24 px; W67 baseline under the same Procrustes metric 2.06 / 6.64 / 2.33 / 5.87 px); re-form 2413 ms (Rust 136 (+10) frames, budget 180); GIF frames f0247 (20.5 s, onset) … f0254 (21.1 s, receding) … f0278 (23.1 s, crisp); s2-step6-shake-200ms.png: Splash V, Split Λ, Merge filament stream, card torn with bead-chain holes, "Liquid", "The DOM" and the "Split" label unreadable on the cream background |
| 8 | Modes: reduced motion and print | ✅ (tests only, not recorded) | ✅ under ?rm=1 the click and the shake leave the scene still and crisp | ?rm=1 segment: click on Splash + shake, `reactedMs` null (no restAlpha < 1 within 1 s, asserted); s2-step8-rm-idle.png and s2-step8-rm-after-click-and-shake.png byte-identical, crisp edges; GIF f0301 (25.0 s) … f0345 (28.7 s) identical; modes.spec 5/5 in the canvas2d run |

Cross-fade (D70-4): no pale flash. During the step-2 hover sweep (f0034–f0110) every pill stays full-colour. At the shake onset (f0247) the moving liquid is opaque and only the exact roundRect behind it fades (a translucent ghost of the home rect, which is the intended `restAlpha` fade). At the end of the step-6 re-form (f0262 → f0278) the fill stays solid while the frayed edge sharpens into the roundRect. `fluid-canvas2d.test.ts` D70-4 tests green.

## Constants

| Constant | W69 | W70 | Source |
|---|---|---|---|
| `SHAKE_PROFILE_AMPLITUDE` | (white noise `SHAKE_NOISE = 0.9`) | 0.8 | D70-1 |
| `SHAKE_STIFFNESS_CAP` | 0.4 | 0.2 | D70-2, W70 measurement |
| `POINTER_DRAG_PER_S` | 6.0 | 12.0 | D70-3 (amended 2026-10-06, saga dec_7db9a25c) |
| Canvas2D density weight while restAlpha < 1 | 1 − restAlpha | 1 | D70-4 |

Perf (W70.4): p95 3.75 ms with the pointer inactive, 3.82 ms with the pointer.

## Open points

- Step 6 may be stronger than "slosh". Elements are thrown up to ≈ 150 px from home, Merge tears into a droplet chain and the card into a lace-like mesh, and the labels sit on bare background for about half a second. Part of the lace is the density renderer's bead chains (a Carried item for slice 3). Dennis judges whether to soften it: `SHAKE_PROFILE_AMPLITUDE` 0.8 → 0.5, or `SHAKE_STIFFNESS_CAP` 0.2 → 0.3. Both must keep the slosh metric (≥ 12 / 24 px) green. No test bounds over-violence: the slosh metric has only lower bounds, so the call rests on the GIF and vision.
- Step 2 is readable but modest: the bulge is a swell with a frayed edge rather than a lens-shaped bump, and it is easy to miss at GIF scale.
- The shake re-form is 2413 ms against W69's 2179 ms, still inside the 3 s budget.
- The video has a single grey frame at ≈ 5.0, 15.3 and 25.5 s, close to Playwright screenshots. Most likely these are capture artifacts, not renderer output, because the canvas never paints grey.
- The profile varies along x only (`u = (x − cx)/(w/2)`), so a tall element gets no vertical wave.
- DOM-text halo, honey preset: not in W70 (slice 4 / Dennis' playground session).
- Next full whole-picture check: after slice 4 (NORTH-STAR rule).
