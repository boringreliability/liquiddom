---
"liquiddom": minor
"@liquiddom/react": minor
"@liquiddom/vue": minor
---

**liquiddom 0.3 (alpha): the soft-body engine is retired and replaced by an MLS-MPM fluid engine.** This first alpha ships the liquid *at rest*: each observed element is drawn as crisp liquid behind its real DOM text, with reduced motion and print handled. Splash, shake and the pointer field arrive in the next alpha. This is a breaking release; 0.2 code does not run unchanged. The 0.2 engine is preserved at the git tag `softbody-final`.

### Old → new

| 0.2 | 0.3 |
|---|---|
| option `capacity` | `maxElements` (fixed; `observe()` beyond it throws `RangeError`) |
| option `physics` (`LiquidPhysicsConfig`), `presets` (goo/jelly/firm) | `material: { viscosity, cohesion, recovery }`; material presets `water`/`honey`/`jelly` arrive in the next alpha |
| options `colorDefault`, `colorHover`, `colorSource`, `theme`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex`, `maxDt` | removed; `create()` throws a `TypeError` naming the replacement |
| `observe(el, liquidType)` | `observe(el, { viscosity?, recovery? })` |
| `grow()`, `tween()`, `getBuffer()`, `spawnDroplet()`, `despawnDroplet()`, `setBackgroundTexture()` | removed |
| `impulse()` | removed; `splash(el, opts)` arrives in the next alpha |
| `setPhysicsConfig()`, `getPhysicsConfig()`, `validatePhysicsConfig` | removed; `setMaterial()` / `getMaterial()` arrive in the next alpha; `validateMaterial` (@internal) |
| `refreshTheme()`, `refreshShadow()` | `refresh(el)` |
| `capacity` | `elementCapacity`, plus the new `particleCapacity` |
| `isReducedMotion`, `isScrolling`, `pointerActive`, `pointerX`, `pointerY`, `preserveBackgrounds`, `isScrollSnapping` | removed |
| `LiquidInstancePanicDetail`, the `liquiddom:instance-panic` event, `SpawnDropletOptions` | removed (WASM init is single-flight; there is nothing to recover from) |
| React/Vue `useLiquidRef({ liquidType })`, `<LiquidElement liquidType>` | `useLiquidRef({ viscosity?, recovery? })`, `<LiquidElement viscosity recovery>` (type names `UseLiquidRefOptions` / `LiquidElementProps` are kept, their shape changed) |

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
