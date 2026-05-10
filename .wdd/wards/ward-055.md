---
ward: 55
revision: null
name: "Smooth Scroll-Snap Interpolation"
epic: "theming-polish"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 055: Smooth Scroll-Snap Interpolation

## Scope
Replace W26's hard "snap on scroll idle" with an eased transition. When scrolling stops, `base_pos` deltas are absorbed over ~150 ms instead of teleporting in a single frame. Removes the small but visible jolt.

## Inputs
- W26 scroll-aware base position
- `instance.isScrolling` flag

## Outputs
- New per-entity `target_base_pos` separate from `base_pos`
- Lerp loop in TS that drives `base_pos` toward `target_base_pos` over `snapDurationMs`

## Specification
- During scroll: physics frozen (`dt = 0`), `target_base_pos` updated from `getBoundingClientRect()` each frame, `base_pos` NOT yet written.
- On scroll idle: TS lerps `base_pos` from current to `target_base_pos` over `snapDurationMs` (default 150).
- Physics resumes once interpolation is within 0.5 px of target.
- Reduced-motion: snap instantly (current behavior).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Run interpolation while `isScrolling` is still true.
- Break `tween()` (W32) — they must compose without fighting.

## Must DO
- Visual: scroll past a hero blob, stop — blob eases into new alignment, does not jolt.
- Reduced-motion test: instant snap preserved.

## Verification
Manual: scroll-hero demo, compare pre/post — no jolt. Test that `tween()` started during scroll-idle interpolation completes correctly.
