# Context — liquiddom

## Last Updated
Ward 74 — 2026-10-10 (slice 4: text that flows in WebGPU, F in Rust, rest needs F ≈ I, the liquid-text toggle, no ghost pill). Next: W75.

## Current State
Epic 15 (Fluid Engine): slices 1–3 closed, slice 4 in progress. `LiquidDOM.create()` runs a 2D MLS-MPM fluid in Rust/WASM (`FluidCore`), drawn by Canvas2D or WebGPU. The soft-body engine is the tag `softbody-final`. Packages `0.3.0-alpha.x` (pre mode `alpha`), nothing published; `site/` frozen until slice 6. Test totals: `.wdd/PROGRESS.md` and the ward gold notes.

Canonical vision, acceptance scene (8 steps) and slice matrix: `.wdd/NORTH-STAR.md`. Binding design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. Execution ledger and rulings: `.superpowers/sdd/README/progress.md` (git-ignored).

## Architecture Decisions Made
Soft-body decisions (W1–W62) are snapshotted in `.wdd/memory/snapshots/`. Active fluid decisions (full text in `ward-063..066.md`, log in NORTH-STAR "Plan decisions"):

| Decision | Rationale | Ward |
|----------|-----------|------|
| MLS-MPM (APIC, quadratic B-splines) with home spring, chosen over PBF in a bake-off; Rust/WASM kept | Real fluid is the goal; spike reference only | D1–D2, W63 |
| FFI: element stride 10, dynamic SoA 7, static SoA 3, state stride 4; 7-arg constructor frozen | Flat views, no JSON; one owner (`FluidBridge`) | W64 (D64-4) |
| Rust owns the fixed-step accumulator (100 ms clamp, ≤ 3 × 1/60 s, 8 substeps); no hot-path allocation; `indexing_slicing` denied | Determinism, no panics on JS input | W64 |
| Public facade: whitelist options (removed ones throw with replacement), `observe(el, { viscosity, recovery })` captured once, fixed pools, no `grow()` | 0.2 configs fail loudly | W66 (D66-1, -4, -10) |
| Injected `@layer liquiddom` stylesheet with `!important`, paint/stacking scoped to `@media screen and (forced-colors: none)`; print/forced-colors hide the canvas | `revert-layer` fell back to the UA default in print | W66 (D66-15 amended) |
| Shared refcounts: one stylesheet per document, one decoration per element across instances; colour snapshot lifts the class with `transition: none` | Multi-instance correctness | W66 |
| `LoopController`: user pause and hidden tab are separate sources; dt reset on resume; first throwing frame stops the instance for good | 0.2 regression fixes; no silent re-arm | W66 (D66-12) |
| WebGPU liquid: splat into T0 rgba16float + T0a r16float, composite with an fwidth edge, rest SDF overlay at restAlpha; T2 deferred | No 32-bit targets; Canvas2D parity through kernel-params.ts and Σw·a | W71 (D71-3…6) |
| `'auto'` = WebGPU on a hardware adapter, Canvas2D fallback (unavailable, software adapter or unusable presentation surface) on a remounted canvas, one `console.info` unless `silentFallback`; explicit `'webgpu'` accepts SwiftShader; `device.lost` → Canvas2D rebuild in place, one `console.warn` | WebGPU by default without breaking anyone; CI can test the WebGPU path | W72 (D72-1, D72-2, D72-3) |
| Liquid text in WebGPU: render-only F (every substep, σ clamp, sticky torn), rest needs max‖F − I‖ < 0.05, runtime-built atlas, T1/T1w at 1× in its own pass, text composite after the rest SDF, refcounted liquid-text with fail-safe; damage drops restAlpha to 0 | Text that flows without ever hiding the DOM text; no ghost pill | W74 (D74-1…7) |
| Playwright is the visual/behaviour guard; Linux baselines from the pinned image, committed only after a vision check | jsdom cannot see cascade or transitions | W65 (D65-7) |

