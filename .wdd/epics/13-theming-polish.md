---
epic: "theming-polish"
name: "Theming & Polish"
number: 13
status: "planned"
created: "2026-05-10"
---
# Epic 13: Theming & Polish

## Goal
Close documented limitations from CONTEXT.md and replace hardcoded colors with CSS-derived theming. This is the epic that takes the library from "looks correct" to "looks like it belongs to the host site".

## Wards
| Ward | Name | Status |
|------|------|--------|
| 52 | CSS Computed Background Reflection | planned |
| 53 | Border-Radius Clip in `preserveBackgrounds` | planned |
| 54 | box-shadow Compatibility under `preserveBackgrounds` | planned |
| 55 | Smooth Scroll-Snap Interpolation | planned |

## Integration Points
- W52 reads `getComputedStyle()` per-element in `PhantomObserver.sync()` — coordinate cost vs. cache.
- W53 depends on W42 (border-radius parameterization) for the geometry source of truth.
- W54 may extend or supersede W28 (Transparent Background Compatibility).
- W55 replaces the hard "snap on scroll idle" of W26 with an eased transition.

## Completion Criteria
- Default coloring respects host-element `background-color` / first gradient stop.
- `preserveBackgrounds: true` correctly masks rounded corners (no rectangular clip artifacts).
- box-shadow fully visible in `preserveBackgrounds` mode, or honestly documented as scoped out.
- Scroll re-attachment is interpolated, not snapped — particles ease into new `base_pos` over ~150ms.
