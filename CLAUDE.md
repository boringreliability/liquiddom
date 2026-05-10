# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

`liquiddom` is a WASM-driven soft-body physics library that animates real DOM elements via a hidden `<canvas>` overlay while preserving accessibility. Rust computes the physics; TypeScript orchestrates DOM observation, the RAF loop, pointer/scroll/visibility events, and rendering. They share a pre-allocated `Float32Array` in WASM linear memory — there is no JSON over the FFI boundary.

The package is published as ESM (`dist/`) plus the wasm-pack output (`pkg/`). Entry point: `ts/src/index.ts` exporting `LiquidDOM.create()`.

## Commands

### Build
- `npm run build` — Full pipeline: `wasm-pack build --target web --out-dir pkg` then `tsc -p tsconfig.build.json`. Always required after Rust changes.
- `npm run build:wasm` — Rust → WASM only.
- `npm run build:ts` — TypeScript → `dist/` only.

### Develop
- `npm run dev` — Builds WASM, then runs Vite against `demo/` (with `demo/scenes/*.html` for individual scenarios: `dragable-cards.html`, `scroll-hero.html`).

### Test
- `npm test` — Vitest run (TS tests under `ts/__tests__/`). jsdom environment.
- `npm run test:watch` — Vitest watch mode.
- `npm test -- ts/__tests__/runtime-truth.test.ts` — Run a single test file.
- `npm test -- -t "snippet"` — Run tests matching a name pattern.
- `cargo test` — All Rust unit tests (in-file `#[cfg(test)]` modules under `src/`).
- `cargo test --lib physics::` — Filter by module path.

### Lint / Format
- `cargo clippy` — Required to pass with zero warnings.
- `cargo fmt` — Required.
- TypeScript correctness is enforced via `tsc --noEmit` through `npm run build:ts`.

### Verification (use before claiming a ward is gold)
`npm run build && npm test && cargo test && cargo clippy && npm pack --dry-run`

## Architecture (high-level)

### The Rule of Two
- **Rust is DOM-blind and color-blind.** It only does math: positions, velocities, springs, neighbor constraints, area preservation. Never reads `document`, never knows about CSS or themes. Enforced — do not violate.
- **TypeScript owns DOM/render.** `PhantomObserver` reads `getBoundingClientRect`, writes per-entity `[x, y, w, h, ...]` into the shared buffer, then renders particle positions back to the canvas as splines.

### FFI contract — DO NOT change without coordinated edits

A single flat `Float32Array` in WASM memory is the only data channel. Two views:

1. **Entity buffer** — 8 floats per entity (`FLOATS_PER_ENTITY = 8`):

   | Index | Field             | Owner           |
   |-------|-------------------|-----------------|
   | 0     | x (DOM left)      | TS writes       |
   | 1     | y (DOM top)       | TS writes       |
   | 2     | w                 | TS writes       |
   | 3     | h                 | TS writes       |
   | 4     | (state flags)     | TS              |
   | 5     | `liquid_type`     | TS writes       |
   | 6     | `impulse_vx`      | TS writes       |
   | 7     | `impulse_vy`      | TS writes       |

   `w == 0` means "slot inactive" — Rust skips that entity in `tick()`.

2. **Particle buffer** — `PARTICLES_PER_BODY * 2` floats per entity (currently `16 * 2 = 32`). Rust writes particle positions; TS reads to render splines.

The constants `FLOATS_PER_ENTITY` and `PARTICLES_PER_BODY` are duplicated in `src/buffer.rs` / `src/api.rs` (Rust) and `ts/src/phantom-observer.ts` (TS). They MUST stay in sync.

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

### Memory and pointer ownership

`WasmBridge` (`ts/src/wasm-bridge.ts`) is the **sole** owner of pointer/view logic. `PhantomObserver` and `LiquidDOM` never call `core.ptr()` directly. After `core.grow()`, `bridge.rebind()` MUST be called and the new views passed to `observer.setViews()` — `WebAssembly.Memory` may detach the underlying `ArrayBuffer` on grow.

### Per-frame loop semantics (`ts/src/index.ts`)

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

- TS tests live in `ts/__tests__/*.test.ts`. The "runtime-truth" file (Ward 35) catches "looks green but isn't true at runtime" failures — extend it when wiring new public API surface.
- `liquiddom-api.test.ts` covers the full public `LiquidDOM` instance API.
- Rust tests are colocated with the module under `#[cfg(test)] mod tests` in `src/*.rs`.
- Vitest uses `jsdom`. Mocks for `pkg/liquiddom.js` are required because WASM does not load under jsdom — the codebase falls back to a "mock mode" if WASM `import` fails. Tests should still verify the buffer-write contract is correct.

## Related working directory

The user's environment also includes `/Users/Z6DEC/kmddev/thatcore/neuralDataGrid/apps/demo-app/src/wasm` as an additional working directory. It is unrelated to this project — do not edit it unless the user asks.
