---
ward: 1
revision: null
name: "Memory Layout & Buffer Allocation"
epic: "state-ffi"
status: "complete"
dependencies: []
layer: "rust"
estimated_tests: 6
created: "2026-03-30"
completed: "2026-03-30"
---
# Ward 001: Memory Layout & Buffer Allocation

## Scope
Design og allokering af en flat `Vec<f32>` buffer der kan deles med JavaScript via WebAssembly memory. Bufferen holder bounding boxes og states for Phantom DOM elementer. 8 floats per entity (32 bytes), zero-overhead, GC-fri.

## Inputs
Ingen — dette er det første Ward.

## Outputs
- `EntityBuffer` struct med allokering, pointer-eksponering, resize og indeksering
- Bruges af Ward 2 (Buffer Mutation API) og Ward 4 (FFI Integration)

## Specification

### Data Layout
Hver entity optager 8 consecutive `f32` values:
- `[0]` x position
- `[1]` y position
- `[2]` width
- `[3]` height
- `[4]` interaction_state (0.0=default, 1.0=hover, 2.0=active)
- `[5]` liquid_type (0.0=squish, 1.0=tear, 2.0=magnet)
- `[6]` custom_param_1 (e.g. border radius, mass)
- `[7]` reserved/padding

### API
- `EntityBuffer::new(capacity: usize)` — allokerer buffer til `capacity` entities
- `ptr() -> *const f32` — rå pointer til buffer start
- `len() -> usize` — antal floats i brug
- `capacity() -> usize` — total kapacitet i entities
- `grow(new_capacity: usize)` — udvid buffer (panic hvis ny < nuværende)
- `entity_slice(id: usize) -> &[f32]` — returnér 8-float slice for entity `id`
- `entity_slice_mut(id: usize) -> &mut [f32]` — mutable version
- `FLOATS_PER_ENTITY: usize = 8` — konstant

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_new_allocates_correct_capacity` | `new(100)` giver plads til 100 entities (800 floats) |
| 2 | `test_initial_values_are_zero` | Hele bufferen er nul-initialiseret |
| 3 | `test_ptr_returns_valid_pointer` | `ptr()` er ikke null og peger på buffer data |
| 4 | `test_entity_slice_returns_correct_range` | `entity_slice(5)` returnerer floats [40..48] |
| 5 | `test_grow_increases_capacity` | `grow()` udvider bufferen og bevarer eksisterende data |
| 6 | `test_grow_panics_if_smaller` | `grow(50)` på en buffer med capacity 100 panicker |

## Must NOT
- Ingen `#[wasm_bindgen]` annotationer
- Ingen `serde` eller JSON serialisering
- Ingen fysik/matematik (Hookes lov osv.)
- Ingen TypeScript/JavaScript filer
- Ingen `unsafe` kode medmindre strengt nødvendigt for pointer-eksponering

## Must DO
- Pre-allokér med `vec![0.0f32; capacity * 8]`
- Eksponér `ptr()` og `len()` som public methods
- Sikker bounds-checking på `entity_slice()`
- 32-byte alignment per entity (8 × f32)

## Verification
- `cargo test` består alle 6 tests
- `cargo clippy` giver nul warnings
- Buffer allokering, læsning og resize virker korrekt
