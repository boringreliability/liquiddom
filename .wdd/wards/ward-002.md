---
ward: 2
revision: null
name: "Buffer Mutation API"
epic: "state-ffi"
status: "complete"
dependencies: [1]
layer: "rust"
estimated_tests: 6
created: "2026-03-30"
completed: "2026-03-30"
---
# Ward 002: Buffer Mutation API

## Scope
Sikker og semantisk API-wrapper (`EntityRef` og `EntityRefMut`) ovenpå `EntityBuffer` fra Ward 1. Tillader fysikmotoren (Ward 6) at læse/skrive data via navngivne metoder i stedet for rå array-indeksering.

## Inputs
`EntityBuffer` struct og `FLOATS_PER_ENTITY` fra `src/buffer.rs` (Ward 1).

## Outputs
- `EntityRef<'a>` struct (immutable access)
- `EntityRefMut<'a>` struct (mutable access)
- `entity()` og `entity_mut()` metoder på `EntityBuffer`
- Bruges af Ward 6 (Mass-Spring Kernel)

## Specification

### Accessor Structs
Zero-copy references ind i bufferen via lifetimed slices:
- `EntityRef<'a>` wraps `&'a [f32]` (8 floats)
- `EntityRefMut<'a>` wraps `&'a mut [f32]` (8 floats)

### API
- Position & Size: `x()`, `y()`, `width()`, `height()` + `set_*` (kun RefMut)
- State: `interaction_state()`, `liquid_type()` + `set_*` (kun RefMut)
- Buffer integration: `entity(id) -> EntityRef`, `entity_mut(id) -> EntityRefMut`

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_entity_ref_reads_position_and_size` | EntityRef kan læse x, y, width, height korrekt |
| 2 | `test_entity_ref_mut_updates_position` | set_x/set_y muterer underliggende buffer |
| 3 | `test_entity_ref_reads_states` | Læser interaction_state og liquid_type korrekt |
| 4 | `test_entity_ref_mut_updates_states` | State-ændringer slår igennem på slice |
| 5 | `test_buffer_entity_integration` | buffer.entity()/entity_mut() returnerer korrekte wrappers |
| 6 | `test_multiple_mutations_persist` | Flere feltopdateringer overskriver ikke hinanden |

## Must NOT
- Ingen kloning af data (brug lifetimed slices)
- Ingen ændringer af FLOATS_PER_ENTITY
- Ingen wasm_bindgen
- Ingen fysikberegninger

## Must DO
- Placer i `src/entity.rs` eller udvid `src/buffer.rs`
- Panic med tydelig besked hvis slice ikke er præcis 8 floats

## Verification
- `cargo test` består alle 6 nye tests
- `cargo clippy` giver 0 warnings
