---
epic: "liquid-look"
name: "Liquid Look"
number: 16
status: "active"
created: "2026-10-25"
---
# Epic 16: Liquid Look

## Goal
Renderer work on top of the finished fluid engine (Epic 15): the liquid takes on more of the element's own look. It is pure TypeScript/WGSL rendering; Rust, the FFI and the public API stay as Epic 15 left them. The first ward makes the author's CSS `box-shadow` follow the liquid (design `docs/superpowers/specs/2026-10-24-liquiddom-shadows-design.md`).

## Wards
| Ward | Name | Status |
|------|------|--------|
| 88 | Shadows follow the liquid | planned |

This table is maintained by hand; `wdd progress` / PROGRESS.md is the source of truth for status.

## Integration Points
- **Epic 15 (Fluid Engine):** the toggle lifecycle (`liquid-text`, `liquid-away`, `liquid-halo`), the colour snapshot and its W75 triggers, both renderers' passes. NORTH-STAR's scene and matrix are unchanged.
- **Epic 14 / W86 (site):** the hero gets a CSS glow; the docs pages that say shadows are not drawn are corrected.

## Completion Criteria
- Every ward approved at gold by Dennis before `wdd complete`.
- `npm run verify`, `npm run e2e:canvas2d` and `npm run e2e:webgpu-hw` green at every gold; no acceptance step regresses.
