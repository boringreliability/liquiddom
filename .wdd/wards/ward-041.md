---
ward: 41
revision: null
name: "Canvas2D Fallback & Feature Detection"
epic: "webgpu-rendering"
status: "planned"
dependencies: [36]
layer: "typescript"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 041: Canvas2D Fallback & Feature Detection

## Scope
With `renderer: 'auto'`, attempt WebGPU init; on any failure (no `navigator.gpu`, adapter request fails, device lost) silently fall back to `Canvas2DRenderer`. No console errors, no broken state, no half-rendered frame.

## Inputs
- W36 renderer registry
- W37 `WebGPUUnavailableError`

## Outputs
- `LiquidOptions.renderer = 'auto' | 'canvas2d' | 'webgpu'`, default `'auto'`
- `instance.activeRenderer: 'canvas2d' | 'webgpu'` getter for diagnostics

## Specification
- 'auto' path: try WebGPU first, catch `WebGPUUnavailableError`, instantiate Canvas2D, log a single info-level message.
- 'webgpu' path: hard-fail if unavailable (caller asked explicitly).
- 'canvas2d' path: skip WebGPU probing entirely.
- Device-lost during runtime: handle `device.lost` promise — destroy WebGPU renderer and rebuild as Canvas2D mid-session if possible; otherwise pause the loop with a documented event.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Throw on WebGPU absence in 'auto' mode.
- Render two renderers simultaneously.
- Leak GPU resources on fallback.

## Must DO
- One-line console log on fallback (suppressible via a config flag).
- Expose `activeRenderer` so demos can show which path is live.

## Verification
Manual test in Firefox (no WebGPU), Safari (partial), Chrome 120+. All three render the demo correctly. `instance.activeRenderer` reports the right value in each.
