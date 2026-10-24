# @liquiddom/react

## 0.3.0-alpha.1

### Minor Changes

- 3bf4a9e: A stopped instance is reported. The new option `onError(err)` is called once when an instance stops for good (a frame that throws, a failed grid allocation for a growth or the first area hint, a failed Canvas2D rebuild after a lost WebGPU device), after its `console.error`; it is never called for a `create()` rejection, a fallback or after `destroy()`. The React and Vue providers (and the Vue plugin) now destroy a stopped instance and expose the reason through the new `useLiquidError()` (Vue also exports `LiquidErrorKey`); a `create()` rejection sets it too, and `config.onError` is still called. `<LiquidElement drag={false}>` and `useLiquidRef({ drag: false })` pass the drag opt-out to `observe()`. An app that observes its elements after `create()` (every adapter app, or `autoObserve: false`) now gets the same grid resolution as `autoObserve`: the first observed elements set the area hint once. A Vue example joins the React one, and both are smoke-tested from the published packages.
- 1a68179: **liquiddom 0.3 (alpha): the soft-body engine is retired and replaced by an MLS-MPM fluid engine.** This first alpha ships the liquid _at rest_: each observed element is drawn as crisp liquid behind its real DOM text, with reduced motion and print handled. Splash, shake and the pointer field arrive in the next alpha. This is a breaking release; 0.2 code does not run unchanged. The 0.2 engine is preserved at the git tag `softbody-final`.

  ### Old → new

  | 0.2                                                                                                                                          | 0.3                                                                                                                                                                     |
  | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | option `capacity`                                                                                                                            | `maxElements` (fixed; `observe()` beyond it throws `RangeError`)                                                                                                        |
  | option `physics` (`LiquidPhysicsConfig`)                                                                                                     | `material: { viscosity, cohesion, recovery }`                                                                                                                           |
  | export `presets` (goo/jelly/firm)                                                                                                            | removed; material presets `water`/`honey`/`jelly` arrive in the next alpha                                                                                              |
  | options `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex`, `maxDt` | removed; `create()` throws a `TypeError` naming the replacement                                                                                                         |
  | `observe(el, liquidType)`                                                                                                                    | `observe(el, { viscosity?, recovery? })`                                                                                                                                |
  | `grow()`, `tween()`, `getBuffer()`, `spawnDroplet()`, `despawnDroplet()`, `setBackgroundTexture()`                                           | removed                                                                                                                                                                 |
  | `impulse()`                                                                                                                                  | removed; `splash(el, opts)` arrives in the next alpha                                                                                                                   |
  | `setPhysicsConfig()`, `getPhysicsConfig()`, `validatePhysicsConfig`                                                                          | removed; `setMaterial()` / `getMaterial()` arrive in the next alpha; `validateMaterial` (@internal)                                                                     |
  | `refreshTheme()`, `refreshShadow()`                                                                                                          | `refresh(el)`                                                                                                                                                           |
  | instance property `capacity`                                                                                                                 | `elementCapacity`, plus the new `particleCapacity`                                                                                                                      |
  | `isReducedMotion`, `isScrolling`, `pointerActive`, `pointerX`, `pointerY`, `preserveBackgrounds`, `isScrollSnapping`                         | removed                                                                                                                                                                 |
  | `LiquidInstancePanicDetail`, the `liquiddom:instance-panic` event, `SpawnDropletOptions`                                                     | removed (WASM init is single-flight; there is nothing to recover from)                                                                                                  |
  | React/Vue `useLiquidRef({ liquidType })`, `<LiquidElement liquidType>`                                                                       | `useLiquidRef({ viscosity?, recovery? })`, `<LiquidElement viscosity recovery>` (type names `UseLiquidRefOptions` / `LiquidElementProps` are kept, their shape changed) |

  ### `SplashOptions` changed shape

  In 0.2, `SplashOptions` was `{ threshold, count, jitter?, speedScale?, lifetimeMs?, radius? }` and configured droplet spawning inside `impulse()`. That type is gone in this alpha. The next alpha adds a **different** `SplashOptions`, `{ strength?: number /* 0–2, default 1 */, at?: { x: number; y: number } /* client px */ }`, for `instance.splash(el, opts)`. Code that imports `SplashOptions` must be rewritten, not just recompiled.

  ### Known regression: colours no longer auto-refresh

  0.2 watched every observed element with a MutationObserver and re-read its background colour and box-shadow on `style`/`class` changes. 0.3 snapshots `background-color` and `color` once at `observe()`. Until the extended MutationObserver lands (slice 4), call `instance.refresh(el)` after you change an element's colours (theme switch, class toggle, inline style).

  ### Other behaviour changes

  - `LiquidDOM.create()` rejects with `LiquidWasmLoadError` when the WASM fails to load. The silent mock mode is gone.
  - Observed elements get `class="liquid-element"` (and `data-liquid-stack` when they need stacking). One `<style id="liquiddom-styles">` is injected per document. `unobserve()` restores the element exactly. Borders and box-shadows of observed elements are not drawn.
  - The canvas is `aria-hidden="true"`, sits below the observed elements (focus rings stay visible), and is hidden in print and forced-colors.
  - `renderer: 'auto'` uses Canvas2D until the WebGPU fluid renderer lands. `renderer: 'webgpu'` initialises WebGPU but draws nothing yet (one `console.warn`).
  - `gravity` is accepted and validated but has no effect yet.
  - `pause()` is no longer undone when a hidden tab becomes visible again.

## 0.2.0-rc.0

### Minor Changes

Initial public release. React 18+ bindings for [`liquiddom`](https://www.npmjs.com/package/liquiddom).

**Exports:**

- `<LiquidProvider config?>` — owns a `LiquidDOMInstance` via React Context
- `useLiquid()` — read the instance (returns `null` before init / outside provider)
- `useLiquidRef<T>(opts?)` — callback ref that auto-observes/unobserves
- `<LiquidElement as? liquidType? ...rest>` — drop-in tag wrapping `useLiquidRef`

**Behavior:**

- Strict-mode safe (idempotent observe — React 18 double-mount in dev does not double-register)
- SSR-safe (provider effect gated on `typeof window`)
- `liquiddom` is a peer dependency (single WASM instance shared across the app)

### Peer dependencies

- `liquiddom@^0.2.0-rc.0`
- `react@^18.0.0 || ^19.0.0`
