# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

`liquiddom` is a WASM-driven physics library (soft-body today, being replaced by an MLS-MPM fluid engine in Epic 15, see "Fluid engine (in progress, Epic 15)" below) that animates real DOM elements via a hidden `<canvas>` overlay while preserving accessibility. Rust computes the physics; TypeScript orchestrates DOM observation, the RAF loop, pointer/scroll/visibility events, and rendering. They share a pre-allocated `Float32Array` in WASM linear memory — there is no JSON over the FFI boundary.

The repo is an npm workspace (`packages/*`, `examples/*`, `site`) with three publishable packages: `liquiddom` (core), `@liquiddom/react`, and `@liquiddom/vue` (split in W51). `site/` is the private Astro marketing/docs site `@liquiddom/site` (W58+, deployed to `liquiddom.vsplat.io`). Rust source and `Cargo.toml` stay at repo root (one Rust crate produces one `pkg/` consumed by `packages/core/`). Entry point: `packages/core/ts/src/index.ts` exporting `LiquidDOM.create()`.

## Commands

### Build
- `npm run build` — Full pipeline from root: `wasm-pack` then the workspace-fanned TS builds. Always required after Rust changes.
- `npm run build:wasm` — Rust → WASM only (`pkg/`, gitignored).
- `npm run build:ts` — Workspace-fanned build (`npm run build --workspaces --if-present`; includes `site` and `examples/react`).
- `npm run build -w liquiddom` — Build a single package. Core's build is `tsc` **then** `scripts/copy-wasm.mjs`, which copies `pkg/` into `packages/core/dist/wasm/`, deletes wasm-pack's `.gitignore: *` (otherwise npm drops the binary from the tarball), and rewrites the emitted `../../../../pkg/liquiddom.js` import to the colocated copy. Fails if `pkg/` is missing.

### Develop
- `npm run dev` — Builds WASM, then runs Vite against `demo/`. Individual scenarios live in `demo/scenes/*.html` (dragable-cards, scroll-hero, fusion, refraction, splash-buttons, tilt-bowl, playground).
- `npm run dev -w @liquiddom/site` — Astro dev server for the public site (needs core built first; consumes `liquiddom` via workspace).
- `npm run build -w liquiddom-react-example` — Build the React example app.

### Test
- `npm test` — Vitest 4 multi-project run: root `vitest.config.ts` lists `test.projects` = core, react, vue, **site** (there is no `vitest.workspace.ts`). jsdom env per project config.
- `npm test -- -t "snippet"` — Filter by name pattern.
- `npm test -w @liquiddom/react` — Run only one package's tests.
- `cargo test` — All Rust unit tests (in-file `#[cfg(test)]` modules under `src/`).
- `cargo test --lib physics::` — Filter by module path.

### Lint / Format
- `npm run clippy` — `cargo clippy --all-targets --all-features -- -D warnings`; must be clean (CI runs exactly this).
- `cargo fmt` — Required.
- TypeScript correctness is enforced via `tsc` through `npm run build:ts`.

### Release
- `npm run changeset` — Author a new changeset (drives version bumps).
- `npm run version` — Apply pending changesets (bumps package.json versions).
- Tag `v*` on `master` → `.github/workflows/release.yml` runs `npx changeset publish` with `NPM_TOKEN`.

### Verification (use before claiming a ward is gold)
`npm run verify` — runs `build + test:rust + test + clippy`. Add `npm pack --dry-run --workspaces` to inspect publish output.

## Architecture (high-level)

### Fluid engine (in progress, Epic 15)

> **Status:** the soft-body engine described in the rest of this section is being replaced by a 2D MLS-MPM fluid engine. The soft-body engine is **retired as of W66**: W66 deletes `src/{api,buffer,entity,math,physics}.rs`, `phantom-observer.ts`, `wasm-bridge.ts`, `box-shadow.ts` and the old renderers/shaders, and rewrites this section. Its last state is tagged `softbody-final` (`515f54d`). Until W66, both engines live side by side and the soft-body subsections below stay true for the old code.

