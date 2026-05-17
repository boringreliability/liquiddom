# Context — liquiddom

## Last Updated
Ward 39 — 2026-05-17

## Current State
54 wards COMPLETE (latest: Ward 39 — Metaball Fusion Shader). 55 Rust + 226 TS = 281 tests. 0 clippy warnings, 0 TS errors.

W39 ships WebGPU-only metaball fusion: second full-screen-quad `fusionPipeline` coexists with W38's per-entity `aabbPipeline`; both share an explicit `GPUBindGroupLayout` + `GPUPipelineLayout` (NOT `layout: "auto"`). Fragment shader iterates `MAX_ENTITIES=64`, accumulates SDF via quadratic smin (`min(a,b) - h²·k·0.25`); winner-take-all color w/ epsilon-stable `if (d < minD - 0.001)`. Opt-in via `LiquidOptions.theme.fusionRadius > 0` (default keeps W38 polygon-with-AA). CPU clamp at instance + renderer (`NaN`/negative → `0`); value lands in `flags.y` of 80-byte global uniform. Capacity safety: `> 64` silently falls back to AABB pipeline with one-shot `console.warn`. Demo: `demo/scenes/fusion.html` + `fusion.ts` (4 buttons, 2×2, 30px gap). URL overrides `?renderer=canvas2d`, `?fusionRadius=120`. Visual: smooth "goo" bridges between adjacent blobs; standalone silhouettes still show W38's 16-facet polygon outline (smin-self is no-op).

Prior-ward summaries are snapshotted in `.wdd/memory/snapshots/ward-NNN-complete.md`. Recent epic: W36 Render Abstraction → W37 WebGPU Pipeline → W38 SDF Blob → W39 Metaball Fusion. Next: W40 Background Refraction (texture sampling along SDF gradient), then W41 Canvas2D Fallback (`renderer: 'auto'`).

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
| `WebGPURenderer`: vertex-pulling, `bgra8unorm-srgb`; `WebGPUUnavailableError` paths A/B/C/D/E w/ `cause`; `renderer?: 'canvas2d'\|'webgpu'` (default `'canvas2d'`); `pushErrorScope("validation")` around pipeline create | WebGPU baseline | W37 |
| SDF blob: per-entity 6-vert AABB quad + 16-segment polygon-SDF (Jordan even/odd) + smoothstep AA; `sdf-helpers.wgsl.ts` extracted for W40; `discard`-based clip-hole using `sdRoundedRect`; EntityGPU 32B→64B; global uniform 64B→80B | SDF rendering | W38 |
| Fusion = second full-screen-quad pipeline + smin SDF combine, opt-in via `theme.fusionRadius > 0`; explicit shared `GPUBindGroupLayout`+`GPUPipelineLayout` (NOT `layout:"auto"`); capacity safety valve `> 64` falls back to AABB w/ one-shot warn; winner-take-all color w/ `d < minD - 0.001`; clip uses winner's clipRect only; `RenderFrame.theme.fusionRadius?: number` optional for back-compat; smin-self is no-op (standalone outlines stay W38-faceted) | Metaball fusion | W39 |

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
| Total tests | 281 (55 Rust + 226 TS) | W39 |

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
- W39 fusion: standalone silhouettes still show 16-facet outline; smin smoothes merge zones only
- W39 fusion: WebGPU-only; Canvas2D ignores `theme.fusionRadius`
- W39 fusion: `capacity > 64` falls back to W38 path with one-shot `console.warn`
- W39 fusion: merge-region clip uses winner's `clipRect` only

## What Comes Next
- W36 + W37 + W38 + W39 DONE — WebGPU SDF + metaball fusion live. Canvas2D parity for non-fusion; fusion is WebGPU-only.
- W40 (Background Refraction) — texture sampling along SDF gradient; reuses `sdf-helpers.wgsl.ts` + W39 full-screen-quad pattern.
- W41 (Canvas2D Fallback) — `renderer: 'auto'` with `WebGPUUnavailableError`-catching fallback. Fresh-canvas requirement (W37 §17) load-bearing.
- Tag `v0.2.0-rc.0` whenever publish is desired (W51 pipeline ready).
- W55 follow-up: update slot[4] interaction_state during lerp window so hover reacts within 150ms post-scroll.
- `preserveBackgrounds: true` + tight rest-shape: midpoint-spline traces interior, clip excludes; invisible until hover/drag/impulse. Tune default OR add clip-inset option.
