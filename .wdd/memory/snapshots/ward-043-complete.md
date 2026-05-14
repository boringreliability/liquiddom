# Context — liquiddom

## Last Updated
Ward 43 — 2026-05-14

## Current State
43 wards COMPLETE, Ward 43 GOLD (awaiting human approval). 47 Rust + 161 TS = 208 tests. 0 clippy warnings, 0 TS errors. W43 introduces `PhysicsStrategy::FreeDrop` — DOM-less free-floating particles in the same slot pool as soft-body entities. Public API: `instance.spawnDroplet({ x, y, vx, vy, radius? })`. Foundation for W44 (spawning UX), W45 (culling), W46 (gravity).

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
- W44 (spawning UX) + W45 (lifetime/culling) + W46 (gravity) build directly on W43's FreeDrop
- Tag `v0.2.0-rc.0` whenever publish is desired (W51 pipeline ready)
- W55 (scroll snap), W56 (examples/vue/), W36 (renderer abstraction → WebGPU)
- WebGPU rendering exploration (long-term)
