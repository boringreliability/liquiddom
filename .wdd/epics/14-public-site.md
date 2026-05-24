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
| 60 | Live Hero (Canvas2D-correct, WebGPU FreeDrop AABB bug + TryItNow disabled — both deferred to W61) | planned |
| **61** | **Core renderer bug fixes: multi-instance recursion + WebGPU FreeDrop SDF branch (publishes `0.2.0-rc.1`)** | planned |
| 62 | Re-enable Try-it-now widget + framework tabs in getting-started | planned |
| 63 | Demo Migration: remaining 6 scenes → Astro islands; delete `demo/` | planned |
| 64 | Polish: API reference autogen + search + dark mode + SEO + `<LiquidElement>` auto-CSS-resets | planned |

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
