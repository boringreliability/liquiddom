# liquiddom

WASM-driven soft-body physics that animates real DOM elements through a hidden `<canvas>` overlay — without sacrificing accessibility. Rust runs the math, TypeScript orchestrates the DOM. They share a pre-allocated `Float32Array` over the FFI boundary; there is no JSON in the hot path.

## Install

```bash
npm install liquiddom
```

For React or Vue, install the corresponding adapter:

- [`@liquiddom/react`](https://www.npmjs.com/package/@liquiddom/react)
- [`@liquiddom/vue`](https://www.npmjs.com/package/@liquiddom/vue)

## Quickstart

```ts
import { LiquidDOM } from "liquiddom";

const liquid = await LiquidDOM.create({
  capacity: 64,
  autoObserve: true, // picks up every [data-liquid] element on the page
});
```

```html
<button data-liquid>I am physically squishy</button>
<a href="#" data-liquid>So am I</a>
```

The original DOM stays intact — screen readers see the `<button>`, `:hover` works, keyboard focus works. liquiddom only paints over it.

## Options (selected)

| Option | Default | Notes |
|--------|---------|-------|
| `capacity` | `128` | Max number of simultaneously observed elements. Throws if exceeded; use `instance.grow(n)` to expand. |
| `autoObserve` | `true` | Auto-observe every `[data-liquid]` on init. Set `false` for manual control. |
| `container` | `undefined` | Scope to a specific element (positioned containing block required). Default = fullscreen. |
| `renderer` | `'auto'` | `'auto'` probes WebGPU then falls back to Canvas2D. `'webgpu'` hard-fails. `'canvas2d'` skips probing. |
| `colorDefault` | `'rgba(15, 52, 96, 0.75)'` | Base fill. |
| `colorHover` | `'rgba(233, 69, 96, 0.85)'` | Fill while hovered. |
| `colorSource` | `'config'` | Set `'computed'` to read each element's `getComputedStyle().backgroundColor` instead. |
| `preserveBackgrounds` | `false` | Cut a hole through the canvas so the element's CSS background shows through. |
| `gravity` | `{ source: 'none' }` | `'fixed'` uses `vector: [x, y]` (px/s²); `'orientation'` reads `DeviceOrientationEvent`. |
| `theme.fusionRadius` | `0` | WebGPU only. Adjacent blobs visually merge via metaball SDF blending. |
| `theme.refraction` | `undefined` | WebGPU only. Blob acts as a glass lens over a host-supplied bitmap. |
| `physics` | preset | Per-frame tunable: `tension`, `damping`, `repulsionRadius`, `repulsionStrength`, `substeps`, etc. |
| `snapDurationMs` | `150` | Smooth lerp duration after a scroll ends. |
| `forceReducedMotion` | `undefined` | Override `prefers-reduced-motion`. |

## Imperative API

```ts
// Observe / unobserve manually
const id = liquid.observe(element);
liquid.unobserve(element);

// Liquid types — change behavior per element
liquid.observe(card, 3); // Dragged: drag follows pointer
liquid.observe(blob, 4); // Shake: vibrates briefly after impulse
liquid.observe(card, 5); // Tween: external position target

// Impulse — shake an element + optional droplet splash
liquid.impulse(button, {
  direction: [0, -1],
  magnitude: 20,
  splash: { threshold: 10, count: 4, jitter: 50, lifetimeMs: 800 },
});

// Tween to a target position
liquid.tween(card, { toX: 200, toY: 100, duration: 400, easing: "ease-out" });

// FreeDrop — DOM-less particles
const dropId = liquid.spawnDroplet({ x: 100, y: 100, vx: 0, vy: -200, radius: 6 });
liquid.despawnDroplet(dropId);

// Live physics
liquid.setPhysicsConfig({ tension: 150, damping: 6 });

// WebGPU background refraction
liquid.setBackgroundTexture(bitmap); // ImageBitmap | null

// Lifecycle
liquid.pause();
liquid.resume();
liquid.destroy();
```

## Liquid types

| Value | Name | Behavior |
|-------|------|----------|
| `0` | Default | Soft-body following its DOM rect. |
| `3` | Dragged | Drag the DOM element; physics follows. |
| `4` | Shake | Vibrates after `impulse()`. |
| `5` | Tween | External `tween()` target. |
| `6` | FreeDrop | DOM-less droplet — no element observed. Used internally by `spawnDroplet()`. |

## Renderer

`renderer: 'auto'` is the default. It tries WebGPU; on `WebGPUUnavailableError` it silently falls back to Canvas2D. The choice is exposed:

```ts
console.log(liquid.activeRenderer); // 'webgpu' | 'canvas2d'
```

WebGPU unlocks **metaball fusion** (`theme.fusionRadius`) and **background refraction** (`theme.refraction`). Canvas2D is the universal fallback — fast, no fusion/refraction.

## Browser support

- **Canvas2D** path: every modern browser (Chrome, Firefox, Safari, Edge).
- **WebGPU** path: Chrome 113+, Edge 113+. Auto-fallback elsewhere.
- `DeviceOrientationEvent` gravity: iOS 13+ requires `liquid.requestOrientationPermission()` from a user-gesture handler.

## Accessibility

liquiddom is paint-only — DOM nodes remain accessible. The canvas itself is `pointer-events: none` and out of the focus order. `prefers-reduced-motion` freezes physics (sync/render still run for snap behavior).

## License

[MIT](./LICENSE) © Dennis Schmock
