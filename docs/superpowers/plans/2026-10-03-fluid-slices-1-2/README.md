# liquiddom fluid engine, slices 1–2: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every ward also follows WDD / GS-TDD:** write tests first → `wdd ward status NN red` → STOP for Dennis' "godkendt" → implement → green → `wdd ward status NN gold` → STOP. AI never runs `wdd complete`.

**Goal:** Replace the retired soft-body engine with an MLS-MPM fluid engine in Rust/WASM. By the end of slice 2, observed DOM elements *are* liquid in the acceptance scene. They rest crisply, splash when clicked or activated from the keyboard, slosh on shake, respond to the pointer and hover, and always re-form. Everything is verified in real browsers.

**Architecture:** Rust (`src/fluid/`) owns the MLS-MPM simulation and the accumulator. It exposes a `FluidCore` over a flat `Float32Array` FFI: a 10-float element buffer, a 7-field SoA dynamic view, a 3-field SoA static view and a 4-float element state view. There is no JSON. TypeScript owns DOM observation, input, the injected stylesheet and rendering. In slices 1–2 the only renderer is Canvas2D, with a density grid, threshold, blended colour and a `roundRect` at rest. A single-flight WASM loader makes multi-instance use safe and fails loudly.

**Tech stack:**
- Rust (edition 2024) with wasm-bindgen 0.2.116 and wasm-pack.
- TypeScript (strict), Vitest 4 (jsdom) and Playwright (real Chromium, pinned image).
- Canvas2D, with WebGPU smoke tests only.
- npm workspaces, changesets and the `wdd` CLI.

**Spec:** [`docs/superpowers/specs/2026-10-02-liquiddom-fluid-design.md`](../../specs/2026-10-02-liquiddom-fluid-design.md), approved and amended in `6963d7d`. Executors read the spec, this index and the ward file they are working on.

## Wards

| Ward | Slice | File | Content | Size |
|---|---|---|---|---|
| W63 | 1 | [W63.md](W63.md) | North star (`.wdd/NORTH-STAR.md`), WDD rules, epic 15, ward files, CLAUDE.md | 8 tasks |
| W64 | 1 | [W64.md](W64.md) | **Liquid at rest, end to end:** Rust core, FFI, single-flight loader, FluidBridge, Canvas2D renderer, acceptance scene | 12 tasks |
| W65 | 1 | [W65.md](W65.md) | Verification harness: Playwright (canvas2d blocking, webgpu soft), multi-instance stress, visual baseline, perf, CI | 13 tasks |
| W66 | 1 | [W66.md](W66.md) | Public API swap, stylesheet, soft-body retirement, site freeze, adapters, versioning | 12 tasks |
| W67 | 2 | [W67.md](W67.md) | **Splash and shake, end to end:** MPM dynamics, stiffness, restAlpha, click and keyboard splash | 15 tasks |
| W68 | 2 | [W68.md](W68.md) | Pointer field, hover, material API and presets, reduced-motion gating | 15 tasks |
| W69 | 2 | [W69.md](W69.md) | Playground on material, splash scene, **whole-picture check**, then STOP before slice 3 is planned | 9 tasks |

Order: W63 → W64 → W65 → W66 → W67 → W68 → W69. Each ward leaves `npm run verify` green.

**Human prerequisites:**
- Before W63: Dennis approves the six D63 decisions (in W63.md).
- Before W66: Dennis completes or closes **W62** (gold) and closes **W50** (planned, moot) via `wdd`.
- Before W67: decision **D67-1** about re-form timing (see Review Focus 1).

## Global Constraints

These are the spec values after the 2026-10-03 amendments. Every task implicitly includes them.

**Pool and FFI**
- `create({ particles, maxElements })`, with defaults **8000** and **32**. `observe` beyond `maxElements` throws `RangeError`. There is no `grow()`.
- Element id == slot index in `[0, maxElements)`. Slots are reused after `unobserve`. `home` is float-encoded, and `HOME_NONE = -1`.
- **Element buffer, 10 floats:**
  - `x, y, w, h`: buffer space; `w == 0` means inactive
  - `radius_px`
  - `interaction`: 0 idle, 1 hover, 2 focused, 3 dragged
  - `home_dx, home_dy`
  - `viscosity`: [0,1], NaN = default
  - `recovery`: s, NaN = default
- **Dynamic view, SoA with 7 fields:** `x, y, f00, f01, f10, f11, flags`. One contiguous block, one `writeBuffer` of `particleCapacity·7·4` bytes, and a fresh view from the bridge every frame.
- **Static view, SoA with 3 fields:** `home, rest_u, rest_v`. Read only when `generation()` changes.
- **Element state view, 4 floats:** `s, maxDev, restAlpha, reserved`.
- **Scalar calls:**
  - `tick(raw_dt_s, px, py, pvx, pvy, pointer_active, gx, gy)`
  - `splash(id, x, y, strength)`
  - `shake(strength)`
  - `set_material(viscosity, cohesion, recovery)`
  - `redistribute()`
  - `generation()`
  - `set_reduced_motion(bool)`
