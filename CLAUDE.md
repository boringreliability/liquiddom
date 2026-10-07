# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

`liquiddom` puts WASM-driven **fluid dynamics** (2D MLS-MPM) on real DOM elements via a hidden `<canvas>`, preserving a11y. Rust computes the fluid on the CPU; TypeScript observes the DOM, runs the frame loop and renders. They share pre-allocated `Float32Array` views in WASM memory; there is no JSON over FFI.

npm workspaces: `packages/*` (`liquiddom`, `@liquiddom/react`, `@liquiddom/vue`, all `0.3.0-alpha.x`, fixed changeset group, pre mode `alpha`) and `examples/*`. `site/` is **frozen** (not a workspace, not in vitest or CI, `deploy-site.yml` is `workflow_dispatch` only) until slice 6. One Rust crate at the repo root produces `pkg/`.

## Commands

### Build
- `npm run build`: `wasm-pack` then workspace builds. Core's build is `scripts/clean-core-dist.mjs` → `tsc` → `scripts/copy-wasm.mjs`. copy-wasm copies `pkg/` into `dist/wasm/` and rewrites every `dist/**/*.js` pkg specifier by depth, failing on a wrong one or when `dist/wasm-loader.js` does not end up on `./wasm/`. It also deletes wasm-pack's `.gitignore: *` (npm would drop the binary) and fails if `pkg/` is missing.
- `npm run build:wasm`: Rust → `pkg/`. **Run it before `npm test`** (the real-WASM tests import `pkg/`).

### Develop
- `npm run dev`: builds WASM, then Vite on `demo/`. `liquiddom` is aliased to `packages/core/ts/src/index.ts`, so scenes run from source. Scenes: `scenes/acceptance.html` (`?seed&renderer&clock=manual&rm=1&test=1`, hook `window.__liquidTest`) and `scenes/stress.html?n=2..4` (report `window.__stress`). Hook shapes live in `demo/test-hooks.ts`.
- `demo/scenes/splash.html` and `demo/scenes/playground.html` (W69): fluid splash scene and the Tweakpane material playground (`liquiddom-playground-v2`).
- `npm run whole-picture` (W69): records the acceptance scene in the local-only Playwright `record` project (canvas2d, RAF clock, re-form budgets read from `.wdd/NORTH-STAR.md`) and converts it with ffmpeg to `docs/superpowers/whole-picture/slice-2-canvas2d.gif`. Never run in CI.

### Test
- `npm test`: Vitest 4 projects core, react and vue (jsdom). The adapter tests exercise core's **dist**: run `npm run build -w liquiddom` first. Filter with `npm test -- -t "snippet"` or `npm test -w @liquiddom/react`.
- `npm run e2e:canvas2d` (`playwright test --project=canvas2d`): blocking browser suite, real WASM, Vite on :4173 with `--strictPort` and `BROWSER=none`; run `npm run build:wasm` first. `npm run e2e:webgpu` (new headless Chromium on SwiftShader: the smoke, `webgpu-liquid.spec.ts` and acceptance steps 1–3 under `renderer=webgpu`, W71) runs locally; CI runs only the soft smoke (W71.0 fallback B), and gold uses `npm run e2e:webgpu-hw` (Metal, never in CI); `npm run e2e:perf` records p95 and is non-blocking. Every spec imports `test` from `e2e/fixtures.ts`, which fails on `console.error`, `pageerror` and panics. `npm run e2e:typecheck` type-checks the specs.
- `npm run e2e:dist` (W69, D69-6): blocking smoke of the published core `dist`. `npm run e2e:dist:build` builds core, `@liquiddom/react` and `examples/react` (without its `wasm-pack` prebuild; run `npm run build:wasm` first), then `e2e/dist.spec.ts` serves `examples/react/dist` with Vite's `preview()` on :4174 and checks `create()`, `canvas.liquid-canvas`, the `.wasm` fetch and the console.
- Linux baselines only: `npm run e2e:update` (`scripts/e2e-docker.sh`, pinned image, `linux/amd64`, Docker required). Baselines live in `e2e/__screenshots__/`; visual specs skip on macOS. Commit a baseline only after a vision check. The `e2e-update-baselines` job in `ci.yml` can be dispatched with `gh workflow run ci.yml --ref <branch>` only once `ci.yml` is on `master`. Ask before pushing a branch.
- `cargo test`, `cargo test --lib fluid::`; `npm run clippy` (`cargo clippy --all-targets --all-features -- -D warnings`, exactly what CI runs); `cargo fmt`.
- `npm run bench:opt-level`: FluidCore tick benchmark, opt-level 3 vs "s" (W65).