- **North star:** `.wdd/NORTH-STAR.md` is canonical for the vision, the acceptance scene (`demo/scenes/acceptance.html`) and the slice matrix. Design: `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. Epic: `.wdd/epics/15-fluid-engine.md` (W63–W69 = slices 1–2).
- **Rust (`src/fluid/`, W64+):** `#[wasm_bindgen] FluidCore` is the whole FFI surface:
  - constructor `new(particles, max_elements, world_w_px, world_h_px, area_hint_px2, max_element_h_px, seed)` (7 arguments, frozen in W64 D64-4; `max_element_h_px` is the tallest initial element height and sets the grid margin `max(200, max_element_h_px)` px);
  - pointers `elements_ptr` / `dynamic_ptr` / `static_ptr` / `state_ptr`;
  - `tick(raw_dt_s, px, py, pvx, pvy, pointer_active, gx, gy) -> steps`;
  - `splash(id, x, y, strength)`, `shake(strength)`, `set_material(viscosity, cohesion, recovery)`;
  - `redistribute()`, `generation()`, `set_reduced_motion(on)`.

  Rust owns the fixed-step accumulator (dt clamp 100 ms, ≤ 3 steps of 1/60 s, 8 substeps). `src/fluid/` denies `clippy::indexing_slicing` and allocates nothing on the hot path.
- **FFI strides.** Rust `src/fluid/layout.rs` and TS `packages/core/ts/src/fluid-layout.ts` MUST match, and a test asserts it:
  - `ELEMENT_STRIDE = 10`: TS writes `x, y, w, h, radius_px, interaction, home_dx, home_dy, viscosity, recovery` (`w == 0` = inactive slot; NaN = material default).
  - `STATE_STRIDE = 4`: Rust writes `s, maxDev, restAlpha, reserved` every step.
  - `DYNAMIC_FIELDS = 7`: Rust writes SoA `x, y, f00, f01, f10, f11, flags` every tick. The field stride is the particle capacity, and TS takes a fresh view every frame.
  - `STATIC_FIELDS = 3`: Rust writes SoA `home, rest_u, rest_v` at `redistribute()`, and TS re-reads it only when `generation()` changes.
- **TS:**
  - `fluid-bridge.ts` (`FluidBridge`, sole owner of pointers and views, the role `WasmBridge` has today);
  - `wasm-loader.ts` (single-flight init, `LiquidWasmLoadError`; the only fluid-engine file that imports `pkg/`, and like every `pkg/` importer it sits directly in `ts/src/` so `scripts/copy-wasm.mjs` can rewrite the specifier by depth);
  - `element-registry.ts`;
  - `runtime.ts` (`createFluidRuntime()`, the internal entry until W66 puts `LiquidDOM.create()` on top);
  - `renderers/fluid-canvas2d.ts` (density grid plus an exact `roundRect` at rest).
- **No silent mock mode for the fluid engine.** jsdom tests pass the `@internal` `testBackend` (`packages/core/ts/__tests__/_fluid-test-backend.ts`) and install `_fake-canvas.ts`. From W64 on, run `npm run build:wasm` before `npm test`.
- **Real-browser verification (W65+):** Playwright under `e2e/`, with projects `canvas2d` (blocking) and `webgpu` (soft, smoke only until slice 3).

### The Rule of Two
- **Rust is DOM-blind and color-blind.** It only does math: positions, velocities, springs, neighbor constraints, area preservation. Never reads `document`, never knows about CSS or themes. Enforced — do not violate.
- **TypeScript owns DOM/render.** `PhantomObserver` reads `getBoundingClientRect`, writes per-entity `[x, y, w, h, ...]` into the shared buffer, then packages post-tick state into a `RenderFrame` (`observer.buildFrame()`). A `Renderer` backend draws that frame — renderers never touch the DOM either.

### FFI contract — DO NOT change without coordinated edits

A single flat `Float32Array` in WASM memory is the only data channel. Two views:

