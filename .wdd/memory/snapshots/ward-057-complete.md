# Context — liquiddom

## Last Updated
Ward 55 — 2026-05-15

## Current State
49 wards COMPLETE (latest: Ward 55 — Smooth Scroll-Snap Interpolation + W26 fix). 55 Rust + 201 TS = 256 tests. 0 clippy warnings, 0 TS errors. W55 ships a two-in-one: Part A fixes W26's implementation gap (physics didn't actually pause during scroll); Part B adds smooth 150ms lerp at scroll-end (replaces hard snap). `LiquidOptions.snapDurationMs`, `instance.isScrollSnapping`. Behavior change: pointer-driven repulsion now freezes during scroll. 0 clippy warnings, 0 TS errors. W46 closes the FreeDrop UX gap: gravity makes droplets arc + fall instead of flying straight away. Per-frame `(gx, gy)` in tick(), strategy-gated (Default/Shake/Magnet/Tear + FreeDrop; skips Dragged/Tween). `LiquidOptions.gravity: { source: 'none' | 'fixed' | 'orientation', vector?, strength? }`. iOS 13+ wrapper via `instance.requestOrientationPermission()`. 0 clippy warnings, 0 TS errors. W56 closes the FreeDrop visibility gap from W43+W44+W45 — `PhantomObserver.render()` now iterates `dropletIds` and draws each droplet as a particle-spline blob (or filled circle in mock-mode). The entire FreeDrop pipeline (spawn → tick → cull → render) is now visible end-to-end. 0 clippy warnings, 0 TS errors. W44 ties FreeDrop spawning into `impulse()`: opt-in `splash: SplashOptions` fires droplets at the element's perimeter with velocity = `direction*magnitude*speedScale + jitter*randomUnit`. Backwards-compatible (no splash = today's Shake-only behavior). 0 clippy warnings, 0 TS errors. W45 closes the W43 "droplets accumulate forever" caveat: FreeDrop slots auto-cull when center exits viewport+margin OR `lifetime_ms` expires. `spawnDroplet` allocator now scans for Rust-culled slots before failing capacity. Public `instance.despawnDroplet(id)` API added. 0 clippy warnings, 0 TS errors. W43 introduces `PhysicsStrategy::FreeDrop` — DOM-less free-floating particles in the same slot pool as soft-body entities. Public API: `instance.spawnDroplet({ x, y, vx, vy, radius? })`. Foundation for W44 (spawning UX), W45 (culling), W46 (gravity).

