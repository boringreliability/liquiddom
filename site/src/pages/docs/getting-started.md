---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Install liquiddom, pour your first element and learn the one stacking rule.
---

liquiddom runs a 2D fluid simulation (MLS-MPM, in Rust compiled to WebAssembly) and paints it on a canvas under your page. Each element you observe becomes a drop of liquid in its own background colour. The element itself stays a real element: focusable, clickable and read by a screen reader.

> **0.3 alpha.** The API can still change between alphas. Pin the version you test with.

## Install

```bash
npm install liquiddom@alpha
```

The package ships ES modules and a `.wasm` file that it loads next to its own JavaScript.

## Five lines of vanilla

```html
<button class="pill" data-liquid>Pour me</button>

<script type="module">
  import { LiquidDOM } from "liquiddom";
  const liquid = await LiquidDOM.create();
</script>
```

The bare `import "liquiddom"` needs a bundler (Vite, webpack, Rollup, …) that resolves npm packages and serves the `.wasm` file with them. A plain HTML file opened from disk cannot resolve it.

`create()` loads the WebAssembly, mounts one canvas and observes every element that carries `data-liquid`. It resolves with an instance; see the [API](/docs/api/) for everything on it.

## `data-liquid`

Mark the elements that should become liquid:

```html
<button class="pill" data-liquid>Subscribe</button>
<article class="card" data-liquid>…</article>
```

- The liquid takes each element's computed `background-color`. Any CSS colour works, including `oklch()` and Tailwind's theme colours.
- liquiddom hides the element's own background, border and box-shadow while it is observed and draws the liquid in their place. The element's text, focus ring and events are untouched.
- `unobserve(el)` (or `destroy()`) restores the element exactly.

## Observing by hand

`autoObserve` is `true` by default. Turn it off to choose the elements and their options yourself:

```js
const liquid = await LiquidDOM.create({ autoObserve: false });
liquid.observe(document.querySelector("#search"), { drag: false }); // a field: never dragged
for (const el of document.querySelectorAll("[data-liquid]")) liquid.observe(el);
```

`observe()` is idempotent: observing an element again keeps the options it was first observed with. To watch for elements added later, call `liquid.autoDiscover()`.

## The stacking rule

The canvas sits **under** the page (`z-index: -1`), so your text always paints above the liquid. For that to work:

- Put the page background on `<html>`, not on `<body>`. A `<body>` without a background while `<html>` has one is fine.
- Give no ancestor of an observed element an opaque background (a section, a wrapper, a card around a button). The liquid would be drawn under it and disappear.

When liquiddom finds such a background it logs one `console.warn` naming the element and the fix, then falls back for that instance: the canvas moves to `z-index: 0`, above plain page backgrounds, and observed elements are lifted above it.

### Container mode

To keep the liquid inside one box, pass `container`:

```js
const box = document.querySelector(".pool"); // position: relative; isolation: isolate
const liquid = await LiquidDOM.create({ container: box, particles: 1000, maxElements: 4 });
```

The container must be positioned (for example `position: relative`), since the canvas is absolutely positioned inside it, and it must be a stacking context (for example `isolation: isolate`), so the liquid can go under its content. liquiddom never restyles it; it warns instead.

## Next

- Tune the material and gravity in the [playground](/playground/), then copy the settings as code.
- Using React or Vue? See [React and Vue](/docs/adapters/).
