# Context — liquiddom

## Last Updated
Ward 80 — 2026-10-13 (scroll follows). Next: W81 parking and resize.

## Current State
Epic 15 (Fluid Engine): slices 1–5 closed. `LiquidDOM.create()` runs a 2D MLS-MPM fluid in Rust/WASM (`FluidCore`), drawn by Canvas2D or WebGPU. The soft-body engine is the tag `softbody-final`. Packages `0.3.0-alpha.x` (pre mode `alpha`), nothing published; `site/` frozen until slice 6. Test totals: `.wdd/PROGRESS.md` and the ward gold notes.

Canonical vision, acceptance scene (8 steps) and slice matrix: `.wdd/NORTH-STAR.md`. Binding design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. Execution ledger and rulings: `.superpowers/sdd/README/progress.md` (git-ignored).

## Architecture Decisions Made
Soft-body decisions (W1–W62) are snapshotted in `.wdd/memory/snapshots/`. Active fluid decisions (full text in `ward-063..066.md`, log in NORTH-STAR "Plan decisions"):

| Decision | Rationale | Ward |
|----------|-----------|------|
| MLS-MPM (APIC, quadratic B-splines) with home spring, chosen over PBF in a bake-off; Rust/WASM kept | Real fluid is the goal; spike is reference | D1–D2, W63 |
| FFI: element stride 10, dynamic SoA 7, static SoA 3, state stride 4; 7-arg constructor frozen | Flat views, no JSON | W64 (D64-4) |
| Rust owns the fixed-step accumulator (100 ms clamp, ≤ 3 × 1/60 s, 8 substeps); no hot-path allocation; `indexing_slicing` denied | Determinism, no panics on JS input | W64 |
| Public facade: whitelist options (removed ones throw with replacement), `observe(el, { viscosity, recovery })` captured once, fixed pools, no `grow()` | 0.2 configs fail loudly | W66 (D66-1, -4, -10) |
| Injected `@layer liquiddom` stylesheet with `!important`, paint/stacking scoped to `@media screen and (forced-colors: none)`; print/forced-colors hide the canvas | `revert-layer` fell back to the UA default in print | W66 (D66-15 amended) |
| Shared refcounts: one stylesheet per document, one decoration per element across instances; colour snapshot lifts the class with `transition: none` | Multi-instance correctness | W66 |
| `LoopController`: user pause and hidden tab are separate sources; dt reset on resume; first throwing frame stops the instance for good | No silent re-arm | W66 (D66-12) |
| WebGPU liquid: splat into T0 rgba16float + T0a r16float, composite with an fwidth edge, rest SDF overlay at restAlpha; T2 deferred | No 32-bit targets; Canvas2D parity through kernel-params.ts and Σw·a | W71 (D71-3…6) |
| `'auto'` = WebGPU on a hardware adapter, Canvas2D fallback (unavailable, software adapter or unusable presentation surface) on a remounted canvas, one `console.info` unless `silentFallback`; explicit `'webgpu'` accepts SwiftShader; `device.lost` → Canvas2D rebuild in place, one `console.warn` | WebGPU by default, nobody breaks | W72 (D72-1, D72-2, D72-3) |
| Liquid text in WebGPU: render-only F (every substep, σ clamp, sticky torn), rest needs max‖F − I‖ < 0.05, runtime-built atlas, T1/T1w at 1× in its own pass, text composite after the rest SDF, refcounted liquid-text with fail-safe; damage drops restAlpha to 0 | Text flows, DOM text never hidden | W74 (D74-1…7) |
| Per-element MutationObserver (first old value per batch, own classes ignored); colour re-read on the element's own class/style or a colour transitionend, deferred while a CSS transition runs; atlas re-render on text/fonts/DPR, one upload in flight | Text and colours stay true to the DOM | W75 (D75-1, D75-2) |
| Canvas2D DOM-text halo: liquid-halo + one data-liquid-id rule per element in the refcounted sheet, text-shadow in the background colour while moving | Readable DOM text, no inline style | W75 (D75-3) |
| Playwright is the visual/behaviour guard; Linux baselines from the pinned image, committed only after a vision check | jsdom sees no cascade | W65 (D65-7) |

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
| Fixed-step p95 (local, 4 elements; W67) | ~3.6 ms | W67 |
| RAF p95 (local) | 3.40 ms | W66 |
| WASM size (opt-level 3) | ~85 kB | W65 |
| Splat overdraw estimate, shake peak (webgpu, Metal; D72-4) | max 402341 fragments/frame | W72 |
| RAF p95 webgpu | 3.815 ms | W72 |