## Architecture Decisions Made
| Decision | Rationale | Ward |
|----------|-----------|------|
| Flat `Vec<f32>` buffer, 8 floats per entity | 32-byte alignment, zero-copy til JS Float32Array, ingen GC | W1 |
| `Vec::resize` til grow | Bevarer data, nul-initialiserer ny plads | W1 |
| Zero-copy EntityRef/EntityRefMut | Lifetimed slices, ingen data-kopiering | W2 |
| WasmBridge ejer al pointer/view logik | PhantomObserver har nul WASM-viden | W15 |
| Instance-based API via closures | Nul statisk state, multiple instanser mulige | W13 |
| Idempotent observe + destroy | Duplicate observe returnerer same ID, destroy er no-op ved gentagne kald | W13-14 |
| dt clamping + visibility auto-pause | Math.min(rawDt, maxDt), visibilitychange listener | W17 |
| DPR via setTransform per frame | Kumulativ scale() undgås, CSS-pixel coords bevaret | W18 |
| Reduced motion via dt=0 | Partikler i hvile, loop kører stadig for sync/render | W19 |
| Pointer Events erstatter Mouse Events | Unified touch/pen/mouse via PointerEvent API | W19 |
| Container mode via config switch | Canvas mount, resize, coords, culling — alt container-relative | W20 |
| Neighbor springs + Shoelace area | Bilateral constraints, shape preservation, centroid anchoring | W22 |
| Config via tick() parametre | Ingen separat config-FFI, TS sender per-frame | W23 |
| Rigid translation ved base_pos delta | Partikler teleporterer med DOM, fjedre kun for deformation | W26 |
| Viewport-relative coords med container offset | getBoundingClientRect + coordOffset for container mode | W27 |
| `dist/wasm/` shipping pattern | wasm-pack's `pkg/.gitignore: *` blocks npm pack; copy to `dist/wasm/` at build, drop the gitignore, patch `dist/index.js` import path | W35 |
| FLOATS_PER_ENTITY 8 → 9, slot[8] = `border_radius_px` | First coordinated FFI bump; slot[4] verified as `interaction_state` (hover/focus), no free slot in 0–7; W43 (FreeDrop) and W46 (gravity) will make further bumps as their own deliberate revisions | W42 |
| Centered point placement + symmetry-preserving remainder distribution | Rounded-rect perimeter sampling at offset `(j+0.5)·L/n` avoids segment-junction ambiguity; remainder distributed as 4-arc groups then h-pair then v-pair so pill/circle stay bilaterally symmetric | W42 |
| Live physics update via setPhysicsConfig | Partial merge validated atomically before mutation; colors require instance rebuild (v1); particleCount not live-tunable | W49 |
| React adapter via Context + useLiquidRef | Zero core changes; provider owns instance, hook returns callback-ref with state-trigger pattern; strict-mode safe via idempotent observe | W47 |
| Rounded-rect clip in preserveBackgrounds | Uses native ctx.roundRect (browser floor: Chrome 99+/FF 113+/Safari 16+); clamps to min(w,h)/2 defensively; r=0 falls through to plain rect for perf | W53 |
| Per-element computed-bg theme via colorSource: 'computed' | Opt-in (default 'config' preserves bit-for-bit); per-element MutationObserver (one per element, disconnect() on unobserve since MutationObserver has no per-target unobserve); gradient + per-element hover + stylesheet-cascade deferred to v2 | W52 |
| Vue 3 adapter via provide/inject + useLiquidRef watch | Zero core changes; pure-TS adapter (defineComponent + h(), no SFCs); both `<LiquidProvider>` component and `LiquidPlugin` install paths share the same InjectionKey; useLiquidRef uses watch with `flush: "post"` so element is mounted before observe; liquidType captured once (intentionally non-reactive) | W48 |
| Workspace split: Rust stays at repo root, only TS moves into `packages/` | Moving Cargo.toml/pkg/ into packages/core would touch wasm-pack invocations, demo vite config, copy-wasm.mjs depth, dev script — much larger surface for purely aesthetic gain. TS source moves drive 4 path-literal updates (depth 2 → 4) + copy-wasm.mjs regex update. | W51 |
| Independent versioning via Changesets (`linked: []`) | Adapters often need bug-fix bumps without core re-release. Trade-off: peer-range/installed-version drift mitigated by Test #10 (semver.satisfies with `includePrerelease: true`). Lockstep is a one-line revert if drift becomes a problem in practice. | W51 |
| Peer-dep range `^0.2.0-rc.0` (not `^0.2.0`) during rc period | Default semver excludes prereleases; workspace install would 404. Caret semantics still accept `0.2.x`, `0.3.x` after stable ships. | W51 |
| `exports` map requires `default` condition for CJS resolver compat | Pure-ESM packages with only `import` condition break `createRequire().resolve()` (used by tooling + tests). `default: "./dist/index.js"` keeps the dual-package contract clean. | W51 |
| Per-element MutationObserver becomes unconditional, drives both theme + box-shadow refresh | W54 needs MO for shadow refresh regardless of `useComputedTheme`. New combined callback gates the theme branch (`if (this.useComputedTheme) this.refreshElementTheme(...)`) so `useComputedTheme: false` consumers don't get auto-populated `themeCache`. | W54 |
| Clip-hole inflates by per-side box-shadow margin under `preserveBackgrounds` | Outset shadows extending beyond element rect were clipped. `parseBoxShadowMargin` (paren-aware split + `px`-token extraction, no color-function allowlist) computes per-side margins via `max(0, blur + spread ± offset)`. Border-radius is preserved unchanged on the inflated rect — the clip-hole corner is behind the DOM element so it's invisible; shadow falloff masks the difference. | W54 |
| FreeDrop is parallel `Vec<Option<FreeParticle>>`, NOT enum variant | Soft-body slots use `Vec<Option<EntityBody>>`. FreeDrop adds parallel `Vec<Option<FreeParticle>>` — at most one is `Some` per slot. Restructuring `bodies` into an enum would force every reader to match three variants; parallel storage costs ~24 bytes per unused slot vs. kilobytes for `EntityBody`. Invariant enforced by unified `LiquidCore::release_slot(id)` (called from TS in both `unobserve` and `spawnDroplet`) + `debug_assert!` at the FreeDrop init site. | W43 |
| FreeDrop reuses slot[6]/[7] as initial velocity, read once at lazy init | Shake (W31) uses slot[6]/[7] as per-frame impulse. FreeDrop redefines them as ONE-time initial velocity under `liquid_type=6`. After lazy `FreeParticle` creation, subsequent ticks ignore slot[6]/[7] — velocity persists in Rust state. Dispatch via slot[5]=liquid_type; no collision. | W43 |
| FreeDrop slots excluded from `preserveBackgrounds` clip-hole | The clip code carves the bounding rect from the canvas to expose the DOM element. FreeDrop has NO DOM element — clipping would partially erase the droplet's own particles. `render()` reads slice[5]: when `liquid_type === 6`, skip the clipping branch entirely. | W43 |
| `spawnDroplet` capacity-check is non-mutating (peek-before-pop) | Existing `observe` increments `nextId` BEFORE the capacity check, leaving state mutated on throw. W43's `spawnDroplet` peeks `availableIds.length > 0 ? availableIds[top] : nextId`, asserts capacity, THEN pops/increments. Cleaner failure semantics; test #6 locks this in. (`observe` keeps existing behavior to avoid breaking W47/W48/W52 expectations.) | W43 |
| FreeDrop lifetime lives in `FreeParticle.lifetime_ms`, slot[3] is read-once at lazy init | W43 made slot[3]=diameter (cosmetic redundancy — Rust only reads slot[2]). W45 reclaims slot[3] for lifetime_ms. After lazy init, slot[3] mutations are IGNORED (Decision §2 read-once invariant, mirrors slot[6]/[7] velocity pattern from W43). Renewing lifetime requires despawn + respawn. | W45 |
| Viewport AABB passed in `tick()`, not via setter | r1 proposed `set_viewport()` setter but the ordering pitfall (forget the setter → cull silently disabled) is a class of bug the spec must not create. `tick()` already carries `#[allow(clippy::too_many_arguments)]`; +5 viewport args is no cost. RAF loop always calls with `(0, 0, vp.w, vp.h, 100)`. | W45 |
| spawnDroplet allocator priority: availableIds → scan → nextId | Three-tier allocator. `scanForFreedDropletSlot` iterates `dropletIds` for entries with `slot[2] === 0` (Rust-culled slots TS hasn't recycled yet). `despawnDroplet` removes from dropletIds BEFORE zeroing slot, so scan unambiguously finds Rust-driven culls. Test #7 locks priority order. | W45 |
| FreeDrop render-last-frame-then-cull | Particle positions for current frame are written BEFORE the cull check fires, so a freshly-culled droplet still renders at its final position. Locks Decision §11; visible when rendering follow-up ward lands. | W45 |
| Splash spawning is opt-in via `impulse(el, { splash })`, fired AFTER buffer writes + BEFORE auto-reset timer | Backwards-compat invariant: existing `impulse()` calls without `splash` keep classic Shake behavior. Threshold gate (`magnitude >= splash.threshold`) lets consumers split soft-vs-hard impulse semantically. Splash uses `observer.spawnDroplet()` directly (codebase pattern, avoids `this` destructuring footgun). | W44 |
| Splash perimeter sampling uses `t = (j + 0.5) / count` (edge-centered) | Visually important `count=4` case lands at the four mid-edges. `count=1` happens to land at `t=0.5` = bottom-right corner — deterministic and visually neutral for a single droplet. Walk order: top → right → bottom → left. | W44 |
| Splash try/catch swallows ANY throw, not just capacity-exceeded | Bare `catch {}` future-proofs against new `spawnDroplet` error classes. Acceptable because splash is best-effort by design and host's impulse state is already written by the time the splash loop runs. | W44 |
| Splash defaults inherit from `spawnDroplet` (no duplication) | `lifetimeMs` and `radius` flow through as `undefined` when omitted; `spawnDroplet`'s own `?? 5000` / `?? 4` defaults take over. Single source of truth — no drift hazard if W43/W45 retunes defaults. | W44 |
| `render()` extracted into per-id `renderEntityAt(ctx, id, viewport, isFreeDrop)` dispatcher | Two clean loops (idToElement + dropletIds) sharing a private method per W56 §1. Defense-in-depth: soft-body loop skips slot[5]=6 ids that leak into idToElement. Droplet render path delegates to `renderDropletAt` with center-based cull semantics, colorDefault (no hover/theme), no clip-hole, and arc-fallback in mock-mode. | W56 |
| FreeDrop render-cull uses bbox (`pos ± r`); Rust cull uses center | Intentional asymmetry — Rust is the liveness truth-source, TS render is more generous (renders whatever Rust still considers active). A droplet crossing Rust's margin may render for ~1 frame before deactivation. | W56 |
| Gravity as per-tick scalar (not setter), strategy-gated in Rust | `tick()` carries `(gx, gy)` every frame (avoids ordering pitfall). `matches!(Default \| Shake \| Magnet \| Tear)` controls soft-body gating; FreeDrop has own integrate path. Skips Dragged (cursor-driven) and Tween (target-driven) — gravity would fight either. Defense-in-depth NaN/Infinity guard at Rust boundary AND TS `clamp()` (orientation events can deliver NaN). | W46 |
| Semi-implicit Euler ordering preserved | `velocity += g*dt; pos += velocity*dt` for FreeDrop; `apply_gravity()` BEFORE `run_physics()` for soft-body so springs react this frame. T1 locks exact numerics. | W46 |
| `strength: 980 px/s²` default (≈ 1 g at typical screen scale) | Empirical tuning. Orientation maps gamma/beta → [-90, 90] → /90 → × strength. Reduced-motion clamps gravity to (0, 0) (mirrors physicsDt clamp). | W46 |
| W26's "physics pause during scroll" was never actually implemented — W55 Part A fixes it | `physicsDt = (reducedMotion \|\| scrolling) ? 0 : dt` + `pointerActive && !reducedMotion && !scrolling`. The redundant `observer.sync()` in the scroll-idle timeout is dropped (per-frame RAF sync covers it). Behavior change: pointer repulsion now freezes during scroll. | W55 |
| Smooth scroll-snap lerp via per-entity Map (not per-entity buffer slot) | TS-side `Map<id, { fromX, fromY, el, startTime }>` populated at scroll-end. RAF loop runs `runScrollSnapLerp()` when map is non-empty (skips `observer.sync()` to avoid overwriting). Lerp reads LIVE `getBoundingClientRect()` each frame so re-scroll catches up naturally. Tween wins composition via `scrollSnap.delete(id)` at tween start. | W55 |
| Mock-mode tolerance: RAF loop bails on `!ctx` only, not `!core` | Previously `if (!ctx || !core) return;` meant mock-mode (no WASM) never ran the loop. Now mock-mode still runs sync/lerp/render fallbacks; only `core.tick()` is gated. Marginal real-world benefit (rarely hit) but consistent. | W55 |

## Active Constraints
- Rust er DOM-blind og Farve-blind (kun matematik)
- Ingen JSON over FFI-grænsen
- Pre-allokeret buffer pool (ingen entity churn)
- Eksplicit grow only (ingen auto-grow)

## Key Metrics
| Metric | Value | Ward |
|--------|-------|------|
| Floats per entity | 8 (32 bytes) | W1 |
| Particles per body | 16 | W8 |
| Package size (gzipped) | ~8 kB (+ ~15 kB WASM) | W24 |
| Total tests | 87 (28 Rust + 59 TS) | W25 |
| Total tests | 124 (35 Rust + 89 TS) | W35 |
| Floats per entity | 9 (36 bytes) | W42 |
| Total tests | 138 (43 Rust + 95 TS) | W42 |
| Total tests | 145 (43 Rust + 102 TS) | W49 |
| Total tests | 154 (43 Rust + 111 TS) | W47 |
| Total tests | 158 (43 Rust + 115 TS) | W53 |
| Total tests | 167 (43 Rust + 124 TS) | W52 |
| Total tests | 176 (43 Rust + 133 TS) | W48 |
| Total tests | 189 (43 Rust + 146 TS) | W51 |
| Total tests | 199 (43 Rust + 156 TS) | W54 |
| Total tests | 208 (47 Rust + 161 TS) | W43 |
| Total tests | 218 (52 Rust + 166 TS) | W45 |
| Total tests | 225 (52 Rust + 173 TS) | W44 |
| Total tests | 232 (52 Rust + 180 TS) | W56 |
| Total tests | 245 (55 Rust + 190 TS) | W46 |
| Total tests | 256 (55 Rust + 201 TS) | W55 |

## Known Limitations
- Container mode assumes positioned containing block
- Focus events only fire on natively focusable elements
- Reduced motion still runs RAF loop (sync/render active, physics frozen)
- `backdrop-filter` on elements will filter canvas particles behind them (browser limitation, not fixable without moving canvas above DOM)
- Per-corner mixed (`10px 20px`) and per-axis elliptical (`10px / 5px`) `border-radius` values fall back to the first token (W42 v1 limitation)
- `colorSource: 'computed'` reads `background-color` only — `background-image: linear-gradient(...)` falls back to `colorDefault` (W52 v1 limitation, gradients deferred to v2)
- `colorSource: 'computed'` uses global `colorHover` for all hover states — per-element hover variants deferred to v2
- `colorSource: 'computed'` MutationObserver fires on the observed element's `style`/`class` attribute changes only — ancestor-driven CSS rule swaps (e.g. `<html data-theme="dark">` toggling a `.btn { background: ... }` rule) do NOT trigger automatic refresh; call `instance.refreshTheme(el)` after the theme switch
- Runtime `border-radius` changes after `observe()` are NOT reflected — re-observe required (W42 v1 limitation)
- `calc()` / `min()` / `max()` may fall back to 0 if `getComputedStyle` does not resolve them (W42)

## What Comes Next
- FreeDrop trilogi + visibility + gravity + scroll-snap nu komplet.
- Tag `v0.2.0-rc.0` whenever publish is desired (W51 pipeline ready)
- W36 (renderer abstraction → WebGPU), examples/vue (DX)
- WebGPU rendering exploration (long-term)
- W55 follow-up: update slot[4] (interaction_state) during the lerp window so hover styling reacts within 150ms post-scroll instead of waiting for sync resume
