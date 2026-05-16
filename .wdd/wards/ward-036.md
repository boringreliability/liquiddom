---
ward: 36
revision: 2
name: "Render Abstraction Layer"
epic: "webgpu-rendering"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: "2026-05-16"
---
# Ward 036: Render Abstraction Layer

## Revision history
- **r1** — initial fleshed-out spec.
- **r2** (this revision) — addresses reviewer findings:
  - **C1 fix:** `softBodyIds`/`dropletIds` snapshotted as `ReadonlyArray<number>` (not live iterators), and `buildFrame()` is called AFTER `observer.sync()` in the RAF loop (pseudocode + R3 corrected).
  - **M1 fix:** `Renderer.init()` is *always* `Promise<void>` (Decision §8 narrowed). `LiquidDOM.create()` awaits it. Failures propagate via the create()-level promise.
  - **M2 fix:** Locked that `renderer` is declared at the `create()` closure scope, replacing the old `ctx` closure variable.
  - **M3 fix:** `startLoop()`'s `!ctx` guard is removed; loop runs unconditionally; `Canvas2DRenderer.render()` bails internally when ctx is null. RAF cost in mock-mode accepted as negligible (only hits tests).
  - **M4 fix:** `renderer.resize()` is called AFTER `resizeCanvas()` writes canvas.width/height. Ordering locked.
  - **m1 fix:** Test count bumped 3→4. T3 covers happy soft-body path; T4 covers `preserveBackgrounds: true` + droplet path (the two branches most at risk of copy-paste regression).
  - **m2 fix:** Test #1 uses a compile-time `const _: Renderer = ...` assertion as primary check, runtime `typeof` as secondary sanity.
  - **m3 fix:** `RenderFrame.softBodyIds` and `dropletIds` typed as `ReadonlyArray<number>`. Snapshotted by `buildFrame()` via `Array.from(...)`.
  - **m4 fix:** Test #4 also covers destroy idempotency + render-after-destroy is a no-op.
  - **W37 contract gap fix:** `PARTICLES_PER_BODY` and `FLOATS_PER_ENTITY` are re-exported from `renderers/renderer.ts` so W37 can import constants without crossing into `phantom-observer.ts` internals. Decision §11 amended.

## Scope
Decouple rendering from `PhantomObserver`. Extract today's Canvas2D drawing path into a `Canvas2DRenderer` class implementing a stable `Renderer` interface. `PhantomObserver` exposes a `buildFrame(viewport): RenderFrame` DTO method instead of `render(ctx, viewport)`. The RAF loop in `LiquidDOM.create()` becomes renderer-agnostic: it builds a frame from observer + viewport and hands it to the active renderer. This is a pure refactor — no behavior change, no visible-pixel change, no API surface for end users. Unblocks W37 (WebGPU pipeline) by giving the WebGPU implementation a defined contract to slot into.

