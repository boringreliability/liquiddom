---
ward: 52
revision: null
name: "CSS Computed Background Reflection"
epic: "theming-polish"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: null
---
# Ward 052: CSS Computed Background Reflection

## Scope
Replace the global `colorDefault`/`colorHover` config with per-element automatic theming derived from the host's computed `background-color` (and optionally first stop of `background-image: linear-gradient`). The blob now blends with whatever it represents.

## Inputs
- `getComputedStyle(el)` per observed element
- `PhantomObserver` per-element listener registry

## Outputs
- `LiquidOptions.theme.colorSource: 'config' | 'computed' | 'mixed'` (default `'config'` for backwards compat; `'mixed'` recommended)
- Per-element theme cache invalidated on `MutationObserver` attribute changes for `style` / `class`

## Specification
- On observe, read `getComputedStyle(el).backgroundColor`. If transparent, fall back to `colorDefault`.
- Optional gradient parsing: capture the first color stop only (good-enough for v1).
- Refresh cache on attribute mutations or explicit `instance.refreshTheme(el)`.
- Pass per-entity color into the renderer (Canvas2D and WebGPU) via the `RenderFrame.theme` field from W36.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Read computed style every frame for every element (expensive).
- Hard-fail on unparseable colors (`currentColor`, CSS vars resolved odd) — fall back gracefully.

## Must DO
- Default behavior unchanged when `colorSource` is `'config'`.
- Hover state still respects `colorHover` unless `'computed'` overrides it.
- Cache hit ratio > 99% during steady state.

## Verification
Demo page with three buttons in different brand colors — all blobs match without per-element config. Mutate one button's class to a new color — blob updates.
