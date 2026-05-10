---
epic: "webgpu-rendering"
name: "WebGPU Rendering Pipeline"
number: 10
status: "planned"
created: "2026-05-10"
---
# Epic 10: WebGPU Rendering Pipeline

## Goal
Lift rendering from Canvas2D splines to GPU-accelerated SDF/metaball rendering with optional background refraction. Preserves the Rule of Two — Rust still emits only particle positions; rendering remains TS-orchestrated, now with WGSL shaders. Canvas2D stays as a feature-detection fallback.

## Wards
| Ward | Name | Status |
|------|------|--------|
| 36 | Render Abstraction Layer | planned |
| 37 | WebGPU Pipeline Scaffolding | planned |
| 38 | SDF Blob Fragment Shader | planned |
| 39 | Metaball Fusion Shader | planned |
| 40 | Background Refraction Sampling | planned |
| 41 | Canvas2D Fallback & Feature Detection | planned |

## Integration Points
- Reads particle buffer from WasmBridge — no change to FFI shape.
- Replaces direct `ctx.bezierCurveTo` path in `PhantomObserver.render()`.
- Honors capacity, culling, and DPR concerns from prior epics (W18, W20).
- Surface-level: adds a `renderer` field on `LiquidOptions` (`'canvas2d' | 'webgpu' | 'auto'`).

## Completion Criteria
- A single `Renderer` interface with two implementations: `Canvas2DRenderer` (existing behavior preserved) and `WebGPURenderer`.
- Metaball fusion visible at distances < `repulsionRadius * 1.2` in showcase scene.
- Background refraction toggleable via config; off by default.
- Feature detection picks WebGPU on capable browsers, falls back silently on unsupported ones.
- No regression in existing demos. All Ward 35 runtime-truth tests still green.
