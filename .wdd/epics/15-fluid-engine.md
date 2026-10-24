---
epic: "fluid-engine"
name: "Fluid Engine"
number: 15
status: "complete"
created: "2026-10-03"
---
# Epic 15: Fluid Engine

## Goal
Make observed web elements genuinely liquid, which is the project's declared goal from day one: "WASM/WGPU-driven fluid dynamics on web elements via hidden canvas, preserving a11y" (PROJECT.md). The physics is real 2D fluid dynamics: MLS-MPM, re-implemented under test with `spike/fluid-mpm` as reference, computed in Rust/WASM on the CPU. It is rendered below the real DOM through a hidden, `aria-hidden` canvas. Buttons and cards splash, split, merge with each other and always re-form ("T-1000"). Their text is liquid while it moves, and the real DOM text is shown at rest, so semantics, focus and contrast stay those of the original element. Epic 02 never wrote this goal down, and W6/W7 silently replaced it with mass-spring soft bodies. This epic retires that engine (tag `softbody-final`, code removed in W66) and builds the fluid engine in vertical slices. Each slice is judged by the acceptance scene and the slice matrix in [NORTH-STAR.md](../NORTH-STAR.md), never by ward count, and the next slice is planned only after a whole-picture check.

## Wards
| Ward | Name | Status |
|------|------|--------|
| 63 | North star and WDD rules (docs) | complete |
| 64 | Liquid at rest, end to end | complete |
| 65 | Verification harness (Playwright, CI, perf baseline) | complete |
| 66 | Public API swap and soft-body retirement | complete |
| 67 | Splash and shake, end to end | complete |
| 68 | Pointer, hover and material | complete |
| 69 | Playground, splash scene, whole-picture check | complete |
| 70 | Slice 2 fix: sloshing shake, readable bulge, clean cross-fade (after the slice-2 whole-picture check) | complete |
| 71 | Liquid in WebGPU (slice 3) | complete |
| 72 | WebGPU by default, robust (slice 3) | complete |
| 73 | Shake without lace (fix ward after slice 3) | complete |
| 74 | Text that flows (slice 4) | complete |
| 75 | Text that stays true (slice 4) | complete |
| 76 | Whole picture after slice 4 | complete |
| 77 | Closed liquid under shake and splash (fix ward after slice 4) | complete |
| 78 | Drag the liquid (slice 5) | complete |
| 79 | Merge and separate (slice 5) | complete |
| 80 | Scroll follows (slice 6) | complete |
| 81 | Parking and resize (slice 6) | complete |
| 82 | Under the page (slice 6) | complete |
| 83 | Gravity and tilt (slice 6) | complete |
| 84 | Touch and opt-out (slice 6) | complete |
| 85 | Adapters (slice 6) | complete |
| 86 | The site (slice 6) | complete |
| 87 | Whole picture (slice 6) | complete |

Slices 1–2 = W63–W69; slices 3–6 (WebGPU liquid, liquid text, drag and merge, the world) were planned one after another, each only after the whole-picture check that precedes it, and are all done (W87, 2026-10-24). This table is maintained by hand; `wdd progress` / PROGRESS.md is the source of truth for status.

## Integration Points
- **Epic 02 (Physics Engine), 07, 08, 11:** their mass-spring physics and `liquid_type` strategies are replaced, and the code is deleted in W66.
- **Epic 10 (WebGPU Rendering):** the renderer interface's method shape, WebGPU init, auto fallback and `silentFallback` are kept. The SDF passes are deleted in W66, and the fluid splat/composite passes arrive in slice 3.
- **Epic 12 (Framework Adapters):** React and Vue are ported in W66 (`liquidType` → element options `viscosity`/`recovery`).
- **Epic 14 (Public Site):** frozen in W66 and rebuilt in W86 as a workspace on the 0.3 API (landing, playground, docs), live at https://liquiddom.vsplat.io; `deploy-site.yml` stays manual. Its unbuilt wards 63–68 are dropped and the numbers reused here (D63-3).
- **W61 RCA:** the wasm-bindgen double-init race is fixed at the source by the single-flight loader in W64. The W61 workarounds are removed in W66.

## Completion Criteria
- Every step of the S6 column in the NORTH-STAR slice matrix passes in CI on `canvas2d` (blocking), and in WebGPU locally on Metal (`e2e:webgpu-hw`) at every ward's gold; the CI SwiftShader smoke stays soft (amended in W87, D87-3: SwiftShader cannot run the liquid, W71.0 fallback B, so "`webgpu` blocking after 10 green runs" could never be met).
- Whole-picture checks after slices 2, 4 and 6 are recorded in `.wdd/memory/whole-picture/`, with recordings inspected with vision.
- No soft-body code remains, and `npm run verify` and `cargo clippy --all-targets --all-features -- -D warnings` are green.
- The three packages are published together as `0.3.0-alpha.x` (changesets fixed group): met, `0.3.0-alpha.1` on 2026-10-24 through npm trusted publishing.
- Every ward was approved at gold by Dennis before `wdd complete` (run by Dennis or, after his approval, by AI).
