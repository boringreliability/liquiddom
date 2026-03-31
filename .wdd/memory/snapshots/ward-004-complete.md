# Context — liquiddom

## Last Updated
Ward 1 started — 2026-03-30

## Current State
Ward 3 COMPLETE. Phase 1 Rust+TS fundamenter på plads. 12 Rust tests + 5 TS tests = 17 total, 0 warnings.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` buffer, 8 floats per entity | 32-byte alignment, zero-copy til JS Float32Array, ingen GC | W1 |
| Ingen wasm_bindgen i Ward 1 | Ren Rust-kerne først, FFI tilføjes i Ward 4 | W1 |
| `Vec::resize` til grow | Bevarer data, nul-initialiserer ny plads, ingen manuell kopi | W1 |
| Pointer invalideres ved grow | JS SKAL re-fetche ptr() efter grow — constraint for Ward 4 | W1 |

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
- Integration Spec 1: FFI Sync Protocol dokumentation
- Ward 4: FFI Integration & Tick Event (TS/Rust — forbind delt hukommelse)
