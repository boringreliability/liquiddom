---
layout: ../../layouts/DocsLayout.astro
title: API
description: Every LiquidDOM.create() option, every instance member, element options, presets, gravity and the error types.
---

```ts
import {
  LiquidDOM, presets,
  WebGPUUnavailableError, LiquidWasmLoadError,
  type LiquidOptions, type LiquidDOMInstance, type ElementOptions,
  type Material, type GravityOptions, type SplashOptions,
} from "liquiddom";
```

## `LiquidDOM.create(options?)`

`LiquidDOM.create(options?: LiquidOptions): Promise<LiquidDOMInstance>`

Every option is optional. Unknown keys throw a `TypeError` that lists the allowed ones, and the options removed in 0.3 (`capacity`, `physics`, `theme`, …) throw a `TypeError` that names the replacement.

<div class="table-wrap">

| Option | Type | Default | Meaning |
|---|---|---|---|
| `particles` | `number` | `8000` | The fixed particle pool, an integer in [256, 65536]. Set once; there is no growing. |
| `maxElements` | `number` | `32` | The fixed element slots, an integer in [1, 256]. `observe()` beyond it throws `RangeError`. |
| `container` | `HTMLElement` | none | Container mode: the canvas mounts inside this element and the liquid stays in it. It must be positioned and a stacking context. |
| `renderer` | `"auto" \| "webgpu" \| "canvas2d"` | `"auto"` | `"auto"`: WebGPU on a hardware adapter, Canvas2D otherwise. `"webgpu"`: also on a software adapter; `create()` rejects with `WebGPUUnavailableError` without one. `"canvas2d"`: never probes WebGPU. |
| `material` | `Partial<Material>` | `{ viscosity: 0.5, cohesion: 0.5, recovery: 0.7 }` | Merged over the defaults; see [Material](#material). |
| `gravity` | `GravityOptions` | `{ source: "none" }` | See [Gravity](#gravity). |
| `seed` | `number` | random | A u32. The same seed, inputs and viewport give the same particle positions. |
| `autoObserve` | `boolean` | `true` | Observe every `[data-liquid]` element (inside `container`, if given) at create. |
| `forceReducedMotion` | `boolean` | `false` | Run in the still, crisp reduced-motion mode whatever the OS setting. |
| `silentFallback` | `boolean` | `false` | Hide the one `console.info` logged when `"auto"` falls back to Canvas2D. |
| `onError` | `(err: unknown) => void` | none | Called once when the instance stops for good. See [Errors](#errors). |

</div>

## The instance

`LiquidDOMInstance` is what `create()` resolves with. After `destroy()` every method throws, except `unobserve()` and `destroy()` (no-ops); `requestOrientationPermission()` returns a rejected promise.

### Elements

- **`observe(el: HTMLElement, opts?: ElementOptions): number`** observes an element and returns its slot id. Idempotent: a second call keeps the first options. Throws `RangeError` when all `maxElements` slots are taken and `TypeError` for invalid options.
- **`unobserve(el: HTMLElement): void`** stops observing and restores the element exactly.
- **`refresh(el: HTMLElement): void`** re-reads the element's `background-color` and `color` now. Changes to the element's own `class` or `style` and the end of its own colour transitions are picked up without it; call it after a colour change from anywhere else (a new stylesheet rule, an ancestor class, a `:hover` colour without a transition, a `@keyframes` colour animation).
- **`autoDiscover(root?: Element): void`** observes `[data-liquid]` elements as they are added under `root` (default: the container or `document.body`) and unobserves them as they are removed.
- **`stopAutoDiscover(): void`** stops that.

### Motion

- **`splash(el: HTMLElement, opts?: SplashOptions): void`** splashes an observed element. Throws `Error` when `el` is not observed. Clicking an observed element splashes at the pointer, and Enter or Space on a focused button or link (a click with detail 0) at its centre, without any code.
- **`shake(strength?: number): void`** sloshes every observed element. `strength` is 0–2 (default 1, 0 does nothing).
- **`setMaterial(partial: Partial<Material>): void`** validates, merges and applies a material change atomically; a `TypeError` leaves the material as it was.
- **`getMaterial(): Material`** returns a copy of the current material.
- **`setGravity(partial: Partial<GravityOptions>): void`** validates, merges and applies a gravity change atomically.
- **`requestOrientationPermission(): Promise<boolean>`** asks for device-orientation access on iOS 13+; call it from a user gesture. Resolves `true` when granted or not required.

Under reduced motion `splash()` and `shake()` still validate their arguments, but nothing moves.

### Lifecycle

- **`pause(): void`** and **`resume(): void`** stop and restart the frame loop. A hidden tab pauses on its own.
- **`destroy(): void`** removes the canvas, restores every element and frees the engine. It never throws; a second call does nothing.
- **`isPaused: boolean`** (read-only) is `true` after `pause()`.
- **`activeRenderer: "canvas2d" | "webgpu"`** (read-only) is the renderer in use. If the GPU device is lost, the instance continues in Canvas2D and this becomes `"canvas2d"`.
- **`particleCapacity: number`** and **`elementCapacity: number`** (read-only) are the fixed pool sizes.

## `ElementOptions`

The second argument of `observe()`. Read once, when the element is first observed; to change them, `unobserve()` and `observe()` again.

<div class="table-wrap">

| Key | Type | Default | Meaning |
|---|---|---|---|
| `viscosity` | `number` | the material's | [0, 1], for this element only. |
| `recovery` | `number` | the material's | Seconds in [0.2, 3], for this element only. |
| `drag` | `boolean` | `true` | `false`: the element never drags (mouse, pen or touch) and keeps the browser's long-press menu. Use it for text fields, inputs and `contenteditable`. |

</div>

## `SplashOptions`

<div class="table-wrap">

| Key | Type | Default | Meaning |
|---|---|---|---|
| `strength` | `number` | `1` | 0–2; 0 does nothing. |
| `at` | `{ x: number; y: number }` | the element's centre | The splash origin in client px, like `MouseEvent.clientX/Y`. |

</div>

## Material

```ts
interface Material { viscosity: number; cohesion: number; recovery: number }
```

`viscosity` and `cohesion` are in [0, 1]; `recovery` is the time in seconds, [0.2, 3], the liquid takes to re-form after a splash. `create()` and `setMaterial()` throw a `TypeError` for a value outside these ranges.

### `presets`

Three frozen materials:

<div class="table-wrap">

| Preset | viscosity | cohesion | recovery |
|---|---|---|---|
| `presets.water` | 0.15 | 0.3 | 0.5 |
| `presets.honey` | 0.9 | 0.7 | 0.8 |
| `presets.jelly` | 0.6 | 0.85 | 0.4 |

</div>

```ts
const liquid = await LiquidDOM.create({ material: presets.honey });
liquid.setMaterial({ cohesion: 0.8 });
```

## Gravity

```ts
interface GravityOptions {
  source: "none" | "fixed" | "orientation";
  vector?: [number, number]; // for "fixed"; normalised, [0, 0] = none
  strength?: number;         // px/s², default 980
}
```

Only **changes** in gravity act: a change sloshes the liquid inside its element, and it rests at home again within about 3 s; a constant gravity never leans it. The gravity given at `create()` and a switch of `source` start at rest, so `fixed` shows only when `setGravity()` changes its vector.

```ts
liquid.setGravity({ source: "fixed", vector: [1, 0] }); // tilt right: a slosh, then rest
if (await liquid.requestOrientationPermission()) liquid.setGravity({ source: "orientation" });
```

`orientation` follows the device tilt (rotated with the screen, changes under 2° ignored) and removes its listener on `destroy()`. Under reduced motion gravity is ignored.

## Errors

- **`WebGPUUnavailableError`**: `create({ renderer: "webgpu" })` rejects with it when the browser has no usable WebGPU. With `"auto"` it never reaches you: the instance falls back to Canvas2D.
- **`LiquidWasmLoadError`**: `create()` rejects with it when the WebAssembly cannot be imported, fetched or compiled. Its `cause` holds the underlying error.
- **`onError`**: an instance that is already running can still stop for good (a frame that throws, a failed growth of the simulated world after a resize, a failed grid rebuild for the first observed elements, or a failed Canvas2D rebuild after a lost GPU device). It then logs one `console.error`, stops drawing and calls `onError(err)` once. It is not called for a `create()` rejection, an `"auto"` fallback or after `destroy()`. Recovery is `destroy()`, then `create()`:

```ts
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
declare function showRestart(retry: () => void): void; // your UI

async function start() {
  let liquid: LiquidDOMInstance | null = null;
  let stopped = false;
  liquid = await LiquidDOM.create({
    onError() {
      stopped = true;
      liquid?.destroy();   // null while create() still runs
      showRestart(start);  // your UI: a button that calls start() again
    },
  });
  if (stopped) liquid.destroy(); // it stopped before create() resolved
}
```

`onError` can run before `create()` resolves; `create()` then resolves with the stopped instance, which is why the example destroys it on arrival too. `destroy()` is idempotent.
