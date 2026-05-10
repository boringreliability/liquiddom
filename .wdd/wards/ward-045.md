---
ward: 45
revision: null
name: "Droplet Culling & Lifetime Management"
epic: "element-physics-extensions"
status: "planned"
dependencies: [43]
layer: "rust"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 045: Droplet Culling & Lifetime Management

## Scope
FreeDrop entities must be reclaimed automatically. A droplet is freed when it exits the viewport bounds OR when its lifetime expires. Reclaimed slots return to the pool for future spawns.

## Inputs
- W43 FreeDrop buffer slots
- TS-provided viewport bounds (already passed for culling in W18)

## Outputs
- Rust `tick()` deactivates droplet slots when `pos` exits `viewport_aabb + cullMargin` or `lifetime_ms <= 0`.
- A slot is "deactivated" by setting `w = 0.0` (matches existing skip-condition).

## Specification
- Add `viewport_x, viewport_y, viewport_w, viewport_h` to `tick()` signature OR derive from existing arguments. Decide at approve.
- Lifetime decremented by `dt_ms` each tick.
- Default lifetime if unset: 5000 ms.
- Free slot reuse: TS `spawnDroplet` scans for `w == 0` slots before refusing.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Cull DOM-anchored entities (only `liquid_type == FreeDrop`).
- Add per-frame allocation for tracking lifetimes.

## Must DO
- A spawned droplet that flies off-screen returns its slot within ~1 frame of crossing the cull margin.
- Lifetime expiry deactivates even stationary droplets.

## Verification
`cargo test physics::tests::test_freedrop_culls_off_screen` and `test_freedrop_lifetime`. Manual: spam-impulse the demo until pool exhausts, then wait — droplets should clear and pool recover.
