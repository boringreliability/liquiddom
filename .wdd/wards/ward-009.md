---
ward: 9
revision: null
name: "Pointer Repulsion"
epic: "physics-engine"
status: "complete"
dependencies: [8]
layer: "both"
estimated_tests: 4
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 009: Pointer Repulsion

## Scope
Ekstern mus/pointer-interaktion: repulsion force der deformerer soft bodies lokalt når pointeren er i nærheden.

## Inputs
- Musens position (pointer_x, pointer_y) + status (pointer_active)
- Vec2 matematik (length, normalize)

## Outputs
- Opdateret `EntityBody::tick` med pointer-parametre
- `LiquidCore::tick(dt, pointer_x, pointer_y, pointer_active)`
- Demo med mousemove event listeners

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_vec2_length_and_normalize` | Pythagoras + nul-vektor safety |
| 2 | `test_pointer_repels_particles` | Partikel inden for radius → velocity væk fra mus |
| 3 | `test_pointer_inactive_does_not_repel` | pointer_active=false → ingen påvirkning |
| 4 | `test_pointer_outside_radius_does_not_repel` | Partikel uden for radius → ingen kraft |

## Must NOT
- TS må ikke beregne fysik — kun levere rå mus-koordinater

## Must DO
- Normalize håndterer nul-vektor (ingen NaN)
- radius=100, strength=5000 som defaults

## Verification
- `cargo test` består alle nye tests
- Visuel: partikler viger fra musen i demo
