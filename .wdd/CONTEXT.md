# Context — liquiddom

## Last Updated
Ward 62 — 2026-05-26 (FreeDrop WebGPU SDF circle dispatch; pre-W62 phantom-observer/ffi-integration regression also fixed)

## Current State
61 wards COMPLETE (latest: Ward 62 — FreeDrop WebGPU SDF circle dispatch). 55 Rust + 242 TS = 297 tests, ALL passing. 0 clippy warnings, 0 TS errors. W62 also fixed an 11-test regression in `phantom-observer.test.ts` + `ffi-integration.test.ts` that had been silently failing since W42 added `window.getComputedStyle(el)` to `observe()` — the old `mockElement` helpers returned plain JS objects (cast to HTMLElement) which jsdom's strict `getComputedStyle` rejected. Replacing them with `document.createElement` + `getBoundingClientRect` override unblocked all 11.

W61 ships a 5-layer defense against the wasm-bindgen `"recursive use of an object"` panic that fires when two `LiquidDOM` instances coexist: (1) `activeCores` module-level Set pinning every wrapper (prevents premature FinalizationRegistry GC mid-borrow); (2) `wasmCallInFlight` cross-instance mutex serializing wasm method calls; (3) per-instance `inTick` re-entrancy guard + `tickFailed` fail-stop; (4) defensive `bridge.rebind()` in RAF loop on `isStale()`; (5) host-driven auto-recovery via `liquiddom:instance-panic` CustomEvent — orchestrators (`wireDemoEmbed`, `mountLiveHero`) listen and trigger destroy+remount transparently. The residual wasm-bindgen `WasmRefCell` race under V8 GC timing still fires occasionally on boot but is now invisible to users (sub-100ms remount).

New public surface: `LiquidInstancePanicDetail` interface (event detail type, marked `@internal`).

Prior-ward summaries snapshotted in `.wdd/memory/snapshots/ward-NNN-complete.md`. Recent sequence: W36 Render Abstraction → W37 WebGPU Pipeline → W38 SDF Blob → W39 Metaball Fusion → W40 Background Refraction → W41 Canvas2D Fallback → W58 Site Foundation → W59 DemoEmbed → W60 Live Hero → W61 Multi-instance Recursion Fix. Next: W62 WebGPU FreeDrop SDF dispatch branch (then W63 shape smoothness, W64 compositing polish, W65 republish 0.2.0-rc.1).

## Architecture Decisions Made
Older decisions snapshotted in `.wdd/memory/snapshots/`. Active load-bearing decisions:

| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` 9 floats/entity; `WasmBridge` owns pointers; instance API via closures; idempotent observe+destroy | Foundation invariants | W1-W15, W42 |
| Config via `tick()` params (not setters); `setPhysicsConfig` atomic merge | Avoids ordering pitfalls | W23, W45, W49 |
| `dist/wasm/` shipping pattern; TS-only workspace split; Changesets `linked: []`; `default` export condition | Publishable shape | W35, W51 |
| React/Vue adapters via Context/provide+inject + ref-hooks (zero core changes); strict-mode safe via idempotent observe | Framework bindings | W47, W48 |
| Per-element MutationObserver drives theme + box-shadow refresh; `colorSource: 'computed'` opt-in | Style sync | W52, W54 |
| FreeDrop parallel `Vec<Option<FreeParticle>>`; slot[3]/[6]/[7] read-once at lazy init; slot[5]=6 dispatch; auto-cull via viewport+lifetime | Droplet pipeline | W43, W45 |
| Splash opt-in via `impulse(el, { splash })`; `renderEntityAt(...isFreeDrop)` dispatcher; gravity gated to Default/Shake/Magnet/Tear+FreeDrop | UX wiring | W44, W46, W56 |
| W26 scroll-pause `physicsDt=0`; smooth scroll-snap lerp via per-entity Map; tween wins composition; `canvasZIndex` default 0 | Scroll + paint order | W55, W57 |
| `Renderer` interface + `buildFrame()` DTO + `Canvas2DRenderer`; async `init()`; `hasCanvasCtx` renderer-aware | Render abstraction | W36, W37 |
| `WebGPURenderer`: vertex-pulling, `bgra8unorm-srgb`; `WebGPUUnavailableError` paths A-E w/ `cause` | WebGPU baseline | W37 |
| `renderer?: 'auto'\|'canvas2d'\|'webgpu'` (default `'auto'`); `silentFallback?: boolean`; `activeRenderer` getter; double `mountCanvas` on fallback (W37 §17); auto branch catches ONLY `WebGPUUnavailableError`; `device.lost` no auto-rebuild in v1 | Auto-fallback | W41 |
| Multi-instance: module-level `activeCores` Set pins every LiquidCore wrapper (prevents premature FinalizationRegistry GC); `wasmCallInFlight` cross-instance mutex serializes wasm method calls; per-instance `inTick` re-entrancy guard; `tickFailed` fail-stop + try/catch around `core.tick()`; defensive `bridge.rebind()` in RAF loop on `isStale()`; host-driven auto-recovery via `liquiddom:instance-panic` CustomEvent on the container (orchestrators destroy + remount on receive) | Multi-instance | W61 |
| FreeDrop WebGPU parity: EntityGPU.params.z = 0/1 (soft-body/FreeDrop) kind discriminator; `sdCircle(p,c,r)` helper; per-fragment if/else dispatch in blob-sdf + shared `entitySdf` helper in fusion-sdf (used by both fs_main + combinedSdf). Square AABB invariant. **WGSL `select` rejected** — Chromium WGSL quirk made FreeDrop branch invisible; if/else is verified-working. | FreeDrop WebGPU | W62 |
| SDF blob: per-entity 6-vert AABB quad + 16-segment polygon-SDF + smoothstep AA; `sdf-helpers.wgsl.ts`; `discard`-clip-hole via `sdRoundedRect`; EntityGPU 64B; global uniform 80B | SDF rendering | W38 |
| Fusion = full-screen-quad + smin SDF, opt-in via `theme.fusionRadius > 0`; cap > 64 falls back to AABB+warn; winner-take-all color w/ epsilon 0.001; smin-self no-op | Metaball fusion | W39 |
| Background refraction = host `ImageBitmap` via `setBackgroundTexture`; BGL 3→5; `theme.refraction = { enabled, strength }`; `combinedSdf` central-diff gradient; LOD 0 sampling; auto-promote k=0 guard; 70/30 mix; `RenderFrame.reducedMotion` required | Background refraction | W40 |

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
- Container mode assumes positioned containing block; focus events require natively focusable elements
- Reduced motion still runs RAF loop (sync/render active, physics frozen)
- `backdrop-filter` filters canvas particles behind elements (browser limitation)
- Per-corner mixed / per-axis elliptical `border-radius` fall back to first token (W42)
- `colorSource: 'computed'` reads `background-color` only; gradients fall back; global `colorHover` (W52); MO listens to observed element only — ancestor cascade swaps need `refreshTheme(el)`
- Runtime `border-radius` changes after `observe()` not reflected — re-observe required (W42)
- W39/W40 fusion: standalone silhouettes still show 16-facet outline (smin-self no-op); cap > 64 falls back to AABB
- W39/W40 winner-take-all color creates a hard boundary at smin midpoint when adjacent blobs differ (Decision §m2 trade-off)
- W40 refraction: WebGPU-only (Canvas2D no-ops); 70/30 mix may darken transparent PNG edges
- W41 `device.lost` does NOT auto-rebuild as Canvas2D in v1; `render()` bails on null device
- W61: residual wasm-bindgen WasmRefCell race under V8 GC timing still fires on boot but is INVISIBLE — `liquiddom:instance-panic` event triggers orchestrator destroy+remount in <100ms.

## What Comes Next
- **W63: WebGPU shape smoothness** (Catmull-Rom subdivision) — fixes 16-facet outline + "kantede" look at larger sizes.
- **W64: WebGPU compositing polish** — winner-take-all color softening + W40 refraction PNG alpha edges.
- **W65: re-enable framework tabs + publish `0.2.0-rc.1`.**
- W66: WebGPU `device.lost` auto-rebuild (deferred from W41).
- W61 follow-up: investigate wasm-bindgen bump / `panic=unwind` to eliminate residual WasmRefCell race.
- W55 follow-up: slot[4] interaction_state during lerp window.