- The strides must match in Rust and TS, and a test asserts it. No JSON over FFI.

**Timestep and grid**
- Rust owns the accumulator. dt is clamped to 100 ms. Each frame runs at most 3 fixed steps of 1/60 s, and any remainder at the cap is dropped. Each step has 8 substeps.
- The cell size is set once at create as `clamp(sqrt(4·A_hint/N), 4, 8)` px. With no hint it is 8 px.
- The grid covers `max(screen,inner)` width × height plus the margin. The margin is `max(200, tallest initial element height)`.
- Each substep only touches a dirty region: the particle AABB plus 2 cells.
- Reallocation on resize is slice 6. Until then particles clamp to the walls.
- If the observed area exceeds `N·cell²/2`, the engine emits `console.warn` only.

**Physics** (W67/W68)
- Constitutive model: `σ = E(J−1)I + μ(C+Cᵀ)`, `J_RELAX`, `COMPRESS_MIN = 0.55`, `TENSION_MAX` as yield.
- CFL cap of 0.45 cells/substep on particles and grid. Air drag.
- Home spring: ζ = 0.8, relative to element velocity, saturated.
- Stiffness:
  - `s_floor = 0.015`
  - splash: `s ← min(s, 0.25·(2 − strength))`
  - shake: `s ← min(s, 0.4)`
  - recovery: `ds/dt = (1 − s)/recovery`
- Slip drift: 3/s × s², capped at 160 px/s.
- Wobble: 1.1 px × (1 − restAlpha).
- Hover swell: `HOVER_SWELL = 0.02`, a shared Rust/TS constant.
- `restAlpha`:
  - Rises when `s > 0.98` and `maxDev < 0.75 px` have held for ≥ 150 ms.
  - Falls immediately when either condition breaks.
  - Fades over 120 ms.
- Pointer field: 70 px radius, weight `(1 − d/r)²`, towards the pointer velocity.
- Click splash happens at the pointer. When `event.detail === 0` (keyboard) it happens at the centre instead.
- Gravity: the option is validated but has no effect until slice 6.
- Per generation, `p_vol = area_per_particle / cell²`.

**Material**
- `viscosity` maps to 100–2000 px²/s on a log scale; default 0.5.
- `cohesion` maps to `TENSION_MAX` 0.02–0.30; default 0.5. It is global only.
- `recovery`: 0.2–3 s, default 0.7.
- Presets: water, honey, jelly.

**Reduced motion** (the single definition)
- No simulation: every particle sits at its target, and `restAlpha = 1`.
- These are ignored: splash, shake, drag, pointer, hover swell, gravity and wobble.
- Scroll and resize are followed instantly, and the DOM text stays visible.
- Detection and the `matchMedia` listener are W64. Input gating is W68.

**Robustness**
- Single-flight init: one module-level promise, reset on rejection.
- A failed WASM load rejects `create()`. jsdom uses `testBackend` (`@internal`) together with `_fake-canvas.ts`.
- Rust: `#![deny(clippy::indexing_slicing)]` in `src/fluid`, no `unwrap`, and no hot-path allocation (a test checks Vec capacity and pointers over 300 ticks).
- Release profile: `[profile.release] lto = true, codegen-units = 1`. W65 measures opt-level 3 vs "s".
- `seed` is a random u32 by default. The same seed, inputs and viewport give bit-identical positions.

**DOM, a11y and rendering**
- One injected `<style>` (`#liquiddom-styles`) per document, removed on the last `destroy()`.
- `.liquid-element` clears background, border and shadow, and sets stacking: `position: relative; z-index: 1` if the element is static, otherwise only `z-index: 1` if its z-index is `auto`.
- `.liquid-text` only appears from slice 4 on.
- `forced-colors` and `print` hide the canvas and neutralise the classes.
- Canvas:
  - `aria-hidden="true"`, `pointer-events: none`, `fixed`, `z-index: 0`.
  - `canvasZIndex` is removed.
- Colour: the background and text colour are snapshotted before the class is applied. `refresh(el)` re-reads them with the class temporarily removed.
- Canvas2D renderer:
  - Density grid with blended colour and per-element normalisation.
  - Kernel ≤ 8 px, threshold 0.5.
  - At rest: a `roundRect` at the **home rect** (DOM rect + home offset, plus the hover swell).
  - Particles with `HOME_NONE` or no paint are skipped.
  - Never `new ImageData` / `new OffscreenCanvas` (they break jsdom).
