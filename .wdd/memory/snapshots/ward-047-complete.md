# Context — liquiddom

## Last Updated
Ward 47 — 2026-05-13

## Current State
37 wards COMPLETE, Ward 47 GOLD (awaiting human approval). 43 Rust + 111 TS = 154 tests. 0 clippy warnings, 0 TS errors. React adapter at `adapters/react/` (pre-staged; W51 will move to `packages/react/`).

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` buffer, 8 floats per entity | 32-byte alignment, zero-copy til JS Float32Array, ingen GC | W1 |
| `Vec::resize` til grow | Bevarer data, nul-initialiserer ny plads | W1 |
| Zero-copy EntityRef/EntityRefMut | Lifetimed slices, ingen data-kopiering | W2 |
| WasmBridge ejer al pointer/view logik | PhantomObserver har nul WASM-viden | W15 |
| Instance-based API via closures | Nul statisk state, multiple instanser mulige | W13 |
| Idempotent observe + destroy | Duplicate observe returnerer same ID, destroy er no-op ved gentagne kald | W13-14 |
| dt clamping + visibility auto-pause | Math.min(rawDt, maxDt), visibilitychange listener | W17 |
| DPR via setTransform per frame | Kumulativ scale() undgås, CSS-pixel coords bevaret | W18 |
| Reduced motion via dt=0 | Partikler i hvile, loop kører stadig for sync/render | W19 |
| Pointer Events erstatter Mouse Events | Unified touch/pen/mouse via PointerEvent API | W19 |
| Container mode via config switch | Canvas mount, resize, coords, culling — alt container-relative | W20 |
| Neighbor springs + Shoelace area | Bilateral constraints, shape preservation, centroid anchoring | W22 |
| Config via tick() parametre | Ingen separat config-FFI, TS sender per-frame | W23 |
| Rigid translation ved base_pos delta | Partikler teleporterer med DOM, fjedre kun for deformation | W26 |
| Viewport-relative coords med container offset | getBoundingClientRect + coordOffset for container mode | W27 |
| `dist/wasm/` shipping pattern | wasm-pack's `pkg/.gitignore: *` blocks npm pack; copy to `dist/wasm/` at build, drop the gitignore, patch `dist/index.js` import path | W35 |
| FLOATS_PER_ENTITY 8 → 9, slot[8] = `border_radius_px` | First coordinated FFI bump; slot[4] verified as `interaction_state` (hover/focus), no free slot in 0–7; W43 (FreeDrop) and W46 (gravity) will make further bumps as their own deliberate revisions | W42 |
| Centered point placement + symmetry-preserving remainder distribution | Rounded-rect perimeter sampling at offset `(j+0.5)·L/n` avoids segment-junction ambiguity; remainder distributed as 4-arc groups then h-pair then v-pair so pill/circle stay bilaterally symmetric | W42 |
| Live physics update via setPhysicsConfig | Partial merge validated atomically before mutation; colors require instance rebuild (v1); particleCount not live-tunable | W49 |
| React adapter via Context + useLiquidRef | Zero core changes; provider owns instance, hook returns callback-ref with state-trigger pattern; strict-mode safe via idempotent observe | W47 |

## Active Constraints
- Rust er DOM-blind og Farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Pre-allokeret buffer pool (ingen entity churn)
- Eksplicit grow only (ingen auto-grow)

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Floats per entity | 8 (32 bytes) | W1 |
| Particles per body | 16 | W8 |
| Package size (gzipped) | ~8 kB (+ ~15 kB WASM) | W24 |
| Total tests | 87 (28 Rust + 59 TS) | W25 |
| Total tests | 124 (35 Rust + 89 TS) | W35 |
| Floats per entity | 9 (36 bytes) | W42 |
| Total tests | 138 (43 Rust + 95 TS) | W42 |
| Total tests | 145 (43 Rust + 102 TS) | W49 |
| Total tests | 154 (43 Rust + 111 TS) | W47 |

## Known Limitations
- Container mode assumes positioned containing block
- Focus events only fire on natively focusable elements
- Reduced motion still runs RAF loop (sync/render active, physics frozen)
- `backdrop-filter` on elements will filter canvas particles behind them (browser limitation, not fixable without moving canvas above DOM)
- `preserveBackgrounds: true` clips to rectangular element rect only — border-radius not matched (planned for W53)
- `box-shadow` may be partially clipped when `preserveBackgrounds` is enabled (planned for W54)
- Per-corner mixed (`10px 20px`) and per-axis elliptical (`10px / 5px`) `border-radius` values fall back to the first token (W42 v1 limitation)
- Runtime `border-radius` changes after `observe()` are NOT reflected — re-observe required (W42 v1 limitation)
- `calc()` / `min()` / `max()` may fall back to 0 if `getComputedStyle` does not resolve them (W42)

## What Comes Next
- Further demo polish and recording
- NPM publish preparation
- WebGPU rendering exploration
