---
ward: 37
revision: null
name: "WebGPU Pipeline Scaffolding"
epic: "webgpu-rendering"
status: "planned"
dependencies: [36]
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: null
---
# Ward 037: WebGPU Pipeline Scaffolding

## Scope
Implement `WebGPURenderer` (TypeScript-side, native `navigator.gpu` API) that draws the same blob splines as Canvas2D — no SDF or metaballs yet. Establishes the pipeline, vertex/uniform layout, and per-frame buffer upload path.

## Inputs
- `Renderer` interface from W36
- Particle Float32Array from `WasmBridge`

## Outputs
- `ts/src/renderers/webgpu-renderer.ts`
- `ts/src/renderers/shaders/blob.wgsl` — minimal vertex/fragment pair drawing colored polygons
- Adapter/device acquisition + cleanup on destroy

## Specification
- Use native browser WebGPU API — no `wgpu-rust` crate. Rule of Two preserved.
- Per-frame: copy particle buffer into a GPU vertex buffer (avoid recreate; reuse with `mapAsync` or `writeBuffer`).
- One draw call per active entity. Acceptable for this ward — fusion comes in W39.
- Fail gracefully: if `navigator.gpu` or adapter request fails, throw `WebGPUUnavailableError` so feature detection (W41) can fall back.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Add `wgpu` to Cargo.toml (rendering stays TS-side).
- Block library init when WebGPU is unavailable — must throw a recoverable error.
- Allocate per-frame; reuse GPU buffers.

## Must DO
- Match Canvas2D output visually for the Default strategy at default physics.
- Clean up GPU resources in `destroy()`.

## Verification
`npm run build && npm test`. Manual: in a WebGPU-capable browser (Chrome 113+), run demo with `renderer: 'webgpu'` — blobs visible, no console errors, no leaked GPU buffers across destroy/recreate.