- `renderer: 'auto'` means Canvas2D until slice 3. Explicit `'webgpu'` gives an infrastructure-only renderer and a warning. `silentFallback` is only validated.
- API:
  - `splash(el, { strength 0–2 = 1, at client px = centre })`
  - `shake(0–2 = 1)`
  - Throws on invalid input. `splash` on an unobserved element throws `Error`.

**Verification**
- Scene: `demo/scenes/acceptance.html` with "Splash", "Split", "Merge" and a card, a fixed `seed`, 1280×800, and `<link rel="icon" href="data:,">`.
- Re-form deadlines: splash 1.5 s, shake/merge 3 s. **This is subject to D67-1.**
- Playwright, in the pinned `mcr.microsoft.com/playwright` image:
  - `canvas2d` is blocking.
  - `webgpu` is soft and runs only the smoke spec until slice 3. It becomes blocking after 10 green runs in a row.
- Visual tests: same seed plus a manual clock, `maxDiffPixelRatio 0.01`. Baselines are **generated locally** in the pinned image via `scripts/e2e-docker.sh --platform linux/amd64` (W65 D65-7). That amends resolution D1, because a `workflow_dispatch` job can only run once `ci.yml` is on master. Each baseline is approved by Dennis after a vision check.
- Multi-instance: 2–4 instances per task plus 50 reloads. Any `console.error`, `pageerror` or panic fails the test.
- Perf (W65, non-blocking, provisional):
  - p95 tick/step at 8000 particles must be ≤ 1.2× the CI baseline.
  - RAF p95 must be ≤ 12 ms.

**Process and release**
- Versions are hand-set to `0.3.0-alpha.0`, with peers `^0.3.0-alpha.0` and examples `"*"`.
- Changesets: a `fixed` group plus `onlyUpdatePeerDependentsWhenOutOfRange: true`, `pre enter alpha`, then minor bumps → `0.3.0-alpha.1`.
- The site is frozen: removed from `workspaces`, from the vitest projects and from the CI build, `deploy-site.yml` is disabled, and the lock file is regenerated.
- `copy-wasm.mjs` rewrites according to depth for every `dist/**/*.js`. Only `ts/src/*.ts` may import `pkg`.
- Every ward has a `North star:` line and a `Decision:` line, both enforced by a test (W63).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, plus whatever attribution trailers the executing harness requires (e.g. `Claude-Session:`).

**Deliberately without an owner in slices 1–2** (decided later):
- What happens to the published `0.2.0-rc.0` (npm deprecate or leave it).
- Switching the `webgpu` project from soft to blocking after 10 green runs. It is logged, and Dennis switches it.
- Applying the opt-level result. W65 measures it, Dennis decides at W65 gold, and the change is then made as a one-line follow-up in `Cargo.toml`.

## Review Focus

These are the five failure modes most likely to bite. Each has a pinning test in its owning ward.

1. **The re-form timing cannot be met with the spec's constants.** A strength-1 splash reaches `restAlpha = 1` after ≈ 2.8 s (0.25 → 0.98 with τ 0.7 s, plus hold and fade), but the requirement is 1.5 s.
   - Owner: W67 (decision **D67-1**, which must be decided before red).
   - Options: change the recovery default, the threshold, the damage rule, or the deadline.
2. **The WASM import path breaks when the loader moves, or when adapter tests run against a stale core `dist`.**
   - Owners: W64 (`wasm-loader.ts` at `ts/src/`) and W66 (copy-wasm per depth, the dist pre-check).
3. **wdd ward ids collide** (`wdd ward create` writes `<epic>/ward-001.md`, and a bare id hits W1).
   - Owner: W63 (D63-1, flat `ward-063…069.md`).
4. **The release chain:** peers that are out of range force a major bump across the fixed group, and removing `site` requires a new lock file.
   - Owner: W66 (`get-release-plan` test, `npm ci` check).
5. **Determinism traps in the harness:**
   - An f32 accumulator without epsilon.
   - Headless-shell instead of new headless.
   - Vite `server.open` in CI.
   - `.gitignore` `w*-*.png` swallowing baselines.
   - Image tag vs `@playwright/test` version.
   - Owners: W64 (accumulator test) and W65.

## Cross-ward verification

The plan was produced as follows:
1. A skeleton with an interface contract, verified against the repo.
2. Resolutions to that verification.
3. Seven ward writers working in parallel.
4. Two cross-checkers (consistency, spec coverage). They raised 49 issues, 25 of them blockers, all routed back to their wards.
5. Revision of each ward.

After that, the blockers were verified once more (see `_verification.md`).
