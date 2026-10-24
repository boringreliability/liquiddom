# liquiddom

## 0.3.0-alpha.1

### Minor Changes

- 3bf4a9e: A stopped instance is reported. The new option `onError(err)` is called once when an instance stops for good (a frame that throws, a failed grid allocation for a growth or the first area hint, a failed Canvas2D rebuild after a lost WebGPU device), after its `console.error`; it is never called for a `create()` rejection, a fallback or after `destroy()`. The React and Vue providers (and the Vue plugin) now destroy a stopped instance and expose the reason through the new `useLiquidError()` (Vue also exports `LiquidErrorKey`); a `create()` rejection sets it too, and `config.onError` is still called. `<LiquidElement drag={false}>` and `useLiquidRef({ drag: false })` pass the drag opt-out to `observe()`. An app that observes its elements after `create()` (every adapter app, or `autoObserve: false`) now gets the same grid resolution as `autoObserve`: the first observed elements set the area hint once. A Vue example joins the React one, and both are smoke-tested from the published packages.
- 8efefda: Drag the liquid. A mouse or pen press on an observed element that moves more than 4 px now drags the element's liquid, never the DOM element: the liquid softens and follows the pointer, and on release it crawls back home and re-forms. The click that ends a drag no longer splashes or activates the element; a press that does not move stays a normal click. Escape, losing window focus, a cancelled pointer, `unobserve()`, `destroy()` and reduced motion cancel the drag. Under WebGPU the label rides on the liquid; under Canvas2D the element's DOM text is hidden (`-webkit-text-fill-color` via the new class `liquid-away`) until the liquid is back at rest. Touch and keyboard never drag. Mouse text selection that starts inside an observed element is no longer possible.
- 1a68179: **liquiddom 0.3 (alpha): the soft-body engine is retired and replaced by an MLS-MPM fluid engine.** This alpha draws each observed element as crisp liquid behind its real DOM text, with reduced motion and print handled. Splash, shake and the pointer field ship with this release. This is a breaking release; 0.2 code does not run unchanged. The 0.2 engine is preserved at the git tag `softbody-final`.

  ### Old → new

  | 0.2                                                                                                                                          | 0.3                                                                                                                                                                     |
  | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | option `capacity`                                                                                                                            | `maxElements` (fixed; `observe()` beyond it throws `RangeError`)                                                                                                        |
  | option `physics` (`LiquidPhysicsConfig`)                                                                                                     | `material: { viscosity, cohesion, recovery }`                                                                                                                           |
  | export `presets` (goo/jelly/firm)                                                                                                            | removed; material presets `water`/`honey`/`jelly` ship with this release                                                                                              |
  | options `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex`, `maxDt` | removed; `create()` throws a `TypeError` naming the replacement                                                                                                         |
  | `observe(el, liquidType)`                                                                                                                    | `observe(el, { viscosity?, recovery? })`                                                                                                                                |
  | `grow()`, `tween()`, `getBuffer()`, `spawnDroplet()`, `despawnDroplet()`, `setBackgroundTexture()`                                           | removed                                                                                                                                                                 |
  | `impulse()`                                                                                                                                  | removed; `splash(el, opts)` ships with this release                                                                                                                   |
  | `setPhysicsConfig()`, `getPhysicsConfig()`, `validatePhysicsConfig`                                                                          | removed; `setMaterial()` / `getMaterial()` ship with this release; `validateMaterial` (@internal)                                                                     |
  | `refreshTheme()`, `refreshShadow()`                                                                                                          | `refresh(el)`                                                                                                                                                           |
  | instance property `capacity`                                                                                                                 | `elementCapacity`, plus the new `particleCapacity`                                                                                                                      |
  | `isReducedMotion`, `isScrolling`, `pointerActive`, `pointerX`, `pointerY`, `preserveBackgrounds`, `isScrollSnapping`                         | removed                                                                                                                                                                 |
  | `LiquidInstancePanicDetail`, the `liquiddom:instance-panic` event, `SpawnDropletOptions`                                                     | removed (WASM init is single-flight; there is nothing to recover from)                                                                                                  |
  | React/Vue `useLiquidRef({ liquidType })`, `<LiquidElement liquidType>`                                                                       | `useLiquidRef({ viscosity?, recovery? })`, `<LiquidElement viscosity recovery>` (type names `UseLiquidRefOptions` / `LiquidElementProps` are kept, their shape changed) |

  ### `SplashOptions` changed shape

  In 0.2, `SplashOptions` was `{ threshold, count, jitter?, speedScale?, lifetimeMs?, radius? }` and configured droplet spawning inside `impulse()`. That type is gone in this alpha. This release adds a **different** `SplashOptions`, `{ strength?: number /* 0–2, default 1 */, at?: { x: number; y: number } /* client px */ }`, for `instance.splash(el, opts)`. Code that imports `SplashOptions` must be rewritten, not just recompiled.

  ### Known regression: colours no longer auto-refresh

  0.2 watched every observed element with a MutationObserver and re-read its background colour and box-shadow on `style`/`class` changes. 0.3 snapshots `background-color` and `color` once at `observe()`. Until the extended MutationObserver lands (slice 4), call `instance.refresh(el)` after you change an element's colours (theme switch, class toggle, inline style).

  ### Other behaviour changes

  - `LiquidDOM.create()` rejects with `LiquidWasmLoadError` when the WASM fails to load. The silent mock mode is gone.
  - Observed elements get `class="liquid-element"` (and `data-liquid-stack` when they need stacking). One `<style id="liquiddom-styles">` is injected per document. `unobserve()` restores the element exactly. Borders and box-shadows of observed elements are not drawn.
  - The canvas is `aria-hidden="true"`, sits below the observed elements (focus rings stay visible), and is hidden in print and forced-colors.
  - `renderer: 'auto'` uses Canvas2D until the WebGPU fluid renderer lands. `renderer: 'webgpu'` initialises WebGPU but draws nothing yet (one `console.warn`).
  - `gravity` is accepted and validated but has no effect yet.
  - `pause()` is no longer undone when a hidden tab becomes visible again.

