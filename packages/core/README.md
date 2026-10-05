# liquiddom

WASM-driven **fluid dynamics** on real DOM elements, drawn on a hidden `<canvas>` while the DOM keeps its semantics, focus and hit areas. Rust runs a 2D MLS-MPM fluid; TypeScript observes the DOM and renders. They share pre-allocated `Float32Array` views; there is no JSON over the FFI.

> **0.3 alpha.** The 0.2 soft-body engine is retired (tag `softbody-final`). This alpha shows the liquid at rest; splash, shake and the pointer field land in the next alpha.

## Install

```bash
npm install liquiddom@alpha
```

## Quickstart

```html
<button data-liquid>Splash</button>
<div class="card" data-liquid>…</div>
<script type="module">
  import { LiquidDOM } from "liquiddom";
  const liquid = await LiquidDOM.create({ seed: 1 });
</script>
```

Every `[data-liquid]` element is observed. Its computed `background-color` becomes the liquid colour, and its own background, border and box-shadow are hidden.

## Options

| Option | Default | Notes |
|---|---|---|
| `particles` | `8000` | Fixed particle pool, integer 256–65536 |
| `maxElements` | `32` | Fixed element slots, 1–256; `observe()` beyond it throws `RangeError` |
| `container` | none | Mount the canvas inside this element (container mode). The container must be a positioned element (e.g. `position: relative`): the canvas is absolutely positioned inside it. liquiddom does not restyle it; a static container logs a `console.warn` at `create()` |
| `renderer` | `'auto'` | `'auto'` / `'canvas2d'` / `'webgpu'` (WebGPU draws nothing until a later alpha) |
| `material` | `{ viscosity: 0.5, cohesion: 0.5, recovery: 0.7 }` | viscosity and cohesion in [0, 1], recovery in seconds [0.2, 3] |
| `gravity` | `{ source: 'none' }` | Accepted and validated; no effect yet |
| `seed` | random u32 | Same seed + inputs + viewport = same positions |
| `autoObserve` | `true` | Observe `[data-liquid]` at create |
| `forceReducedMotion` | `false` | Force the still, crisp reduced-motion mode |
| `silentFallback` | `false` | Validated; reserved for the WebGPU fallback log |

Removed 0.2 options throw a `TypeError` that names the replacement.

## Instance API

```ts
liquid.observe(el, { viscosity?, recovery? }); // returns the slot id
liquid.unobserve(el);                            // restores the element exactly
liquid.refresh(el);                              // re-read colours after a theme change
liquid.pause(); liquid.resume(); liquid.destroy();
liquid.autoDiscover(root?); liquid.stopAutoDiscover();
await liquid.requestOrientationPermission();     // iOS, from a user gesture
liquid.isPaused; liquid.activeRenderer; liquid.particleCapacity; liquid.elementCapacity;
```

After `destroy()`, every method throws except `unobserve()` and `destroy()`; `requestOrientationPermission()` returns a rejected promise instead of throwing synchronously.

### Splash and shake

```ts
liquid.splash(el);                                                        // strength 1 at the rect centre
liquid.splash(el, { strength: 1.6, at: { x: e.clientX, y: e.clientY } }); // client px
liquid.shake();                                                           // every observed element sloshes
liquid.shake(0.5);
```

- `strength` is 0–2 (default 1). `0` is a no-op. Anything else throws `TypeError`.
- `splash` on an element that is not observed throws `Error`.
- Clicking an observed element splashes at the pointer. Keyboard activation (Enter/Space, `event.detail === 0`) splashes at the rect centre. Native activation is never prevented.
- Under reduced motion both are ignored.
- `SplashOptions` changed shape in 0.3: `threshold`, `count`, `jitter`, `speedScale`, `lifetimeMs` and `radius` are gone and throw a `TypeError`.

## Accessibility

- The canvas is `aria-hidden="true"` with `pointer-events: none`. It sits below the observed elements, so focus rings are always visible.
- `prefers-reduced-motion` (or `forceReducedMotion`) stops the simulation: elements are still and crisp, and the DOM text is visible.
- Print and `forced-colors: active` hide the canvas and restore the elements' own styling.

## Known limitations (alpha)

- Colours are snapshotted at `observe()`. Call `refresh(el)` after changing them.
- Only uniform circular `border-radius` is honoured. Borders and box-shadows of observed elements are not drawn.
- An observed element inside an ancestor with `transform`, `filter` or `overflow: hidden` can end up under other content.

## License

MIT
