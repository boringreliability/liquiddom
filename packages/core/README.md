# liquiddom

WASM-driven fluid dynamics on web elements via a hidden canvas overlay. Rust computes the physics; TypeScript orchestrates DOM observation, the RAF loop, pointer/scroll/visibility events, and rendering. They share a pre-allocated `Float32Array` in WASM linear memory — there is no JSON over the FFI boundary.

## Install

```bash
npm install liquiddom
```

## Quickstart

```ts
import { LiquidDOM } from "liquiddom";

const instance = await LiquidDOM.create({
  capacity: 64,
  autoObserve: true,
});
```

For React bindings, see [`@liquiddom/react`](https://www.npmjs.com/package/@liquiddom/react). For Vue 3 bindings, see [`@liquiddom/vue`](https://www.npmjs.com/package/@liquiddom/vue).

## License

MIT — see [LICENSE](./LICENSE).
