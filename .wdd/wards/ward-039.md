---
ward: 39
revision: null
name: "Metaball Fusion Shader"
epic: "webgpu-rendering"
status: "planned"
dependencies: [38]
layer: "typescript"
estimated_tests: 2
created: "2026-05-10"
completed: null
---
# Ward 039: Metaball Fusion Shader

## Scope
Adjacent entities with overlapping or near-overlapping influence fields visually merge into a single goo blob. Classic SDF metaball union (`smin`) applied across all active entities in the fragment pass.

## Inputs
- SDF renderer from W38

## Outputs
- Updated `blob-sdf.wgsl` with global SDF accumulation
- Optional `fusionRadius: number` and `fusionStrength: number` config in `LiquidOptions.theme`

## Specification
- Replace per-entity quad strategy with full-screen pass when fusion is enabled (capacity-bounded — defer >128 to W41 fallback).
- Use polynomial smooth-min: `smin(d1, d2, k) = -log(exp(-k*d1) + exp(-k*d2)) / k` or quadratic variant.
- Fusion only triggers between entities whose AABBs are within `fusionRadius`. Use a CPU pre-pass to build neighbor pairs.
- Default `fusionRadius = 0` (no fusion) so existing demos render unchanged.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Run an O(N²) CPU loop per frame at default capacity (128).
- Break Canvas2D path — fusion is WebGPU-only.

## Must DO
- Show two close buttons visibly merging into one blob in a new demo scene.
- Stay above 60 FPS at capacity 64 with fusion enabled.

## Verification
New `demo/scenes/fusion.html` showing 4 buttons with fusion. Side-by-side recording: fusion off vs. on.
