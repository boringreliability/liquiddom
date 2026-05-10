---
ward: 49
revision: null
name: "Tweakpane Visual Playground"
epic: "framework-adapters-dx"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 1
created: "2026-05-10"
completed: null
---
# Ward 049: Tweakpane Visual Playground

## Scope
A standalone demo page where visitors can drag sliders for every public physics/theme parameter and see the effect live. Includes "Copy config" button that emits a JSON snippet ready to paste into `LiquidDOM.create()`.

## Inputs
- Public `LiquidOptions` and `LiquidPhysicsConfig`
- Tweakpane (~5kB, MIT)

## Outputs
- New `demo/scenes/playground.html` + `playground.ts`
- Linked from `demo/index.html` as the marquee scene

## Specification
- Tweakpane folders: Physics, Theme, Renderer, Gravity (post-W46).
- Each pane control mapped 1:1 to a runtime config field. Use `instance.updateConfig?({...})` if/when added; otherwise rebuild instance with `destroy()` + `create()` on change (acceptable for v1).
- "Copy config" copies `JSON.stringify(currentConfig, null, 2)` to clipboard.
- Mobile-friendly: pane collapsible behind a toggle.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Add Tweakpane to the published library — dev/demo only.
- Couple the public API to Tweakpane's metadata format.

## Must DO
- Document each parameter inline (Tweakpane labels include unit hints).
- Save state to `localStorage` so reload preserves the tweak session.

## Verification
Open `demo/scenes/playground.html`, drag every slider, verify visible change, copy config, paste into `demo/main.ts` — same result.
