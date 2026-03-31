---
ward: 6
revision: null
name: "Particle & Spring Data Structures"
epic: "physics-engine"
status: "complete"
dependencies: [2]
layer: "rust"
estimated_tests: 4
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 006: Particle & Spring Data Structures

## Scope
Grundlæggende data-strukturer til soft body simulation. Konverterer en bounding box til en samling af Particle-objekter langs elementets omkreds.

## Inputs
x, y, width, height fra EntityBuffer (via EntityRef, Ward 2).

## Outputs
- `Vec2` struct (src/math.rs)
- `Particle` struct + `EntityBody` struct (src/physics.rs)
- `EntityBody::new_rect()` til perimeter-distribution

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_vec2_math` | Add, Sub, Mul<f32> operationer |
| 2 | `test_particle_initialization` | Particle oprettes med nul-hastighed |
| 3 | `test_entity_body_rect_distribution` | new_rect(100,100,4) → 4 partikler i hjørnerne |
| 4 | `test_entity_body_particle_count` | new_rect genererer præcis num_particles |

## Must NOT
- Ingen fysikberegninger (Hookes lov = Ward 7)
- Ingen integration med LiquidCore tick loop

## Must DO
- `Vec2` implementerer `std::ops::Add`, `Sub`, `Mul<f32>`
- Jævn perimeter-distribution baseret på `2w + 2h`

## Verification
- `cargo test` består alle 4 nye tests
- `cargo clippy` giver 0 warnings
