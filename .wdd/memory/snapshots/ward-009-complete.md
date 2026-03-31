# Context — liquiddom

## Last Updated
Ward 1 started — 2026-03-30

## Current State
Phase 2 COMPLETE. Physics→FFI bridge: EntityBody lazy creation, particle_data buffer, wireframe debugRender. 20 Rust + 12 TS = 32 tests, 0 warnings. Visuelt verificeret: soft body deformation ved 60 FPS.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` buffer, 8 floats per entity | 32-byte alignment, zero-copy til JS Float32Array, ingen GC | W1 |
| Ingen wasm_bindgen i Ward 1 | Ren Rust-kerne først, FFI tilføjes i Ward 4 | W1 |
| `Vec::resize` til grow | Bevarer data, nul-initialiserer ny plads, ingen manuell kopi | W1 |
| Pointer invalideres ved grow | JS SKAL re-fetche ptr() efter grow — løst via rebindBuffer() | W1/W4 |
| PhantomObserver dual-mode | Lokal Float32Array eller WASM memory view via WasmMemorySource | W4 |
| tick() aktiverer på width!=0 | Zero-cost "alive" convention, ingen ekstra bookkeeping | W4 |

## Active Constraints
- Rust er DOM-blind og Farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Pre-allokeret buffer pool (ingen entity churn)

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Entities per buffer | 1000 (initial) | W1 |
| Floats per entity | 8 (32 bytes) | W1 |

## Known Limitations
_None yet_

## What Comes Next
- Ward 9: Collision & Repulsion (mus-interaktion, force falloff)
- Phase 3: Liquid Rendering (WGPU)
