# Whole-picture check after slice 4: "Liquid text"

**Date:** 2026-10-10 · **Recorded at:** 10798cb · **Ward:** W76
**Canonical scene and matrix:** [NORTH-STAR.md](../../NORTH-STAR.md) · **Spec:** §6 "WDD with an eye on the whole", item 4 · **Earlier checks:** [slice-2.md](slice-2.md), [slice-2-addendum.md](slice-2-addendum.md)

![Acceptance scene after slice 4, canvas2d](../../../docs/superpowers/whole-picture/slice-4-canvas2d.gif)
![Acceptance scene after slice 4, webgpu](../../../docs/superpowers/whole-picture/slice-4-webgpu.gif)

Recorded with `npm run whole-picture` (`e2e/record.spec.ts`, projects `record` and `record-webgpu`): Chromium, 1280×800, DPR 1, seed 1, RAF clock (a manual clock would freeze the video), GIF 640 px at 12 fps; canvas2d 1.81 MiB, 45.75 s; webgpu 2.32 MiB, 36.08 s. Timings are wall-clock, ±50 ms. Re-form budgets are read from NORTH-STAR.md (D67-1: splash 3 s, shake 3 s). Both recordings passed (`2 passed`, 1.4 min), including the live forced-colours assertion; no size fallback was needed.

GIF timelines (seconds): canvas2d step 1 idle 0–3 · step 2 sweep 3–16 · step 3 click 17.0, visually settled 18.0 · step 3b card splash 19.7, settled 21.6 · step 4 Enter on Split 22.4, settled 23.6 · step 6 shake 24.9, settled 27.2 · step 8 forced colours 29.25–30.2 · step 8 ?rm=1 30.25–35.8 · landing 36.1–45.75 (hover 37.75, click "Start free" 38.7, shake 41.0, settled 43.3); webgpu step 1 idle 0–2.4 · step 2 sweep 2.5–7.3 · step 3 click 7.83, visually settled 8.83 · step 3b 10.33, settled 11.0 · step 4 13.08, settled 14.25 · step 6 shake 15.58, settled 18.0 · step 8 forced colours 19.75–20.33 · step 8 ?rm=1 20.4–26.6 · landing 26.67–36.08 (hover 28.33, click 29.0, shake 31.33, settled 33.6).
Frame references `fNNNN` are the 12 fps extraction of each GIF (`fN` = (N − 1)/12 s); shots are `test-results/whole-picture/shots/` (`s2-` = canvas2d, the W69 prefix kept by W72; `webgpu-` = webgpu), not committed. "Visually settled" is the last frame with visible motion; the manifest re-form (restAlpha 1 everywhere) comes later and is the number the budget applies to.

Recording artefact, not a liquid fault: a `page.screenshot()` call shows up as one washed-out grey frame in both videos (f0062, f0185, f0308 in each GIF, and canvas2d f0310 inside the step-6 shake). The PNG shots are clean.

## Renderers

