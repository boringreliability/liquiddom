# liquiddom fluid engine: design

**Status:** the design was approved section by section in chat on 2026-10-02. It was then revised after a three-lens spec review (repo facts, consistency, feasibility; 52 findings). It is awaiting Dennis' review of this written spec.
**Next step after approval:** an implementation plan (writing-plans). The plan details **only slices 1–2** as WDD wards (W63+). Later slices stay outlines and are re-planned after each whole-picture check (§6).

## 0. North star

> *"WASM/WGPU-driven **fluid dynamics** on web elements via hidden canvas, preserving a11y"* (`.wdd/PROJECT.md:5`)

The elements **are** liquid, and so is their text. They splash, split, merge with each other and always re-form ("T-1000"). This is a playground, not a product. There is no launch and no go/no-go. Rust/WASM stays "because we can".

**Why this spec exists:** the goal was always fluid dynamics. Epic 02 never filled in its goal. W6 and W7 silently chose a mass-spring soft-body model, and 55 wards were built on that substitution. §6 makes sure that kind of drift gets caught.

### Decision log

| # | Decision | Saga |
|---|---|---|
| D1 | Goal: play with real fluid simulation. No launch | `dec_4a8a1817` |
| D2 | Solver: MLS-MPM. It won a bake-off against PBF + shape matching (branches `spike/fluid-mpm`, `spike/fluid-pbf`). The production solver is **re-implemented under test, with the spike as reference**. Spike code is not copied | `dec_83e8c8fd` |
| D3 | Physics stays in Rust/WASM on the CPU. WebGPU compute is rejected and needs a separate decision to come back | `dec_f9d25477` |
| D4 | The soft-body engine is retired. Its last state is tagged `softbody-final` (`515f54d`) | `dec_f9d25477` |
| D5 | The text is liquid while the element is moving. **At rest the real DOM text is shown.** a11y is carried by the DOM semantics | `dec_83e8c8fd` + this revision |
| D6 | Rendering: WebGPU, with a simple Canvas2D fallback that has no liquid text | this spec |
| D7 | The canvas sits **below** observed elements (stacking defined in §4). Focus rings stay visible | this spec |
| D8 | Border and box-shadow on observed elements are **dropped visually** in v1. This is an accepted loss | this spec |

### Facts the design rests on

- **W61 root cause** (wasm-bindgen 0.2.116 generated glue): two concurrent `LiquidDOM.create()` calls both pass the `if (wasm !== undefined)` check in `__wbg_init`. `initSync` has the same guard. Each call instantiates its own module, and `__wbg_finalize_init` overwrites the module-global `wasm`. The first core's pointer then dereferences into the wrong memory, giving "recursive use of an object detected". There is no prior panic. Deterministic repro: `docs/superpowers/specs/assets/w61-rca/race3.mjs` fails and `race3fix.mjs` (single-flight) passes. Run `npm run build:wasm` first. Both scripts become the basis for the slice-1 multi-instance test.
- **MPM spike performance**, mean ms per tick (8 substeps): 0.82 at 2k, 1.86 at 5k and 3.49 at 10k. Measured headless on Node 24 on an Apple M4 Pro, viewport 1280×800, 4 elements, actual counts 1926 / 4962 / 9932. A re-run gave 0.76 / 1.85 / 3.40. That interpolates to about 2.8 ms mean and 3.1 ms p95 at 8k, **without F**.
- **Weaknesses shared by both spikes:** the renderer (dominant-id colour, fuzzy edges), the pointer leaves a hole (hard radial push), and text ends up on an empty background.

## 1. What the retirement means

**Removed**
- Mass-spring physics: `EntityBody`, springs, `PARTICLES_PER_BODY = 16`, and `FreeParticle` as its own entity type.
- The `liquid_type` dispatch and every strategy (Default, Tear, Magnet, Dragged, Shake, Tween, FreeDrop).
- The existing drag (`liquidType === 3`, which moves the DOM element with `position: fixed`, `phantom-observer.ts:238-265`).
- Canvas2D splines and the WebGPU SDF shaders (`blob-sdf`, `fusion-sdf`, `sdf-helpers`), including fusion and refraction (W38–W40, W62).
- `RenderFrame` in its current shape.
- The W61 workarounds: `wasmCallInFlight`, `activeCores`, the `tickFailed` remount and the `liquiddom:instance-panic` orchestration.
- The W55 scroll pause and lerp.
- box-shadow parsing (W54).
- The demo scenes and site showcases in their current form (§5).

**Kept and reused**
- Rust/WASM plus the shared `Float32Array` principle (no JSON over FFI). `WasmBridge` remains the sole owner of pointers and views.
- From `PhantomObserver`:
  - rect measurement,
  - container mode with coordinate offset,
  - hover and focus tracking,
  - the per-element `MutationObserver` mechanism, extended (§3),
  - border-radius parsing, which v1 only uses for uniform circular radii (§3).
