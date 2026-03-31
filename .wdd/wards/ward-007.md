---
ward: 7
revision: null
name: "Mass-Spring-Damper Kernel"
epic: "physics-engine"
status: "complete"
dependencies: [6]
layer: "rust"
estimated_tests: 4
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 007: Mass-Spring-Damper Kernel

## Scope
Fysikberegning (Hookes lov) der opdaterer partiklers position og hastighed over tid. Hver partikel søger mod sin globale hvile-position (`base_pos + local_rest`).

## Inputs
- Particle og EntityBody (Ward 6)
- dt (sekunder), tension (k), damping (c) parametre

## Outputs
- `EntityBody::tick(&mut self, dt: f32, tension: f32, damping: f32)`

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_spring_pulls_particle_to_rest` | Displaced partikel bevæger sig mod rest |
| 2 | `test_damping_slows_particle` | Partikel med hastighed bremses af damping |
| 3 | `test_base_pos_movement_drags_particles` | Ændret base_pos → fjederen trækker partikler efter |
| 4 | `test_equilibrium_is_stable` | Partikel i hvile ændrer sig ikke |

## Must NOT
- Ingen kollision/muse-repulsion (Ward 8)
- Ingen rendering

## Must DO
- Euler integration: velocity += F_total * dt, pos += velocity * dt
- tension og damping som parametre (dynamisk via Liquid Types)

## Verification
- `cargo test` består alle 4 nye tests
- `cargo clippy` giver 0 warnings
