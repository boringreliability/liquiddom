---
epic: "element-physics-extensions"
name: "Element Physics Extensions"
number: 11
status: "planned"
created: "2026-05-10"
---
# Epic 11: Element Physics Extensions

## Goal
Make the simulation reflect real DOM shape (border-radius) and add new entity classes (free droplets, gyroscope-aware gravity) so LiquidDOM stops being "rectangles only". This is where the library transitions from "soft rectangles" to "actual liquid simulation".

## Wards
| Ward | Name | Status |
|------|------|--------|
| 42 | Border-Radius Aware Rest Shape | planned |
| 43 | FreeDrop Entity Type & Buffer Extension | planned |
| 44 | Impulse-Triggered Droplet Spawning | planned |
| 45 | Droplet Culling & Lifetime Management | planned |
| 46 | Device Orientation Gravity Vector | planned |

## Integration Points
- W42 extends the entity buffer slot or piggybacks on `liquid_type` encoding — decided at W42 approve.
- W43 introduces a second entity class in Rust (free particle, no DOM anchor). Affects buffer iteration in `tick()`.
- W46 adds two floats to `tick()` signature (`gravity_x`, `gravity_y`) — coordinated FFI change.
- W42 unlocks W53 (border-radius clip in `preserveBackgrounds`).

## Completion Criteria
- Pill-shaped buttons (border-radius >= 50%) rest as pills, not as rectangles with stretched springs.
- A hard impulse can spawn 1–N free droplets that fall under gravity and are culled on viewport exit.
- Mobile demo responds to `deviceorientation` when permission is granted.
- No regression in existing strategies (Default, Dragged, Shake, Tween).
