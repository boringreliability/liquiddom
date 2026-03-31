---
ward: 8
revision: null
name: "Physics to FFI Bridge"
epic: "physics-engine"
status: "complete"
dependencies: [7]
layer: "both"
estimated_tests: 3
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 008: Physics to FFI Bridge

## Scope
Forbind EntityBuffer med EntityBody-collection i LiquidCore. tick() kører fysik, eksponerer flad partikel-buffer til TS for debug-rendering af soft body wireframes.

## Inputs
- EntityBuffer (Ward 1), EntityBody + tick() (Ward 6+7)
- Integration Spec 2

## Outputs
- `bodies: Vec<Option<EntityBody>>` + `particle_data: Vec<f32>` i LiquidCore
- `particle_ptr()` eksponeret til TS
- PhantomObserver debugRender tegner wireframes

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_tick_creates_bodies_on_demand` | width>0 → EntityBody oprettes ved tick |
| 2 | `test_tick_updates_particle_data` | particle_data udfyldt med valid koordinater |
| 3 | `test_grow_resizes_physics_structures` | grow() allokerer plads i bodies + particle_data |
| - | Visuel Inspektion | Wireframes i stedet for stive rektangler |

## Must NOT
- Rust læser ikke DOM
- TS skriver ikke til particle_buffer (read-only)

## Must DO
- dt konverteres til sekunder (dt_ms / 1000.0) i Rust
- PARTICLES_PER_BODY = 16, particle layout: [x0,y0,x1,y1,...] = 32 floats per body

## Verification
- Alle 3 automatiserede tests grønne
- `cargo clippy` 0 warnings
- Visuel demo viser blævrende wireframes