## Active Constraints
- Rust er DOM-blind og farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Faste pools (`particles`, `maxElements`) sat ved `create()`; ingen `grow()`
- Canvas ligger under DOM'en (D7); rendering rører aldrig DOM'en
- Kun `ts/src/wasm-loader.ts` importerer `pkg/`

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Particles (default) | 8000 (range 256–65536) | W66 |
| Tick p95 per fixed step (local, 4 elements) | 3.31 ms | W66 |
| RAF p95 (local) | 3.40 ms | W66 |
| Fixed-step p95 (local, W67 full substep) | ~3.6 ms | W67 |
| WASM size (opt-level 3) | ~85 kB | W65 |
| Splat overdraw estimate, shake peak (webgpu, Metal, 8000 particles) | max 402341 fragments/frame (mean 192911, p95 402341) | W72 |
| RAF p95 webgpu | 3.815 ms | W72 |

## Known Limitations
- Pointer idle decay (D68-4, W68): the ×0.8 velocity decay is per frame, so at 120 Hz the tail decays twice as fast in wall time as at 60 Hz.
- Pointer drag 12/s (W70): a fast sweep lets a pill's trailing edge recede up to ~8 px; interior holes start at drag ≥ 18 (measured), so the e2e no-hole lattice is 10 px inside the contour.
- Shake profile (W70, D70-1; W73 D73-1/2 amplitude 0.5, cap 0.3): the speed profile `1 + 0.5·sin(π·u + φ)` varies along x only (`u = (x − cx)/(w/2)`), so a tall element gets no vertical wave. W73 removed the card "lace".
- OPEN (pre-existing, for Dennis' playground session): the honey preset re-forms in 279–292 frames, above the 3 s budget.
- Container mode needs a positioned container (one `console.warn` if static; liquiddom never restyles it).
- Gravity is validated but has no effect until slice 6; scroll is verified only in slice 6.
- A large scroll can lock particles across elements (W67 slip, slice-6 parking).
- Edge ring (D67-13): spacing cell/2 from the area hint, so a far-off hint makes the ring a little denser or sparser than the interior.
- The first frame that throws stops the instance (unchanged in W67); adapters do not yet react to a stopped instance.
- WebGPU e2e runs only locally (`e2e:webgpu`, `e2e:webgpu-hw` on Metal); CI runs the soft smoke (W71.0: SwiftShader loses the device within 2–5 frames in CI). No webgpu Linux baselines (W72).
- A WebGPU canvas is readable only in the task that rendered it; the e2e helpers read `__liquidTest.pixels()` (a snapshot taken in advance()).
- DOM-text contrast while the liquid is away (D72-5): solved under WebGPU by the liquid text (W74); under Canvas2D the DOM text still sits on the bare page during a splash or shake until W75's halo.
- Liquid text v1 (W74, D74-5): text nodes only; underline, text-shadow, icons, images and SVG are not in the atlas (decorations hide while the text moves); `capitalize` is per word; a font that loads after the atlas build shows the fallback in motion until W75; the page is ≤ 4096² atlas px and an element that does not fit keeps its DOM text. Words are clipped to the border box, so `overflow: visible` text outside it vanishes while moving.
- Liquid text costs (W74): the atlas is rebuilt on every paints rebuild until W75; T1/T1w stay allocated after the first moving text (released only on resize, device loss or destroy).
- Hover swell with liquid text (W74): the particles swell 2 % while the DOM text does not, so the atlas → DOM switch after a hover can shift glyphs by ≈ 1 px at the edges; a pointer resting on a moving card can smear its text locally (spike W74.0).
- `activeRenderer` can change during an instance's life (W72): a lost WebGPU device switches it to `'canvas2d'`; a frame or two during the rebuild draw nothing.
- Canvas2D still splats the moving particles of an element whose rect is w == 0 (hidden); WebGPU hides them through element flags. Since W72 a device loss can switch renderers mid-session, so the difference can become visible; parking (slice 6) resolves it.
- The overdraw number is an estimate (quads × area at the T0 scale), not a GPU counter (D72-4).

## What Comes Next
- Slice 2 closed: `.wdd/memory/whole-picture/slice-2.md` + `slice-2-addendum.md` (steps 1–4, 6, 8 ✅; 5/7 ⏳).
- Slice 4 in progress: W74 done (liquid text in WebGPU). Next: W75 (MutationObserver, colour auto-refresh, atlas re-render on text/fonts/DPR, forced-colors/print with liquid-text active, refresh() and a11y under WebGPU, Canvas2D halo), then W76 (whole picture after slice 4, both renderers).
- Open: fate of the published `0.2.0-rc.0` (spec §7); publish of `0.3.0-alpha.x` is Dennis' call (`changeset version` + commit before tagging `v*`).
