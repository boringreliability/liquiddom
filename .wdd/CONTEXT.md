# Context — liquiddom

## Last Updated
Ward 76 — 2026-10-10 (whole picture after slice 4 in both renderers + landing page; step 6 ❌ by Dennis). Next: fix ward before slice 5.

## Current State
Epic 15 (Fluid Engine): slices 1–4 closed. `LiquidDOM.create()` runs a 2D MLS-MPM fluid in Rust/WASM (`FluidCore`), drawn by Canvas2D or WebGPU. The soft-body engine is the tag `softbody-final`. Packages `0.3.0-alpha.x` (pre mode `alpha`), nothing published; `site/` frozen until slice 6. Test totals: `.wdd/PROGRESS.md` and the ward gold notes.

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
| Per-element MutationObserver (first old value per batch, own classes ignored); colour re-read on the element's own class/style or a colour transitionend, deferred while a CSS transition runs; atlas re-render on text/fonts/DPR, one upload in flight | Text and colours stay true to the DOM without a refresh loop | W75 (D75-1, D75-2) |
| Canvas2D DOM-text halo: liquid-halo + one data-liquid-id rule per element in the refcounted sheet, text-shadow in the background colour while moving | Readable DOM text while the liquid is away, no inline style | W75 (D75-3) |
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
| Fixed-step p95 (local, 4 elements; W66 3.31, W67 full substep) | ~3.6 ms | W67 |
| RAF p95 (local) | 3.40 ms | W66 |
| WASM size (opt-level 3) | ~85 kB | W65 |
| Splat overdraw estimate, shake peak (webgpu, Metal; an estimate, not a GPU counter, D72-4) | max 402341 fragments/frame | W72 |
| RAF p95 webgpu | 3.815 ms | W72 |

## Known Limitations
- Pointer idle decay (D68-4): the ×0.8 decay is per frame, so at 120 Hz the tail decays twice as fast in wall time.
- Pointer drag 12/s (W70): a fast sweep lets a trailing edge recede up to ~8 px; holes start at drag ≥ 18 (e2e lattice 10 px inside).
- Shake profile (W70/W73, amplitude 0.5, cap 0.3): `1 + 0.5·sin(π·u + φ)` varies along x only, so a tall element gets no vertical wave.
- OPEN (pre-existing, for Dennis' playground session): the honey preset re-forms in 279–292 frames, above the 3 s budget.
- Container mode needs a positioned container (`console.warn` if static; never restyled).
- Gravity is validated but has no effect until slice 6; scroll is verified only in slice 6.
- A large scroll can lock particles across elements (W67 slip, slice-6 parking).
- Edge ring (D67-13): spacing cell/2 from the area hint, so a far-off hint makes it denser or sparser.
- The first frame that throws stops the instance; adapters do not yet react to it.
- WebGPU e2e runs only locally (`e2e:webgpu`, `e2e:webgpu-hw` on Metal); CI runs the soft smoke (W71.0: SwiftShader loses the device within 2–5 frames in CI). No webgpu Linux baselines (W72).
- A WebGPU canvas is readable only in the task that rendered it; e2e reads `__liquidTest.pixels()`.
- Text while the liquid is away: WebGPU carries it on its liquid (W74); Canvas2D adds a 1–8 px halo in the background colour (W75), not a solid backdrop for thin glyphs.
- Colour re-read (W75 B): own class/style or a `color` transitionend only, after the element's CSS transitions end; ancestor/stylesheet/`:hover` changes and `@keyframes` colours need `refresh(el)`, which runs at once (it cuts a running transition). Text can run one atlas upload behind.
- An author rewriting an observed element's inline style every frame costs one colour snapshot and one atlas re-render per frame (W75); its DOM text shows meanwhile.
- Liquid text v1 (W74, D74-5): text nodes only; underline, text-shadow, icons, images, SVG, form values/placeholders and `::before`/`::after` text hide while the text moves; `capitalize` is per word; atlas ≤ 4096² px (else the DOM text stays); words are clipped to the border box, so overflowing text vanishes while moving.
- Liquid text costs: the whole atlas page is re-rendered on any generation, paints or text change (v1); two pages on the GPU (one staged); T1/T1w stay allocated.
- Hover swell with liquid text (W74): particles swell 2 % while the DOM text does not (≈ 1 px glyph shift at the edges on the switch); a pointer resting on a moving card can smear its text.
- `activeRenderer` can change mid-session (W72): a lost WebGPU device switches it to `'canvas2d'`; a frame or two draw nothing.
- Canvas2D still splats the particles of a hidden (w == 0) element; WebGPU hides them through flags. Parking (slice 6) resolves it.

## What Comes Next
- Slice 2 closed: `.wdd/memory/whole-picture/slice-2.md` + addendum (steps 1–4, 6, 8 ✅; 5/7 ⏳).
- Slice 4 closed (W74–W76): `.wdd/memory/whole-picture/slice-4.md` + landing page. Next: a fix ward (shake lace on wide surfaces, step 6 ❌; neighbour disturbance; honey), then slice 5.
- Open: fate of the published `0.2.0-rc.0` (spec §7); publishing `0.3.0-alpha.x` is Dennis' call (`changeset version`, commit, tag `v*`).
