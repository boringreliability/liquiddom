# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

`liquiddom` is a WASM-driven soft-body physics library that animates real DOM elements via a hidden `<canvas>` overlay while preserving accessibility. Rust computes the physics; TypeScript orchestrates DOM observation, the RAF loop, pointer/scroll/visibility events, and rendering. They share a pre-allocated `Float32Array` in WASM linear memory — there is no JSON over the FFI boundary.

As of W51 the repo is an npm workspace with three publishable packages: `liquiddom` (core), `@liquiddom/react`, and `@liquiddom/vue`. Rust source and `Cargo.toml` stay at repo root (one Rust crate produces one `pkg/` consumed by `packages/core/`). Entry point: `packages/core/ts/src/index.ts` exporting `LiquidDOM.create()`.

## Commands

### Build
- `npm run build` — Full pipeline from root: `wasm-pack` then `tsc` in each `packages/*` (topological via peer-dep order). Always required after Rust changes.
- `npm run build:wasm` — Rust → WASM only.
- `npm run build:ts` — Workspace-fanned TS build (`npm run build --workspaces --if-present`).
- `npm run build -w liquiddom` — Build a single package.

### Develop
- `npm run dev` — Builds WASM, then runs Vite against `demo/` (with `demo/scenes/*.html` for individual scenarios: `dragable-cards.html`, `scroll-hero.html`).
- `npm run build -w liquiddom-react-example` — Build the React example app.

### Test
- `npm test` — Vitest workspace-mode (`vitest.workspace.ts` runs all three packages in one process). jsdom env per package config.
- `npm test -- -t "snippet"` — Filter by name pattern.
- `npm test -w @liquiddom/react` — Run only one package's tests.
- `cargo test` — All Rust unit tests (in-file `#[cfg(test)]` modules under `src/`).
- `cargo test --lib physics::` — Filter by module path.

### Lint / Format
- `cargo clippy` — Required to pass with zero warnings.
- `cargo fmt` — Required.
- TypeScript correctness is enforced via `tsc` through `npm run build:ts`.

### Release
- `npm run changeset` — Author a new changeset (drives version bumps).
- `npm run version` — Apply pending changesets (bumps package.json versions).
- Tag `v*` on `master` → `.github/workflows/release.yml` runs `npx changeset publish` with `NPM_TOKEN`.

### Verification (use before claiming a ward is gold)
`npm run verify` — runs `build + test:rust + test + clippy`. Add `npm pack --dry-run --workspaces` to inspect publish output.

## Architecture (high-level)

### The Rule of Two
- **Rust is DOM-blind and color-blind.** It only does math: positions, velocities, springs, neighbor constraints, area preservation. Never reads `document`, never knows about CSS or themes. Enforced — do not violate.
- **TypeScript owns DOM/render.** `PhantomObserver` reads `getBoundingClientRect`, writes per-entity `[x, y, w, h, ...]` into the shared buffer, then renders particle positions back to the canvas as splines.

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

The constants `FLOATS_PER_ENTITY` and `PARTICLES_PER_BODY` are duplicated in `src/buffer.rs` / `src/api.rs` (Rust) and `packages/core/ts/src/phantom-observer.ts` (TS). They MUST stay in sync.

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

NaN and unknown values fall back to Default. Add new strategies by extending the enum + `dispatch_strategy` and the match arm in `LiquidCore::tick`.

### Live config (Ward 049)

`LiquidDOMInstance` exposes two methods for tunable runtime physics:
- `setPhysicsConfig(partial: Partial<LiquidPhysicsConfig>): void` — atomic merge → validate → assign. Validation throws `TypeError` from `validatePhysicsConfig`; state unchanged on failure.
- `getPhysicsConfig(): Required<LiquidPhysicsConfig>` — returns a shallow copy.

Both throw `Error` after `destroy()`. `validatePhysicsConfig` is exported as `@internal` for adapter/playground reuse — not part of the stable public API.

### Computed-theme color source (Ward 052)

