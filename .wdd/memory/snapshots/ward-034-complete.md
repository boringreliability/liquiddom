# Context — liquiddom

## Last Updated
Ward 25 — 2026-04-22

## Current State
All 25 wards COMPLETE. 28 Rust + 59 TS = 87 tests. 0 clippy warnings, 0 TS errors. NPM-ready package.

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

## Known Limitations
- Container mode assumes positioned containing block
- Focus events only fire on natively focusable elements
- Reduced motion still runs RAF loop (sync/render active, physics frozen)
- `backdrop-filter` on elements will filter canvas particles behind them (browser limitation, not fixable without moving canvas above DOM)
- `preserveBackgrounds: true` clips to rectangular element rect only — border-radius not matched in v1
- `box-shadow` may be partially clipped when `preserveBackgrounds` is enabled

## What Comes Next
- Ward 027: Coordinate System Unification
- Ward 028: Transparent Background Compatibility
- Epic 08: Interaction Primitives (W29-W32)
- Epic 09: Demo Scenes (W33-W34)
