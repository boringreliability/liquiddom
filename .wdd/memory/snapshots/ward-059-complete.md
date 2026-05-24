# Context — liquiddom

## Last Updated
Ward 58 — 2026-05-24 (deployed at https://liquiddom.vsplat.io)

## Current State
56 wards COMPLETE (latest: Ward 41 — Canvas2D Fallback & Feature Detection). 55 Rust + 247 TS = 302 tests. 0 clippy warnings, 0 TS errors.

W41 closes the WebGPU epic. `renderer` default flips `'canvas2d'` → `'auto'`: try WebGPU, fall back to Canvas2D on `WebGPUUnavailableError`. New: `silentFallback?: boolean` (default false, emits one `console.info`); `instance.activeRenderer: 'canvas2d' | 'webgpu'` getter; private `mountCanvas(zIndex, container)` helper called twice on auto-fallback (W37 §17 fresh-canvas — WebGPU-polluted canvas cannot reuse `getContext("2d")`). `let canvas` reassign; `resizeCanvas` + `hasCanvasCtx` placed AFTER renderer init so closure captures post-fallback canvas. `hasCanvasCtx = activeRenderer === "webgpu" ? true : canvas.getContext("2d") !== null`. Branches: `'canvas2d'` skips probing; `'webgpu'` preserves W37 hard-fail; `'auto'` catches ONLY `WebGPUUnavailableError` (TypeError from a bug rethrows). Mid-session `device.lost` does NOT auto-rebuild in v1 (deferred). Demos: drop hand-rolled fallback on no-override path, keep on `?renderer=webgpu`; `refraction.ts` gate reads `instance.activeRenderer`.

Prior-ward summaries snapshotted in `.wdd/memory/snapshots/ward-NNN-complete.md`. Recent epic: W36 Render Abstraction → W37 WebGPU Pipeline → W38 SDF Blob → W39 Metaball Fusion → W40 Background Refraction → W41 Canvas2D Fallback. Next: tag `v0.2.0-rc.0` (W51 publish pipeline ready).

## Architecture Decisions Made
Older decisions snapshotted in `.wdd/memory/snapshots/`. Active load-bearing decisions:

| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` 9 floats/entity; `WasmBridge` owns pointers; instance API via closures; idempotent observe+destroy | Foundation invariants | W1-W15, W42 |
| Config via `tick()` params (not setters); `setPhysicsConfig` atomic merge | Avoids ordering pitfalls | W23, W45, W49 |
| `dist/wasm/` shipping pattern; TS-only workspace split; Changesets `linked: []`; `default` export condition | Publishable shape | W35, W51 |
| React/Vue adapters via Context/provide+inject + ref-hooks (zero core changes); strict-mode safe via idempotent observe | Framework bindings | W47, W48 |
| Per-element MutationObserver drives theme + box-shadow refresh; `colorSource: 'computed'` opt-in; `parseBoxShadowMargin` paren-aware px-token | Style sync | W52, W54 |
| FreeDrop parallel `Vec<Option<FreeParticle>>` (not enum variant); slot[3]/[6]/[7] read-once at lazy init; slot[5]=6 dispatch; non-mutating cap-check + 3-tier allocator; auto-cull via viewport+lifetime in `tick()` | Droplet pipeline | W43, W45 |
| Splash opt-in via `impulse(el, { splash })`, edge-centered `t=(j+0.5)/count`; `renderEntityAt(...isFreeDrop)` dispatcher; gravity per-tick scalar gated to Default/Shake/Magnet/Tear+FreeDrop | UX wiring | W44, W46, W56 |
| W26 scroll-pause via `physicsDt=0`; smooth scroll-snap lerp via per-entity Map (skips sync); tween wins composition; `canvasZIndex` default `-1`→`0` | Scroll + paint order | W55, W57 |
| `Renderer` interface + `buildFrame()` DTO + `Canvas2DRenderer`; `init()` async for adapter-failure propagation; `hasCanvasCtx` renderer-aware (`options.renderer==="webgpu" ? true : ctx2d!==null`) | Render abstraction | W36, W37 |
| `WebGPURenderer`: vertex-pulling, `bgra8unorm-srgb`; `WebGPUUnavailableError` paths A/B/C/D/E w/ `cause`; `pushErrorScope("validation")` around pipeline create | WebGPU baseline | W37 |
| `renderer?: 'auto'\|'canvas2d'\|'webgpu'` (default `'auto'` since W41); `silentFallback?: boolean` opt-out of fallback log; `LiquidDOMInstance.activeRenderer` getter; `mountCanvas` helper called twice on auto-fallback (W37 §17 fresh-canvas); `let canvas` reassign + `resizeCanvas`/`hasCanvasCtx` placed AFTER renderer init; auto branch catches ONLY `WebGPUUnavailableError`, rethrows TypeError etc.; mid-session `device.lost` does NOT auto-rebuild as Canvas2D in v1 | Auto-fallback | W41 |
| SDF blob: per-entity 6-vert AABB quad + 16-segment polygon-SDF (Jordan even/odd) + smoothstep AA; `sdf-helpers.wgsl.ts` extracted for W40; `discard`-based clip-hole using `sdRoundedRect`; EntityGPU 32B→64B; global uniform 64B→80B | SDF rendering | W38 |
| Fusion = full-screen-quad pipeline + smin SDF combine, opt-in via `theme.fusionRadius > 0`; explicit shared BGL+PipelineLayout; cap > 64 falls back to AABB w/ warn; winner-take-all color w/ epsilon `d < minD - 0.001`; smin-self no-op (standalone outlines stay W38-faceted) | Metaball fusion | W39 |
| Background refraction = host-supplied `ImageBitmap` via `instance.setBackgroundTexture`; BGL 3→5 (texture+sampler at 3/4); `theme.refraction = { enabled, strength }` opt-in; `combinedSdf` helper for central-difference gradient (W39 winner-loop preserved); `textureSampleLevel` LOD 0 (sampling in non-uniform conditional); auto-promote w/ `select(min, smin, k>0)` k=0 guard; single-scalar UV division; 70/30 mix; dual-warn priority; `RenderFrame.reducedMotion: boolean` required (Rule of Two) | Background refraction | W40 |

## Active Constraints
- Rust er DOM-blind og farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Pre-allokeret buffer pool (ingen entity churn)
- Eksplicit `grow()` only (ingen auto-grow)

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Floats per entity | 9 (36 bytes) | W42 |
| Particles per body | 16 | W8 |
| Package size (gzipped) | ~8 kB (+ ~15 kB WASM) | W24 |
| Total tests | 302 (55 Rust + 247 TS) | W41 |

## Known Limitations
- Container mode assumes positioned containing block
- Focus events only fire on natively focusable elements
- Reduced motion still runs RAF loop (sync/render active, physics frozen)
- `backdrop-filter` on elements filters canvas particles behind them (browser limitation; not fixable without moving canvas above DOM)
- Per-corner mixed (`10px 20px`) and per-axis elliptical (`10px / 5px`) `border-radius` fall back to first token (W42)
- `colorSource: 'computed'` reads `background-color` only — gradients fall back to `colorDefault`; global `colorHover` for all hover (W52)
- `colorSource: 'computed'` MO listens to observed element only — ancestor-driven cascade swaps require `instance.refreshTheme(el)`
- Runtime `border-radius` changes after `observe()` not reflected — re-observe required (W42)
- `calc()`/`min()`/`max()` may resolve to 0 if `getComputedStyle` does not (W42)
- W39/W40 fusion: standalone silhouettes still show 16-facet outline (smin-self no-op); merge-region clip uses winner's clipRect only; capacity > 64 falls back to AABB with one-shot warn
- W39/W40 winner-take-all color creates a hard color boundary at smin midpoint when adjacent blobs have different colors (hover or different refraction sample). Decision §m2 trade-off: smin'd colors would muddy hover affordance.
- W40 refraction: WebGPU-only (Canvas2D logs once on non-null `setBackgroundTexture` then no-ops); `textureSampleLevel` LOD 0 in non-uniform conditional; 70/30 mix premultiplied-vs-straight may darken transparent PNG edges
- W41 mid-session `device.lost` does NOT auto-rebuild as Canvas2D (v1 deferral); `render()` bails on null device + `setBackgroundTexture` silently no-ops. Future ward may add a `device-lost` event for consumer-driven recovery.

## What Comes Next
- WebGPU rendering epic CLOSED — W36 + W37 + W38 + W39 + W40 + W41 DONE. Canvas2D parity for non-fusion; fusion + refraction WebGPU-only; `'auto'` default handles fallback transparently.
- Tag `v0.2.0-rc.0` whenever publish is desired (W51 pipeline ready).
- W55 follow-up: update slot[4] interaction_state during lerp window so hover reacts within 150ms post-scroll.
- `preserveBackgrounds: true` + tight rest-shape: midpoint-spline traces interior, clip excludes; invisible until hover/drag/impulse. Tune default OR add clip-inset option.