- The document `pointermove` / `pointerleave` input, reduced motion detection, pause/resume, visibility handling and the idempotent `create / observe / unobserve / destroy` lifecycle.
- The renderer infrastructure:
  - the method shape of the `Renderer` interface (`init / render / resize / destroy`),
  - WebGPU init, feature detection with auto fallback, canvas remount, DPR handling and `silentFallback`.
- Gravity from device orientation (W46), including `requestOrientationPermission`.
- The React and Vue adapters, the Tweakpane playground mechanism (W49), `scripts/copy-wasm.mjs`, changesets and CI.

**New code** (not inherited):
- splash on click and keyboard,
- liquid-only drag,
- the soft pointer field,
- `aria-hidden` on the canvas,
- the stacking CSS,
- the text atlas,
- F,
- the per-element rest state.

**Versioning:**
- Run `changeset pre enter alpha` and use minor-bump changesets.
- Put the three packages in a changesets `fixed` group so their versions move together.
- The result is `0.3.0-alpha.x`.
- What happens to the published `0.2.0-rc.0` (npm deprecate, or leave it) is open (§7).

## 2. The fluid engine (Rust)

### Physics

2D MLS-MPM (Hu et al. 2018), re-implemented with `spike/fluid-mpm` as reference.

**Inherited from the spike.** These parameters carry the feel and must not be lost:
- Constitutive model: `σ = E(J−1)·I + μ(C + Cᵀ)`. J relaxes towards 1 (`J_RELAX`) and is clamped from below (`COMPRESS_MIN = 0.55`). The stretch cap (`TENSION_MAX`) works as plastic yield and gives cohesion.
- 8 substeps per fixed step.
- CFL velocity cap of 0.45 cells per substep, applied to particles **and** grid velocity (grid is new).
- Air drag.
- A home spring with damping ratio ζ = 0.8, **damping relative to the element's own velocity**, and acceleration saturation (far-away droplets crawl back).
- `splash` resets J to 1 for the particles it hits.

**New relative to the spike:**
- gravity in the grid update,
- F (below),
- rest positions that scale with the rect,
- a pre-allocated grid with a fixed cell size,
- the soft pointer field,
- the per-element rest state.

**Timestep:**
- **Rust owns the accumulator.** `tick(raw_dt_s, …)` receives the raw RAF dt.
- dt is clamped to 100 ms.
- At most 3 fixed steps of 1/60 s per RAF. If the cap is hit, the remaining accumulator is dropped, so the simulation slows down instead of blowing up.

