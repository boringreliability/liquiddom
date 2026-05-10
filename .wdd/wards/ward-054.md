---
ward: 54
revision: null
name: "box-shadow Compatibility under preserveBackgrounds"
epic: "theming-polish"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 2
created: "2026-05-10"
completed: null
---
# Ward 054: box-shadow Compatibility under preserveBackgrounds

## Scope
Address the documented limitation: `box-shadow` may be partially clipped by the canvas rect under `preserveBackgrounds: true`. Either (a) inflate the clip region by the shadow extent, or (b) honestly document that shadow rendering is the host's responsibility and exclude from limitations. Pick at approve.

## Inputs
- `getComputedStyle(el).boxShadow`
- Current clip extent in `PhantomObserver.render()`

## Outputs
- Either an inflated clip path that includes shadow margin, OR a documentation update + escape hatch (`shadowMargin: number` config) for hosts to opt into a wider clip per-element

## Specification
- Parse `box-shadow` to extract worst-case `(offsetX + blur + spread)` per side.
- Inflate the clip rect by the per-side margin before `roundRect`.
- For multiple shadows, take the max margin.
- Negative spread / inset shadows: ignore (don't extend clip).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Inflate clip when `preserveBackgrounds: false`.
- Re-parse box-shadow per frame.

## Must DO
- Cached parse on observe; refresh on `MutationObserver` style changes.
- Visual: button with `box-shadow: 0 8px 24px black` + `preserveBackgrounds` — shadow fully visible.

## Verification
Demo scene with shadowed buttons. Compare against pre-W54 screenshots — shadow no longer clipped.