1. **Entity buffer** — 9 floats per entity (`FLOATS_PER_ENTITY = 9`):

   | Index | Field               | Owner                            |
   |-------|---------------------|----------------------------------|
   | 0     | x (DOM left)        | TS writes                        |
   | 1     | y (DOM top)         | TS writes                        |
   | 2     | w                   | TS writes                        |
   | 3     | h                   | TS writes                        |
   | 4     | `interaction_state` | TS writes (idle/hover/focused)   |
   | 5     | `liquid_type`       | TS writes                        |
   | 6     | `impulse_vx`        | TS writes                        |
   | 7     | `impulse_vy`        | TS writes                        |
   | 8     | `border_radius_px`  | TS writes (on observe + resize)  |

   `w == 0` means "slot inactive" — Rust skips that entity in `tick()`.

2. **Particle buffer** — `PARTICLES_PER_BODY * 2` floats per entity (currently `16 * 2 = 32`). Rust writes particle positions; TS reads to render splines.

The constants `FLOATS_PER_ENTITY` and `PARTICLES_PER_BODY` are duplicated in `src/buffer.rs` / `src/api.rs` (Rust) and `packages/core/ts/src/phantom-observer.ts` (TS; re-exported by `renderers/renderer.ts`). `PARTICLES_PER_BODY` is **also hardcoded as `16u`** in `renderers/shaders/blob-sdf.wgsl.ts` and `fusion-sdf.wgsl.ts`. All of these MUST stay in sync. (The WebGPU renderer repacks entities into its own 16-float / 64-byte `EntityGPU` struct; that is a GPU-side layout, not the FFI stride.)

Per-strategy slot reinterpretation: under `liquid_type=4` (Shake) slot[6]/[7] are per-frame impulse; under `liquid_type=6` (FreeDrop) they are one-time initial velocity. The buffer layout itself is fixed — the meaning of slot[6]/[7] is selected by slot[5]'s dispatch.

### `liquid_type` dispatch (`src/physics.rs`)

`liquid_type` (slice index 5) selects a `PhysicsStrategy`:

| Value | Strategy | Status     |
|-------|----------|------------|
| 0     | Default  | active     |
| 1     | Tear     | stub       |
| 2     | Magnet   | stub       |
| 3     | Dragged  | active (Ward 30) — drag moves DOM, Rust follows via `skip_rigid_translation` |
| 4     | Shake    | active (Ward 31) — uses impulse_vx/vy at slice[6,7]; TS owns timer-based decay |
| 5     | Tween    | active (Ward 32) — TS writes target into buffer between ticks |
| 6     | FreeDrop | active (Ward 43) — DOM-less particle, no springs/neighbors. Lazy-inits `FreeParticle` from slot[6]/[7] as initial velocity; subsequent ticks ignore those slots. Stored in parallel `Vec<Option<FreeParticle>>`. |

NaN and unknown values fall back to Default. Add new strategies by extending the enum + `dispatch_strategy` and the match arm in `LiquidCore::tick`.

### Live config (Ward 049)

`LiquidDOMInstance` exposes two methods for tunable runtime physics:
- `setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void` — atomic merge → validate → assign. Validation throws `TypeError` from `validatePhysicsConfig`; state unchanged on failure.
- `getPhysicsConfig(): Required<LiquidPhysicsConfig>` — returns a shallow copy.

Both throw `Error` after `destroy()`. `validatePhysicsConfig` is exported as `@internal` for adapter/playground reuse — not part of the stable public API.

### Computed-theme color source (Ward 052)

