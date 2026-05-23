# @liquiddom/vue

## 0.2.0-rc.0

### Minor Changes

Initial public release. Vue 3.4+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom).

**Exports:**
- `<LiquidProvider :config>` — owns a `LiquidDOMInstance` via provide/inject
- `LiquidPlugin` — alternative install via `app.use(LiquidPlugin, config?)`
- `useLiquid()` — returns `Ref<LiquidDOMInstance | null>` (reactive)
- `useLiquidRef<T>(opts?)` — template ref that auto-observes/unobserves
- `<LiquidElement :as :liquid-type ...attrs>` — drop-in tag wrapping `useLiquidRef`

**Behavior:**
- SSR-safe (provider effect gated on `typeof window`)
- Pure TypeScript with `h()` render functions — no `.vue` SFC dependency in the published package
- `liquidType` is captured once on first attach (not reactive)
- `liquiddom` is a peer dependency (single WASM instance shared across the app)

### Peer dependencies

- `liquiddom@^0.2.0-rc.0`
- `vue@^3.4.0`
