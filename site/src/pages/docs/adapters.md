---
layout: ../../layouts/DocsLayout.astro
title: React and Vue
description: The @liquiddom/react and @liquiddom/vue adapters, and how they handle a stopped instance.
---

Both adapters create one liquiddom instance for a part of your app and observe elements as they mount. They take the same `config` as [`LiquidDOM.create()`](/docs/api/), read once when the provider mounts.

## React

```bash
npm install liquiddom@alpha @liquiddom/react@alpha
```

React 18 (19 is in the peer range but untested).

```tsx
import { LiquidProvider, LiquidElement, useLiquid, useLiquidError } from "@liquiddom/react";

export default function App() {
  return (
    <LiquidProvider config={{ material: { viscosity: 0.6 } }}>
      <Pills />
    </LiquidProvider>
  );
}

function Pills() {
  const liquid = useLiquid();       // the instance, or null
  const error = useLiquidError();   // why there is none, or null
  return (
    <>
      <LiquidElement as="button" className="pill" onClick={() => liquid?.shake()}>
        Shake
      </LiquidElement>
      <LiquidElement as="input" drag={false} aria-label="Search" />
      {error !== null ? <p role="status">The liquid stopped.</p> : null}
    </>
  );
}
```

- **`<LiquidProvider config>`** creates the instance on mount and destroys it on unmount.
- **`<LiquidElement as viscosity recovery drag>`** renders `as` (default `div`) and observes it. `viscosity`, `recovery` and `drag` are [element options](/docs/api/#elementoptions), read once when the element first attaches; every other prop goes to the DOM element.
- **`useLiquidRef(opts?)`** is the hook behind it: a callback ref for your own element.
- **`useLiquid()`** returns the instance, or `null` before it is ready, outside a provider and after a stop.
- **`useLiquidError()`** returns the error that left the provider without an instance, or `null`.

## Vue

```bash
npm install liquiddom@alpha @liquiddom/vue@alpha
```

Vue 3.4 or newer. Install the plugin for the whole app, or wrap a subtree in `<LiquidProvider>`:

```ts
import { createApp } from "vue";
import { LiquidPlugin } from "@liquiddom/vue";
import App from "./App.vue";

createApp(App).use(LiquidPlugin, { material: { viscosity: 0.6 } }).mount("#app");
```

```vue
<script setup lang="ts">
import { LiquidElement, useLiquid, useLiquidError } from "@liquiddom/vue";
const liquid = useLiquid();       // Ref: the instance, or null
const error = useLiquidError();   // Ref: why there is none, or null
</script>

<template>
  <LiquidElement as="button" class="pill" @click="liquid?.shake()">Shake</LiquidElement>
  <LiquidElement as="input" :drag="false" aria-label="Search" />
  <p v-if="error !== null" role="status">The liquid stopped.</p>
</template>
```

- **`LiquidPlugin`** (`app.use(LiquidPlugin, config)`) creates one instance for the app and destroys it on `app.unmount()`.
- **`<LiquidProvider :config>`** does the same for its subtree.
- **`<LiquidElement as viscosity recovery drag>`**, **`useLiquidRef(opts?)`**, **`useLiquid()`** and **`useLiquidError()`** work as in React; the two hooks return refs. `LiquidKey` and `LiquidErrorKey` are the injection keys.

## When the liquid stops

An instance can stop for good after it started (see [Errors](/docs/api/#errors)). Both adapters handle it the same way:

1. The provider (or plugin) destroys the stopped instance at once, so no element stays decorated on a dead canvas.
2. `useLiquid()` becomes `null` and `useLiquidError()` holds the error. A `create()` rejection sets the error too.
3. There is no automatic retry. Remount the provider to create a new instance, for example with a new `key` in React or `v-if` in Vue.

Your own `config.onError` is still called, after the adapter's handler. Elements stay usable throughout: a stopped liquid only means no liquid is drawn.
