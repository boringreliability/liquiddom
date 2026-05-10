---
ward: 43
revision: null
name: "FreeDrop Entity Type & Buffer Extension"
epic: "element-physics-extensions"
status: "planned"
dependencies: []
layer: "both"
estimated_tests: 4
created: "2026-05-10"
completed: null
---
# Ward 043: FreeDrop Entity Type & Buffer Extension

## Scope
Introduce a second entity class: a free-floating particle (no DOM anchor, no body, no springs) that obeys gravity and lives in the same buffer pool. Foundation for W44 (spawning) and W45 (culling). Pure plumbing — no spawning logic yet.

## Inputs
- Existing `EntityBuffer` and `EntityBody` system
- `liquid_type` dispatch in `dispatch_strategy`

## Outputs
- New `PhysicsStrategy::FreeDrop` variant (value 6.0)
- `EntityBody` becomes `Option`-wrapped per-slot already; FreeDrop uses a leaner `FreeParticle` instead — stored in a parallel `Vec<Option<FreeParticle>>` or via enum variant
- `tick()` branches on strategy; FreeDrop ignores DOM `base_pos`

## Specification
- A FreeDrop entity has only `pos`, `velocity`, `radius`, `lifetime_ms` — no springs, no neighbors.
- `tick()` for FreeDrop: integrate velocity under gravity (zero in this ward; W46 supplies it), no spring forces.
- Rendering: FreeDrop writes to the same particle buffer at `i * PARTICLES_PER_BODY * 2`, repeating its single position into all 16 slots so the existing renderer draws a small circle. Suboptimal — W38 SDF will handle it cleanly.
- TS: `instance.spawnDroplet(x, y, vx, vy)` returns id. No DOM element required.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Allocate a new buffer per droplet — reuse the existing slot pool.
- Mix DOM-anchored and free entities in the same Rust collection without a clear discriminator.

## Must DO
- Existing strategies untouched and tested.
- `liquid_type = 6` round-trips through dispatch.
- Capacity accounting unchanged (a droplet occupies one slot like an entity).

## Verification
`cargo test physics::tests::test_freedrop` covers integration + round-trip. TS test spawns 5 droplets, verifies buffer slots flip to active.
