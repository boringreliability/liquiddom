# liquiddom

[![CI](https://github.com/boringreliability/liquiddom/actions/workflows/ci.yml/badge.svg)](https://github.com/boringreliability/liquiddom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/liquiddom.svg)](https://www.npmjs.com/package/liquiddom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

WASM-driven soft-body physics that animates real DOM elements through a hidden `<canvas>` overlay — without sacrificing accessibility. Rust runs the math, TypeScript orchestrates the DOM. They share a pre-allocated `Float32Array` over the FFI boundary; there is no JSON in the hot path.

> **Status:** `0.2.0-rc.0` — Release Candidate. API is stable but expect a final polish pass before 1.0.

## Why?

CSS animations and JS tweens can't make DOM elements feel like physical matter — squishing, splashing, magnetizing, draping over a cursor. liquiddom does, while the underlying `<button>` / `<a>` / `<div>` remains a plain accessible DOM node: screen readers see it, keyboard focus works, `:hover` still fires.

## Quickstart

```bash
npm install liquiddom
```

```ts
import { LiquidDOM } from "liquiddom";

const liquid = await LiquidDOM.create({
  capacity: 64,
  autoObserve: true, // observes every [data-liquid] element on the page
});
```

```html
<button data-liquid>I am physically squishy</button>
```

That's it. The button now reacts to pointer, scroll, focus, and viewport changes. See [`packages/core/README.md`](packages/core/README.md) for the full API.

## Framework adapters

| Package | Purpose |
|---------|---------|
| [`liquiddom`](packages/core) | Core library — works with any web framework or vanilla |
| [`@liquiddom/react`](packages/react) | React 18+ Provider + hooks (`useLiquid`, `useLiquidRef`) |
| [`@liquiddom/vue`](packages/vue) | Vue 3.4+ Provider + composables (`useLiquid`, `useLiquidRef`) |

## Architecture — the Rule of Two

```
┌─────────────────────────────────────┐
│  TypeScript (DOM-aware)             │
│  - PhantomObserver: reads rects     │
│  - RAF loop                         │
│  - Pointer/scroll/visibility events │
│  - Renderer (Canvas2D or WebGPU)    │
└─────────┬───────────────────────────┘
          │ flat Float32Array (9 floats/entity)
          │ NO JSON, NO setters
┌─────────▼───────────────────────────┐
│  Rust → WASM (DOM-blind)            │
│  - Physics: mass-spring-damper      │
│  - Particle constraints             │
│  - Area preservation                │
└─────────────────────────────────────┘
```

- **Rust** is DOM-blind and color-blind: positions, velocities, springs, neighbor constraints. It never reads `document`, never knows about CSS or themes.
- **TypeScript** owns DOM and rendering. `PhantomObserver` writes per-entity `[x, y, w, h, ...]` into the shared buffer; reads particle positions back out for splines.
- **The FFI contract is the buffer.** Zero allocation per frame, zero serialization.

## Rendering backends

| Backend | Status | Features |
|---------|--------|----------|
| Canvas2D | Default fallback | Bezier-spline blobs, fast, works everywhere |
| WebGPU | Chrome 113+ / Edge 113+ | Metaball fusion (SDF smin), background refraction |

`renderer: 'auto'` (the default since v0.2.0-rc.0) probes WebGPU and falls back to Canvas2D transparently. Check `instance.activeRenderer` for the chosen backend.

## Demos

```bash
npm run dev
```

Opens the demo gallery at `http://localhost:3000`. Scenes:

- `scenes/dragable-cards.html` — draggable cards with liquid drop-shadow
- `scenes/scroll-hero.html` — scroll-responsive hero with smooth snap-back
- `scenes/splash-buttons.html` — buttons that splash droplets when clicked
- `scenes/tilt-bowl.html` — device-orientation gravity demo
- `scenes/fusion.html` — WebGPU metaball fusion
- `scenes/refraction.html` — WebGPU background refraction (glass lens)
- `scenes/playground.html` — Tweakpane-driven live physics tuning

## Development

```bash
npm run build       # wasm-pack + tsc across all packages
npm test            # vitest workspace (jsdom)
cargo test          # Rust unit tests
cargo clippy        # zero warnings required
npm run verify      # build + test:rust + test + clippy
```

This repo uses [WDD (Ward-Driven Development)](.wdd/PROJECT.md) — work is broken into atomic "wards", each with its own spec/tests/implementation. See `.wdd/PROGRESS.md` for status (56/57 complete as of this writing).

## License

[MIT](LICENSE) © Dennis Schmock
