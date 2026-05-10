---
ward: 53
revision: null
name: "Border-Radius Clip in preserveBackgrounds"
epic: "theming-polish"
status: "planned"
dependencies: [42]
layer: "typescript"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 053: Border-Radius Clip in preserveBackgrounds

## Scope
Close the documented limitation: `preserveBackgrounds: true` currently clips to a rectangular element rect. Use the resolved border-radius from W42 to clip the canvas region to a rounded rect, so pill and circular buttons no longer leak particles outside their visible bounds.

## Inputs
- W42 resolved border-radius value per entity
- Existing `preserveBackgrounds` clip code path in `PhantomObserver.render()`

## Outputs
- Updated clip path in Canvas2D renderer using `roundRect` (or polyfill for older browsers)
- WebGPU renderer applies the same clip via SDF mask in shader

## Specification
- Canvas2D: replace `ctx.rect(x, y, w, h)` clip with `ctx.roundRect(x, y, w, h, r)` then `ctx.clip()`.
- WebGPU: include border-radius in per-entity uniforms; fragment shader discards pixels outside the rounded-rect SDF.
- For `r = 0`, behavior must match current (no extra ops, no perf regression).
- Per-corner mixed radii: deferred to a future ward.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Change behavior when `preserveBackgrounds: false`.
- Break Safari (which historically had `roundRect` issues — verify and polyfill if needed).

## Must DO
- Visual test: pill button with `preserveBackgrounds: true` — particles clipped to pill.
- Update `CONTEXT.md` Known Limitations to remove this entry.

## Verification
Manual: dragable-cards demo with pill buttons + `preserveBackgrounds: true`. No corner leaks.
