# @liquiddom/react

## 0.2.0-rc.0

### Minor Changes

Initial public release. React 18+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom).

**Exports:**
- `<LiquidProvider config?>` — owns a `LiquidDOMInstance` via React Context
- `useLiquid()` — read the instance (returns `null` before init / outside provider)
- `useLiquidRef<T>(opts?)` — callback ref that auto-observes/unobserves
- `<LiquidElement as? liquidType? ...rest>` — drop-in tag wrapping `useLiquidRef`

**Behavior:**
- Strict-mode safe (idempotent observe — React 18 double-mount in dev does not double-register)
- SSR-safe (provider effect gated on `typeof window`)
- `liquiddom` is a peer dependency (single WASM instance shared across the app)

### Peer dependencies

- `liquiddom@^0.2.0-rc.0`
- `react@^18.0.0 || ^19.0.0`