### Release
- Pre mode `alpha`: `npm run changeset` → `npm run version` → tag `v*` → `release.yml` runs `changeset publish`.

### Verification
`npm run verify` (build + test:rust + test + clippy), plus `npm run e2e:canvas2d` for visual wards. `npm pack --dry-run --workspaces` inspects the publish output.

## Architecture (high-level)

### Fluid engine (in progress, Epic 15)
The soft-body engine (W6–W62) is retired as of W66; its last state is the git tag `softbody-final`. The binding design is `docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`. The canonical acceptance scene and slice matrix are in `.wdd/NORTH-STAR.md`. Slice 1 (W63–W66) ships the liquid at rest through the public API; slices 2–6 follow the matrix.
- `FluidCore` (`src/fluid/api.rs`, wasm-bindgen) is the only exported Rust class. `FluidBridge` (`ts/src/fluid-bridge.ts`) is the sole owner of its pointers and views.
- Strides (`src/fluid/layout.rs` ↔ `ts/src/fluid-layout.ts`, asserted equal by a test): `ELEMENT_STRIDE = 10`, `STATE_STRIDE = 4`, `DYNAMIC_FIELDS = 7`, `STATIC_FIELDS = 3`.

### Rule of Two
- **Rust is DOM-blind and colour-blind** (`src/fluid/`): particles, grid, element targets, rest state.
- **TypeScript owns DOM and render** (`packages/core/ts/src/`): `ElementRegistry` measures rects and writes the element buffer; renderers read the particle views.

### FFI contract
- **Element buffer**, 10 floats per element (TS writes):
  - `x, y, w, h` in buffer space (`w == 0` means inactive)
  - `radius_px`
  - `interaction` (0 idle, 1 hover, 2 focused, 3 dragged)
  - `home_dx, home_dy`
  - `viscosity` (NaN = default), `recovery` (NaN = default)

  **Element id == slot index.**
- **Dynamic view** (Rust writes every tick): SoA `x, y, f00, f01, f10, f11, flags`. Take a fresh view every frame.
- **Static view** (Rust writes at redistribute): SoA `home, rest_u, rest_v`. Read it only when `generation()` changes.
- **State view**: 4 floats per element, `s, maxDev, restAlpha, reserved`.
- **Scalar calls:**
  - `tick(raw_dt_s, px, py, pvx, pvy, pointer_active, gx, gy)`. Rust owns the accumulator: 100 ms clamp, at most 3 × 1/60 s, 8 substeps each.
  - `splash`, `shake`, `set_material`, `redistribute`, `generation`, `set_reduced_motion`.
- The constructor is `FluidCore(particles, maxElements, worldWPx, worldHPx, areaHintPx2, maxElementHPx, seed)` (frozen in D64-4). `maxElementHPx` is the tallest initial element and sets the grid margin `max(200, maxElementHPx)` px.

### Internal runtime and public facade
- `runtime.ts` `createFluidRuntime()` (internal) sets up:
  - the canvas (`stylesheet.ts` `mountLiquidCanvas`)
  - the backend (single-flight `wasm-loader.ts`; jsdom uses the `@internal` `testBackend`)
  - the `ElementRegistry`
  - the renderer (`renderers/select.ts`)
  - the `LoopController` (user pause vs hidden tab)
  - reduced motion
- Per frame: coord offset → `registry.sync()` → `core.tick()` → `bridge.syncGeneration()` → `renderer.render(frame)`. The first frame that throws stops the instance for good (one `console.error`, the loop is destroyed); recovery is `destroy()` + `create()`. `destroy()` never throws (a failing `core.free()` only warns).
- `index.ts` `LiquidDOM.create()` is the public facade:
  - `resolveOptions`: a whitelist; removed options throw. The `@internal` hooks are `testBackend`, `loader`, `clock`.
  - autoObserve candidates become the area hint.
  - post-destroy semantics.
- `internal.ts` `runtimeOf()` serves the demo scene hooks only.
- Exports: `LiquidDOM`, `WebGPUUnavailableError`, `LiquidWasmLoadError`, `validateMaterial` (@internal), and the types `LiquidOptions`, `LiquidDOMInstance`, `ElementOptions`, `Material`, `GravityOptions`.

