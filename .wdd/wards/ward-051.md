---
ward: 51
revision: null
name: "NPM Publish Pipeline & Workspace Split"
epic: "framework-adapters-dx"
status: "planned"
dependencies: [47, 48]
layer: "typescript"
estimated_tests: 2
created: "2026-05-10"
completed: null
---
# Ward 051: NPM Publish Pipeline & Workspace Split

## Scope
Convert the repo to a workspace (npm workspaces, no extra tool) with `packages/core`, `packages/react`, `packages/vue`. Set up changesets-based versioning and a publish script. First public release on npm.

## Inputs
- Current single-package layout
- W47 React adapter, W48 Vue adapter (in pre-split locations)

## Outputs
- `packages/core/` — current `liquiddom` package
- `packages/react/` — `@liquiddom/react`
- `packages/vue/` — `@liquiddom/vue`
- `examples/` — sample apps consuming the published packages from local link
- `.changeset/` config + `release.yml` GitHub Action

## Specification
- Use npm workspaces (no pnpm/yarn lock-in).
- `packages/core/package.json` keeps the existing `liquiddom` name.
- Adapters declare `liquiddom` as `peerDependency` to keep WASM-load logic centralized.
- Changesets handle version bumps; CI publishes on tag push.
- CI matrix: Node 20, 22; Linux/macOS.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Break the existing `liquiddom` import path for current users.
- Publish before all three packages have a green CI run.
- Couple core to React/Vue (one-way dependency only).

## Must DO
- `npm pack --dry-run` for each package shows the expected files.
- Workspace install builds all three packages in topological order.
- `examples/react` and `examples/vue` build against the workspace-linked packages.

## Verification
Tag a `0.2.0-rc.0`, push, watch CI publish to npm under the `next` dist-tag. Install in a scratch project, verify all three packages resolve.
