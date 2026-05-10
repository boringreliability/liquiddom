---
ward: 48
revision: null
name: "@liquiddom/vue Adapter Package"
epic: "framework-adapters-dx"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: null
---
# Ward 048: @liquiddom/vue Adapter Package

## Scope
First-party Vue 3 bindings, mirroring W47 in scope. Uses the Composition API and Vue's lifecycle hooks for observe/unobserve.

## Inputs
- Public `LiquidDOM.create()` API
- Existing instance API

## Outputs
- New workspace package `packages/vue/` (or `adapters/vue/` pre-W51)
- Composable: `useLiquid()` (instance access) and `useLiquidRef()` (template ref + auto-observe)
- Plugin: `app.use(LiquidPlugin, config)` for app-wide instance
- Component: `<LiquidElement>` with a default slot

## Specification
- Plugin creates the instance on `app.mount`, destroys on `app.unmount`.
- `<LiquidElement>` uses `<slot v-bind="...">` with the auto-observed ref so consumers can use any element.
- Vue 3.4+ as peer dep. No Vue 2 / Composition API plugin support.
- SSR-safe: instance creation gated on `isClient`.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Touch the DOM during SSR.
- Force a global instance — composable usage must work without the plugin.

## Must DO
- Sample app in `examples/vue/` (Vite + Vue 3, ~10 lines).
- `<Suspense>` boundary tolerated.
- Type definitions for `<script setup>` consumers.

## Verification
`pnpm --filter @liquiddom/vue test`. Manual: example app runs, soft-body button visible, no Vue warnings.
