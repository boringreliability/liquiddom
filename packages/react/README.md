# @liquiddom/react

React 18+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom).

## Install

```bash
npm install liquiddom @liquiddom/react react react-dom
```

`liquiddom` is a peer dependency — install it explicitly so a single WASM instance is shared across your app.

## Quickstart

```tsx
import { LiquidProvider, LiquidElement } from "@liquiddom/react";

export default function App() {
  return (
    <LiquidProvider config={{ capacity: 16 }}>
      <LiquidElement as="button">Click me</LiquidElement>
    </LiquidProvider>
  );
}
```

## API

- `<LiquidProvider config?>` — owns a `LiquidDOMInstance` via React Context.
- `useLiquid()` — reads the instance; returns `null` before init / outside a provider.
- `useLiquidRef<T>(opts?)` — callback ref that auto-observes/unobserves the element.
- `<LiquidElement as? liquidType?>` — convenience tag wrapping `useLiquidRef`.

Strict-mode safe (idempotent observe). SSR-safe (provider effect gated on `typeof window`).

## License

MIT — see [LICENSE](./LICENSE).
