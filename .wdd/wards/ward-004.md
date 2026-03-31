---
ward: 4
revision: null
name: "FFI Integration & Tick Event"
epic: "state-ffi"
status: "complete"
dependencies: [1, 2, 3]
layer: "both"
estimated_tests: 4
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 004: FFI Integration & Tick Event

## Scope
Erstat mock Float32Array i PhantomObserver med direkte memory-view ind i Rusts EntityBuffer via wasm-bindgen. Etablér WasmApi (LiquidCore) som TS bruger til at starte systemet og kalde tick().

## Inputs
- EntityBuffer + EntityRefMut (Rust, Ward 1+2)
- PhantomObserver (TS, Ward 3)
- Integration Spec 1 (FFI Sync Protocol)

## Outputs
- `src/api.rs`: `LiquidCore` struct med `#[wasm_bindgen]`
- Opdateret PhantomObserver der forbindes til WASM memory
- Komplet RAF-loop prototype

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_wasm_core_initialization` | LiquidCore instantiering + valid pointer |
| 2 | `test_ts_writes_are_visible_in_rust` | TS skriver til array view → synligt i WASM memory |
| 3 | `test_rust_tick_mutates_memory` | tick() muterer buffer → TS kan læse ændringen |
| 4 | `test_buffer_grow_reestablishes_view` | grow() → PhantomObserver genskaber Float32Array view |

## Must NOT
- Ingen DOM manipulation i Rust
- Ingen JSON over FFI
- Ingen fysik endnu (tick() er dummy-mutation)

## Must DO
- `crate-type = ["cdylib"]` i Cargo.toml
- wasm-pack build --target web
- Håndtér pointer invalidation ved grow()

## Verification
- Alle 4 TS/Vitest tests grønne
- wasm-pack build uden fejl
- Ward 3 tests stadig grønne
