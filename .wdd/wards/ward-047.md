---
ward: 47
revision: null
name: "@liquiddom/react Adapter Package"
epic: "framework-adapters-dx"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 5
created: "2026-05-10"
completed: null
---
# Ward 047: @liquiddom/react Adapter Package

## Scope
First-party React bindings. A `<LiquidProvider>` owns one global instance; a `<LiquidElement>` component (or `useLiquid()` hook) handles observe/unobserve on mount/unmount. No core-library changes.

## Inputs
- Public `LiquidDOM.create()` API
- Existing `instance.observe(el)` / `instance.unobserve(el)`

## Outputs
- New workspace package `packages/react/` (depends on W51 split, OR pre-stage in `adapters/react/`)
- Components: `<LiquidProvider config?>`, `<LiquidElement as?: ElementType>`
- Hook: `useLiquid()` returning the active instance
- Hook: `useLiquidRef<T>(opts?)` returning a ref + auto observe/unobserve

## Specification
- `<LiquidProvider>` calls `LiquidDOM.create()` in `useEffect`, calls `destroy()` on unmount.
- `<LiquidElement>` renders an arbitrary tag with a ref, observes on mount, unobserves on unmount.
- Strict-mode safe: double-invoke of effects must not duplicate observes (idempotent observe already covers this — verify).
- React 18+ as peer dep. No React 16 polyfills.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Mutate the core public API to make React easier (adapt at the wrapper layer).
- Bundle React into the package — peer dep only.

## Must DO
- Sample app in `examples/react/` (Vite, ~10 lines of code).
- Strict-mode + Suspense double-render works.
- Cleanly tree-shakes when only the hook is used.

## Verification
`pnpm --filter @liquiddom/react test`. Manual: example app runs, soft-body button visible, no React strict-mode warnings.
