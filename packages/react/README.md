# @liquiddom/react

React 18+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom) — WASM-driven soft-body physics on real DOM elements.

## Install

```bash
npm install liquiddom @liquiddom/react react react-dom
```

`liquiddom` is a peer dependency so a single WASM instance is shared across your app.

## Quickstart

```tsx
import { LiquidProvider, LiquidElement } from "@liquiddom/react";

export default function App() {
  return (
    <LiquidProvider config={{ capacity: 16, theme: { fusionRadius: 50 } }}>
      <LiquidElement as="button">Click me</LiquidElement>
      <LiquidElement as="a" href="#">Also liquid</LiquidElement>
    </LiquidProvider>
  );
}
```

## Three usage patterns

### 1. `<LiquidElement>` — drop-in tag

Easiest. Wraps `useLiquidRef` and observes on mount.

```tsx
<LiquidElement as="button" liquidType={4 /* Shake */}>
  Shaky
</LiquidElement>
```

### 2. `useLiquidRef` — ref on your own element

When you need full control over the element (custom components, third-party libs).

```tsx
import { useLiquidRef } from "@liquiddom/react";

function Card() {
  const ref = useLiquidRef<HTMLDivElement>({ liquidType: 3 /* Dragged */ });
  return <div ref={ref} className="my-card">Drag me</div>;
}
```

### 3. `useLiquid` — imperative access

For one-off actions like `impulse()`, `tween()`, `spawnDroplet()`.

```tsx
import { useLiquid, useLiquidRef } from "@liquiddom/react";

function Button() {
  const liquid = useLiquid();
  const ref = useLiquidRef<HTMLButtonElement>();

  return (
    <button
      ref={ref}
      onClick={() => liquid?.impulse(ref.current!, { magnitude: 20 })}
    >
      Splash me
    </button>
  );
}
```

## API

| Export | Description |
|--------|-------------|
| `<LiquidProvider config?>` | Owns a `LiquidDOMInstance` via React Context. `config` is captured once on mount — re-renders don't re-create the instance. |
| `useLiquid()` | Returns the active instance, or `null` before init / outside a provider. |
| `useLiquidRef<T>(opts?)` | Callback ref that auto-observes on mount, unobserves on unmount. `opts.liquidType` captured at first attach. |
| `<LiquidElement as? liquidType? ...rest>` | Convenience tag — internally uses `useLiquidRef`. Forwards all other props to the underlying element. |

## Notes

- **Strict-mode safe** — `useLiquidRef` observes idempotently, so React 18's double-mount in dev doesn't double-register.
- **SSR-safe** — the provider effect is gated on `typeof window`, so server rendering is a no-op.
- **Single instance per provider** — nested providers each spin up their own WASM instance. For most apps, one provider at the root is correct.

## Full options + imperative API

All options and methods exposed via `config` and `useLiquid()` come straight from [`liquiddom`'s core API](https://www.npmjs.com/package/liquiddom).

## License

[MIT](./LICENSE) © Dennis Schmock
