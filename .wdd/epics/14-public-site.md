---
epic: "public-site"
name: "Public Site"
number: 14
status: "complete"
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
| **61** | **Multi-instance recursion fix** (core Rust/TS — investigation + patch + regression-lock tests) | complete |
| **62** | **WebGPU FreeDrop SDF dispatch branch** (WGSL — adds FreeDrop entity rendering, matches W56 Canvas2D) — dropped 2026-10-24: the soft-body WebGPU renderer was retired in W66; its ward file stays at `red` as a historical record (wdd has no dropped status) | dropped |
| 63 | WebGPU shape smoothness — dropped 2026-10-03 (D63-3): soft-body renderer retired; number reused by Epic 15 | dropped |
| 64 | WebGPU compositing polish — dropped 2026-10-03 (D63-3): soft-body renderer retired; number reused by Epic 15 | dropped |
| 65 | Re-enable Try-it-now + framework tabs + publish `0.2.0-rc.1` — dropped 2026-10-03 (D63-3): next publish is `0.3.0-alpha.x` (Epic 15 W66) | dropped |
| 66 | WebGPU device.lost auto-rebuild as Canvas2D — dropped 2026-10-03 (D63-3): returns in fluid slice 3 | dropped |
| 67 | Demo Migration to Astro islands — dropped 2026-10-03 (D63-3): site rebuilt as fluid playground in slice 6 | dropped |
| 68 | Polish: API reference, search, dark mode, SEO — dropped 2026-10-03 (D63-3): revisited with the slice-6 site | dropped |

## Integration Points
- **Epic 10 (WebGPU Rendering):** the renderer-toggle leans on W41's `'auto'` default and `instance.activeRenderer` getter.
- **Epic 12 (Framework Adapters):** docs demonstrate both vanilla, `@liquiddom/react`, and `@liquiddom/vue` usage paths.
- **Epic 09 (Demo Scenes):** the existing scenes are the migration target. Epic 09 is effectively absorbed by Epic 14 once W59 completes.

## Completion Criteria
Closed 2026-10-24 (Dennis): the public site was rebuilt on the fluid engine in Epic 15's W86 and is live at https://liquiddom.vsplat.io; the soft-body-era criteria below were superseded by that design (`docs/superpowers/specs/2026-10-23-liquiddom-site-design.md`).
- Production site deployed (GitHub Pages at `liquiddom.dev` or `boringreliability.github.io/liquiddom`). (met: GitHub Pages, custom domain liquiddom.vsplat.io)
- All 8 existing scenes migrated as Astro islands with explanation + code-snippet. (superseded: the W86 landing tells the engine's story in nine chapters; the demo scenes stay for the e2e suite)
- Global renderer toggle works across every page including playground. (superseded: the site uses `renderer: 'auto'`; the playground picks the renderer by URL param)
- Lighthouse performance score ≥ 90 on landing + at least one demo page. (not measured for the W86 site)
- npm install instruction copy-pastes and works against the published packages (superseded: the 0.3 site, rebuilt in W86 from the workspace dist, is live at https://liquiddom.vsplat.io).
- Old `demo/scenes/*.html` files removed (after W59).