Opt-in via `LiquidOptions.colorSource: 'computed'` (default `'config'` preserves legacy behavior). Each observed element's `getComputedStyle(...).backgroundColor` is resolved on `observe()` and on `style` / `class` mutations. The resolved color is used as the blob's base fill; hover state continues to use the global `colorHover` for v1. Transparent / `'transparent'` / unparseable values fall back to `colorDefault`. Call `instance.refreshTheme(el)` to trigger a manual re-read (e.g. after a stylesheet swap the per-element MO can't see).

After W54, the per-element `MutationObserver` is **unconditional** (one per observed element, disconnect on `unobserve`). It drives BOTH theme refresh and box-shadow margin refresh; the theme branch is gated inside the callback (`if (this.useComputedTheme) this.refreshElementTheme(...)`) so `useComputedTheme: false` consumers don't get auto-populated `themeCache` entries.

### Scroll handling (Ward 026 + 055)

W26 added a `scrolling` flag toggled by `scroll` events with a 100ms idle timeout. W55 fixed W26's implementation gap and added smooth lerp:

- **Physics pause during scroll**: `physicsDt = (reducedMotion || scrolling) ? 0 : dt`. Pointer repulsion also freezes: `pointerActive && !reducedMotion && !scrolling`. Prevents partikel-eksplosion during fast scrolls.
- **Smooth lerp at scroll-end (W55)**: when `scrolling` flips false, capture per-entity `base_pos` snapshots into an internal `Map<id, ScrollSnapState>`. RAF loop runs `runScrollSnapLerp()` when map is non-empty (skips `observer.sync()` to avoid overwriting); each frame computes `t = elapsed / snapDurationMs`, lerps slot[0]/[1] toward live `getBoundingClientRect()`. `LiquidOptions.snapDurationMs` (default 150).
- **Public API**: `instance.isScrollSnapping: boolean` — true while the lerp map is non-empty.
- **Composition with `tween()`**: tween wins. `tween(el, ...)` deletes the entity's lerp entry before scheduling its setInterval, so the two paths never fight.
- **Container mode**: container scroll events also trigger the lerp; container-relative coord offset is applied so buffer-space and rect-space stay aligned.
- **Reduced motion**: bypasses lerp entirely — `observer.sync()` keeps writing live rects (instant snap).

### Gravity (Ward 046)

`LiquidOptions.gravity?: { source: 'none' | 'fixed' | 'orientation', vector?, strength? }`. Per-frame `(gx, gy)` in px/s² flows through `tick()`. Strategy gating: Default/Shake/Magnet/Tear + FreeDrop receive gravity; Dragged + Tween skip (would fight cursor/target). Semi-implicit Euler: `velocity += g*dt; pos += velocity*dt`. Reduced-motion clamps to (0, 0).

- **Sources:** `'none'` (default, no behavior change), `'fixed'` (use `vector` verbatim), `'orientation'` (subscribe to `DeviceOrientationEvent`, map `gamma → x, beta → y` via `clamp([-90, 90])/90 × strength`).
- **iOS 13+:** `instance.requestOrientationPermission()` — MUST be called from user-gesture handler. Returns `true` on grant or when no permission is required. Requires HTTPS in production (localhost is exempt for dev).
- **Defense-in-depth:** Both Rust `apply_gravity` and TS `clamp()` reject NaN/Infinity (malformed orientation events).

### FreeDrop entity (Wards 043 + 044 + 045 + 056)

A second entity class — DOM-less free-floating particles in the same slot pool as soft-body entities. Foundation for W44 (spawning UX) and W46 (gravity). Without gravity, a FreeDrop moves at constant velocity until its lifetime expires or it exits the viewport.

- **Spawn:** `instance.spawnDroplet({ x, y, vx, vy, radius?, lifetimeMs? })` returns the slot id. Defaults: `radius=4` (diameter 8 in slot[2]), `lifetimeMs=5000`.
- **Splash spawn (W44):** `instance.impulse(el, { magnitude, direction, splash: { threshold, count, jitter?, speedScale?, lifetimeMs?, radius? } })` opt-in fires droplets at the element's perimeter when `magnitude >= splash.threshold`. Edge-centered sampling (`t = (j+0.5)/count`) → `count=4` hits the four mid-edges. Velocity = `direction*magnitude*speedScale + jitter*randomUnit()`. Capacity-exhausted aborts the splash loop silently. Splash defaults inherit from `spawnDroplet` (single source of truth). Splash runs AFTER impulse buffer writes, BEFORE the W31 auto-reset timer.
- **Despawn:** `instance.destroy()` cleans all droplet slots; `instance.despawnDroplet(id)` (W45) for explicit removal. Idempotent — silent no-op on non-droplet ids.
- **Storage:** `LiquidCore` has `bodies: Vec<Option<EntityBody>>` AND `free_particles: Vec<Option<FreeParticle>>`. Invariant: at most one is `Some` per slot. Enforced by `release_slot(id)` (idempotent, clears both) called from TS in both `unobserve` and `spawnDroplet`. A `debug_assert!` at the FreeDrop init site traps invariant violations in dev.
- **Slot reuse (W43 + W45):** `slot[5]=6.0` (liquid_type). `slot[2]=diameter` (active marker). `slot[3]=lifetime_ms` (W45 reclaimed from diameter symmetry). `slot[6]/[7]`=initial velocity. **Slots [3], [6], [7] are read ONCE at lazy `FreeParticle` creation; subsequent ticks ignore them.** Renewing lifetime requires despawn + respawn.
- **Auto-cull (W45):** Each tick, `lifetime_ms -= dt_ms`. If lifetime ≤ 0 OR center is outside `(vp_x, vp_y, vp_w, vp_h)` ± `cull_margin`, Rust deactivates the slot (zeros slot[2]/[3], clears `free_particles[i]`). Render-last-frame-then-cull ordering — the cull check fires AFTER the particle positions for that frame are written.
- **TS allocator (W45):** `spawnDroplet` priority is `availableIds` → `scanForFreedDropletSlot` (iterates `dropletIds` for `slot[2]===0` Rust-culled entries) → `nextId++`. `despawnDroplet` removes from `dropletIds` BEFORE zeroing slot, so the scan unambiguously finds Rust-driven culls.
- **Tick signature:** `core.tick(...)` carries 15 args including `vp_x, vp_y, vp_w, vp_h, cull_margin` (W45 §1: passed every frame; no setter — no ordering risk). RAF loop uses `(0, 0, vp.w, vp.h, 100)`.
- **Render (W56):** Rust writes 16 particle positions distributed on a circle of `radius = slot[2]/2` around the droplet center. `PhantomObserver.render()` iterates both `idToElement` (soft-body) AND `dropletIds` (FreeDrop) via the shared `renderEntityAt(ctx, id, viewport, isFreeDrop)` private dispatcher. Droplets render through the same Bezier-midpoint spline path as soft-bodies, but with: (a) center-based viewport cull (`pos ± r` bbox), (b) `colorDefault` only — no hover/theme, (c) no clip-hole under `preserveBackgrounds`, (d) filled-circle fallback (`ctx.arc`) when `particleBuffer` is null (mock-mode).
- **Constraints:** `observe(el, 6)` throws (FreeDrop has no DOM). FreeDrop slots are EXCLUDED from `preserveBackgrounds` clip-hole (clipping would erase the droplet's own particles).

### box-shadow clip inflation (Ward 054)

Under `preserveBackgrounds: true`, the canvas-clip rectangle is sized to the element's bounding box plus per-side margins computed from `getComputedStyle(el).boxShadow` so outset shadows render intact. `packages/core/ts/src/box-shadow.ts` exposes `parseBoxShadowMargin(raw: string): ShadowMargin` (paren-aware top-level split → numeric `px` token extraction per segment → per-side max across segments; `inset` shadows skipped). Margins are cached in `PhantomObserver.shadowCache` on `observe()` and refreshed via the unconditional MO. The clip-hole's border-radius is preserved unchanged (the clip-hole corner is behind the DOM element so the geometric difference is invisible; shadow falloff masks the rest). Public API: `instance.refreshShadow(el)` for stylesheet-cascade-driven changes outside MO scope (parity with `refreshTheme`).

### Vue adapter (Ward 048)

Vue 3.4+ bindings live at `packages/vue/src/index.ts`, published as `@liquiddom/vue` (workspace split landed in W51). Public API:

- `<LiquidProvider :config>` — owns one `LiquidDOMInstance` via provide/inject. Captures `config` once on mount.
- `LiquidPlugin` — alternative install path: `app.use(LiquidPlugin, config?)`. Monkey-patches `app.unmount` for cleanup.
- `useLiquid()` — returns `Ref<LiquidDOMInstance | null>`; reactive (updates when async create resolves).
- `useLiquidRef<T>(opts?)` — returns `Ref<T | null>` template ref; internal `watch` auto-observes/unobserves across lifecycle (`flush: "post"` so element is mounted before observe fires). `liquidType` captured once — `:liquidType="reactive"` looks reactive but isn't.
- `<LiquidElement :as :liquidType>` — wraps a tag with the ref pre-attached. `inheritAttrs: false` + manual spread (Vue forwards class/style/events/data-* via `attrs`).

SSR-safe: provider effect gated on `typeof window`; `useLiquidRef`'s watch doesn't fire on the server. Adapter is pure TypeScript with `h()` render functions — no `.vue` SFCs, no vite-plugin-vue dependency.

### React adapter (Ward 047)

React 18+ bindings live at `packages/react/src/index.tsx`, published as `@liquiddom/react` (workspace split landed in W51). Public API:

- `<LiquidProvider config?>` — owns one `LiquidDOMInstance` via React Context, captures `config` once on mount.
- `useLiquid()` — read the instance; returns `null` before init / outside a provider.
- `useLiquidRef<T>(opts?)` — callback ref that auto-observes / unobserves an element on mount/unmount; safe before instance ready (deferred via state-trigger).
- `<LiquidElement as? liquidType?>` — convenience tag that wraps `useLiquidRef`.

Strict-mode safe via idempotent `observe` (W14 invariant). SSR-safe — provider effect is gated on `typeof window`.

### Memory and pointer ownership

`WasmBridge` (`packages/core/ts/src/wasm-bridge.ts`) is the **sole** owner of pointer/view logic. `PhantomObserver` and `LiquidDOM` never call `core.ptr()` directly. After `core.grow()`, `bridge.rebind()` MUST be called and the new views passed to `observer.setViews()` — `WebAssembly.Memory` may detach the underlying `ArrayBuffer` on grow.

### Per-frame loop semantics (`packages/core/ts/src/index.ts`)

Order matters:
1. Container mode: cache `getBoundingClientRect` once, `observer.setCoordOffset(...)`.
2. W61 defensive rebind: if `bridge.isStale()`, `bridge.rebind()` + `observer.setViews()` (another instance's allocation may have grown/detached memory).
3. `runScrollSnapLerp()` if the W55 lerp map is non-empty, else `observer.sync()` — DOM → buffer.
4. `core.tick(physicsDt, ...)` — `physicsDt = 0` if `reducedMotion || scrolling` (sync/render still run). Guarded by `tickFailed` / `inTick` / module-level `wasmCallInFlight` and wrapped in try/catch (see Multi-instance below).
5. `observer.buildFrame(viewport, reducedMotion)` → `renderer.render(frame)`. Clearing and DPR handling live inside the renderer (Canvas2D uses `ctx.setTransform(dpr, …)` per frame — never cumulative `scale()`).

### Renderer layer (Wards 036–041, 062)

`packages/core/ts/src/renderers/` holds the `Renderer` interface (`init / render(RenderFrame) / resize / destroy / setBackgroundTexture?`) and two backends:

- **`Canvas2DRenderer`** — Bezier-midpoint splines; the original path.
- **`WebGPURenderer`** — SDF blobs (`shaders/blob-sdf.wgsl.ts`), metaball fusion via smooth-min (`fusion-sdf.wgsl.ts`, W39), background refraction from a host-supplied `ImageBitmap` (`instance.setBackgroundTexture`, W40). FreeDrops use an analytical-circle SDF branch (W62). Fusion and refraction are WebGPU-only; Canvas2D ignores them (refraction warns once).

`LiquidOptions.renderer: 'auto' | 'canvas2d' | 'webgpu'` (default `'auto'`). `'auto'` tries WebGPU and falls back to Canvas2D **only** on `WebGPUUnavailableError` (any other error is rethrown so bugs surface). The fallback removes and remounts the canvas, because a canvas that already got a WebGPU context can't hand out a 2D one. It logs one `console.info` unless `silentFallback` is set. Explicit `'webgpu'` always rethrows. `instance.activeRenderer` reports the backend that actually initialized — gate behavior on that, not on the requested option. `renderer.resize()` is called AFTER the canvas backing-store write.

### Multi-instance & panic recovery (Ward 061)

wasm32 builds use `panic = "abort"`, so a Rust panic inside a wasm-bindgen `&mut self` method leaves that `LiquidCore`'s `WasmRefCell` borrowed **forever**. Under multiple instances, GC-triggered `FinalizationRegistry` frees could land mid-`tick`. Mitigations in `index.ts`, all of which must be preserved:

- `activeCores` — module-level `Set` pinning every live core as a GC root; removed only right before `core.free()` in `destroy()`.
- `wasmCallInFlight` (module-level) + `inTick` (per-instance) — drop nested/re-entrant wasm calls.
- `tickFailed` — after a caught `tick()` panic the instance stops ticking and dispatches a bubbling `liquiddom:instance-panic` `CustomEvent` (on the container, or `window` in fullscreen mode). **Recovery is host-driven:** the orchestrator must `destroy()` and `LiquidDOM.create()` again. In-place core recreation was tried and left the renderer frozen.

Currently only the site orchestrators (`site/src/lib/demo-embed-runtime.ts`, `live-hero-mount.ts`) listen for the event; the React/Vue adapters do not yet, despite comments suggesting otherwise. The underlying race is mitigated, not eliminated.

### Container vs. fullscreen mode
Triggered by `options.container`. Affects canvas mount (absolute inside container vs. fixed body), pointer coords (subtract container rect), resize (`ResizeObserver` vs. `window.resize`), and auto-discover root.

## Project-specific constraints (do not violate)

- **No JSON over FFI.** Only the flat buffer.
- **Pre-allocated buffer pool, no entity churn.** Capacity is fixed at `create()`; explicit `grow()` is the only way to expand.
- **No framework dependencies.** This is a vanilla web library.
- **Don't move canvas above DOM.** `backdrop-filter` is a documented limitation.
- **WASM is loaded via dynamic `import("../../../../pkg/liquiddom.js")`** in `index.ts`. The path is load-bearing: `scripts/copy-wasm.mjs` string-rewrites exactly this specifier in `dist/index.js` for publishing (W24/W35/W51). Change both together.

## WDD (Ward-Driven Development) workflow

This repo is governed by `.wdd/` — `PROJECT.md`, `NORTH-STAR.md`, `PROGRESS.md`, `CONTEXT.md`, `epics/`, `wards/`, plus the global `wdd` CLI tool.

- Use the `wdd` CLI to change ward status (`wdd complete`, `wdd ward status`, `wdd progress`). Do NOT hand-edit ward frontmatter for status transitions.
- The repo also exposes plugin skills `ward`, `ward-new`, and `wdd`. Invoke them when starting/continuing ward work — they enforce the checkpoint discipline.
- **Critical rule:** AI never marks a ward `complete`. Stop after `gold` (all tests green) and present results for human approval. Sequence: `planned → red → approved → gold → STOP → human → complete`.
- `.wdd/PROGRESS.md` is the source of truth for ward counts and status — read it (or run `wdd progress`) rather than trusting a number cached here. `.wdd/CONTEXT.md` holds the architecture-decisions table and known limitations; ward specs in `.wdd/wards/ward-NNN.md` carry the detailed decision rationale (`Decision §N`) that code comments reference.
- `.cursor/rules/wdd.mdc` mirrors the same checkpoint discipline: STOP after writing tests (red) for human approval, and - `.cursor/rules/wdd.mdc` mirrors the same checkpoint discipline: STOP after writing tests (red) for human approval, and STOP again at gold.

### North star and direction gate (W63+, binding for every ward from W63 on)

- **`.wdd/NORTH-STAR.md` is canonical** for the vision (written as experiences), the acceptance scene, its 8 steps and the slice matrix. The spec links to it. `packages/core/__tests__/wdd-docs.test.ts` fails if the steps or the matrix drift from spec §6. Change both in one commit.
- **Every ward spec has a `North star:` line** directly under its title, naming the scene step(s) it moves (or `none — <reason>`).
- **Every ward spec has a `## Decisions` section.** Each technique, architecture or scope choice is a `### D<NN>-<k>: <name>` item with `Proposal:`, `Consequence:` and exactly one `Decision:` line (template: `.wdd/templates/ward.md`).
- **Direction gate before `red`, separate from test approval.**
  1. Present each decision to Dennis in chat as a named decision with its consequence.
  2. On his answer, record it with `saga_record_decision`.
  3. Rewrite its line as `Decision: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx)`, or `AMENDED …` when he changed it.
  4. Add the row to NORTH-STAR's "Plan decisions" log.

  **A ward cannot move to `red` while any line says `Decision: PENDING`.** `wdd-docs.test.ts` enforces this for every fluid ward past `planned`.
- **Vertical slices.** Every ward ends in something visible in the acceptance scene. No "data structures first" wards.
- **Whole-picture check** after slices 2, 4 and 6 (W69 is the first, canvas2d only): a recording of the acceptance scene in every renderer the slice has, inspected with vision, plus a status per scene step against the matrix (`.wdd/memory/whole-picture/`). The next slice is planned only afterwards.
- **Spikes** are time-boxed and answer one question. Their code is never copied into production (`spike/fluid-mpm` is reference only).

### Fluid ward files: deviation from `/ward-new` (D63-1)

The fluid wards are **hand-created flat files** `.wdd/wards/ward-063.md` … `ward-069.md`, copied from `.wdd/templates/ward.md`, not created with `wdd ward create`. This deviates from the `/ward-new` skill on purpose. `wdd ward create --epic fluid-engine` writes `.wdd/wards/fluid-engine/ward-001.md` (per-epic numbering, scoped id `fluid-engine-001`) and ignores `.wdd/templates/ward.md`, and a bare `wdd ward status 1 …` would then hit legacy W1.
- Address the fluid wards by their bare numbers, e.g. `wdd ward status 64 red`. Never create `.wdd/wards/fluid-engine/`; a test guards against it.
- Creating a ward file by hand is not a status transition. Every transition after creation goes through `wdd ward status`.
- Wards after W69 follow the same pattern (next free flat number), until the wdd CLI can create flat ids.
- Epic 15 is the hand-created `.wdd/epics/15-fluid-engine.md` (`epic: "fluid-engine"`), matching the `NN-` naming of the other epics (`wdd epic create` would write `fluid-engine.md`).

## Public site (`site/`, Wards 058–060)

Astro 6 + Tailwind 4, deployed to GitHub Pages at `liquiddom.vsplat.io` by `.github/workflows/deploy-site.yml` on pushes to `master` touching site/packages/Rust sources. Showcases (`site/src/showcases/`) are mounted through `site/src/lib/demo-embed-runtime.ts` (`wireDemoEmbed`) and `live-hero-mount.ts`. Both own instance lifecycle, including renderer-toggle remounts (`renderer-store.ts`) and W61 panic recovery. The site's own Vitest project runs as part of `npm test`.

## Test conventions

- TS tests live in `packages/{core,react,vue}/__tests__/`, `packages/core/ts/__tests__/*.test.ts`, and `site/__tests__/` (site build output, deploy workflow, and snippet-canary checks). WebGPU tests (`webgpu-*.test.ts`) run against a mocked `navigator.gpu`; there's no real GPU under jsdom. The "runtime-truth" file (Ward 35) catches "looks green but isn't true at runtime" failures — extend it when wiring new public API surface. `packages/core/__tests__/workspace-publish.test.ts` (W51) asserts the publishable shape of all three packages.
- `liquiddom-api.test.ts` covers the full public `LiquidDOM` instance API.
- Rust tests are colocated with the module under `#[cfg(test)] mod tests` in `src/*.rs`.
- Vitest uses `jsdom`. Mocks for `pkg/liquiddom.js` are required because WASM does not load under jsdom — the codebase falls back to a "mock mode" if WASM `import` fails. Tests should still verify the buffer-write contract is correct.

