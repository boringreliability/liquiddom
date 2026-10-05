---
epic: "fluid-engine"
name: "Fluid Engine"
number: 15
status: "active"
created: "2026-10-03"
---
# Epic 15: Fluid Engine

## Goal
Make observed web elements genuinely liquid, which is the project's declared goal from day one: "WASM/WGPU-driven fluid dynamics on web elements via hidden canvas, preserving a11y" (PROJECT.md). The physics is real 2D fluid dynamics: MLS-MPM, re-implemented under test with `spike/fluid-mpm` as reference, computed in Rust/WASM on the CPU. It is rendered below the real DOM through a hidden, `aria-hidden` canvas. Buttons and cards splash, split, merge with each other and always re-form ("T-1000"). Their text is liquid while it moves, and the real DOM text is shown at rest, so semantics, focus and contrast stay those of the original element. Epic 02 never wrote this goal down, and W6/W7 silently replaced it with mass-spring soft bodies. This epic retires that engine (tag `softbody-final`, code removed in W66) and builds the fluid engine in vertical slices. Each slice is judged by the acceptance scene and the slice matrix in [NORTH-STAR.md](../NORTH-STAR.md), never by ward count, and the next slice is planned only after a whole-picture check.

## Wards
| Ward | Name | Status |
|------|------|--------|
| 63 | North star and WDD rules (docs) | planned |
| 64 | Liquid at rest, end to end | planned |
| 65 | Verification harness (Playwright, CI, perf baseline) | planned |
| 66 | Public API swap and soft-body retirement | planned |
| 67 | Splash and shake, end to end | planned |
| 68 | Pointer, hover and material | planned |
| 69 | Playground, splash scene, whole-picture check | planned |

Slices 1–2 = W63–W69. Slices 3–6 (WebGPU liquid, liquid text, drag and merge, the world) are outlines in the spec. Their wards are planned only after the whole-picture check that precedes them. This table is maintained by hand; `wdd progress` / PROGRESS.md is the source of truth for status.

## Integration Points
- **Epic 02 (Physics Engine), 07, 08, 11:** their mass-spring physics and `liquid_type` strategies are replaced, and the code is deleted in W66.
- **Epic 10 (WebGPU Rendering):** the renderer interface's method shape, WebGPU init, auto fallback and `silentFallback` are kept. The SDF passes are deleted in W66, and the fluid splat/composite passes arrive in slice 3.
- **Epic 12 (Framework Adapters):** React and Vue are ported in W66 (`liquidType` → element options `viscosity`/`recovery`).
- **Epic 14 (Public Site):** frozen in W66 (out of the root workspaces and CI build, `deploy-site.yml` manual only) and rebuilt as a fluid playground in slice 6. Its unbuilt wards 63–68 are dropped and the numbers reused here (D63-3).
- **W61 RCA:** the wasm-bindgen double-init race is fixed at the source by the single-flight loader in W64. The W61 workarounds are removed in W66.

## Completion Criteria
- Every step of the S6 column in the NORTH-STAR slice matrix passes in CI: `canvas2d` blocking, and `webgpu` blocking once it has 10 green runs in a row.
- Whole-picture checks after slices 2, 4 and 6 are recorded in `.wdd/memory/whole-picture/`, with recordings inspected with vision.
- No soft-body code remains, and `npm run verify` and `cargo clippy --all-targets --all-features -- -D warnings` are green.
- The three packages are published together as `0.3.0-alpha.x` (changesets fixed group).
- Every ward was approved at gold by Dennis before `wdd complete` (run by Dennis or, after his approval, by AI).
