# @liquiddom/vue

Vue 3.4+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom) — WASM-driven soft-body physics on real DOM elements.

## Install

```bash
npm install liquiddom @liquiddom/vue vue
```

`liquiddom` is a peer dependency so a single WASM instance is shared across your app.

## Quickstart

```vue
<script setup lang="ts">
import { LiquidProvider, LiquidElement } from "@liquiddom/vue";
</script>

<template>
  <LiquidProvider :config="{ capacity: 16, theme: { fusionRadius: 50 } }">
    <LiquidElement as="button">Click me</LiquidElement>
    <LiquidElement as="a" href="#">Also liquid</LiquidElement>
  </LiquidProvider>
</template>
```

## Three usage patterns

### 1. `<LiquidElement>` — drop-in tag

Easiest. Wraps `useLiquidRef` and observes on mount.

```vue
<LiquidElement as="button" :liquid-type="4 /* Shake */">
  Shaky
</LiquidElement>
```

### 2. `useLiquidRef` — template ref on your own element

When you need full control over the element.

```vue
<script setup lang="ts">
import { useLiquidRef } from "@liquiddom/vue";

const cardRef = useLiquidRef<HTMLDivElement>({ liquidType: 3 /* Dragged */ });
</script>

<template>
  <div ref="cardRef" class="my-card">Drag me</div>
</template>
```

### 3. `useLiquid` — imperative access

For one-off actions like `impulse()`, `tween()`, `spawnDroplet()`.

```vue
<script setup lang="ts">
import { useLiquid, useLiquidRef } from "@liquiddom/vue";

const liquid = useLiquid();
const buttonRef = useLiquidRef<HTMLButtonElement>();

function splash() {
  if (liquid.value && buttonRef.value) {
    liquid.value.impulse(buttonRef.value, { magnitude: 20 });
  }
}
</script>

<template>
  <button ref="buttonRef" @click="splash">Splash me</button>
</template>
```

## Plugin install (alternative to `<LiquidProvider>`)

```ts
import { createApp } from "vue";
import { LiquidPlugin } from "@liquiddom/vue";
import App from "./App.vue";

createApp(App)
  .use(LiquidPlugin, { capacity: 16 })
  .mount("#app");
```

The plugin attaches the instance app-wide; `useLiquid()` works without a surrounding `<LiquidProvider>`. The plugin monkey-patches `app.unmount` for cleanup.

## API

| Export | Description |
|--------|-------------|
| `<LiquidProvider :config>` | Owns a `LiquidDOMInstance` via provide/inject. `config` captured once on mount. |
| `LiquidPlugin` | Alternative install via `app.use(LiquidPlugin, config?)`. |
| `useLiquid()` | Returns `Ref<LiquidDOMInstance \| null>`. Reactive — updates when async create resolves. |
| `useLiquidRef<T>(opts?)` | Template ref that auto-observes / unobserves across lifecycle. Internal watch uses `flush: "post"` so the element is mounted before observe fires. |
| `<LiquidElement :as :liquid-type ...attrs>` | Convenience tag. Uses `inheritAttrs: false` + manual spread so class/style/events/data-* forward correctly. |

## Notes

- **SSR-safe** — provider effect gated on `typeof window`; `useLiquidRef`'s watch doesn't fire on the server.
- **No `.vue` SFC dependency in the package** — adapter is pure TypeScript using `h()` render functions, so it can be consumed without `vite-plugin-vue` configured for `node_modules`.
- **`liquidType` is captured at first attach** — `:liquid-type="reactive"` looks reactive but is read once. Change requires re-mount.

## Full options + imperative API

All options and methods exposed via `:config` and `useLiquid()` come straight from [`liquiddom`'s core API](https://www.npmjs.com/package/liquiddom).

## License

[MIT](./LICENSE) © Dennis Schmock