### DOM and a11y
- On `observe()` the colours are snapshotted **before** `class="liquid-element"` is applied; `data-liquid-stack="relative" | "z"` handles stacking.
- One refcounted `<style id="liquiddom-styles">` per document, in `@layer liquiddom` with `!important`. The paint and stacking rules are scoped to `@media screen and (forced-colors: none)` and there is no `revert-layer`. Print and `forced-colors: active` hide the canvas, and the elements keep their own styling.
- The canvas is `aria-hidden`, `pointer-events: none`, `z-index: 0`, last in `body` or inside the container. `unobserve()` restores the element exactly. Two instances observing the same element share one decoration (refcounted).
- `refresh(el)` re-reads colours. There is no automatic colour refresh until slice 4. The re-read lifts the class with inline `transition: none !important` (so a CSS background transition cannot return its transparent start value), flushes style, then restores the exact `class` and `style` attribute strings.

### Renderers
- `renderers/frame.ts` defines `Renderer` (`init / render / resize / destroy`) and `RenderFrame`.
- `FluidCanvas2DRenderer` draws a density grid plus an exact `roundRect` at `restAlpha = 1`; while `restAlpha < 1` the density is splatted at full weight and the roundRect is drawn at `restAlpha` on top (D70-4, no translucent dip). No liquid text.
- `WebGPURenderer` (`renderers/webgpu/`, W71) draws the liquid in two passes: splat (instanced quads into T0 `rgba16float` = Σw·rgb, Σw and T0a `r16float` = Σw·a, additive, at `t0Scale` × the backing size, default 0.5, D71-4) and screen (composite: threshold 0.5 with an `fwidth` edge, colour Σw·rgb/Σw premultiplied by coverage·Σw·a/Σw; then a rounded-rect SDF quad per element at `restAlpha`, D71-6). `gpu-buffers.ts` packs the views (homes only on a generation or paints change); `kernel-params.ts` holds the kernel shared with Canvas2D (D71-5). T2 waits for slice 4. Explicit `'webgpu'` accepts a fallback adapter; `'auto'` still means Canvas2D without probing until W72.

### Pointer, hover and material (Ward 068)

