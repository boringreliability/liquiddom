# liquiddom

**WASM-driven fluid dynamics on web elements via a hidden canvas, preserving a11y.** The elements *are* liquid: they splash, split, merge and always re-form. This is a playground, not a product.

- **Rust/WASM** runs a 2D MLS-MPM fluid on the CPU (`src/fluid/`).
- **TypeScript** observes the DOM, owns the frame loop and renders (Canvas2D now, WebGPU from a later slice).
- They share pre-allocated `Float32Array` views; there is no JSON over the FFI.
- **The DOM stays the source of truth.** Semantics, focus, events and hit areas stay on the real elements. The canvas is `aria-hidden` and sits below them.

> Status: **0.3 alpha, slice 1 ("liquid at rest")**. The 0.2 soft-body engine is retired; its last state is the tag `softbody-final`. Design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. North star: `.wdd/NORTH-STAR.md`.

## Quickstart

```ts
import { LiquidDOM } from "liquiddom";
const liquid = await LiquidDOM.create({ seed: 1 }); // observes every [data-liquid] element
```

Packages: [`liquiddom`](packages/core), [`@liquiddom/react`](packages/react), [`@liquiddom/vue`](packages/vue).

## Demos

`npm run dev` builds the WASM and serves `demo/`:
- `scenes/acceptance.html`: the north-star acceptance scene (`?rm=1` for reduced motion).
- `scenes/stress.html?n=4`: several instances created in one task.

The public site (`site/`) is frozen during the rewrite and returns in slice 6.

## Development

```bash
npm ci
npm run build          # wasm-pack + workspace builds
npm run test:rust      # cargo test
npm test               # vitest (core, react, vue); needs a fresh pkg/
npx playwright test --project=canvas2d
npm run verify         # build + test:rust + test + clippy
```

## License

MIT
