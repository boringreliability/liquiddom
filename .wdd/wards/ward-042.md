---
ward: 42
revision: null
name: "Border-Radius Aware Rest Shape"
epic: "element-physics-extensions"
status: "planned"
dependencies: []
layer: "both"
estimated_tests: 5
created: "2026-05-10"
completed: null
---
# Ward 042: Border-Radius Aware Rest Shape

## Scope
Particle rest positions today form a rectangle. Read the host element's computed `border-radius` and parameterize `EntityBody::new_rect` (rename: `new_rounded_rect`) so pill-shaped buttons rest as pills, not as stretched rectangles.

## Inputs
- `EntityBody::new_rect` in `src/physics.rs`
- `PhantomObserver.sync()` per-element loop

## Outputs
- New helper `rounded_rect_perimeter_points(w, h, r, count) -> Vec<Vec2>` in `src/physics.rs` or a new `src/shape.rs`
- TS reads `getComputedStyle(el).borderRadius`, resolves to pixels, writes into the entity buffer
- Possible 9th f32 in entity layout — to be decided in spec phase (alternative: pack into existing slot[4] state-flags byte)

## Specification
- Resolve `border-radius` to a single pixel value. For per-corner mixed values, take min for v1.
- Clamp `r` to `min(w, h) / 2`.
- Distribute `PARTICLES_PER_BODY` along the rounded perimeter — 4 quarter-arcs + 4 straight edges, weighted by arc-length.
- TS sends `r` per-frame in tick (consistent with W23 pattern of "config via tick parameters") OR writes once into buffer slot. Decide at approve.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Break the 16-particle invariant.
- Introduce DOM-awareness in Rust (TS reads CSS, sends pixel value).
- Regress rectangle case (`r = 0`).

## Must DO
- `r = 0` produces identical results to current `new_rect`.
- Pill case (`r = h/2`, `w > h`) shows pill-shaped equilibrium.
- Unblock W53 (border-radius clip) by exposing the resolved radius to `PhantomObserver.render()`.

## Verification
New Rust tests for `rounded_rect_perimeter_points` (point count, symmetry, arc-length distribution). New TS test that pill button at rest has centroid matching DOM rect, perimeter matching pill silhouette.