- 47a91b6: Gravity works. The `gravity` option (`source: 'none' | 'fixed' | 'orientation'`) now reaches the liquid, and only its changes act: tilting the phone (or changing a fixed vector with the new `setGravity(partial)`) sloshes the liquid inside its element, and it rests at home again, so the crisp contour and the real DOM text come back. A constant gravity never leans the liquid, and the gravity given at `create()` or a switch of `source` starts at rest. `fixed` now means `normalize(vector) · strength`; `orientation` follows `deviceorientation` rotated with the screen, ignores changes under 2° and removes its listener on `destroy()`. `setGravity(partial)` is validated and applied atomically like `setMaterial`. Under reduced motion gravity is ignored.
- 08c86a6: Liquid text under WebGPU: while an element splashes, shakes or bulges, its text now stretches and tears with its own liquid, and at rest the real DOM text returns. The DOM text is hidden only while the liquid text stands in for it (never under Canvas2D, reduced motion, after a lost device or when the text atlas cannot be built). A splash or shake no longer leaves a pale outline of the element inside the hole.
- 1f58c54: Merge and separate. Dragging an element's liquid into another element now merges the two: the liquid under the dragged one softens and makes room, and after the release both separate and re-form within 3 seconds. Under WebGPU the labels never overlap: where the two liquids mix, neither shows its text. Nothing changes for a page without a drag.
- 98056d7: Parking and resize. Elements far outside the viewport (beyond the liquid's world plus a margin) are parked: their liquid is not simulated, which makes long pages cheaper, and when they scroll back into view they are at rest at once. When the window (or the container) grows beyond the area the liquid was set up for, the liquid's grid grows, with one `console.info` per growth; it never shrinks. In container mode the liquid's world is the container's visible box. The Canvas2D renderer no longer draws the liquid of an element that is hidden (`display: none`) while it moves.
- 7ad31ac: Fluid engine, slice 2: a soft pointer field (the liquid follows the pointer's motion with no holes), a 2 % hover swell (mouse or pen via `pointerenter`/`pointerleave`, touch ignored; focus has no swell and hover beats focus), `setMaterial()` / `getMaterial()`, and material `presets` (`water`, `honey`, `jelly`).

  `presets` changed shape: it now holds material presets `{ viscosity, cohesion, recovery }` instead of the 0.2 physics presets (`goo`, `jelly`, `firm` with `tension`, `damping`, `repulsionRadius`, …). Under reduced motion, pointer, hover, splash and shake are ignored (`splash()`/`shake()` still validate their arguments).

- a4ec0c4: Scroll follows. The liquid now moves with the page when it scrolls: every frame the scroll delta shifts the liquid rigidly with its elements, so scrolling no longer sets it sloshing or tears it, and a light, capped share of the scroll speed lets it lag a little and settle back. In container mode the liquid follows the container's own scroll and the canvas stays on the container's visible area (a `transform` on liquiddom's canvas only; the container is never restyled). Elements that do not move with the page (`position: fixed`, or `sticky` while stuck) keep their liquid in place. A drag survives a scroll: the dragged liquid stays under the pointer. Under reduced motion the liquid follows the scroll with no inertia.
- a0f0ed3: Fluid engine slice 2 (W67): full MLS-MPM dynamics with T-1000 re-form. New `splash(el, { strength?, at? })` and `shake(strength?)`. Clicking an observed element splashes at the pointer; keyboard activation splashes at the rect centre. `SplashOptions` changed shape in 0.3: the 0.2 fields `threshold`, `count`, `jitter`, `speedScale`, `lifetimeMs` and `radius` throw a `TypeError`.
- e201761: Liquid text stays true to the page. A change to an observed element's text, its own `class` or `style`, a web font that finishes loading, or a zoom/DPR change re-renders the element's liquid text on the next frame, and colour changes through the element's `class`/`style` or a `color`/`background-color` transition are picked up without calling `refresh(el)`. With forced colours or print the real DOM text shows at once, also mid-splash. In the Canvas2D renderer a moving element's DOM text gets a soft halo in the element's own background colour so it stays readable while its liquid is away.
- 05b36b5: Touch can drag. Hold an observed element for 350 ms and move: its liquid follows the finger and the page does not scroll; a quicker swipe still scrolls and a tap is still a click. While a finger holds a draggable element its long-press menu is suppressed and draggable elements get `-webkit-touch-callout: none`. The new element option `observe(el, { drag: false })` opts an element out of every drag (mouse, pen and touch) and keeps the browser's own long-press behaviour; like `viscosity` it is validated and read once. The pointer's idle velocity now fades per unit of time (0.8 per 1/60 s), so a 120 Hz display has the same tail as a 60 Hz one.
- 2ca8e37: The liquid goes under the page. The liquid canvas now sits at `z-index: -1`, so splashed or shaken liquid passes under the page's own text and boxes instead of over them, and observed elements no longer get `position: relative; z-index: 1` (their author dropdowns and overlays now show above them). If the page cannot take the canvas underneath — `<html>` and `<body>` both have a background, a wrapper or `<main>` around an observed element has an opaque background, or the `container` is not a stacking context (give it `isolation: isolate`) — liquiddom logs one `console.warn` naming the element (or, for a container, the fix) and keeps the previous behaviour (`z-index: 0`) for that instance. Under a shake, an element close to a window edge now sloshes inward instead of being cut off at the edge. The Canvas2D renderer draws a smoother edge while the liquid moves on pages with large elements (at some extra render cost there).
- c81045f: `renderer: 'auto'` (the default) now uses WebGPU when the browser has a hardware GPU adapter and falls back to Canvas2D otherwise (no WebGPU, a software adapter such as SwiftShader, or a canvas whose WebGPU presentation surface does not work), logging one `console.info` unless `silentFallback: true`. An explicit `renderer: 'webgpu'` also accepts a software adapter and still rejects `create()` with `WebGPUUnavailableError` when WebGPU is missing. If the GPU device is lost while the page runs, the instance continues with the Canvas2D renderer on a fresh canvas (one `console.warn`), and `activeRenderer` reports `'canvas2d'`. With `'auto'`, `create()` now performs one extra `requestAdapter` round-trip (plus `requestDevice` on a hardware adapter) before it resolves. `activeRenderer` can change from `'webgpu'` to `'canvas2d'` after a device loss without any event, so read it again whenever you need it rather than caching it.

### Patch Changes

- a7e6b52: Shake and splash keep the liquid closed. The default stretch yield rises (cohesion 0.5 now maps to 0.46, the range is 0.02–0.90) and the shake profile amplitude drops to 0.35, so wide elements thin instead of tearing into a lace. The kernel radius follows the particle spacing up to 16 px (was 8 px), so a splash no longer leaves specks in a neighbouring element on pages with a large observed area; the Canvas2D density grid coarsens with it to keep its cost flat. The honey preset re-forms within 3 s.
- 138cc7c: Shake stretches less and no longer tears the card into a lace. The speed profile amplitude drops from 0.8 to 0.5, and shake softens elements to s ≤ 0.3 (was 0.2).
- cf23de1: Slice-2 feel fixes: `shake()` now sets every element sloshing (a spatially coherent wave per element instead of per-particle noise, and elements go softer during a shake), the pointer field drags the liquid twice as strongly so the bulge along a sweep is readable, and the Canvas2D renderer no longer flashes a pale, translucent fill while an element fades back to rest.
- 6d0fd3e: `renderer: 'webgpu'` now draws the liquid: instanced particle splats thresholded into a smooth silhouette, blended colour where elements meet, and a crisp rounded-rect contour at rest. Translucent element backgrounds keep their alpha. `'auto'` still uses Canvas2D for now, and the infrastructure-only warning for `'webgpu'` is gone.
- d7d644b: Element colours in any CSS syntax the browser paints (oklch, lab, color(), named colours) now reach the liquid; previously they fell back to the default purple.

## 0.2.0-rc.0

### Minor Changes

Initial public release.

**Core capabilities:**

- WASM-driven soft-body physics on real DOM elements via hidden `<canvas>` overlay
- 9-float-per-entity flat `Float32Array` FFI contract (no JSON over the boundary)
- Pre-allocated buffer pool with explicit `grow()` (no entity churn)
- Phantom DOM observation — original elements stay accessible

**Rendering:**

- `renderer: 'auto'` (default) — probes WebGPU, falls back to Canvas2D transparently
- Canvas2D path: Bezier-spline blobs, universal browser support
- WebGPU path: SDF blobs, metaball fusion (`theme.fusionRadius`), background refraction (`theme.refraction`)
- `instance.activeRenderer` exposes the chosen backend

**Liquid types:**

- `0` Default — soft-body following DOM rect
- `3` Dragged — drag the element, physics follows
- `4` Shake — vibrates after `impulse()`
- `5` Tween — external position target
- `6` FreeDrop — DOM-less droplet particles

**Interaction primitives:**

- `impulse(el, opts)` with optional droplet splash
- `tween(el, opts)` with `linear` / `ease-out` easing
- `spawnDroplet(opts)` / `despawnDroplet(id)`
- `setPhysicsConfig(partial)` for live runtime tuning

**Environment integration:**

- Scroll-aware physics pause + smooth snap-back lerp
- Reduced-motion respect
- `prefers-color-scheme` via `colorSource: 'computed'`
- Device orientation gravity (`gravity.source: 'orientation'`)
- Container-mode (positioned containing block) + fullscreen mode
- `preserveBackgrounds` clip-hole with border-radius + box-shadow margin handling

**Browser support:**

- Canvas2D path: all modern browsers (Chrome, Firefox, Safari, Edge)
- WebGPU path: Chrome 113+, Edge 113+