- **Soft pointer field (Rust, `interaction::pointer_accel`):** velocity-only coupling inside 70 px, weight `(1 − d/r)²`, 12/s (`POINTER_DRAG_PER_S`, D70-3; W68 started at 6), added after the home-spring saturation. No radial term; a resting pointer only damps moving liquid (−v·k), so it digs no holes. `PointerField::sanitized` (once per `tick`) turns NaN/Inf into an inactive pointer and clamps the speed to 2000 px/s.
- **Pointer input (TS, `pointer-tracker.ts`):** document `pointermove`, document `pointerout` with `relatedTarget === null` (left the window; D68-7 amended), `pointercancel`, touch `pointerup`, and window `blur`. Velocity is sampled per frame from the runtime clock (`0.5·v + 0.5·Δpos/Δt`, held ≤ 120 ms, then ×0.8 per frame), so `?clock=manual` is deterministic. Known limitation (D68-4): the ×0.8 decay is per frame, not per unit of time, so at 120 Hz the idle tail decays twice as fast in wall time as at 60 Hz.
- **Hover (D68-2 amended):** `pointerenter`/`pointerleave` on the observed element, ignoring `pointerType === "touch"` (a tap's compatibility `mouseenter` would stick); the initial `:hover` is read at observe only under `(hover: hover)`. The registry writes slot 5 every `sync()`: hover (1) beats focus (2) until slice 5 (a click focuses buttons in Chrome/Firefox and must not drop the swell; FOCUSED has no engine effect yet), idle (0). Hover is also cleared when the element is detached or `:disabled` at `sync()`. The home rect swells by `HOVER_SWELL = 0.02` about its centre, radius included (`swell_rect` in Rust, called from `home_rect`; the same rule in TS `homeRect`).
- **Reduced-motion input gating:** pointer inactive and slot 5 = 0. The runtime's `splash` returns `true` without calling the core (so the facade does not throw), and `shake` returns early. Validation still runs. It follows live media changes.
- **Fused AABB (D68-10):** redistribute, the reduced-motion pin, splash, shake, an active pointer tick and `set_particle_px` call `Scratch::invalidate_bounds()`, so `SubstepOpts::reuse_bounds` never reuses a stale particle AABB.
- **Material:** `setMaterial(partial)` snapshots the partial once (getters read once), then runs `validateMaterial` → `mergeMaterial` → `core.set_material` → assign, atomically; `getMaterial()` returns a copy. `presets` = `water`, `honey`, `jelly` (material-shaped; the 0.2 physics presets are gone).

### Interim state (slices 2–5)
Slice 2 is in progress: `splash()` / `shake()` and click/keyboard splash are live (W67); the soft pointer field, the hover swell, `setMaterial`/`getMaterial` and the material presets are live (W68), with reduced-motion input gating in TS. W70: `shake` is a spatially coherent field per element, `d·520·strength·(1 + 0.8·sin(π·u + φ))` with no white noise and stiffness cap 0.2, so elements slosh instead of sliding (D70-1/2). W67 facts: the rest layout has an edge-aligned ring (D67-13, cell/2 spacing); the element velocity is computed once per tick; `time_s` is f64; the first frame that throws still stops the instance. Local p95 is ≈3.75 ms (pointer inactive) / 3.82 ms (pointer active) per fixed step. Gravity is validated but has no effect until slice 6. Container mode works; the container must be a positioned element (e.g. `position: relative`) because the canvas is absolutely positioned inside it. liquiddom never restyles the container (that would move the containing block of the author's own absolutely positioned descendants); a static container gets one `console.warn` per instance at `create()`. Scroll is verified only in slice 6. Slice 3 is in progress: W71 draws the liquid under `renderer: 'webgpu'` (steps 1–3 green in WebGPU); `auto`, the Canvas2D fallback and `device.lost` follow in W72.

## Project-specific constraints (do not violate)
- No JSON over FFI. Fixed pools: `particles` and `maxElements` are set at `create()`; there is no `grow()`.
- No panics on JS input in `src/fluid`: `clippy::indexing_slicing` is denied and there is no unwrap. No hot-path allocation.
- The canvas stays below the DOM (D7). Rendering never touches the DOM.
- Only `ts/src/wasm-loader.ts` imports `../../../../pkg/liquiddom.js` (enforced by workspace-publish).
- The spike (branch `spike/fluid-mpm`) is reference only; never copy its code (D2).

## WDD (Ward-Driven Development) workflow

This repo is governed by `.wdd/` — `PROJECT.md`, `NORTH-STAR.md`, `PROGRESS.md`, `CONTEXT.md`, `epics/`, `wards/`, plus the global `wdd` CLI tool.

- Use the `wdd` CLI to change ward status (`wdd complete`, `wdd ward status`, `wdd progress`). Do NOT hand-edit ward frontmatter for status transitions.
- The repo also exposes plugin skills `ward`, `ward-new`, and `wdd`. Invoke them when starting/continuing ward work — they enforce the checkpoint discipline.
- **Critical rule:** AI never decides on its own that a ward is complete: it stops at `gold` and waits for Dennis' approval. Once Dennis has approved gold, AI may run `wdd complete`. Sequence: `planned → red → approved → gold → STOP → human approves → complete` (the `wdd complete` command itself may be run by AI after that approval).
- `.wdd/PROGRESS.md` is the source of truth for ward counts and status — read it (or run `wdd progress`) rather than trusting a number cached here. `.wdd/CONTEXT.md` holds the architecture-decisions table and known limitations; ward specs in `.wdd/wards/ward-NNN.md` carry the detailed decision rationale (`Decision §N`) that code comments reference.
- `.cursor/rules/wdd.mdc` mirrors the same checkpoint discipline: STOP after writing tests (red) for human approval, and STOP again at gold.

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

## Test conventions
- TS tests: `packages/core/ts/__tests__/*.test.ts` and `packages/{core,react,vue}/__tests__/`. Helpers start with `_` (`_fake-canvas.ts`, `_fake-gpu.ts`, `_fluid-test-backend.ts`, `_facade-helpers.ts`). The adapters import them by relative path. `_fake-gpu.ts` (W71) installs `navigator.gpu`, the `GPU*Usage` globals and `getContext("webgpu")`, and records validation mistakes in `calls.errors`. A WebGPU canvas is readable only in the task that drew it, so e2e pixel reads go through `__liquidTest.pixels()`.
- jsdom has no 2d context and no WASM. Tests pass `testBackend` and install the fake canvas through `setupFacadeTestEnv()`. Real WASM runs in `fluid-ffi`/`multi-instance-wasm` (initSync) and in Playwright.
- Test files are not type-checked. Type-level contracts live in tsc fixtures (`__fixtures__/types-smoke`, `__fixtures__/api-migration-types`).
- `packages/core/__tests__/wdd-docs.test.ts` guards NORTH-STAR, the ward template, the decision blocks and this file's Architecture section.
- Rust tests are colocated in `src/fluid/*.rs`, plus the acceptance-layout scenarios in `scenario_tests.rs`.
- GS-TDD + WDD: approved decisions → failing tests → STOP for "godkendt" → implement → code review → gold → STOP. Visual wards need screenshots inspected with vision.
