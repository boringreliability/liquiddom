# @liquiddom/react

React 18+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom): WASM-driven fluid dynamics on real DOM elements.

## Install

```bash
npm install liquiddom@alpha @liquiddom/react@alpha
```

## Quickstart

```tsx
import { LiquidProvider, LiquidElement } from "@liquiddom/react";

export function App() {
  return (
    <LiquidProvider config={{ material: { viscosity: 0.6, cohesion: 0.85, recovery: 0.4 } }}>
      <LiquidElement as="button" viscosity={0.3}>Splash</LiquidElement>
    </LiquidProvider>
  );
}
```

## API

| Export | Purpose |
|---|---|
| `<LiquidProvider config?>` | Owns one `LiquidDOMInstance`; `config` is read once on mount |
| `LiquidContext` | The raw context (instance or `null`) |
| `useLiquid()` | The instance, or `null` before init / outside a provider |
| `useLiquidRef<T>({ viscosity?, recovery? }?)` | Callback ref that observes on attach and unobserves on detach; options are captured at first attach |
| `<LiquidElement as? viscosity? recovery? …rest>` | Convenience tag around `useLiquidRef`; every other prop is forwarded |

StrictMode-safe (single-flight WASM init plus idempotent `observe`). SSR-safe (the provider effect only runs in the browser).

## Migrating from 0.2

`useLiquidRef({ liquidType })` and `<LiquidElement liquidType>` are gone; use `{ viscosity?, recovery? }`. See the core package's changelog for the full old → new table.

## License

MIT
