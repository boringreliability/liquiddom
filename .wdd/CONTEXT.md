# Context — liquiddom

## Last Updated
Ward 87 complete — 2026-10-24 (whole picture after slice 6, gold approved by Dennis). 0.3.0-alpha.1 published 2026-10-24; epic 15 complete. Next: Epic 16 (W88 shadows).

## Current State
Epic 15 (Fluid Engine). `LiquidDOM.create()` runs a 2D MLS-MPM fluid in Rust/WASM (`FluidCore`), drawn by Canvas2D or WebGPU. Soft-body: tag `softbody-final`. Packages `0.3.0-alpha.1` (pre mode `alpha`), published on npm (`latest` + `alpha`, trusted publishing; 0.2.0-rc.0 deprecated); `site/` is the private workspace `@liquiddom/site` (Astro 7, core's dist; W86). Test totals: `.wdd/PROGRESS.md`, ward gold notes.

Canonical vision, acceptance scene (8 steps), slice matrix: `.wdd/NORTH-STAR.md`. Binding design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. Execution ledger, rulings: `.superpowers/sdd/README/progress.md` (git-ignored).

## Architecture Decisions Made
Soft-body decisions (W1–W62): `.wdd/memory/snapshots/`. Fluid decisions: `ward-NNN.md`, log in NORTH-STAR "Plan decisions":

| Decision | Rationale | Ward |
|-|-|-|
| MLS-MPM (APIC, quadratic B-splines) with home spring, chosen over PBF in a bake-off; Rust/WASM kept | Real fluid is the goal; spike is reference | D1–D2, W63 |
| FFI: element stride 10, dynamic SoA 7, static SoA 3, state stride 4; 7-arg constructor frozen | Flat views, no JSON | W64 (D64-4) |
| Rust owns the fixed-step accumulator (100 ms clamp, ≤ 3 × 1/60 s, 8 substeps), no hot-path allocation, `indexing_slicing` denied | Determinism, no JS-input panics | W64 |
| Public facade: whitelist options (removed ones throw with replacement), `observe(el, { viscosity, recovery, drag })` captured once, fixed pools, no `grow()` | 0.2 configs fail loudly | W66 (D66-1, -4, -10) |
| Injected `@layer liquiddom` stylesheet with `!important`, paint/stacking in `@media screen and (forced-colors: none)`; print/forced-colors hide the canvas | `revert-layer` fell to the UA default in print | W66 (D66-15 amended) |
| Shared refcounts: one stylesheet per document, one decoration per element across instances; colour snapshot lifts the class via `transition: none` | Multi-instance correctness | W66 |
| Canvas z -1; opaque ancestor or non-stacking container → warn, z 0 + D7 | Liquid under page text | W82 |
| `LoopController`: user pause and hidden tab are separate sources; dt reset on resume; first throwing frame stops it for good | No silent re-arm | W66 (D66-12) |
| WebGPU liquid: splat into T0 rgba16float + T0a r16float, composite with an fwidth edge, rest SDF overlay at restAlpha; T2 deferred | No 32-bit targets; Canvas2D parity via kernel-params.ts and Σw·a | W71 (D71-3…6) |
| `'auto'` = WebGPU on a hardware adapter, else Canvas2D (unavailable, software adapter or unusable surface) on a remounted canvas, one `console.info` unless `silentFallback`; explicit `'webgpu'` accepts SwiftShader; `device.lost` → in-place Canvas2D rebuild, one `console.warn` | WebGPU by default, nobody breaks | W72 (D72-1…3) |
| Liquid text in WebGPU: render-only F (every substep, σ clamp, sticky torn), rest needs max‖F − I‖ < 0.05, runtime-built atlas, T1/T1w at 1× in own pass, text composite after the rest SDF, refcounted liquid-text (fail-safe); damage drops restAlpha to 0 | Text flows, DOM text never hidden | W74 (D74-1…7) |
| Per-element MutationObserver (first old value per batch, own classes ignored); colour re-read on own class/style or a colour transitionend, deferred while a CSS transition runs; atlas re-render on text/fonts/DPR, one upload in flight | Text and colours follow the DOM | W75 (D75-1, -2) |
| Canvas2D DOM-text halo: liquid-halo + one data-liquid-id rule per element in the refcounted sheet, background-colour text-shadow while moving | Readable DOM text, no inline style | W75 (D75-3) |
| Playwright guards visuals/behaviour; Linux baselines from the pinned image, committed only after a vision check | jsdom sees no cascade | W65 (D65-7) |
| Site back as workspace (landing, playground, docs) on core's dist; blocking Playwright `site` (Canvas2D); deploy dispatch-only | Public API only, tested like the examples | W86 (D86-1…8) |
| `parseCssColor` hands unparsed syntax (oklch, lab, color(), named) to a cached 1×1 canvas probe | Tailwind colours, not default purple | W86 (D86-9) |
| Shadows follow the liquid: browser at rest, `liquid-shadow-away` + renderer while away (D88-1 … D88-14) | Exact at rest, follows in motion | W88 |

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
| Fixed-step p95 (local, 4 elements) | ~3.6 ms | W67 |
| RAF p95 local, canvas2d / webgpu | 3.40 / 3.815 ms | W66 / W72 |
| WASM size (opt-level 3) | ~85 kB | W65 |
| Splat overdraw est., shake peak (Metal; D72-4) | max 402341 fragments/frame | W72 |

## Known Limitations
- Pointer drag 12/s (W70): a fast sweep: trailing edge recedes ~8 px; holes at drag ≥ 18.
- Shake (W77): `1 + 0.35·sin(π·u + φ)`, cap 0.3, default yield J ≤ 1.46; x-only profile. Mirrored near viewport edges (W82). "Book a demo" beads ≈ 5 frames (D82-6).
- Drag (W78): re-form ≥ ≈113 frames; `recovery` > ≈1.1 s cannot re-form in 3 s (D78-5).
- Drag press: `selectstart` blocked document-wide (no drag-select in observed `<input>`/contenteditable, D78-2); if `setPointerCapture` throws (Firefox) the ending click may hit an ancestor, unswallowed; any keydown clears an armed swallow; in a pending Canvas2D rebuild a new drag may hide the label early; nested instances: a press drags both.
- Slice 6 (W80–W85: scroll, parking/resize, under the page, gravity, touch, adapters): full lists in CLAUDE.md's "Known" lines. Key: labels trail the liquid one frame per scroll step (D80-4); container must be positioned + a stacking context; touch/iOS checked only on a phone.
- Edge ring (D67-13): spacing cell/2 from the area hint (W85: set at the first batch without one).
- WebGPU e2e local only (`e2e:webgpu`, `-hw` on Metal); CI: soft smoke; no webgpu Linux baselines.
- A WebGPU canvas reads only in its render task; e2e uses `__liquidTest.pixels()`.
- Text while away: WebGPU carries it on its liquid (W74); Canvas2D adds a 1–8 px background-colour halo (W75), no solid backdrop for thin glyphs.
- Colour re-read (W75 B): own class/style or a `color` transitionend only, after its CSS transitions end; ancestor/stylesheet/`:hover` changes and `@keyframes` colours need `refresh(el)` (runs at once). Text can lag one atlas upload.
- Rewriting an observed element's inline style every frame costs a colour snapshot + atlas re-render per frame (W75); DOM text shows meanwhile.
- Liquid text (W74 v1, costs, W79): see CLAUDE.md's Renderers and DOM sections and `ward-074.md`.
- Hover swell + liquid text (W74): particles swell 2 %, DOM text not (≈ 1 px); a resting pointer can smear moving text.
- `activeRenderer` can change mid-session (W72): a lost WebGPU device makes it `'canvas2d'`; a frame or two draw nothing.
- Canvas2D cell `ceil(R)/6` (W82): ≈ 2.8× render time on large kernels; one fine-spaced element holds the page on the 2 px floor (W77).
- Colour probe (W86): needs a 2d canvas (null in jsdom); 256 cached strings.
- Shadows (W88): holes > ≈ 3 kernel radii show the shadow on their rim; WebGPU caps 16 density sources/frame (the rest keep a static browser shadow); a resting shadow paints over moving liquid. After `unobserve()` mid-motion the freed liquid carries the receivers' shadows for a few frames (speckled glow, WebGPU most visible).

## What Comes Next
- Epic 16 'Liquid look' (`.wdd/epics/16-liquid-look.md`): W88 shadows follow the liquid (in progress); further looks per the epic.