Recorded in **canvas2d and webgpu**, the first check in both (spec §6.4). WebGPU ran on the hardware adapter (`record-webgpu`, `adapter.info`: apple / metal-3 / isFallbackAdapter false), local only (W71.0 fallback B: SwiftShader does not run the liquid in CI). SwiftShader smoke (soft, CI): pass this run (local `webgpu` project 15 passed, 11 skipped; `adapter.info` google / swiftshader / isFallbackAdapter true); green CI runs toward the 10 needed to make it blocking: 8 successful `ci.yml` runs since 2026-10-05 per `gh run list` (the smoke's own per-run result is not tallied anywhere, so 8 is an upper bound). The local `webgpu` project logged repeated `console.warn` "liquiddom: text atlas upload failed ([Invalid Texture] …)" on SwiftShader (fail-safe: the DOM text stays); see Open points.

## Scene steps

| Step | Scene step | Expected S4 | Canvas2D | WebGPU | Evidence |
|---|---|---|---|---|---|
| 1 | Idle 2 s: crisp edges, DOM text visible at rest | ✅ | ✅ crisp pills and card, DOM text, no fur, no halo at rest | ✅ identical to Canvas2D: crisp, DOM text, no liquid-text artefact | acceptance.spec step 1 ×2 pass in canvas2d and webgpu-hw; manifest at rest after 16 ms (canvas2d) and 10 ms (webgpu); GIF 0–3 s (canvas2d), GIF 0–2.4 s (webgpu); s2-step1-idle.png, webgpu-step1-idle.png |
| 2 | Pointer sweep: soft bulge, no holes | ✅ | ✅ soft drag of each pill edge as the pointer passes, no hole, slightly ragged edge while moving | ✅ same bulges, the label rides its liquid (Merge bulging in the shot), no hole | acceptance.spec step 2 ×5 pass in both projects; sweep frames canvas2d f0046–f0130, webgpu f0030–f0075; s2-step2-sweep.png (pills already back at shot time), webgpu-step2-sweep.png |
| 3 | Click "Splash": jets and fingers, [WebGPU] the text tears with the liquid, re-form within 3 s | ✅ W with text | ✅ C-shaped jets and fingers, DOM label "Splash" stays with its blue halo and reads on the bare page, re-formed in 2647 ms | ✅ label torn away with its liquid (gone in the hole, glyph fragments on the rim, readable again before rest), DOM text back without a visible snap, re-formed in 2533 ms | acceptance.spec step 3 + W74 ghost-pill tests pass (canvas2d); webgpu-robust "W74 – text that flows" 5/5 pass (webgpu-hw, no-blink MAE 0.0046); manifest step 3 canvas2d 2647 ms, webgpu 2533 ms; step 3b card text canvas2d 2230 ms, webgpu 2197 ms; webgpu f0096–f0099 label gone, f0099–f0102 torn glyphs on the rim, f0103–f0105 pale smear while the hole closes, f0106 readable, f0107 DOM; canvas2d f0205–f0216 halo label; s2-step3-splash-150ms.png, webgpu-step3-splash-150ms.png, webgpu-step3-card-text-250ms.png, s2-step3-reformed.png, webgpu-step3-reformed.png |
| 4 | Tab and Enter on "Split": centre splash, focus ring visible | ✅ | ✅ centred splash on Split, focus ring visible above the liquid in every frame, DOM label with halo, re-formed in 2484 ms | ✅ centred splash, focus ring visible throughout, label torn then readable, re-formed in 2413 ms | acceptance.spec step 4 pass (canvas2d); webgpu-robust W72 step 4 pass (webgpu-hw); manifest canvas2d 2484 ms, webgpu 2413 ms; canvas2d f0270–f0282, webgpu f0158–f0170; s2-step4-focus.png, webgpu-step4-focus.png, s2-step4-splash-150ms.png, webgpu-step4-splash-150ms.png |
| 5 | Drag "Merge" into the card, separate, re-form within 3 s | ⏳ | ⏳ slice 5 | ⏳ slice 5 | not recorded: liquid-only drag lands in slice 5 |
| 6 | Shake: everything sloshes, re-form within 3 s | ✅ | ✅ every element sloshes (Splash and Merge thrown into arcs, card bends), DOM labels with halos, re-formed in 2425 ms; residual diamond-hole lace in the card for about 0.5 s | ✅ every element sloshes, the text rides and bends with its liquid, re-formed in 2476 ms; the same diamond-hole lace, "source of truth" lost where the card tears | acceptance.spec step 6 + lace guard pass (canvas2d, tear px f10 1175 ≤ 1699, f20 831 ≤ 915); webgpu-robust W72 step 6 pass; manifest canvas2d 2425 ms, webgpu 2476 ms; lace canvas2d f0301–f0309, webgpu f0190–f0194; s2-step6-shake-200ms.png, webgpu-step6-shake-200ms.png, s2-step6-reformed.png, webgpu-step6-reformed.png |
| 7 | Scroll 300 px and back: the liquid follows with no snap | ⏳ | ⏳ slice 6 | ⏳ slice 6 | not recorded: scroll lands in slice 6 |
| 8 | Modes: reduced motion, print, device.lost, forced colours | + forced-colors ✅ | ✅ forced colours on live mid-splash: no canvas, black DOM text on white at once, liquid back and re-formed in 1212 ms after; ?rm=1 still and crisp after click and shake | ✅ the same: no canvas, DOM text with no liquid-text hole, re-formed in 1559 ms after; ?rm=1 still and crisp; device.lost rebuild green | modes.spec 5/5 (+2 visual skipped on macOS), a11y.spec 2/2, halo.spec 7/7, colour-refresh 2/2 (canvas2d); webgpu-robust W72 step 8 3/3 + W75 9/9 incl. test 34 forced colours live (webgpu-hw); recording: s2-step8-forced-colors-mid-splash.png, webgpu-step8-forced-colors-mid-splash.png, …-step8-forced-colors-after.png, …-step8-rm-idle.png, …-step8-rm-after-click-and-shake.png; GIF 29.25–30.2 s (canvas2d), GIF 19.75–20.33 s (webgpu) |

Splash scene and playground (`scenes.spec`): pass (2/2, canvas2d). Published dist (`e2e:dist`): pass (1/1). Landing smoke (`landing.spec`): pass (3/3, canvas2d). Totals this run: canvas2d 40 passed, 9 skipped; webgpu-hw 39 passed, 15 skipped; webgpu (SwiftShader) 15 passed, 11 skipped; cargo 170 passed, 2 ignored.

## Text

WebGPU, step 3 (12 fps frames f0095–f0107): at f0095 the label is already smeared; f0096–f0099 the centre of the pill is a clean hole and the label is simply gone with it (no DOM text over the hole, no pale rest pill: D74-7 holds); f0099–f0102 torn glyph fragments ("S", "h") sit on the closing rim; f0103–f0105 a pale, whitish smear fills the centre as the hole closes over the torn text, for about 0.25 s; f0106 "Splash" is readable in the liquid; f0107 it is DOM text, with no blink and no sharpness snap visible between f0106 and f0107. Step 3b (f0125–f0133): the gentle card splash is the best liquid-text moment of the recording: "Liquid at rest" and both paragraph lines shear and stretch with the card, stay readable in places (webgpu-step3-card-text-250ms.png), and only a pale hole at the impact point (around "the"/"follows") swallows a few letters; by f0133 the text is crisp DOM again. Step 6 (f0188–f0216, webgpu-step6-shake-200ms.png): "Splash" stretches along the blue arc, "Merge" wraps the green V, "Split" slants, the card text tilts with the card and breaks exactly where the lace holes open ("source of truth"); a small blue tail under Splash lingers until about f0216. No stale glyph and no smear under the resting pointer were visible in any frame.

Canvas2D: the DOM text never moves; while an element moves it carries the halo in its own background colour (probe mid-shake: all four elements `liquid-halo`, text-shadow rgb(47, 111, 222) on Splash, rgb(202, 75, 32) on Split, rgb(26, 131, 97) on Merge, rgb(38, 50, 56) on the card). Every label reads on the bare page mid-motion (s2-step3-splash-150ms.png, s2-step6-shake-200ms.png, canvas2d f0205–f0216 and f0301–f0309), and the halo is gone at rest (s2-step3-reformed.png, s2-step6-reformed.png). The honest cost: the label stays where the element is while its liquid is somewhere else, which reads as "text on a ghost" rather than liquid text.

Forced colours (live switch mid-splash, both renderers): the canvas disappears at once and the DOM shows black text on white system colours with nothing hidden (s2-step8-forced-colors-mid-splash.png, webgpu-step8-forced-colors-mid-splash.png; GIF f0352 canvas2d, f0238 webgpu); switched off, the liquid returns and re-forms (1212 ms canvas2d, 1559 ms webgpu).

## Landing page

`demo/scenes/landing.html` ("Riverbase", six observed elements) recorded after the acceptance scene in both renderers. Click "Start free" re-formed in 2431 ms (canvas2d) and 2346 ms (webgpu), shake in 2297 ms and 2266 ms, all within the 3 s budgets; `reformedAtEnd` true in both manifests.

What holds:
- canvas2d and webgpu at rest: the page reads as an ordinary SaaS landing page, crisp pills and cards, DOM text, no artefact (s2-landing-rest.png, webgpu-landing-rest.png; canvas2d GIF 36.1 s, webgpu GIF 26.67 s); after the shake it returns to exactly that state (s2-landing-reformed.png, webgpu-landing-reformed.png).
- webgpu shake: the wide light and tinted cards wave as sheets and their headings and two-line bodies flow with them, readable along the wave (webgpu-landing-shake-200ms.png, webgpu f0377–f0383) — the strongest "liquid text" impression in the whole check.
- canvas2d shake: every label stays readable as DOM text with its halo, including "Runs while you sleep" over the page background (s2-landing-shake-200ms.png).

What breaks:
- canvas2d and webgpu: the liquid that leaves its element paints over unobserved page content. The "Start free" jet covers letters of the hero paragraph (", sh" of "shape", "kfi" of "backfills", "ca" of "scales") and the light card's white liquid washes over the page (s2-landing-shake-200ms.png, webgpu-landing-shake-200ms.png). D7 keeps the canvas below the observed elements, not below the author's in-flow text; the acceptance scene has no foreign text, so this is new evidence.
- canvas2d and webgpu: dark surfaces show white streaks and lace holes under shake ("Runs while you sleep" card, "Book a demo"), and "Book a demo" stays speckled for about 1 s after its shape is back (canvas2d f0502–f0514, webgpu f0386–f0398). W73's lace fix was tuned on the acceptance card; these elements are wider (card) or smaller and darker (pill).
- canvas2d and webgpu: a splash on "Start free" disturbs its neighbour "Book a demo" 16 px away: white specks inside the dark pill for about 0.7 s (s2-landing-splash-150ms.png, webgpu-landing-splash-150ms.png; canvas2d f0466–f0474, webgpu f0350–f0358; in webgpu its label also wobbles). Not Canvas2D-only, as first suspected.
- canvas2d and webgpu: `.liquid-element` forces `border-color: transparent` and `box-shadow: none`, so the light card's author border (#e2e6ef) and shadow are gone even at rest; white on #f4f6fb still reads, a card that relies on its border would lose its edge (s2-landing-rest.png, webgpu-landing-rest.png).
- canvas2d and webgpu: hover on "Start free" swells the liquid but keeps the snapshotted #3b4cf5 (sampled rgb(59, 76, 245) in s2-landing-hover.png and webgpu-landing-hover.png, same blue to the eye), while the author CSS asks for #2a37d6 — the documented `:hover` limitation (needs `refresh(el)`); the author's 160 ms background transition is invisible because the DOM background is transparent.
- canvas2d and webgpu: nested backgrounds (the cards' icon chips) stay in the DOM and detach from their moving liquid (s2-landing-shake-200ms.png, webgpu-landing-shake-200ms.png); "Sign in" drifts to the top-right corner during the shake (webgpu f0377–f0383).
- webgpu: torn regions of text vanish (parts of "Book a demo" and "Runs while you sleep", webgpu-landing-shake-200ms.png), as designed (D74-4 coverage 0 when torn); canvas2d instead keeps the DOM text in place over the departed liquid.

## Carried

Carried into this check from the slice-3 and slice-4 gold notes and CONTEXT's known limitations. W76 changes no engine or renderer behaviour: each row is evidence plus one recommendation, and Dennis decides what is fixed, and whether in a fix ward before slice 5 or inside a later slice.

| Item | Evidence | Recommendation |
|---|---|---|
| Honey preset re-form (279–292 frames) | probe (manual clock, seed 1, `setMaterial` honey, splash on Splash): every restAlpha back to 1 after 285 frames in canvas2d and 285 in webgpu (shared solver), against the 180-frame budget (3 s); W73 measured 279–292 | retune `presets.honey` (raise `recovery` or lower `viscosity`) to ≤ 180 frames in a fix ward before slice 5, with a patch changeset |
| Canvas2D splats w == 0 particles | probe as briefed (opaque px around Merge after hiding it mid-shake) is confounded: hiding Merge recentres the flex row, so Split moves into the region (3091 css px canvas2d, 3093 webgpu); colour-keyed probe instead (Merge-green px on the whole canvas): 6213 / 6224 at rest, 0 in both renderers 3, 60 and 360 frames after hiding | not reproduced on this build: keep closed; add a colour-keyed guard when slice 6 brings parking |
| Shake profile varies along x only | vision: the 180 px card bends as one sheet whose vertical offset varies along x, no wave along y (canvas2d f0301–f0309, webgpu f0190–f0194, s2-step6-shake-200ms.png, webgpu-step6-shake-200ms.png); the lace holes form a diagonal band where the stretch is largest | keep: a vertical term would add stretch, and the lace (Open points) asks for less; revisit only with the lace fix |
| Pointer decay per frame, not per unit of time | `POINTER_IDLE_DECAY = 0.8`, `POINTER_IDLE_MS = 120` (pointer-tracker.ts:13–14); half-life ln 0.5 / ln 0.8 ≈ 3.1 frames = 52 ms at 60 Hz, 26 ms at 120 Hz; not measured, arithmetic only (no 120 Hz display in this run) | convert to a per-time decay (`0.8^(dt·60)`) in slice 5 with the pointer-drag work |
| runtime-truth.test.ts flake under verify load | alone 20/20 pass; under `npm run verify` 3/3 pass (the 61-file vitest run; W72: 1 failure, then 0/33) | keep and watch; an explicit timeout only if it fails again |
| DOM text contrast while the liquid is away | Canvas2D probe mid-shake: all 4 elements carry `liquid-halo` with a text-shadow in their own background colour; vision: every label readable in s2-step3-splash-150ms.png and s2-step6-shake-200ms.png; WebGPU: liquid text readable in webgpu-step3-card-text-250ms.png, torn regions vanish (webgpu-step6-shake-200ms.png); landing grey body text on the bare page reads with its dark halo (s2-landing-shake-200ms.png) | closed for the acceptance scene; what remains is design, not contrast: WebGPU torn text vanishes and Canvas2D text stays put — keep |

## Feel against the north star

WebGPU now delivers the slice-4 promise in the gentle cases: the card splash and the landing cards' wave show text that is part of the liquid, stretching and bending with it, and the return to DOM text is seamless. In the violent cases the text mostly disappears with the liquid that tears (the Splash label is gone or torn for most of a second, f0096–f0105), which is honest but reads less as "text that tears" than as "text that vanishes". Canvas2D stays honest: real DOM text with a halo, always readable, never liquid. Everything still splashes, sloshes and always re-forms within 3 s in both renderers, on the acceptance scene and on a foreign page ("T-1000" holds). What looks fake: the lace holes in dark surfaces, the speckled "Book a demo" after a neighbour's splash, liquid painting over the author's paragraph, and icon chips floating off their cards. Drag and merge (slice 5) and scroll, parking and the world (slice 6) are still to come; the landing page shows that slice 6 also has to answer how the liquid stacks against unobserved content.

## Perf

At 8000 particles in the acceptance scene, this machine Apple M4 Pro (local, not CI):
- canvas2d (perf project): p95 Rust `tick` per fixed step 4.12 ms (mean 3.76 ms; F every substep, D74-1; slice 2: 3.560 ms, W70: 3.75 ms), RAF p95 4.24 ms (budget ≤ 12 ms).
- webgpu (webgpu-hw, Metal): RAF p95 4.36 ms (W74: 4.33 ms, W72: 3.8 ms); overdraw mean/p95/max 182.6k / 402k / 402k fragments/frame (p50 0, n 92); text pass cost not measured separately.
- F cost (W74): every substep vs off, WASM median p95 ratio 1.125, mean 3.60 vs 4.05 ms per step (every 2nd substep not taken, ratio ≤ 1.2).
CI baseline recorded: no.

## Drift check

- Engine is MLS-MPM in Rust; soft-body identifiers: none (`grep EntityBody|PARTICLES_PER_BODY|liquid_type` in `src` and `packages/core/ts/src` is empty).
- F is render-only (never in the stress): yes, per `src/fluid/fmath.rs` and `solver.rs:705` ("never in the stress") and W74's tests; Rust scenario re-form with F in the rest criterion: splash 145 frames (D74-2), W67 evidence splash 135 + 10, shake 126 + 10.
- Renderers never touch the DOM; the runtime owns every class write (`liquid-element`, `liquid-text`, `liquid-halo`): `grep classList|setAttribute|.style.` in `renderers/` is empty.
- Only `wasm-loader.ts` imports `pkg/`: yes.
- Every visible motion comes from the solver; the text follows F, not a TS animation: yes.
- Built beyond the north star, or skipped against the S4 column: none (the landing page is a W76 test page, D76-2).

## Open points for slice 5

- Residual lace under shake in both renderers: diamond holes in the acceptance card for about 0.5 s (canvas2d f0301–f0309, webgpu f0190–f0194) although the D73-3 guard passes (1175 / 831 px), and stronger white streaks on the landing page's dark card and "Book a demo" (owner: engine, shake profile / tension; the guard covers only the acceptance card).
- A splash disturbs a neighbouring element 16 px away (landing "Book a demo" specks, both renderers; owner: engine, splash impulse radius or neighbour coupling).
- Escaped liquid paints over unobserved in-flow page text (landing hero paragraph, both renderers; owner: runtime/stylesheet stacking, D7 scope; slice 6 world).
- `.liquid-element` drops author `border-color` and `box-shadow` at rest (light card loses its edge; owner: runtime/stylesheet).
- Nested backgrounds (icon chips) detach from moving liquid (owner: atlas/renderer scope, D74-5 v1 limits).
- `:hover` background colours are not followed (needs `refresh(el)`; documented W75 limitation, the author transition is invisible).
- WebGPU: the hole-closing frames show a pale smear over torn text for about 0.25 s (f0103–f0105); owner: renderer text composite.
- SwiftShader `webgpu` project: repeated "text atlas upload failed ([Invalid Texture] …)" `console.warn` (fail-safe DOM text; owner: renderer/atlas upload on fallback adapters).
- W75 open items: test 34 (forced colours live) passed this run (webgpu-hw 39/39), rare race still to watch; a manual `refresh(el)` cuts a running author transition (documented, kept immediate at W75 gold); container-mode DPR change is still untested in a browser (resolution query only; a manual zoom check is suggested).
- W74 carried: two atlas pages up to 2 × 64 MB at 4096²; device.lost shows one blank frame during the Canvas2D rebuild; border-box clip hides overflowing text while moving.
- Spec §7 open points still open: render scale for T0 (0.5× kept since W71), what happens to the published `0.2.0-rc.0`; F every substep vs every 2nd is closed (every substep, W74).
- SwiftShader smoke: at most 8/10 green CI runs (successful `ci.yml` runs since 2026-10-05; per-job smoke results not tallied).

## Recommendation

Fix first, then plan slice 5: a small fix ward for the residual lace on dark and wide surfaces and the neighbour disturbance (both engine, both renderers), plus the honey preset retune; decide whether the stacking against unobserved content and the dropped border/shadow wait for slice 6 or join that fix ward. Everything else in the S4 column is ✅ in both renderers. This is a recommendation only. **Dennis decides; slice 5 is planned only after his review of this check.**