Opt-in via `LiquidOptions.colorSource: 'computed'` (default `'config'` preserves legacy behavior). Each observed element's `getComputedStyle(...).backgroundColor` is resolved on `observe()` and on `style` / `class` mutations. The resolved color is used as the blob's base fill; hover state continues to use the global `colorHover` for v1. Transparent / `'transparent'` / unparseable values fall back to `colorDefault`. Call `instance.refreshTheme(el)` to trigger a manual re-read (e.g. after a stylesheet swap the per-element MO can't see).

After W54, the per-element `MutationObserver` is **unconditional** (one per observed element, disconnect on `unobserve`). It drives BOTH theme refresh and box-shadow margin refresh; the theme branch is gated inside the callback (`if (this.useComputedTheme) this.refreshElementTheme(...)`) so `useComputedTheme: false` consumers don't get auto-populated `themeCache` entries.

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
1. Cache `getBoundingClientRect` once, set `coordOffset` for container mode.
2. `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` — DPR via setTransform per frame; never use cumulative `scale()`.
3. `clearRect`.
4. `observer.sync()` — DOM → buffer.
5. `core.tick(physicsDt, ...)` — `physicsDt = 0` if `reducedMotion || scrolling` (sync/render still run).
6. `observer.render(ctx, ...)` — particles → canvas splines.

### Container vs. fullscreen mode
Triggered by `options.container`. Affects canvas mount (absolute inside container vs. fixed body), pointer coords (subtract container rect), resize (`ResizeObserver` vs. `window.resize`), and auto-discover root.

## Project-specific constraints (do not violate)

- **No JSON over FFI.** Only the flat buffer.
- **Pre-allocated buffer pool, no entity churn.** Capacity is fixed at `create()`; explicit `grow()` is the only way to expand.
- **No framework dependencies.** This is a vanilla web library.
- **Don't move canvas above DOM.** `backdrop-filter` is a documented limitation.
- **`Vite` resolves WASM via dynamic `import("../../pkg/liquiddom.js")`** — packaging path is sensitive (Ward 35 explicitly addresses this).

## WDD (Ward-Driven Development) workflow

This repo is governed by `.wdd/` — `PROJECT.md`, `PROGRESS.md`, `CONTEXT.md`, `epics/`, `wards/`, plus the global `wdd` CLI tool.

- Use the `wdd` CLI to change ward status (`wdd complete`, `wdd ward status`, `wdd progress`). Do NOT hand-edit ward frontmatter for status transitions.
- The repo also exposes plugin skills `ward`, `ward-new`, and `wdd`. Invoke them when starting/continuing ward work — they enforce the checkpoint discipline.
- **Critical rule:** AI never marks a ward `complete`. Stop after `gold` (all tests green) and present results for human approval. Sequence: `planned → red → approved → gold → STOP → human → complete`.
- `.wdd/PROGRESS.md` is the source of truth for ward counts. As of last context refresh, 34/35 wards complete, Ward 35 ("Demo Hardening, Runtime Truth, and Showcase Polish") in `gold`.

## Test conventions

- TS tests live in `packages/{core,react,vue}/__tests__/` and `packages/core/ts/__tests__/*.test.ts`. The "runtime-truth" file (Ward 35) catches "looks green but isn't true at runtime" failures — extend it when wiring new public API surface. `packages/core/__tests__/workspace-publish.test.ts` (W51) asserts the publishable shape of all three packages.
- `liquiddom-api.test.ts` covers the full public `LiquidDOM` instance API.
- Rust tests are colocated with the module under `#[cfg(test)] mod tests` in `src/*.rs`.
- Vitest uses `jsdom`. Mocks for `pkg/liquiddom.js` are required because WASM does not load under jsdom — the codebase falls back to a "mock mode" if WASM `import` fails. Tests should still verify the buffer-write contract is correct.

## Related working directory

The user's environment also includes `/Users/Z6DEC/kmddev/thatcore/neuralDataGrid/apps/demo-app/src/wasm` as an additional working directory. It is unrelated to this project — do not edit it unless the user asks.
