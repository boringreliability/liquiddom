# @liquiddom/vue

Vue 3.4+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom).

## Install

```bash
npm install liquiddom @liquiddom/vue vue
```

`liquiddom` is a peer dependency — install it explicitly so a single WASM instance is shared across your app.

## Quickstart

```vue
<script setup lang="ts">
import { LiquidProvider, LiquidElement } from "@liquiddom/vue";
</script>

<template>
  <LiquidProvider :config="{ capacity: 16 }">
    <LiquidElement as="button">Click me</LiquidElement>
  </LiquidProvider>
</template>
```

Or install as a plugin:

```ts
import { createApp } from "vue";
import { LiquidPlugin } from "@liquiddom/vue";

createApp(App).use(LiquidPlugin, { capacity: 16 }).mount("#app");
```

## API

- `<LiquidProvider :config>` — owns a `LiquidDOMInstance` via provide/inject.
- `LiquidPlugin` — alternative install via `app.use(LiquidPlugin, config?)`.
- `useLiquid()` — returns `Ref<LiquidDOMInstance | null>`.
- `useLiquidRef<T>(opts?)` — template ref that auto-observes/unobserves.
- `<LiquidElement :as :liquidType>` — convenience tag wrapping `useLiquidRef`.

SSR-safe — provider effect gated on `typeof window`.

## License

MIT — see [LICENSE](./LICENSE).
