# Context — liquiddom

## Last Updated
Ward 82 — 2026-10-14 (under the page). Next: W83 gravity and tilt.

## Current State
Epic 15 (Fluid Engine). `LiquidDOM.create()` runs a 2D MLS-MPM fluid in Rust/WASM (`FluidCore`), drawn by Canvas2D or WebGPU. The soft-body engine is the tag `softbody-final`. Packages `0.3.0-alpha.x` (pre mode `alpha`), unpublished; `site/` frozen until slice 6. Test totals: `.wdd/PROGRESS.md`, ward gold notes.

Canonical vision, acceptance scene (8 steps), slice matrix: `.wdd/NORTH-STAR.md`. Binding design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. Execution ledger, rulings: `.superpowers/sdd/README/progress.md` (git-ignored).

## Architecture Decisions Made
Soft-body decisions (W1–W62): `.wdd/memory/snapshots/`. Active fluid decisions (full text `ward-063..066.md`, log in NORTH-STAR "Plan decisions"):

| Decision | Rationale | Ward |
|-|-|-|
| MLS-MPM (APIC, quadratic B-splines) with home spring, chosen over PBF in a bake-off; Rust/WASM kept | Real fluid is the goal; spike is reference | D1–D2, W63 |
| FFI: element stride 10, dynamic SoA 7, static SoA 3, state stride 4; 7-arg constructor frozen | Flat views, no JSON | W64 (D64-4) |
| Rust owns the fixed-step accumulator (100 ms clamp, ≤ 3 × 1/60 s, 8 substeps), no hot-path allocation, `indexing_slicing` denied | Determinism, no JS-input panics | W64 |
| Public facade: whitelist options (removed ones throw with replacement), `observe(el, { viscosity, recovery })` captured once, fixed pools, no `grow()` | 0.2 configs fail loudly | W66 (D66-1, -4, -10) |
| Injected `@layer liquiddom` stylesheet with `!important`, paint/stacking in `@media screen and (forced-colors: none)`; print/forced-colors hide the canvas | `revert-layer` fell to the UA default in print | W66 (D66-15 amended) |
| Shared refcounts: one stylesheet per document, one decoration per element across instances; colour snapshot lifts the class via `transition: none` | Multi-instance correctness | W66 |
| Canvas z -1; opaque ancestor or non-stacking container → warn, z 0 + D7 | Liquid under page text | W82 |
| `LoopController`: user pause and hidden tab are separate sources; dt reset on resume; first throwing frame stops the instance for good | No silent re-arm | W66 (D66-12) |
| WebGPU liquid: splat into T0 rgba16float + T0a r16float, composite with an fwidth edge, rest SDF overlay at restAlpha; T2 deferred | No 32-bit targets; Canvas2D parity via kernel-params.ts and Σw·a | W71 (D71-3…6) |
| `'auto'` = WebGPU on a hardware adapter, else Canvas2D (unavailable, software adapter or unusable surface) on a remounted canvas, one `console.info` unless `silentFallback`; explicit `'webgpu'` accepts SwiftShader; `device.lost` → in-place Canvas2D rebuild, one `console.warn` | WebGPU by default, nobody breaks | W72 (D72-1, D72-2, D72-3) |
| Liquid text in WebGPU: render-only F (every substep, σ clamp, sticky torn), rest needs max‖F − I‖ < 0.05, runtime-built atlas, T1/T1w at 1× in own pass, text composite after the rest SDF, refcounted liquid-text (fail-safe); damage drops restAlpha to 0 | Text flows, DOM text never hidden | W74 (D74-1…7) |
| Per-element MutationObserver (first old value per batch, own classes ignored); colour re-read on own class/style or a colour transitionend, deferred while a CSS transition runs; atlas re-render on text/fonts/DPR, one upload in flight | Text and colours stay true to the DOM | W75 (D75-1, D75-2) |
| Canvas2D DOM-text halo: liquid-halo + one data-liquid-id rule per element in the refcounted sheet, background-colour text-shadow while moving | Readable DOM text, no inline style | W75 (D75-3) |
| Playwright guards visuals/behaviour; Linux baselines from the pinned image, committed only after a vision check | jsdom sees no cascade | W65 (D65-7) |

## Active Constraints
- Rust er DOM-blind og farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Faste pools (`particles`, `maxElements`) sat ved `create()`; ingen `grow()`
- Canvas ligger under DOM'en (D7); rendering rører aldrig DOM'en
- Kun `ts/src/wasm-loader.ts` importerer `pkg/`