**Grid:**
- The cell size is decided **once** at `create()` from the particle density, clamped to 4–8 px. It is independent of the viewport, so the numerical behaviour (and visual regression) does not depend on window size.
- The grid is pre-allocated to cover `screen.width × screen.height` plus a margin (or the container's maximum in container mode).
- A larger resize triggers one explicit, logged reallocation.

**Walls and off-screen elements:**
- The grid covers the viewport plus a margin of 1 element height, at least 200 px. Walls sit at the grid edges.
- An element whose rect lies entirely outside viewport + margin is **parked**: its particles are not simulated.
- When it re-enters the margin, its particles are placed at `rest` instantly. This is invisible because it happens off-screen.

### T-1000 re-form

- Each particle has `home` (the element slot) and `rest_uv ∈ [0,1]²`, a normalised position within the element's rest rect.
- **Target** = `rest_uv` mapped into the element's **current home rect** (slots 0–3 plus `home_dx/dy`, see the FFI section). A resize therefore changes the targets and the liquid gently follows the new shape. Scroll and drag become something the liquid follows.
- **Stiffness:**
  - Each element has a stiffness `s ∈ [s_floor, 1]`, with `s_floor = 0.015`.
  - Damage rules: `splash` sets `s ← min(s, 0.25·(2 − strength))` clamped to ≥ `s_floor`, `shake` sets `s ← min(s, 0.4)`, and drag sets `s ← min(s, 0.5)` while dragging.
  - Recovery: `ds/dt = (1 − s)/recovery`, with `recovery` defaulting to 0.7 s.
  - These are internal constants. Only `recovery` is a parameter.
- **Slip drift** is kept: a grid-independent drift towards the target, scaled by `s²`, at rate 3/s, max 160 px/s. It is **documented as non-physical** (it does not conserve momentum). Without it, merged liquids never separate.
- **Wobble** (1.1 px in the spike) is scaled by `(1 − restAlpha)`, so it is 0 at rest.
- **Hover:** the home rect swells by 2% around its centre, a gentle bulge. Focus has no extra engine effect; the focus ring belongs to the DOM.

### Per-element rest state

Rust owns it and exports it:
- During G2P, Rust computes `maxDev` for each element: the max |x − target| over its particles, O(n).
- `restAlpha ∈ [0,1]` rises towards 1 when `s > 0.98` and `maxDev < 0.75 px` have both held for at least 150 ms. It falls towards 0 immediately when either is broken. This hysteresis prevents flicker.
- The fade time is 120 ms both ways.

### Deformation gradient F (render-only)

F is used **only** for the liquid text. It never enters the stress.

Per substep:
- `F ← (I + dt·C)·F`, followed by the slip term `F ← F + dt·SLIP_RATE·s²·(I − F)`, so F returns to I in step with the liquid.
- No plastic projection and no J relaxation, because those would break the continuity of the text between neighbouring particles.

Safety clamp:
- Singular values are clamped to `σ ∈ [0.2, 5]` via a closed-form 2×2 SVD, and det < 0 is flipped to the nearest proper rotation.
- Particles that hit the clamp get a `torn` flag (bit), and their text coverage fades out.

F's cost (+4 floats of SoA plus an SVD per substep) is benchmarked in slice 4. If it is too expensive, update F every 2nd substep.

### Particle pool and elements

- `create({ particles, maxElements })` fixes the capacity. `observe` beyond `maxElements` **throws**. There is no `grow()`.
- **Element id == slot index** in `[0, maxElements)`. Slots are reused after `unobserve`. `home` is stored as a float-encoded integer.
- Particles belonging to a freed slot keep their old `home` until `redistribute()` gives them a new home. They then crawl there, with no snap.
- **Redistribution:**
  - TS calls `redistribute()` once per microtask after a batch of `observe` / `unobserve` calls.
  - Rust divides the pool by area.
  - Rust bumps a **generation counter**, which is an FFI getter.
- **Density constraint:** MPM needs at least 2 particles per cell. The total observed area therefore has to satisfy `≤ particles · cell² / 2`. With 8000 particles and 8 px cells that is about 256k px², roughly one 600×400 card plus a few buttons. Beyond that:
  - `console.warn`,
  - the coarser cell size (8 px) is used,
  - the liquid gets visibly noisier.
  This is a documented limit, not a crash.
- Particle data is SoA: `x, y, vx, vy, C(4), J, F(4), home, rest_u, rest_v, flags`.

### Interaction

| Input | Engine effect |
|---|---|
| Pointer move | A soft velocity field: particles within a 70 px radius are pulled towards the pointer's velocity with weight `(1 − d/r)²`. This replaces the spike's hard radial push (`POINTER_PUSH_PX`), which caused the hole |
| `click` on an observed element | `splash` at the pointer position. **If `event.detail === 0`** (a keyboard-triggered click from Enter or Space on a focusable element), the splash is at the rect centre instead. Native activation is never prevented, so there is never a double splash |
| Drag (pointerdown + > 4 px movement) | `home_dx/dy` follow the pointer while the DOM stays put. After the threshold, the following click splash is suppressed. On release `home_dx/dy` → 0 and the liquid crawls home |
| `shake(strength)` | Global impulse: a random direction per element (seeded RNG) plus per-particle noise. Everything goes soft |
| Gravity | `(gx, gy)` in the grid update. Clamped to 0 under reduced motion |
| Droplets | Particles flung far away are ordinary liquid that crawls home. There is no separate entity type |

### Reduced motion

This is the only definition. §4 and §6 refer to it.
- Under `prefers-reduced-motion` (or `forceReducedMotion`), **the simulation does not run**.
- Every particle sits at its target (`rest_uv` under the current rect), and every `restAlpha = 1`.
- Splash, shake, drag deformation, the pointer field, hover swell, gravity and wobble are all ignored.
- Scroll and resize are followed instantly, because the targets follow the rects.
- The result is a still, crisp element with the real DOM text visible.

### Robustness

- **Single-flight WASM init:** one module-level init promise shared by every instance, reset on rejection.
- **Loud failure:** a WASM load failure rejects `create()` with a clear error. Silent mock mode is gone. jsdom tests use an explicit `testBackend` option (`@internal`).
- **No panics on JS input:** no `unwrap`, no indexing that can panic, and no allocation in the hot path (scratch buffers). TS validates all input first: capacity, ids, NaN and ranges.
- **Release build:** `[profile.release]` with `lto = true` and `codegen-units = 1`. `opt-level` 3 vs `"s"` is decided by measurement.
- **Seedable RNG** (`seed`) for lobes, jitter, shake directions and initial sampling. Same seed + same inputs + same viewport = the same particle positions.

### FFI contract

This is a coordinated contract change. It replaces the 9-float soft-body layout.

1. **Element buffer: 10 floats per element**, written by TS.

   | Index | Field | Note |
   |---|---|---|
   | 0–3 | `x, y, w, h` | The DOM rect in buffer space (container-relative in container mode). `w == 0` means the slot is inactive |
   | 4 | `radius_px` | Uniform circular border-radius (v1) |
   | 5 | `interaction` | 0 idle, 1 hover, 2 focused, 3 dragged |
   | 6–7 | `home_dx, home_dy` | Drag offset of the home rect relative to the DOM rect (px). 0 when not dragging |
   | 8 | `viscosity` | Per-element override in [0,1]. NaN = material default |
   | 9 | `recovery` | Per-element override in seconds. NaN = material default |

2. **Dynamic particle view**, written by Rust: SoA `x, y, f00, f01, f10, f11` as **one contiguous block**. TS uploads it with a single `writeBuffer(buf, 0, memory.buffer, ptr, n_active·24)` and takes the view from `WasmBridge` every frame, never a cached view.
3. **Static particle view**, written by Rust at redistribution: SoA `home, rest_u, rest_v, flags`. TS reads it only when the generation counter changes.
4. **Element state view**, written by Rust every step: 4 floats per element, `s, maxDev, restAlpha, reserved`.
5. **Scalar calls** (no buffer, no JSON):
   - `tick(raw_dt_s, px, py, pvx, pvy, pointer_active, gx, gy)`
   - `splash(id, x, y, strength)`, coordinates in buffer space
   - `shake(strength)`
   - `set_material(viscosity, cohesion, recovery)`
   - `redistribute()`
   - `generation()`
   - `set_reduced_motion(bool)`

The stride constants live in both `src/` (Rust) and the TS bridge, and MUST stay in sync. A test asserts they match.

**Material parameters**, all normalised [0,1] except recovery:
- `viscosity` maps to `VISCOSITY_PX` 100–2000 on a log scale, default 0.5 ≈ 450.
- `cohesion` maps to `TENSION_MAX` 0.02–0.30, default 0.5 ≈ 0.16. **It is global only**, because cohesion between different elements is a property of the whole liquid.
- `recovery` is in seconds, range 0.2–3, default 0.7.

## 3. Rendering and liquid text

Physics runs on the CPU (Rust) and rendering on the GPU (TS + WebGPU), in line with the Rule of Two.

The `Renderer` keeps its method shape. The new `RenderFrame` contains:
- the dynamic and static particle views,
- the generation counter,
- the element state view,
- per-element colour and text colour (snapshotted, see the colour section),
- the per-element atlas sub-rect,
- the viewport and DPR,
- `reducedMotion`.

### WebGPU: two passes

1. **Splat.** Each particle is drawn as an instanced quad (instance data read from a storage buffer via `instance_index`) with a smooth kernel. It writes into three render targets, all using additive blending `{src: one, dst: one, op: add}`:
   - `T0 rgba16float`: `Σw·rgb_premul` and `Σw` (density). Render scale 0.5× DPR.
   - `T1 rgba16float`: `Σw·text_rgba_premul`, sampled from an RGBA atlas. 1× DPR. **Only particles from elements with `restAlpha < 1`** are splatted here.
   - `T2 r16float`: `Σw·restAlpha`, used to cross-fade to the rest contour.

   The targets total 24 B per sample. That is within the default `maxColorAttachmentBytesPerSample = 32`, and rgba16float is blendable in WebGPU core. **No 32-bit float targets.**

   **Per-element density normalisation:**
   - Each particle's splat mass is its element's area per particle.
   - The kernel radius is proportional to the element's spacing (both passed as per-element uniforms), and is **capped at 8 px**.
   - The 0.5 threshold therefore lands on the rect edge for every element.
2. **Composite.**
   - Density is thresholded into a silhouette with an anti-aliased edge (`fwidth`).
   - Colour is normalised (`Σw·rgb / Σw`), which **blends at boundaries** (no speckle, and the card no longer "swallows" the button).
   - Text is composited from T1 in the text colour.
   - The context is configured with `alphaMode: 'premultiplied'`.

### Liquid text: the formula

For each splat fragment from particle p:
```
uv = rest_uv_p + diag(1/w_rest, 1/h_rest) · F_p⁻¹ · (frag_px − x_p_px)
```
- `w_rest, h_rest` come from the rect at redistribution, not the live rect.
- `uv` is mapped into the atlas as `atlas_origin + uv · atlas_size`.
- Coverage is 0 when `uv ∉ [0,1]²`. Atlas entries get a gutter of at least 1 kernel radius.
- `F⁻¹` is computed once per instance in the vertex shader, and its norm is clamped so compression does not cause minification.
- Coverage is 0 when `|det F| < ε` or `torn` is set.

The mapping direction is correct: `F = ∂x/∂X`, so a world offset is mapped back to rest through `F⁻¹`. Because neighbouring particles' patches agree, the text stretches and tears **continuously** with the liquid.

### Crisp at rest

When `restAlpha → 1`, the composite cross-fades to:
1. the element's **analytic rounded-rect SDF contour**: one instanced quad per resting element adds SDF density into T0 and T2, so pills are real pills with no fur, and
2. **the real DOM text.** TS removes the `liquid-text` class (`color: transparent`) per element when `restAlpha = 1`, and puts it back as soon as `restAlpha < 1`. At the same moment the atlas is cross-faded out.

At rest, what you see is therefore pixel-exact the DOM text, with no atlas approximation.

### Text atlas

- Built from `Range.getClientRects()` line boxes plus computed style (font, weight, size, letter/word spacing, text-transform, colour). It is **not** re-wrapped.
- It is drawn with OffscreenCanvas `fillText` at the current DPR.
- **Goal: visually matching the DOM text, not pixel-identical.** It is only seen while the element is moving, and at rest the real DOM text is shown.
- It is re-rendered:
  - on the per-element MutationObserver, which is **extended** to `childList`, `characterData`, `subtree` and the `style`/`class` attributes,
  - on `document.fonts` `loadingdone`,
  - on a DPR or zoom change.
  The MutationObserver **ignores liquiddom's own class mutations** (`liquid-element` / `liquid-text`).
- **v1 scope:** text nodes only. Icons, images and SVG inside an element are not liquid; they keep their DOM rendering on top.

### Colour

- Before `liquid-element` is applied, TS **snapshots** the computed `background-color` and `color`. The class itself makes the background transparent, which would otherwise be read back as "transparent".
- `refresh(el)` re-reads them by temporarily removing the class.
- A transparent background falls back to a default liquid colour.

### Canvas2D fallback (no WebGPU)

- A low-resolution density grid with threshold (as in the spike), using **blended** colour and per-element density normalisation.
- At rest: an exact `roundRect` fill per element with `restAlpha = 1`, so the edges are crisp at rest here too.
- **No liquid text:** `liquid-text` is never set, so the DOM text is always visible.

### Infrastructure and errors

- `renderer: 'auto' | 'webgpu' | 'canvas2d'`.
- `auto` treats both `WebGPUUnavailableError` **and** `adapter.info.isFallbackAdapter` (software WebGPU) as "unavailable" and falls back to Canvas2D. Other WebGPU init errors (shader or pipeline errors) are bugs and reject `create()`.
- `silentFallback` only controls the fallback `console.info`.
- On fallback the canvas is remounted.
- **`device.lost`:** rebuild as Canvas2D, and remove `liquid-text` from every element so the text is visible again. This is covered by a Playwright test.

## 4. DOM and a11y model

- **The DOM is the source of truth.** Semantics, focus, events and hit areas stay on the real element at its real rect. Flying liquid cannot be clicked.
- **Classes and an injected stylesheet** (one `<style>` per document, removed on the last `destroy()`):
  - `.liquid-element`
    - `background: transparent; border-color: transparent; box-shadow: none;` (D8)
    - `position: relative; z-index: 1;` when the element's computed position is `static`. Otherwise only `z-index: 1` if `z-index` is `auto`.
  - `.liquid-text { color: transparent; }`
    - Set **only** under WebGPU, and **only** while the element is moving (§3).
  - `@media (forced-colors: active)` and `@media print`: canvas `display: none`, and both classes neutralised with `!important`.
  - `unobserve` removes the classes. The element is then exactly as it was.
- **Canvas:**
  - `aria-hidden="true"` (new), `pointer-events: none`, `position: fixed`, `z-index: 0`.
  - It is a sibling at the end of `body`, or inside the container in container mode.
  - Observed elements sit above it because of the injected stacking rule (D7). This is the mechanism W57 assumed but never guaranteed.
  - The `canvasZIndex` option is **removed**.
  - Focus rings (`:focus-visible`) are part of the DOM element and are always drawn above the liquid.
  - **Accepted limitations:**
    - liquid flying over other content that has its own stacking context or an opaque background can disappear behind it,
    - an observed element inside an ancestor with `transform`, `filter` or `overflow: hidden` can end up visually under other content.
- **Drag moves the liquid, not the DOM.** There is no layout jump, no `position: fixed`, and labels can't end up on top of each other.
- **Keyboard:** see `click` with `event.detail === 0` in §2. It applies to focusable elements. Non-focusable elements (the card) can only be splashed with a pointer.
- **Contrast:**
  - At rest the real DOM text is shown on an exact contour, so contrast is identical to the original.
  - While moving, the text is carried by the same particles as its background, so it always sits on its own liquid.

| Situation | Behaviour |
|---|---|
| `prefers-reduced-motion` / `forceReducedMotion` | As defined in §2 *Reduced motion*: no simulation, crisp at rest, DOM text visible |
| `forced-colors: active` | The liquid is fully off (canvas hidden, classes neutralised). The DOM is unchanged |
| No WebGPU, or software WebGPU | Canvas2D liquid. DOM text always visible |
| `device.lost` | Canvas2D rebuild. `liquid-text` removed |
| `@media print` | Canvas hidden. DOM unchanged |
| Zoom, font or text change | Text atlas re-rendered |
| Scroll | The canvas is `fixed` and is redrawn in RAF. **Known risk:** the liquid can lag one frame behind native scroll. At rest the real DOM text means the text never lags. Measured in slice 6 |

## 5. API and integration

```ts
const liquid = await LiquidDOM.create({
  particles: 8000,             // default 8000. Fixed pool
  maxElements: 32,             // default 32. observe() beyond it throws
  container,                   // optional, as today
  renderer: 'auto',            // 'webgpu' | 'canvas2d'
  material: { viscosity: 0.5, cohesion: 0.5, recovery: 0.7 },
  gravity: { source: 'none' | 'fixed' | 'orientation', vector, strength },
  seed,                        // optional. Deterministic RNG
  autoObserve: true,           // [data-liquid]
  forceReducedMotion: false,
  silentFallback: false,
});
liquid.observe(el, { viscosity?, recovery? });
liquid.unobserve(el);
liquid.splash(el, { strength?: number /* 0–2, default 1 */, at?: { x: number, y: number } /* client px, default rect centre */ });
liquid.shake(strength? /* 0–2, default 1 */);
liquid.setMaterial(partial); liquid.getMaterial();
liquid.refresh(el);
liquid.pause(); liquid.resume(); liquid.destroy();
liquid.requestOrientationPermission();
liquid.autoDiscover(); liquid.stopAutoDiscover();
liquid.isPaused; liquid.activeRenderer; liquid.particleCapacity; liquid.elementCapacity;
```

`splash.at` is converted from client px into buffer space by TS, including the container offset.

### Old to new

Every current export, member and option is accounted for below.

| Current | Fate |
|---|---|
| option `capacity` | → `maxElements` |
| option `physics` (`LiquidPhysicsConfig`), `presets` | → `material`. Presets become material presets (`water`, `honey`, `jelly`) |
| options `colorDefault`, `colorHover`, `colorSource`, `theme.*`, `refraction`, `preserveBackgrounds`, `snapDurationMs`, `canvasZIndex` | removed (colour comes from computed style, plus D7/D8) |
| options `maxDt`, `forceReducedMotion`, `container`, `renderer`, `silentFallback`, `gravity`, `autoObserve` | kept. `maxDt` becomes internal (Rust: 100 ms) and is removed as an option |
| `grow()` | removed (fixed pool; `observe` beyond capacity throws) |
| `observe(el, liquidType?)` | → `observe(el, opts?)`. `liquidType` is gone |
| `impulse()`, `tween()`, `spawnDroplet()`, `despawnDroplet()`, `SpawnDropletOptions` | → `splash()` / removed |
| `setPhysicsConfig()`, `getPhysicsConfig()`, `validatePhysicsConfig` (@internal) | → `setMaterial()` / `getMaterial()` / `validateMaterial` (@internal) |
| `refreshTheme()`, `refreshShadow()` | → `refresh()` |
| `setBackgroundTexture()` | removed |
| `getBuffer()`, `pointerX`, `pointerY`, `preserveBackgrounds` (getter), `isScrollSnapping` | removed |
| `isPaused`, `capacity` | `isPaused` kept. `capacity` → `elementCapacity`, plus the new `particleCapacity` |
| `autoDiscover()`, `stopAutoDiscover()`, `pause()`, `resume()`, `destroy()`, `activeRenderer`, `requestOrientationPermission()` | kept |
| `LiquidInstancePanicDetail`, the `liquiddom:instance-panic` event | removed |
| React: `LiquidProvider`, `LiquidContext`, `useLiquid`, `useLiquidRef`, `LiquidElement` | kept. `liquidType` prop/option → element options |
| Vue: `LiquidProvider`, `LiquidPlugin`, `LiquidKey`, `useLiquid`, `useLiquidRef`, `LiquidElement` | kept, same change |

StrictMode is safe because of single-flight init plus idempotent `observe`.

### Demo, examples and site: what happens in which slice

| Today | Fate |
|---|---|
| `demo/scenes/fusion`, `refraction`, `scroll-hero`, `dragable-cards` | **Deleted in slice 1** |
| `demo/scenes/splash-buttons`, `tilt-bowl` | Deleted in slice 1. Recreated as fluid scenes in slices 2 (splash) and 6 (tilt) |
| `demo/scenes/playground` | Removed in slice 1. Ported to material parameters in slice 2 |
| `demo/scenes/acceptance.html` | **New in slice 1** |
| `examples/react` | Updated to the new API in slice 1 (it is small) |
| `site/` | **Frozen in slice 1:** taken out of the root `workspaces` and CI build, and `deploy-site.yml` is disabled, so the live site stays on the `softbody-final` deployment. Rebuilt as a fluid playground in slice 6, then added back |

## 6. Verification and way of working

### The acceptance scene

`.wdd/NORTH-STAR.md` is **canonical** for the scene. `PROJECT.md` and this spec link to it.

The page is `demo/scenes/acceptance.html`: three buttons ("Splash", "Split", "Merge"), a card with a heading and two lines of text, a fixed `seed`, and a fixed viewport of 1280×800 in Playwright.

**Scene steps:**
1. Idle for 2 s: crisp edges and the DOM text visible at rest.
2. Pointer sweep: soft bulge, no holes.
3. Click "Splash": jets and fingers. **[WebGPU]** the text tears with the liquid. Re-form within **1.5 s** (`restAlpha = 1`).
4. Tab + Enter on "Split": the same splash at the centre. The focus ring is visible throughout.
5. Drag "Merge" into the card and release: displacement merge, separation, both re-form within **3 s**, and the labels never overlap.
6. Shake: everything sloshes and re-forms within **3 s**.
7. Scroll 300 px and back: the liquid follows with no snap.
8. Reduced motion / forced colours / Canvas2D project / `device.lost`: each behaves as in §4.

**Expected state per slice.** ✅ = must pass, ⏳ = not expected yet, W/C = per renderer project:

| Step | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| 1 Idle | ✅ C (roundRect + DOM text) | ✅ C | ✅ W+C | ✅ | ✅ | ✅ |
| 2 Pointer | ⏳ | ✅ C | ✅ W+C | ✅ | ✅ | ✅ |
| 3 Splash | ⏳ | ✅ C (no text) | ✅ W+C (no text) | ✅ W with text | ✅ | ✅ |
| 4 Keyboard | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 Drag/merge | ⏳ | ⏳ | ⏳ | ⏳ | ✅ | ✅ |
| 6 Shake | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7 Scroll | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✅ |
| 8 Modes | reduced-motion + print ✅ | ✅ | + device.lost ✅ | + forced-colors ✅ | ✅ | ✅ |

### Testing in real browsers from slice 1

- **Playwright in CI** with real WASM, pinned to the `mcr.microsoft.com/playwright` image, with two projects:
  - `canvas2d` is **always blocking**.
  - `webgpu` runs Chromium (new headless) with `--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader`.
  - **Slice 1** includes a time-boxed smoke job: `requestAdapter`, log `adapter.info`, render a known frame and read it back. The `webgpu` project becomes blocking only after 10 green runs in a row. Until then it is "soft".
  - Because `auto` falls back on software adapters (§3), the `webgpu` project forces `renderer: 'webgpu'`.
- **Visual regression** of the scene's key frames. Same seed, fixed RAF dt (injected clock), and pixel tolerance `maxDiffPixelRatio 0.01`. Baselines are generated only in the pinned image.
- **Multi-instance stress:** 2–4 instances created in the same task, plus 50 reloads. It fails on any `console.error`, `pageerror` or panic. It is based on `race3.mjs`.
- **Perf**, provisional until a CI baseline exists:
  - Metric: **p95 of Rust `tick` per fixed step** (8 substeps) at 8000 particles in the acceptance scene, measured in the `canvas2d` project. Budget ≤ 1.2× the recorded CI baseline. Dev reference: M4 Pro ≈ 2.8 ms mean without F.
  - Frame: p95 of RAF callback duration (JS main thread) ≤ 12 ms in the `canvas2d` project.
  - GPU timing is not measured on SwiftShader. Splat overdraw is logged as fragments per frame.
- **a11y:** axe-core with 0 violations, focus visible above the liquid (screenshot), and `emulateMedia` for reduced-motion, forced-colors and print.
- **Rust:**
  - mass conservation exactly (constant particle count and mass),
  - volume (mean J) within ±5% after the stress sequence,
  - no NaN or Inf, and every F finite with det > 0 after the stress sequence,
  - re-form: `restAlpha = 1` within 1.5 s after a strength-1 splash and within 3 s after shake,
  - determinism: same seed and inputs give bit-identical positions,
  - the buffer strides match.
- **Vitest (jsdom)** stays for TS logic that doesn't need a browser (option validation, the old-to-new mapping, adapters, lifecycle), using the explicit `testBackend`.
- **Gold phase** also requires screenshots inspected with vision (memory rule).

### WDD with an eye on the whole

1. **`.wdd/NORTH-STAR.md`** describes the vision as experiences and contains the acceptance scene and the slice matrix. Every ward spec gets a line: *"North star: which scene step(s) does this move?"*.
2. **Vertical slices.** Every ward ends in something visible in the acceptance scene. No "data structures first" wards.
3. **A direction gate, separate from test approval.** A technique, architecture or scope choice is presented in chat as a named decision with its consequence. Dennis approves it, it is logged with `saga_record_decision`, and it gets a "Decision" line in the ward spec. **The ward cannot move to `red` without it.**
4. **Whole-picture check** after slices 2, 4 and 6: a video or GIF of the acceptance scene in both renderers, plus status against the north star. The next slice is planned only afterwards.
5. **Spikes** are allowed and time-boxed. They produce an answer, and their code never becomes production code (D2 re-implements).
6. Unchanged: `planned → red → (human approves tests) → approved → gold → (human approves) → complete`. AI never marks a ward complete.

### Slices

Slices 1–2 are detailed in the plan. Slices 3–6 are re-planned after each whole-picture check.

| # | Slice | Visible in the scene afterwards |
|---|---|---|
| 1 | **Liquid at rest** | Single-flight init + loud failure; MPM core in Rust (at rest only: sampling, home spring, reduced-motion path); new FFI; Canvas2D render with roundRect at rest; injected stylesheet + stacking + print; acceptance scene; Playwright harness + WebGPU smoke; multi-instance test; soft-body code, old scenes and site removed or frozen; `examples/react` ported |
| 2 | **Liquid that reacts** | Full MPM dynamics, pointer field, click/keyboard splash, shake, stiffness/re-form/restAlpha, playground on material, splash scene. Followed by a **whole-picture check** |
| 3 | **WebGPU liquid** | Splat/composite (T0/T2), blended colour, SDF contour at rest, `device.lost`, overdraw logging |
| 4 | **Liquid text** | F with clamp/torn, text atlas + T1, the `liquid-text` toggle, extended MutationObserver, forced-colors. Followed by a **whole-picture check** |
| 5 | **Drag and merge** | `home_dx/dy`, drag threshold, displacement merge, slip separation |
| 6 | **The world** | Scroll (incl. the 1-frame risk), resize, container, parking, gravity/tilt scene, adapters, site rebuilt and re-enabled. Followed by a **whole-picture check** |

**Interim state for kept features in slices 1–5:**
- **Gravity:** the option is accepted and validated, but has no effect until slice 6. Its tests are marked `skip` with a reference to the slice-6 ward.
- **Container mode:** works from slice 1 (rects and offset are kept). Scroll inside a container is only verified in slice 6.
- **Adapters:** compiled against the new API from slice 1 (`liquidType` → opts). Tests are updated in slice 1.
- **Pause/resume and visibility:** work from slice 1.

## 7. Out of scope, risks and open points

**Out of scope for this round:**
- WebGPU compute (D3).
- Liquid icons, images or SVG.
- Liquid flying above the DOM (D7).
- Rendered border or shadow (D8).
- Per-corner or elliptical border-radius.
- WebGL2.
- Web Worker offload: W50 is to be **closed by a human via `wdd`** as moot.
- Launch and marketing.

**Risks and mitigations:**

| Risk | Mitigation |
|---|---|
| The F text smears or shows doubled strokes under large deformation | Render-only F without plastic projection, the SVD clamp, torn fade. Verified visually in slice 4 |
| Slip drift looks "magical" in the wrong way | Tuned in the playground. Scaled by `s²` |
| WebGPU in CI on SwiftShader is flaky or slow | Smoke job in slice 1. The project stays "soft" until 10 green runs. GPU perf is not measured there |
| Too large an observed area for the pool (> ~256k px² at 8000/8 px) | Warning plus coarser cells. Documented limit. Consumers can raise `particles` |
| Splat overdraw is heavy on mobile iGPUs (≈1.6M fragments at 1× DPR in the scene) | Kernel cap of 8 px, density at 0.5×, text only for moving elements. Fragments per frame logged |
| The liquid lags 1 frame behind native scroll | DOM text at rest means the text never lags. Measured in slice 6. Alternative: a canvas that scrolls with the content |
| Stacking contexts in consumer CSS | Documented. The injected rule covers the common case |

**Open points**, decided by measurement or in the first wards:
- Render scale for T0 (0.5× vs 0.75×).
- `opt-level` 3 vs `"s"`.
- What happens to the published `0.2.0-rc.0` (npm deprecate or leave it) and to the CHANGELOGs.
- Whether F is updated every substep or every 2nd substep (benchmark in slice 4).
