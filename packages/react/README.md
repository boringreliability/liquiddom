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
| `useLiquid()` | The instance, or `null` before init, outside a provider and after it stopped |
| `useLiquidError()` | Why there is no instance: the stop's error or the `create()` rejection; `null` otherwise |
| `useLiquidRef<T>({ viscosity?, recovery?, drag? }?)` | Callback ref that observes on attach and unobserves on detach; options are captured on first render |
| `<LiquidElement as? viscosity? recovery? drag? …rest>` | Convenience tag around `useLiquidRef`; every other prop is forwarded |

StrictMode-safe (single-flight WASM init plus idempotent `observe`). SSR-safe (the provider effect only runs in the browser).

## When the liquid stops

If the instance stops for good (a frame that throws, for example), the provider destroys it: the elements are restored, `useLiquid()` returns `null` and `useLiquidError()` returns the error. A `create()` that rejects (no WebGPU with `renderer: 'webgpu'`, a WASM load failure) sets the same error. There is no automatic retry; remount the provider (a new `key`) to try again. Your own `config.onError` is still called. Under `createRoot` (React 18's default, React 19's only root) a stop is one render; under the legacy `ReactDOM.render` root `useLiquid()` and `useLiquidError()` can both read `null` for one render.

```tsx
function Status() {
  const error = useLiquidError();
  return error ? <p role="alert">Liquid stopped: {String(error)}</p> : null;
}
```

`<LiquidElement drag={false}>` (or `useLiquidRef({ drag: false })`) opts an element out of every drag; like `viscosity`, it is read once.

## Material

`config` is read once on mount, so changing `config.material` later does nothing. Change the material live through the instance, for example with one of the core's `presets` (`water`, `honey`, `jelly`):

```tsx
import { presets } from "liquiddom";
import { useLiquid } from "@liquiddom/react";

function HoneyButton() {
  const liquid = useLiquid();
  return <button onClick={() => liquid?.setMaterial(presets.honey)}>Honey</button>;
}
```

`getMaterial()` returns the resolved material. A preset also works at create time: `<LiquidProvider config={{ material: presets.jelly }}>`.

## Migrating from 0.2

`useLiquidRef({ liquidType })` and `<LiquidElement liquidType>` are gone; use `{ viscosity?, recovery? }`. See the core package's changelog for the full old → new table.

## License

MIT
