---
layout: ../../layouts/DocsLayout.astro
title: Limitations
description: What the 0.3 alpha does not do yet, and how to work around it.
---

liquiddom 0.3 is an alpha. These are the known limits, with what to do about each.

## Layout and stacking

- **Backgrounds on ancestors.** The canvas sits under the page. An observed element inside an ancestor with an opaque background puts the instance into a fallback (`z-index: 0`, one `console.warn`). Keep the page background on `<html>` and leave wrappers transparent. A background added to an ancestor after `observe()` is not checked again.
- **Containers.** In container mode the container must be positioned (`position: relative`) and a stacking context (`isolation: isolate`). liquiddom warns but never restyles it.
- **Transforms and clipping.** An observed element inside an ancestor with `transform`, `filter` or `overflow: hidden` can end up under other content. An ancestor stacking context with a negative `z-index` is not detected.
- **Shapes.** Only a uniform, circular `border-radius` is honoured. Borders of observed elements are not drawn. Box-shadows are: up to four outer layers follow the liquid while it moves, inset layers show at rest only, and `filter: drop-shadow()` is not drawn. A spread larger than the viewport diagonal is clamped to it, and a spread larger than the element's smaller side is approximate in Canvas2D (8 shifted copies). A box-shadow that changes on `:hover` without a transition needs `refresh(el)`, as colours do. While the liquid moves, a resting element's own shadow paints over liquid passing it, and an element with an author `transition: box-shadow` has any other transition running at that moment jump to its end when the liquid leaves or comes back to rest.
- **Shadow DOM.** Ancestors outside a shadow root's host are not checked for backgrounds.

## Colours

Colours are read when an element is observed and again when its own `class` or `style` changes or a colour transition on it ends. Call `refresh(el)` after any other colour change: a new stylesheet rule, a class on an ancestor, a `:hover` colour without a transition, or a `@keyframes` colour animation.

- Colours outside `rgb()`/hex are read back from a 1×1 canvas, so browsers with fingerprinting protection (Firefox `resistFingerprinting`, Brave) may noise or blank them. Use `rgb()` or hex for exact liquid colours there.

## Scroll

- While the page scrolls, the canvas can trail the content by one frame, so a label can sit a little off its liquid during a fast scroll. At rest it is exact.
- An element that leaves the simulated area keeps its liquid pressed against the edge until it is parked or comes back. A far-away element is parked and re-appears at rest.
- In container mode the canvas keeps the container's scroll range after its content shrinks.

## Rendering

- **Text in the liquid is WebGPU only.** With WebGPU the labels flow with the liquid. With Canvas2D the DOM text stays in place over the moving liquid, with a halo in the element's colour.
- If the GPU device is lost, the instance continues in Canvas2D (`activeRenderer` becomes `"canvas2d"`).

## Gravity and touch

- Gravity is a subtle lean by design: only changes act, and the liquid always rests at home.
- `requestOrientationPermission()` and touch drag are untested on a real iOS device.
- A swipe that starts on a draggable observed element waits for the main thread, since its `touchmove` listener is not passive.
- On Windows and ChromeOS touchscreens the context menu may open when the finger lifts after a touch drag.
- The iOS callout stays suppressed under reduced motion, where nothing drags. An element observed with `{ drag: false }` gets `-webkit-touch-callout: default`, which overrides a `none` it would inherit from your styles.

## Adapters

- React 19 is in the peer range but untested.
- An instance that stopped keeps its elements decorated until `destroy()`; the adapters destroy it for you.