Out of scope:
- Adding `options.renderer: 'canvas2d' | 'webgpu' | 'auto'` — that lives in W37 when the second renderer actually exists. Adding a switch with one option exposes user-visible API for no value. (Reverses the original stub's §3 wire-up.)
- Registry/factory pattern. `new Canvas2DRenderer()` in `create()` is enough; W37 will introduce a 1-line `switch`.
- Changing the FFI, the Float32Array buffer layout, the W56 soft-body / FreeDrop split, or any visual behavior.
- WebGPU code, WGSL shaders, anything in `renderers/shaders/`.
- Cleaning up the `render()` mock-mode fallback (`fillRect`/`arc`) — that branch survives the move unchanged.

## Inputs
- `packages/core/ts/src/phantom-observer.ts:519-755` — current `render()`, `renderEntityAt()`, `renderDropletAt()` methods (the entire render path).
- `packages/core/ts/src/phantom-observer.ts:540-565` — public `render(ctx, viewport)` entry point.
- `packages/core/ts/src/index.ts:483-548` — RAF loop with `ctx.setTransform`, `ctx.clearRect`, `observer.sync()`, `core.tick()`, `observer.render(ctx, ...)`.
- `packages/core/ts/src/phantom-observer.ts:86-95` — observer state used by render: `buffer` (entity Float32Array), `particleBuffer` (particle Float32Array | null), `idToElement` Map, `dropletIds` Set, `themeCache` (W052), `shadowCache` (W054), `hoverState`, `focusState`, `colorDefault`, `colorHover`.
- `packages/core/ts/src/box-shadow.ts` — `ShadowMargin` type (re-exported by the new renderer module).
- Existing W56 invariant: render iterates two distinct id sources (`idToElement` for soft-body, `dropletIds` for FreeDrop) with a defense-in-depth check at the soft-body site (skip slot[5]=6 leakers).
- Existing W55 invariant: RAF loop bails on `!ctx` only (mock-mode tolerance — sync/lerp still run when WASM is absent). This survives because the loop still owns `canvas.getContext('2d')` initially; after W36 it asks the renderer.

## Outputs
- New file `packages/core/ts/src/renderers/renderer.ts` — `Renderer` interface + `RenderFrame` DTO type.
- New file `packages/core/ts/src/renderers/canvas2d-renderer.ts` — implementation owning the canvas, the 2D context, the DPR transform, the clear, and the per-id draw loops (extracted verbatim from `PhantomObserver.renderEntityAt` / `renderDropletAt`).
- Edit `packages/core/ts/src/phantom-observer.ts`:
  - Remove public `render(ctx, viewport)`, `renderEntityAt`, `renderDropletAt` methods.
  - Add public `buildFrame(viewport: RenderFrameViewport): RenderFrame`.
  - Keep `setViews()`, `setCoordOffset()`, `sync()`, `getBuffer()`, `getObservedEntries()`, `observe()`, `unobserve()`, `spawnDroplet()`, `despawnDroplet()`, etc. unchanged.
- Edit `packages/core/ts/src/index.ts` RAF loop:
  - Instantiate `const renderer = new Canvas2DRenderer()` after canvas creation, call `renderer.init(canvas)`.
  - Replace `ctx.setTransform`, `ctx.clearRect`, `observer.render(ctx, …)` with `renderer.render(observer.buildFrame(viewport))`.
  - Forward `resizeCanvas()` into `renderer.resize(w, h, dpr)`.
  - Call `renderer.destroy()` from `instance.destroy()`.
- Index export: re-export `Renderer` and `RenderFrame` types from `packages/core/ts/src/index.ts` for W37 to consume internally. Public API surface unchanged (no new exported names visible to users of the public `LiquidDOMInstance` API in this ward).

## Decisions (locked in this spec)
1. **`RenderFrame` is a DTO with stable Map references** for `themeCache` / `shadowCache` — NOT a copy. The renderer reads keys lazily during its per-id draw loops. Cost: renderer is coupled to "these Maps exist and are populated by observer." Benefit: zero per-frame allocation for theme/shadow lookups; updates from MutationObserver (W052/W054) flow through to the next render without rebuild. (r2 amendment: `softBodyIds`/`dropletIds` are NOT references — they're snapshotted; see Decision §12.)
2. **`PhantomObserver.buildFrame()` replaces `render()`.** Single accessor instead of proliferating getters (`getBuffer`, `getParticleBuffer`, `getSoftBodyIds`, `getDropletIds`, `getThemeCache`, `getShadowCache`, `getColorDefault`, `getColorHover`). Keeps the observer's surface tight and makes the renderer ↔ observer boundary one method wide.
3. **Renderer owns canvas, context, DPR transform, and clearRect.** Currently the RAF loop does `setTransform` + `clearRect` before calling `observer.render`. After W36, both move into `Canvas2DRenderer.render()`. Rationale: W37's WebGPU renderer has its own clear semantics and no `setTransform`; making the loop renderer-agnostic means it must NOT contain Canvas2D-specific calls.
4. **RAF loop still owns `requestAnimationFrame`, scheduling, dt clamping, scroll-snap lerp.** Renderer is invoked per frame but does not drive the loop. Rationale: W55's `runScrollSnapLerp` is interleaved with `observer.sync()` and `core.tick()` — pulling RAF ownership into the renderer would entangle physics scheduling with rendering. Keep them separate.
5. **W56 soft-body / FreeDrop split stays in the renderer**, not the observer. `Canvas2DRenderer.render()` iterates `frame.softBodyIds` and `frame.dropletIds` as two separate loops, exactly mirroring today's behavior. Rationale: a future SDF/metaball renderer (W38+) may unify these into one full-screen pass; keeping the split in the renderer leaves that door open.
6. **The Canvas2D mock-mode fallback survives unchanged.** When `frame.particles === null` (WASM didn't load), Canvas2DRenderer falls back to `ctx.fillRect(x, y, w, h)` for soft-body and `ctx.arc(cx, cy, r)` for droplets. Identical to today's behavior in `phantom-observer.ts:670` and `:749`.
7. **No `options.renderer` field this ward.** The library exports one renderer; `LiquidDOM.create()` always instantiates `Canvas2DRenderer`. W37 adds the field. This avoids the foot-gun of shipping a one-value enum that exists only to make W36 "look complete." Public-API stability matters more than premature extensibility.
8. **`Renderer.init(canvas)` is always `Promise<void>`** — NOT `void | Promise<void>`. Reason (r2 fix M1): W37's WebGPU init can fail (no adapter, no GPU). If the contract permits sync return, callers that don't `await` silently swallow GPU init failures. Forcing `Promise<void>` makes `await renderer.init(canvas)` mandatory and `LiquidDOM.create()` (already async) propagates init failure to its caller. Canvas2DRenderer's `init` returns `Promise.resolve()` for trivial cases. Init failure throws (or rejects) → `create()` rejects → consumer sees a clean error.
9. **`Renderer.destroy()` is synchronous and idempotent.** Canvas2DRenderer clears internal canvas/context refs; second call is a no-op. W37's WebGPU `device.destroy()` is fire-and-forget so sync return is fine there too. `render()` after `destroy()` is also a no-op (it bails on null ctx/device). Locked by Test #4.
10. **Pixel-for-pixel parity is enforced via test snapshot of `ctx` call sequence**, not via image diff. jsdom can't render canvas pixels, but it can record method calls on a stubbed 2D context. Tests #3 (soft-body happy path) and #4 (preserveBackgrounds + droplet) snapshot the call sequence for fixed RenderFrames and lock them. (Manual smoke covers actual pixels.)
11. **Type-level `Renderer` is published from `renderers/renderer.ts`** but NOT re-exported from the package barrel. Internal contract only — bumping it doesn't require a major version. (W37 imports it directly.) **r2 amendment:** `renderers/renderer.ts` also re-exports `PARTICLES_PER_BODY` and `FLOATS_PER_ENTITY` (originally defined in `phantom-observer.ts`) so W37's WebGPU renderer can compute buffer strides without importing from observer internals. Re-exports are 2 lines; no behavior change.
12. **`softBodyIds` / `dropletIds` are snapshotted as `ReadonlyArray<number>`** in `buildFrame()` via `Array.from(this.idToElement.keys())` and `Array.from(this.dropletIds)`. Reason (r2 fix C1): the RAF loop calls `buildFrame()` then runs `sync()` and `tick()` — both of which can mutate observer state. A live `Map.keys()` iterator would be invalidated by even a microtask-flushed MutationObserver between `buildFrame()` and `renderer.render()`. Snapshot cost: one Array per id-source per frame, ≤capacity numbers each (≤128 typical). Negligible vs. correctness guarantee. (Note: pseudocode now also calls `buildFrame()` AFTER `sync()`/`tick()` for clarity — defense-in-depth.)
13. **`renderer` variable lives at `LiquidDOM.create()` closure scope** (r2 fix M2), replacing the old `ctx` closure variable. Captured by both the RAF `loop` callback and the `instance.destroy()` site. NOT exposed on the public `LiquidDOMInstance` API surface. Lifetime: bound to the instance; cleared when `destroy()` runs.
14. **The `!ctx` bail at `startLoop()` is KEPT** (gold amendment; r2 had proposed removing it as fix M3). Reason: W55's tests (T3 `scroll_idle_does_not_double_sync`, T6 `lerp_completes_within_snap_duration`) mock RAF via vitest fake timers and rely on the loop being dormant when canvas has no 2D context. Removing the bail caused `observer.sync()` to fire spuriously and overwrite the buffer in those tests. Gold captures the bail as `const hasCanvasCtx = canvas.getContext("2d") !== null` at `create()` time (right after `await renderer.init(canvas)`); `startLoop()` checks `if (!hasCanvasCtx) return`. `Canvas2DRenderer.render()` still bails internally on null ctx — both guards coexist as defense-in-depth. No interface change needed (the bail lives in `index.ts`, not the renderer).
15. **`renderer.resize(w, h, dpr)` is called AFTER `resizeCanvas()`** writes `canvas.width`/`canvas.height` (r2 fix M4). For Canvas2D this is a no-op (the backing-store resize is what matters and is done by `resizeCanvas()`). For W37 WebGPU, `resize()` will reconfigure the swap chain — must happen after the canvas internal dimensions are set. Locked ordering: `resizeCanvas()` → `renderer.resize(...)`.

## Specification

### `renderers/renderer.ts`
```ts
import type { ShadowMargin } from "../box-shadow";

// r2: re-export buffer-layout constants so W37 can compute strides without
// reaching into phantom-observer.ts internals.
export { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../phantom-observer";

/**
 * Viewport info passed in `RenderFrame.viewport` each frame.
 * `preserveBackgrounds` mirrors `LiquidOptions.preserveBackgrounds` and gates
 * the clip-hole pass (W53/W54). `cullMargin` is in CSS px.
 */
export interface RenderFrameViewport {
  widthCss: number;
  heightCss: number;
  dpr: number;
  cullMargin: number;
  preserveBackgrounds: boolean;
}

/**
 * Per-frame data passed from observer → renderer. Buffers and Maps are
 * stable references (Decision §1); id arrays are snapshotted (Decision §12).
 * No allocation other than the wrapper object itself + 2 small id arrays.
 */
export interface RenderFrame {
  /** Entity buffer (FLOATS_PER_ENTITY × capacity floats). Owned by observer/WASM. */
  entities: Float32Array;
  /** Particle buffer (PARTICLES_PER_BODY × 2 × capacity floats). `null` in mock-mode. */
  particles: Float32Array | null;
  capacity: number;
  /** Soft-body slot ids — snapshotted ReadonlyArray (Decision §12). */
  softBodyIds: ReadonlyArray<number>;
  /** FreeDrop slot ids — snapshotted ReadonlyArray (Decision §12). */
  dropletIds: ReadonlyArray<number>;
  viewport: RenderFrameViewport;
  theme: {
    colorDefault: string;
    colorHover: string;
    /** Ward 052 per-element computed colors. Empty Map in `colorSource: 'config'`. */
    themeCache: Map<number, string>;
    /** Ward 054 per-element box-shadow margins. */
    shadowCache: Map<number, ShadowMargin>;
  };
}

/**
 * Renderer lifecycle (Decision §3, §8, §9):
 *   1. `new Canvas2DRenderer()` (sync construction, no resources).
 *   2. `await renderer.init(canvas)` once, after canvas is appended to DOM.
 *   3. `renderer.resize(w, h, dpr)` after each `resizeCanvas()` in the loop.
 *   4. `renderer.render(frame)` once per RAF tick.
 *   5. `renderer.destroy()` once on `instance.destroy()` (idempotent).
 *
 * The renderer is a pure consumer of `RenderFrame`. It MUST NOT call back
 * into observer mutation methods (observe/unobserve/sync) from within
 * render() (Decision §1 / R3).
 */
export interface Renderer {
  /**
   * One-time setup. Always async; caller MUST await. Rejection signals an
   * unrecoverable init failure (e.g., WebGPU adapter unavailable) — the
   * caller should propagate so the user sees the error from `create()`.
   */
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** Per-frame draw. Bails internally if renderer is in a degraded state (no ctx, post-destroy). */
  render(frame: RenderFrame): void;
  /** Canvas backing-store dimensions changed (DPR or container resize). */
  resize(widthPx: number, heightPx: number, dpr: number): void;
  /** Release resources. Idempotent — second call is a no-op. */
  destroy(): void;
}
```

### `renderers/canvas2d-renderer.ts`
Constructor: takes no args. Private fields: `canvas: HTMLCanvasElement | null`, `ctx: CanvasRenderingContext2D | null`.

- `init(canvas)`: store ref, `getContext("2d")`. If ctx is null (jsdom default), store null — render() becomes a no-op (matches today's RAF loop bail-on-`!ctx`).
- `resize(_w, _h, _dpr)`: no-op for Canvas2D. The actual canvas backing-store resize is done by the RAF loop's `resizeCanvas()` (it writes `canvas.width`/`canvas.height`). The renderer doesn't need to react — it reads DPR from the frame each tick.
- `render(frame)`: bails on `!ctx`. Otherwise:
  1. `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` (from frame.viewport.dpr).
  2. `ctx.clearRect(0, 0, frame.viewport.widthCss, frame.viewport.heightCss)`.
  3. `ctx.save()` (matches today's `render()` save/restore wrapper).
  4. Soft-body loop: for each id in `frame.softBodyIds`, skip if slot[5]≈6 (defense-in-depth W56), else call private `drawSoftBody(frame, id)`.
  5. FreeDrop loop: for each id in `frame.dropletIds`, call private `drawDroplet(frame, id)`.
  6. `ctx.restore()`.
- `drawSoftBody(frame, id)`: verbatim extraction of `PhantomObserver.renderEntityAt`'s soft-body branch (~70 lines). Reads `frame.entities[id*9 ..+9]`, optional `frame.particles[id*32 ..+32]`, hover state from slot[4], color from `frame.theme.themeCache.get(id) ?? frame.theme.colorDefault`, shadow margin from `frame.theme.shadowCache.get(id) ?? ZERO_MARGIN`, `frame.viewport.preserveBackgrounds` for clip gate.
- `drawDroplet(frame, id)`: verbatim extraction of `PhantomObserver.renderDropletAt` (~50 lines). Same buffer reads via frame; uses `frame.theme.colorDefault` only (no hover/theme per W56 §2).
- `destroy()`: set `canvas = null`, `ctx = null`. Idempotent.

### `PhantomObserver.buildFrame()`
Public method replaces `render()`. Signature:
```ts
buildFrame(viewport: RenderFrameViewport): RenderFrame {
  return {
    entities: this.buffer,
    particles: this.particleBuffer,
    capacity: this.capacity,
    // Decision §12: snapshot id sources to ReadonlyArray. Live iterators
    // would be invalidated by any intervening Map/Set mutation.
    softBodyIds: Array.from(this.idToElement.keys()),
    dropletIds: Array.from(this.dropletIds),
    viewport,
    theme: {
      colorDefault: this.colorDefault,
      colorHover: this.colorHover,
      themeCache: this.themeCache,
      shadowCache: this.shadowCache,
    },
  };
}
```
Per Decision §1, all Maps and Float32Arrays are passed by reference (stable across frames). Per Decision §12, the id arrays are snapshotted.

### RAF loop (`index.ts`)
Replace lines 487-545 (`startLoop` body) with:
```ts
function startLoop() {
  // r2 fix M3: no `!ctx` bail here. Canvas2DRenderer handles it internally.

  const loop = (now: number) => {
    if (paused || destroyed) return;

    const rawDt = now - lastTime;
    lastTime = now;
    const dt = Math.min(rawDt, maxDt);

    if (isContainerMode) {
      containerRect = container.getBoundingClientRect();
      observer.setCoordOffset(containerRect.left, containerRect.top);
    }

    // W55: lerp owns slot[0..3] writes while it's active.
    if (scrollSnap.size > 0) {
      runScrollSnapLerp();
    } else {
      observer.sync();
    }

    const physicsDt = (reducedMotion || scrolling) ? 0 : dt;
    const vp = getViewportSize();
    const gx = reducedMotion ? 0 : gravityX;
    const gy = reducedMotion ? 0 : gravityY;
    if (core) {
      core.tick(physicsDt, pointerX, pointerY,
        pointerActive && !reducedMotion && !scrolling,
        physics.tension, physics.damping, physics.substeps,
        physics.repulsionRadius, physics.repulsionStrength, physics.neighborSpringK,
        0, 0, vp.w, vp.h, CULL_MARGIN_PX,
        gx, gy);
    }

    // r2 fix C1: buildFrame() AFTER sync/tick — snapshotted id arrays are
    // immutable for the duration of render() regardless. Frame reads buffer
    // refs that sync/tick just mutated. No microtask hazard.
    const dpr = window.devicePixelRatio || 1;
    const frame = observer.buildFrame({
      widthCss: vp.w,
      heightCss: vp.h,
      dpr,
      cullMargin: CULL_MARGIN_PX,
      preserveBackgrounds: preserveBg,
    });
    renderer.render(frame);

    animationId = requestAnimationFrame(loop);
  };

  animationId = requestAnimationFrame(loop);
}
```
And update `resizeCanvas()` to call `renderer.resize(...)` after writing canvas.width/height (Decision §15):
```ts
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = isContainerMode ? container.clientWidth : window.innerWidth;
  const h = isContainerMode ? container.clientHeight : window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  renderer.resize(w * dpr, h * dpr, dpr); // r2 fix M4
}
```

### `LiquidDOM.create()` closure scope changes
Per Decision §13, the existing `const ctx = canvas.getContext("2d");` closure variable (currently at index.ts:474) is removed. Replaced by:
```ts
const renderer: Renderer = new Canvas2DRenderer();
await renderer.init(canvas);
```
Both `instance.destroy()` and the RAF `loop` capture this `renderer` variable via closure. The previous `ctx` references in `startLoop()` (`if (!ctx) return`, `ctx.setTransform`, `ctx.clearRect`) are removed.

### Idempotent destroy chain
`instance.destroy()` (already exists, calls `observer.destroy()` etc.) gains one line: `renderer.destroy()` before `observer.destroy()`.

## Tests
All new tests in a new file `packages/core/ts/__tests__/renderer-abstraction.test.ts` to keep them grouped:

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `canvas2d_renderer_satisfies_renderer_contract` | Compile-time: `const _: Renderer = new Canvas2DRenderer();` (test file fails to compile if Canvas2DRenderer drifts from the interface). Runtime sanity: instance has `init`/`render`/`resize`/`destroy` as functions; `init()` returns a `Promise` (Decision §8). Locks the contract that W37 will implement against. |
| 2 | `phantom_observer_render_method_replaced_by_buildFrame` | After W36, `(observer as any).render` is `undefined` AND `typeof observer.buildFrame === "function"`. Calling `buildFrame({ widthCss: 100, heightCss: 100, dpr: 1, cullMargin: 0, preserveBackgrounds: false })` returns an object with `entities`, `particles`, `capacity`, `softBodyIds` (Array), `dropletIds` (Array), `viewport`, `theme` keys; `theme.themeCache` and `theme.shadowCache` are `Map` instances; `softBodyIds` and `dropletIds` are real arrays (`Array.isArray === true`), proving the snapshot per Decision §12. Locks Decisions §1, §2, §12. |
| 3 | `canvas2d_renderer_renders_soft_body_call_sequence` | Construct a known RenderFrame with **one soft-body** at (10, 20, 100, 50), no border-radius, `preserveBackgrounds: false`, default color, no particles (mock-mode: `particles: null` → triggers fallback `fillRect(10, 20, 100, 50)`). Then a second frame with the same soft-body and a synthetic particle buffer holding 16 perimeter particles — assert the recorded sequence is `setTransform`, `clearRect`, `save`, `beginPath`, `moveTo`, 16× `quadraticCurveTo`, `closePath`, `fill`, `restore`. Records via a `RecordingCtx` mock (proxy that captures every method+args). Test enumerates expected sequence inline (no magic snapshot file). Locks soft-body happy path + mock-mode fallback. |
| 4 | `canvas2d_renderer_renders_droplet_and_preserveBackgrounds_clip` | Construct a RenderFrame with `preserveBackgrounds: true`, **one soft-body** at (10, 20, 100, 50) with `slot[8] = 10` (border-radius), shadow margin `{top: 4, right: 4, bottom: 4, left: 4}` in `theme.shadowCache`, and **one droplet** at (200, 200) with diameter 8. Assert the recorded sequence includes: (a) clip-pass for soft-body — `save`, `beginPath`, `rect(0,0,vw,vh)`, `roundRect(6, 16, 108, 58, 10)`, `clip("evenodd")`, then fill, then `restore`; (b) droplet draw — circle of 16 quadratic curves at (200, 200) with radius 4, no clip path. ALSO: call `renderer.destroy()` twice — neither throws; then `renderer.render(frame)` — does not throw, recorded sequence is empty (bail-after-destroy per Decision §9). Locks W53/W54 clip path + W56 droplet path + destroy idempotency + render-after-destroy bail. |

After W36: 259 + 4 = **263 tests** (55 Rust + 208 TS — all 4 new tests TS-side).

## Risks & Mitigations
- **R1: Tests #3/#4 are fragile if Canvas2D rendering changes legitimately.** The locked snapshots are `setTransform`/`clearRect`/`save`/draw-sequence/`restore` enumerations. If a future ward legitimately changes the call order (e.g., W38 SDF moves rendering off Canvas2D, or a future clip variant adds another path call), tests need explicit updates. Mitigated by: keeping snapshots inline (no magic file), naming tests after the contract they lock, JSDoc above each "// REGRESSION LOCKER — update intentionally if render math changes."
- **R2: jsdom doesn't fully mock CanvasRenderingContext2D.** The native jsdom canvas falls back to no-op. We need a custom recording mock. Mitigated by: building a `RecordingCtx` mock helper in `renderer-abstraction.test.ts` (Proxy that captures `method(...args)` tuples into an array). ~20 LOC. Pattern is already used in `phantom-observer.test.ts`.
- **R3 (r2 corrected): `softBodyIds` / `dropletIds` are now `ReadonlyArray<number>` snapshotted at `buildFrame()` time** (Decision §12). The renderer iterates snapshots, NOT live Maps/Sets. Even if a microtask flushes between `buildFrame()` and `render()` and mutates observer state, the snapshot is unaffected. The renderer is still a pure consumer (it cannot call back into observer mutation methods), and that invariant is documented in the `Renderer` interface JSDoc.
- **R4: PhantomObserver's `themeCache` / `shadowCache` are currently `private`.** Decision §2 makes them flow through `buildFrame()`'s return value, which means the references escape observer encapsulation. Mitigated by: the references are still read-only-by-convention for the renderer (no test enforces this, but the type system + the single-consumer pattern keeps it honest). A future ward could wrap them in `ReadonlyMap` if drift surfaces.
- **R5: The mock-mode tolerance from W55 must survive.** Today the RAF loop has `if (!ctx) return;`. After W36 (Decision §14), that bail moves into `Canvas2DRenderer.render()` — RAF unconditionally calls `observer.sync()` and `core.tick()` and `renderer.render()`. In mock-mode (`canvas.getContext('2d')` returns null in jsdom without the canvas package): renderer's internal ctx is null → render() is a no-op. Verified structurally by Test #1 (init returns Promise that resolves even when ctx is null) and by existing 256 tests passing post-refactor.
- **R6: Build-order regression.** The renderer module imports from `box-shadow.ts` (ShadowMargin); `box-shadow.ts` has no upward dependency. `phantom-observer.ts` already imports from `box-shadow.ts`. Adding `renderers/canvas2d-renderer.ts` (imports `renderer.ts` + `box-shadow.ts`) and `renderers/renderer.ts` (imports `phantom-observer.ts` for constant re-export per Decision §11) creates a potential cycle: `canvas2d-renderer` → `renderer` → `phantom-observer`. `phantom-observer` does NOT import from `renderer.ts` or `canvas2d-renderer.ts` — so the graph is acyclic. Mitigated by `tsc --noEmit` in the build step catching any future cycle.
- **R7 (r2 new): `await renderer.init(canvas)` makes `create()`'s init path serial.** Today `create()` does parallel-ish async work (WASM import, observer setup). After W36, `renderer.init()` is awaited inline. For Canvas2DRenderer this is `Promise.resolve()` — essentially free. For W37 WebGPURenderer it adds the adapter-acquisition latency to `create()`'s critical path. Acceptable trade-off: adapter acquisition takes ~10ms on a hot device, ~100ms cold. The alternative (lazy init on first render) loses error-propagation cleanliness, which is the whole reason for Decision §8.
- **R8 (r2 new): RAF loop calls `renderer.resize()` from `resizeCanvas()`** — including on the initial mount (Decision §15). Canvas2D's `resize()` is a no-op so this is safe. For W37 WebGPU, the initial resize must run *after* `renderer.init()` has acquired the device. Mitigated by: `create()` awaits `renderer.init()` BEFORE calling `resizeCanvas()` for the first time. Lock the call order in the create() body: create canvas → mount → new Renderer → await init → resizeCanvas() (which calls renderer.resize()).

## Must NOT
- Change `FLOATS_PER_ENTITY`, `PARTICLES_PER_BODY`, or any FFI shape (their *values* — re-exporting their names per Decision §11 is allowed).
- Touch any Rust code, Cargo.toml, or pkg/.
- Add `options.renderer` to `LiquidOptions` (Decision §7 — W37's job).
- Add a renderer factory or registry (Decision §7 — premature abstraction).
- Change visible output of any existing demo scene — pixel-perfect parity must be preserved (Decision §10).
- Re-export `Renderer` or `RenderFrame` from the package's public barrel (Decision §11). They live in `renderers/*.ts` and W37 imports them directly via relative path.
- Allocate beyond the per-frame builder call's necessary state (Decision §1 — wrapper object + 2 small id arrays per frame; Maps and Float32Arrays are passed by reference).
- Move `requestAnimationFrame`, dt clamping, scroll-snap lerp, `observer.sync()`, or `core.tick()` calls into the renderer (Decision §4).
- Cache anything in the renderer that the observer also caches (themeCache, shadowCache, hoverState). Renderer is a stateless pass over observer state.
- Break the W55 mock-mode tolerance: with no WASM, the RAF loop still runs, sync runs, tick is skipped, render runs with `frame.particles = null`, Canvas2DRenderer falls back to rect/circle. Verified by R5 + Test #3 (mock-mode `fillRect` fallback).
- Make `Renderer.init()` synchronous-permitted via `void | Promise<void>` (r2 Decision §8 — strictly `Promise<void>`).
- Return live `Map.keys()` / `Set.values()` iterators from `buildFrame()` (Decision §12 — must be snapshotted `ReadonlyArray<number>`).

## Must DO
- All 259 existing tests continue to pass.
- New tests #1-#4 pass.
- `npm run build` produces 0 TS errors.
- `cargo clippy` 0 warnings (no Rust change, but verify nothing leaks).
- Manual smoke test on all 6 demo scenes: visually identical to pre-W36.
- W37 can import `{ Renderer, RenderFrame, PARTICLES_PER_BODY, FLOATS_PER_ENTITY }` from `../renderer.ts` (relative path) and implement `Renderer` against the contract — verified structurally by Test #1's compile-time check.

## Manual Smoke Test
### Setup
```
npm run dev
```

### Steps
1. Open `http://localhost:3000/scenes/playground.html?preserveBackgrounds=false&capacity=64`.
   Expected: 4 visible blobs (pill, circle, rectangle, rounded card) — visually identical to the post-W57 baseline.
2. Open `http://localhost:3000/scenes/scroll-hero.html`. Scroll up and down.
   Expected: blobs follow rigidly during scroll, smooth-snap lerp on idle (W55 behavior preserved).
3. Open `http://localhost:3000/scenes/dragable-cards.html`. Drag a card.
   Expected: drag works, blob deforms with cursor (W30 Dragged strategy preserved).
4. Open `http://localhost:3000/scenes/splash-buttons.html`. Click each button.
   Expected: impulse + splash droplets fire normally (W44/W56 preserved).
5. Open `http://localhost:3000/scenes/tilt-bowl.html` on a device with orientation OR DevTools sensor emulation.
   Expected: orientation gravity works (W46 preserved).
6. Open `http://localhost:3000/` (main demo). Use all features.
   Expected: identical behavior to before W36.

### Pass criteria
- [ ] All 6 demo scenes render blobs at page load
- [ ] All interactions (hover, scroll, drag, click, tilt) work identically to pre-W36
- [ ] No console errors, warnings, or rendering artifacts
- [ ] `instance.destroy()` followed by `instance.create()` works without canvas leaks (visual: only one canvas in body)

## Verification
`npm run verify` — `build + test:rust + test + clippy`. All green.
- T1-T3 cover the abstraction contract.
- Existing 256 tests cover regressions in render output (via `phantom-observer.test.ts`, `liquiddom-api.test.ts`, `runtime-truth.test.ts`).
- Manual smoke covers the actual visible parity.
- W37 will follow by adding `WebGPURenderer implements Renderer` and a `switch` in `create()`.
