---
epic: "framework-adapters-dx"
name: "Framework Adapters & DX"
number: 12
status: "planned"
created: "2026-05-10"
---
# Epic 12: Framework Adapters & DX

## Goal
Lower adoption friction. Today only vanilla JS works frictionlessly; React/Vue users must wire MutationObserver themselves. This epic ships first-party wrappers, an interactive playground, optional Worker offload, and a real NPM publish pipeline.

## Wards
| Ward | Name | Status |
|------|------|--------|
| 47 | `@liquiddom/react` Adapter Package | planned |
| 48 | `@liquiddom/vue` Adapter Package | planned |
| 49 | Tweakpane Visual Playground | planned |
| 50 | Web Worker Offload (Optional) | planned |
| 51 | NPM Publish Pipeline & Workspace Split | planned |

## Integration Points
- Adapters consume the existing public `LiquidDOM.create()` API — no core changes required.
- W51 reorganizes the repo into a workspace with `packages/core`, `packages/react`, `packages/vue` (subject to W51 spec).
- W50 may require splitting WasmBridge so it can run inside a Worker — coordinated with current memory ownership rules.

## Completion Criteria
- `npm i @liquiddom/react` + `<LiquidElement>` renders one button as a soft-body in a sample Vite app.
- Same for Vue 3.
- Playground page lets a visitor tweak presets live and copy a config snippet.
- Public NPM tags exist for `liquiddom`, `@liquiddom/react`, `@liquiddom/vue`.
- Worker mode (W50) is opt-in via config and produces no extra bundle weight when disabled.
