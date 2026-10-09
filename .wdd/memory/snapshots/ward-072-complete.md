# Context — liquiddom

## Last Updated
Ward 72 — 2026-10-08 (slice 3 closed: `auto` = WebGPU with Canvas2D fallback, device.lost rebuild, steps 1–4, 6, 8 in both renderers; changeset minor → 0.3.0-alpha.1). Next: W73 fix ward for the card "lace" in WebGPU.

## Current State
Epic 15 (Fluid Engine), slice 1 complete: W63 north star + WDD rules, W64 liquid at rest, W65 verification harness, W66 public API swap. `LiquidDOM.create()` now runs on a 2D MLS-MPM fluid in Rust/WASM (`src/fluid/`, `FluidCore`), drawn by `FluidCanvas2DRenderer` (density grid + exact `roundRect` at rest). The soft-body engine (W6–W62) is deleted; its last state is the tag `softbody-final`.

Tests: cargo 50 (fluid only), vitest 330 + 4 skipped (gravity, slice 6), Playwright canvas2d 17 + 3 Linux-only visual specs (Linux baselines committed, vision-checked). Packages are `0.3.0-alpha.0` in changeset pre mode `alpha`; release plan `0.3.0-alpha.1` ×3, nothing published. `site/` is frozen until slice 6.

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
| RAF p95 webgpu (Metal, local) | 3.815 ms | W72 |
| Total tests | 50 Rust + 330 TS + 17 Playwright | W66 |

## Known Limitations
- Slice 2 is in progress: splash and shake (W67) and the soft pointer field, hover swell, `setMaterial`/`getMaterial` and material presets (W68) are live; no liquid text yet.
- Pointer idle decay (D68-4, W68): the ×0.8 velocity decay is per frame, so at 120 Hz the tail decays twice as fast in wall time as at 60 Hz.
- Pointer drag 12/s (W70): a fast sweep lets a pill's trailing edge recede up to ~8 px; interior holes start at drag ≥ 18 (measured), so the e2e no-hole lattice is 10 px inside the contour.
- Shake profile (W70, D70-1): the speed profile `1 + 0.8·sin(π·u + φ)` varies along x only (`u = (x − cx)/(w/2)`), so a tall element gets no vertical wave. At cap 0.2 the shake reads as violent (labels left on bare background for ~0.5 s; the card's lace is partly the density renderer's bead chains, a slice-3 carry).
- Container mode needs a positioned container (one `console.warn` if static; liquiddom never restyles it).
- Gravity is validated but has no effect until slice 6; scroll is verified only in slice 6.
- A large scroll can lock particles across elements (W67 slip, slice-6 parking).
- Edge ring (D67-13, W67): the in-motion edge envelope sd is 0.120 px at 120 px/s (W67 metric; W64's R2 layout scored ≈ 0.6–0.7 px with it). The ring spacing is cell/2, from the area hint, so when the hint is far off the ring is a little denser or sparser than the interior.
- The first frame that throws stops the instance (unchanged in W67); adapters do not yet react to a stopped instance.
- No browser loads the published `dist` yet (carry to W69 whole-picture check).
- WebGPU acceptance (steps 1–3, shader validation, translucent colour) runs only locally (`npm run e2e:webgpu` / `e2e:webgpu-hw` on Metal); CI runs the soft smoke only (W71.0 spike: every rendering test loses the device within 2–5 frames on SwiftShader inside the pinned container, on native arm64 and on the GitHub runner; reason 'destroyed' or 'unknown', no validation errors). There are no webgpu Linux baselines (spike answer NO in W72; steps 4, 6, 8 and device.lost (W72) included in the local-only runs).
- A WebGPU canvas is readable only in the task that rendered it; the e2e helpers read `__liquidTest.pixels()` (a snapshot taken in advance()).
- DOM-text contrast while the liquid is away (D72-5): under both renderers an element's DOM text sits on the bare page during a splash or shake; the halo / liquid text is slice 4.
- `activeRenderer` can change during an instance's life (W72): a lost WebGPU device switches it to `'canvas2d'`; a frame or two during the rebuild draw nothing.
- Canvas2D still splats the moving particles of an element whose rect is w == 0 (hidden); WebGPU hides them through element flags. Since W72 a device loss can switch renderers mid-session, so the difference can become visible; parking (slice 6) resolves it.
- The overdraw number is an estimate (quads × area at the T0 scale), not a GPU counter (D72-4).

## What Comes Next
- Slice 2 closed: `.wdd/memory/whole-picture/slice-2.md` + `slice-2-addendum.md` (steps 1–4, 6, 8 ✅; 5/7 ⏳).
- Slice 3 is closed (W71 + W72, 2026-10-08). Next: **W73 fix ward** for the card "lace" (thin light tears inside the card during shake, visible in WebGPU; Dennis 2026-10-08, saga dec_3342ac32), then plan slice 4 (liquid text, T1/T2, forced-colors, DOM-text halo decision); the whole-picture check after slice 4 is the first in both renderers.
- Open: fate of the published `0.2.0-rc.0` (spec §7); publish of `0.3.0-alpha.x` is Dennis' call (`changeset version` + commit before tagging `v*`).
