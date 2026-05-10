---
ward: 40
revision: null
name: "Background Refraction Sampling"
epic: "webgpu-rendering"
status: "planned"
dependencies: [39]
layer: "typescript"
estimated_tests: 2
created: "2026-05-10"
completed: null
---
# Ward 040: Background Refraction Sampling

## Scope
Optional WebGPU-only effect: the blob acts as a glass lens, refracting the page content behind it. Sampled from a snapshot texture provided by the host (the library does not rasterize the DOM itself).

## Inputs
- WebGPU SDF + fusion pipeline from W39

## Outputs
- New config `theme.refraction: { enabled, strength, sourceTexture? }`
- Public method `instance.setBackgroundTexture(bitmap: ImageBitmap)` for host-supplied snapshots

## Specification
- Library does NOT call `html2canvas` or rasterize DOM. Host responsibility.
- When `theme.refraction.enabled && sourceTexture` is provided, fragment shader samples the texture with UV displaced by SDF gradient × `strength`.
- When no texture supplied, refraction is silently disabled (no error, no warning spam).
- Texture is treated as immutable per call; host re-supplies on layout change.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Pull `html2canvas` or any DOM-rasterization dependency into the package.
- Refract aggressively enough to make text unreadable at default strength.

## Must DO
- Document the host-supplied-snapshot pattern in README with a 10-line example.
- Maintain accessibility: refraction off when `prefers-reduced-motion`.

## Verification
Demo scene that snapshots a Lorem ipsum panel, supplies it to the instance, and shows the blob refracting it. No flash of unstyled content.
