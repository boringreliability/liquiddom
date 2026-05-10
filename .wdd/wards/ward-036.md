---
ward: 36
revision: null
name: "Render Abstraction Layer"
epic: "webgpu-rendering"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 036: Render Abstraction Layer

## Scope
Decouple `PhantomObserver` from Canvas2D. Introduce a `Renderer` interface and rewrite the existing Canvas2D path as `Canvas2DRenderer`. Pure refactor — no behavior change. Unblocks WebGPU work in W37+.

## Inputs
- `PhantomObserver.render()` (current Canvas2D logic)
- `WasmBridge` particle view

## Outputs
- `ts/src/renderers/renderer.ts` — interface + `RenderFrame` type
- `ts/src/renderers/canvas2d-renderer.ts` — current behavior, extracted
- `PhantomObserver` no longer references `CanvasRenderingContext2D` directly

## Specification
- `Renderer` interface: `init(canvas)`, `render(frame)`, `resize(w, h, dpr)`, `destroy()`.
- `RenderFrame`: `{ entities: Float32Array, particles: Float32Array, capacity: number, viewport: { w, h, cullMargin }, theme: ThemeConfig }`.
- Wire chosen renderer in `LiquidDOM.create()` via `options.renderer ?? 'canvas2d'`.
- `LiquidOptions.renderer: 'canvas2d' | 'webgpu' | 'auto'`.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Change FFI shape or buffer layout.
- Ship WebGPU code in this ward.
- Break existing demo scenes or runtime-truth tests.

## Must DO
- Preserve current Canvas2D output pixel-for-pixel.
- Make WebGPU path plug-in-able by extending only the renderer registry.

## Verification
`npm run build && npm test && cargo clippy`. Manual: open `demo/scenes/scroll-hero.html` and `dragable-cards.html` — visually identical to before.
