# Context — liquiddom

## Last Updated
Ward 1 started — 2026-03-30

## Current State
Ward 1 (Memory Layout & Buffer Allocation) — RED phase. Skriver fejlende tests for EntityBuffer.

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` buffer, 8 floats per entity | 32-byte alignment, zero-copy til JS Float32Array, ingen GC | W1 |
| Ingen wasm_bindgen i Ward 1 | Ren Rust-kerne først, FFI tilføjes i Ward 4 | W1 |

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
- Ward 1: Memory Layout & Buffer Allocation (RED → tests)