## Key Metrics
| Metric | Value | Ward |
|-|-|-|
| Particles (default) | 8000 (range 256–65536) | W66 |
| Fixed-step p95 (local, 4 elements; W67) | ~3.6 ms | W67 |
| RAF p95 (local) | 3.40 ms | W66 |
| WASM size (opt-level 3) | ~85 kB | W65 |
| Splat overdraw estimate, shake peak (webgpu, Metal; D72-4) | max 402341 fragments/frame | W72 |
| RAF p95 webgpu | 3.815 ms | W72 |

## Known Limitations
- Pointer idle decay (D68-4): ×0.8 per frame; at 120 Hz the tail decays twice as fast.
- Pointer drag 12/s (W70): a fast sweep: trailing edge recedes ~8 px; holes at drag ≥ 18.
- Shake (W77): `1 + 0.35·sin(π·u + φ)`, cap 0.3, default yield J ≤ 1.46; x-only profile. Mirrored near viewport edges (W82). "Book a demo" beads ≈ 5 frames (D82-6).
- Drag (W78): mouse/pen only, no opt-out; re-form ≥ ≈113 frames; `recovery` > ≈1.1 s cannot re-form in 3 s (D78-5).
- Drag press: `selectstart` blocked document-wide (no drag-select in observed `<input>`/contenteditable, D78-2); if `setPointerCapture` throws (Firefox) the ending click may hit an ancestor, unswallowed; any keydown clears an armed swallow; in a pending Canvas2D rebuild a new drag may hide the label early; nested instances: a press drags both.
- Container mode: positioned + a stacking context (`isolation: isolate`), else warn + z 0 (W82); never restyled.
- Gravity: validated, inert until W83.
- Scroll (W80): rigid shift + capped inertia (D80-2); fixed/stuck-sticky elements not shifted. While scrolling, DOM labels sit 60–100 px off their liquid for a frame per scroll step, both renderers; none at rest (D80-4).
- Parking (W81): outside world + margin an element is not simulated, re-enters at rest; partly outside keeps wall-clamped liquid. A translated container canvas keeps its scroll range after the content shrinks (W80).
- `resize_world` (W81): a margin near 8192 px needs ≈ 450 MB of grid (200 px: ≈ 55 MB).
- Edge ring (D67-13): spacing cell/2 from the area hint; a far-off hint changes density.
- The first throwing frame (or a failing `resize_world`) stops the instance; adapters do not react.
- WebGPU e2e local only (`e2e:webgpu`, `-hw` on Metal); CI: soft smoke; no webgpu Linux baselines.
- A WebGPU canvas reads only in its render task; e2e uses `__liquidTest.pixels()`.
- Text while away: WebGPU carries it on its liquid (W74); Canvas2D adds a 1–8 px background-colour halo (W75), no solid backdrop for thin glyphs.
- Colour re-read (W75 B): own class/style or a `color` transitionend only, after its CSS transitions end; ancestor/stylesheet/`:hover` changes and `@keyframes` colours need `refresh(el)` (runs at once). Text can lag one atlas upload.
- Rewriting an observed element's inline style every frame costs a colour snapshot + atlas re-render per frame (W75); DOM text shows meanwhile.
- Liquid text v1 (W74, D74-5): text nodes only; underline, text-shadow, icons, images, SVG, form values/placeholders, `::before`/`::after` hide while moving; `capitalize` per word; atlas ≤ 4096² px (else DOM text stays); words clipped to the border box (overflow vanishes while moving).
- Liquid text costs: whole atlas page re-renders on a generation, paints or text change; two GPU pages (one staged); T1/T1w/T1id stay allocated. W79: no text where text liquids meet.
- Hover swell + liquid text (W74): particles swell 2 %, DOM text not (≈ 1 px); a resting pointer can smear moving text.
- `activeRenderer` can change mid-session (W72): a lost WebGPU device makes it `'canvas2d'`; a frame or two draw nothing.
- Canvas2D cell `ceil(R)/6` (W82): ≈ 2.8× render time on large kernels; one fine-spaced element holds the page on the 2 px floor (W77).
- Stacking check (W82): stacking-context `<body>` + opaque html/body falls back (z 0); negative-z ancestor contexts and ancestors beyond a shadow host are missed (canvas may cover their text).

## What Comes Next
- Slices 1–5 closed (whole pictures: `.wdd/memory/whole-picture/`). Slice 6: W80–W82 done; next W83.
- Open: fate of the published `0.2.0-rc.0` (spec §7); publishing `0.3.0-alpha.x` is Dennis' call.