## Known Limitations
- Pointer idle decay (D68-4): ×0.8 per frame, so at 120 Hz the tail decays twice as fast.
- Pointer drag 12/s (W70): a fast sweep lets a trailing edge recede ~8 px; holes start at drag ≥ 18.
- Shake (W77): `1 + 0.35·sin(π·u + φ)`, cap 0.3, default yield J ≤ 1.46; x-only profile.
- Drag (W78): mouse/pen only, no opt-out; re-form ≥ ≈113 frames; per-element `recovery` > ≈1.1 s cannot re-form in 3 s (D78-5).
- Drag press: `selectstart` blocked document-wide (no drag-select in observed `<input>`/contenteditable, D78-2); if `setPointerCapture` throws (Firefox) the ending click may hit an ancestor, unswallowed; any keydown clears an armed swallow; in a pending Canvas2D rebuild a new drag may hide the label early. Two instances on nested elements: one press drags both.
- Container mode needs a positioned container (`console.warn` if static; never restyled).
- Gravity is validated but inert until W83.
- Scroll (W80): rigid shift + capped inertia (D80-2); fixed/stuck sticky elements are not shifted. While scrolling, DOM labels sit 60–100 px off their liquid for a frame per scroll step (both renderers); none at rest (D80-4).
- Elements past the grid margin clamp to the walls until W81 parking. A translated container canvas keeps the old scroll range after the content shrinks (W80).
- Edge ring (D67-13): spacing cell/2 from the area hint, so a far-off hint makes it denser or sparser.
- The first frame that throws stops the instance; adapters do not yet react to it.
- WebGPU e2e is local only (`e2e:webgpu`, `e2e:webgpu-hw`, Metal); CI runs the soft smoke. No webgpu Linux baselines.
- A WebGPU canvas reads only in its render task; e2e uses `__liquidTest.pixels()`.
- Text while the liquid is away: WebGPU carries it on its liquid (W74); Canvas2D adds a 1–8 px halo in the background colour (W75), not a solid backdrop for thin glyphs.
- Colour re-read (W75 B): own class/style or a `color` transitionend only, after the element's CSS transitions end; ancestor/stylesheet/`:hover` changes and `@keyframes` colours need `refresh(el)`, which runs at once. Text can run one atlas upload behind.
- An author rewriting an observed element's inline style every frame costs one colour snapshot and one atlas re-render per frame (W75); its DOM text shows meanwhile.
- Liquid text v1 (W74, D74-5): text nodes only; underline, text-shadow, icons, images, SVG, form values/placeholders and `::before`/`::after` text hide while the text moves; `capitalize` is per word; atlas ≤ 4096² px (else the DOM text stays); words are clipped to the border box (overflow vanishes while moving).
- Liquid text costs: the whole atlas page re-renders on any generation, paints or text change; two pages on the GPU (one staged); T1/T1w/T1id stay allocated. W79: no text where text liquids meet.
- Hover swell with liquid text (W74): particles swell 2 % while the DOM text does not (≈ 1 px glyph shift on the switch); a resting pointer can smear moving text.
- `activeRenderer` can change mid-session (W72): a lost WebGPU device makes it `'canvas2d'`; a frame or two draw nothing.
- Canvas2D still splats a hidden (w == 0) element's particles (WebGPU hides them); W81 parking resolves it.
- Canvas2D cell (W77): one fine-spaced element holds the whole page on the 2 px grid, where R up to 16 px costs ≈1.5×.

## What Comes Next
- Slice 2 closed: `.wdd/memory/whole-picture/slice-2.md` + addendum.
- Slices 4 and 5 closed. Slice 6: W80 scroll; next W81.
- Open: fate of the published `0.2.0-rc.0` (spec §7); publishing `0.3.0-alpha.x` is Dennis' call (`changeset version`, commit, tag `v*`).
