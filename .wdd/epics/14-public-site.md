---
epic: "public-site"
name: "Public Site"
number: 14
status: "active"
created: "2026-05-23"
---
# Epic 14: Public Site

## Goal
Build a unified public site that doubles as landing page AND documentation, with interactive demos embedded throughout — converting "OSS curiosity" into "I'll use this in production." Replaces the current `demo/scenes/*.html` proliferation with a single Astro site where every demo is augmented by an explanation box, a code snippet, and a global Canvas2D↔WebGPU renderer toggle that persists across navigation.

## Wards
| Ward | Name | Status |
|------|------|--------|
| 58 | Site Foundation: Astro + Landing Skeleton + Renderer Toggle + Deploy Workflow | complete |
| 59 | DemoEmbed + 2 Showcases (squish, fusion) + Snippet Canary + Toggle Indicator | complete |
| 60 | Live Hero (Canvas2D-correct, WebGPU bugs deferred to W61-W64) | complete |
| **61** | **Multi-instance recursion fix** (core Rust/TS — investigation + patch + regression-lock tests) | planned |
| **62** | **WebGPU FreeDrop SDF dispatch branch** (WGSL — adds FreeDrop entity rendering, matches W56 Canvas2D) | planned |
| **63** | **WebGPU shape smoothness** (WGSL Catmull-Rom segment subdivision — fixes faceted-look + 16-facet outline limitation) | planned |
| **64** | **WebGPU compositing polish** (winner-take-all color softening at fusion midpoint + W40 refraction PNG alpha) | planned |
| **65** | **Re-enable Try-it-now + framework tabs + publish `0.2.0-rc.1`** | planned |
| 66 | WebGPU device.lost auto-rebuild as Canvas2D (deferred from W41) | planned |
| 67 | Demo Migration: remaining 6 scenes → Astro islands; delete `demo/` | planned |
| 68 | Polish: API reference autogen + search + dark mode + SEO + `<LiquidElement>` auto-CSS-resets | planned |

## Integration Points
- **Epic 10 (WebGPU Rendering):** the renderer-toggle leans on W41's `'auto'` default and `instance.activeRenderer` getter.
- **Epic 12 (Framework Adapters):** docs demonstrate both vanilla, `@liquiddom/react`, and `@liquiddom/vue` usage paths.
- **Epic 09 (Demo Scenes):** the existing scenes are the migration target. Epic 09 is effectively absorbed by Epic 14 once W59 completes.

## Completion Criteria
- Production site deployed (GitHub Pages at `liquiddom.dev` or `boringreliability.github.io/liquiddom`).
- All 8 existing scenes migrated as Astro islands with explanation + code-snippet.
- Global renderer toggle works across every page including playground.
- Lighthouse performance score ≥ 90 on landing + at least one demo page.
- npm install instruction copy-pastes and works against the published `0.2.0-rc.0` packages.
- Old `demo/scenes/*.html` files removed (after W59).
