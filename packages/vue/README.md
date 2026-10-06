# @liquiddom/vue

Vue 3.4+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom): WASM-driven fluid dynamics on real DOM elements.

## Install

```bash
npm install liquiddom@alpha @liquiddom/vue@alpha
```

## Quickstart

```vue
<script setup lang="ts">
import { LiquidProvider, LiquidElement } from "@liquiddom/vue";
</script>

<template>
  <LiquidProvider :config="{ material: { viscosity: 0.6, cohesion: 0.85, recovery: 0.4 } }">
    <LiquidElement as="button" :viscosity="0.3">Splash</LiquidElement>
  </LiquidProvider>
</template>
```

## API

| Export | Purpose |
|---|---|
| `<LiquidProvider :config>` | Owns one `LiquidDOMInstance` via provide/inject; `config` is read once on mount |
| `LiquidPlugin` | Alternative install: `app.use(LiquidPlugin, config?)` |
| `LiquidKey` | The injection key |
| `useLiquid()` | `Ref<LiquidDOMInstance \| null>` |
| `useLiquidRef<T>({ viscosity?, recovery? }?)` | Template ref that observes once mounted; options are read once at setup |
| `<LiquidElement :as :viscosity :recovery>` | Convenience tag; attrs, class, style and events are forwarded |

SSR-safe: nothing runs on the server.

## Material

`config` is read once on mount, so changing `config.material` later does nothing. Change the material live through the instance, for example with one of the core's `presets` (`water`, `honey`, `jelly`). `useLiquid()` returns a `Ref`, so read `.value`:

```vue
<script setup lang="ts">
import { presets } from "liquiddom";
import { useLiquid } from "@liquiddom/vue";

const liquid = useLiquid();
</script>

<template>
  <button @click="liquid?.setMaterial(presets.honey)">Honey</button>
</template>
```

In a template the ref is unwrapped; in script use `useLiquid().value?.setMaterial(...)`. `getMaterial()` returns the resolved material. A preset also works at create time: `<LiquidProvider :config="{ material: presets.jelly }">`.

## Migrating from 0.2

`useLiquidRef({ liquidType })` and `<LiquidElement :liquidType>` are gone; use `{ viscosity?, recovery? }`.

## License

MIT
