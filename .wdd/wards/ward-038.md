---
ward: 38
revision: null
name: "SDF Blob Fragment Shader"
epic: "webgpu-rendering"
status: "planned"
dependencies: [37]
layer: "typescript"
estimated_tests: 2
created: "2026-05-10"
completed: null
---
# Ward 038: SDF Blob Fragment Shader

## Scope
Replace the polygon-fill blob in W37 with a signed-distance-field rendering pass. Each entity becomes a soft-edged blob whose silhouette is computed in the fragment shader from its 16 particles, not from a CPU-tessellated path.

## Inputs
- `WebGPURenderer` from W37

## Outputs
- `ts/src/renderers/shaders/blob-sdf.wgsl`
- Updated bind group layout exposing particle positions as a storage buffer

## Specification
- Fragment shader: for each fragment, compute min distance to each of the entity's 16 particles, then apply a smoothstep around `radius ± softness`.
- Per-entity uniforms: color, softness, radius (derived from average particle spacing).
- Run as full-screen quad with per-entity instance index, OR per-entity quad bounded to entity AABB. Pick the latter for capacity > 32.
- AABB computed in TS each frame; sent as instance attribute.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Recompute particle layout on the CPU each frame for tessellation — that's the whole point.
- Hardcode 16 particles in the WGSL — read `PARTICLES_PER_BODY` via override constant.

## Must DO
- Match or exceed Canvas2D visual quality at 60 FPS with capacity 64.
- Honor reduced-motion (no shader animation when `dt = 0`).

## Verification
Visual A/B comparison page in demo. SDF blob has smoother silhouette than spline path. Frame time on M-series MacBook < 4 ms at capacity 64.
