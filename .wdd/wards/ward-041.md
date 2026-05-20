---
ward: 41
revision: 3
name: "Canvas2D Fallback & Feature Detection"
epic: "webgpu-rendering"
status: "complete"
dependencies: [36, 37, 40]
layer: "typescript"
estimated_tests: 10
created: "2026-05-10"
completed: "2026-05-20"
---
# Ward 041: Canvas2D Fallback & Feature Detection

## Scope
Adds `'auto'` to `LiquidOptions.renderer` and makes it the new default. The `'auto'` mode attempts to initialize `WebGPURenderer`; on `WebGPUUnavailableError` (paths A-E from W37), silently falls back to `Canvas2DRenderer` with an opt-out info-level log. Closes the WebGPU rendering epic — consumers now get GPU rendering where available and Canvas2D elsewhere without writing the probe themselves. Adds `instance.activeRenderer: 'canvas2d' | 'webgpu'` getter for diagnostics. Mid-session `device.lost` does NOT auto-rebuild as Canvas2D in v1 (the W37+W40 behavior of nulling the device + logging a warn is preserved); full mid-session recovery is deferred to a future ward.

## Inputs
- W36 `Renderer` interface + `Canvas2DRenderer`
- W37 `WebGPURenderer` + `WebGPUUnavailableError` (paths A/B/C/D/E)
- W40 `setBackgroundTexture` on renderer (forwarded by instance regardless of active path; null call is silent on Canvas2D)

## Outputs
- `LiquidOptions.renderer?: 'auto' | 'canvas2d' | 'webgpu'` — **default changes from `'canvas2d'` to `'auto'`**
- `LiquidOptions.silentFallback?: boolean` — when `true`, suppresses the info-level fallback log. Default `false`.
- `LiquidDOMInstance.activeRenderer: 'canvas2d' | 'webgpu'` — read-only getter for the active renderer.
- `mountCanvas` private helper extracted from `index.ts` for canvas creation + styling + mount (used by both initial create + fallback).
- `index.ts` create-flow refactored so `canvas` is mutable (`let`), renderer init runs before `resizeCanvas()`, and the post-fallback canvas reference is the one used by all downstream state (`hasCanvasCtx`, `destroy()`, etc.).
- Demo updates: `fusion.ts`, `refraction.ts`, `playground.ts` migrated to consume the `'auto'` default (see §10).

## Specification

### 1 — Default change: `'canvas2d'` → `'auto'`
`LiquidOptions.renderer` default changes from `'canvas2d'` (W37) to `'auto'`. Consumers calling `LiquidDOM.create()` with no renderer option now get WebGPU on capable browsers (~50-100ms extra init time on first call due to async adapter probe) and Canvas2D elsewhere. Pre-release breaking change is acceptable — package is `0.2.0-rc.0`.

**Type signature update** (load-bearing — TypeScript will compile-error without this):
- `LiquidOptions.renderer` type in `index.ts:69` is currently `"canvas2d" | "webgpu"`. Extend to `"auto" | "canvas2d" | "webgpu"`. Without this change, the implementation's `requestedRenderer === "auto"` branch produces a type error.

**JSDoc updates required** (load-bearing for implementers):
- `LiquidOptions.renderer` (currently `index.ts:63-69`) — rewrite default `'canvas2d'` → `'auto'`, drop the "W41's job" note, document `'auto'` as the recommended path.
- `LiquidOptions.silentFallback` — new JSDoc block; default `false`. (No symmetric `LiquidDOMInstance` getter — `silentFallback` is a one-shot init-time choice, not runtime state.)
- `LiquidDOMInstance.activeRenderer` — new getter JSDoc with values + when each fires.
- `.wdd/CONTEXT.md` Decision row currently listing `default 'canvas2d'` — update to `'auto'`.
- `.wdd/wards/ward-037.md` is NOT rewritten — historical doc. Add a one-line revision note at the top (`// W41 changed the default; this spec preserved for history`).

### 2 — `'auto'` mode flow
Three branches per `options?.renderer`:
- `'webgpu'`: preserve W37 contract — throw `WebGPUUnavailableError` on any failure path.
- `'canvas2d'`: skip WebGPU probing entirely. Never construct `WebGPURenderer`.
- `'auto'` (default): try WebGPU first; on `WebGPUUnavailableError` fall back to Canvas2D.

```ts
const requestedRenderer = options?.renderer ?? "auto";
let renderer: Renderer;
let activeRenderer: "canvas2d" | "webgpu";

// Initial canvas mount — replaces the current inlined block at index.ts:291-312.
// `canvas` is `let` (not `const`) so the auto-fallback branch can reassign it.
let canvas = mountCanvas(canvasZIndex, container);

if (requestedRenderer === "canvas2d") {
  renderer = new Canvas2DRenderer();
  await renderer.init(canvas);
  activeRenderer = "canvas2d";
} else {
  // 'webgpu' OR 'auto' — try WebGPU first
  try {
    const gpuRenderer = new WebGPURenderer();
    await gpuRenderer.init(canvas);
    renderer = gpuRenderer;
    activeRenderer = "webgpu";
  } catch (err) {
    if (requestedRenderer === "webgpu") throw err;  // explicit ask → hard fail
    if (!(err instanceof WebGPUUnavailableError)) throw err;  // unknown error → don't swallow
    // 'auto' fallback path — replace polluted canvas + init Canvas2D
    canvas.remove();
    canvas = mountCanvas(canvasZIndex, container);  // see §3
    renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    activeRenderer = "canvas2d";
    if (!options?.silentFallback) {
      console.info(
        `[liquiddom] WebGPU unavailable, falling back to Canvas2D renderer (${err.message})`,
      );
    }
  }
}

// CRITICAL: resizeCanvas() runs AFTER the renderer init block so the
// (possibly replaced) canvas gets correct backing-store dimensions.
resizeCanvas();
```

**`canvas` MUST be declared `let` (not `const`)** at the top of `LiquidDOM.create()`. The fallback branch reassigns it. The existing closure refs (`destroy()`'s `canvas.remove()`, `hasCanvasCtx`, `startLoop()`) all close over the variable — JS `let` semantics mean they correctly see the post-fallback value.

### 3 — `mountCanvas` helper (extracted)
Extract the existing inlined canvas creation logic into a private helper:
```ts
function mountCanvas(zIndex: number, container: HTMLElement | undefined): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = String(zIndex);
  if (container) {
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
  } else {
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    document.body.appendChild(canvas);
  }
  return canvas;
}
```
Called at both:
- Initial canvas creation (replacing the current inlined block at `index.ts:291-312`)
- The fallback branch in §2

The helper returns a NAKED canvas — `canvas.width`/`canvas.height` (backing-store pixel dimensions) are NOT set here. The subsequent `resizeCanvas()` call sets those. Keeps the helper's responsibility tight.

### 4 — `activeRenderer` getter
```ts
interface LiquidDOMInstance {
  readonly activeRenderer: "canvas2d" | "webgpu";
  // ... existing surface
}
```
Implemented as a getter on the instance object reading the `activeRenderer` closure variable. Read-only. **Not observable mid-init** — the instance object is only constructed AFTER the renderer init block completes, so `activeRenderer` always reflects the final state when first read.

### 5 — `hasCanvasCtx` becomes activeRenderer-aware
The W37 fix to `hasCanvasCtx` reads `options?.renderer === "webgpu" ? true : canvas.getContext("2d") !== null`. With auto-fallback, the check is no longer based on the REQUESTED renderer but on the ACTIVE one:
```ts
const hasCanvasCtx = activeRenderer === "webgpu" ? true : canvas.getContext("2d") !== null;
```
This line MUST sit AFTER the renderer init block so `canvas` and `activeRenderer` are both at their final post-fallback values.

### 6 — `silentFallback` opt-out
Default `false` — fallback always logs unless explicitly silenced. The single line emitted is `console.info` (not `console.warn`) because fallback is expected, documented behavior, not an anomaly.

**Multi-instance pages:** each instance emits independently. Consumers spinning up multiple instances on a no-WebGPU browser may prefer `silentFallback: true` (or a single capability check via `'gpu' in navigator` before construction).

### 7 — Device-lost mid-session is NOT auto-rebuilt in v1
W37's `device.lost` handler nulls `this.device` and logs a warn. W40 additionally invalidates `refractionTexture` + `hasUserTexture`. After device-lost:
- `render()` bails early (no device).
- `setBackgroundTexture()` is a silent no-op (W40 §4 guard `if (!this.device) return`). Confirmed safe — no race against a null device.

W41 does NOT add mid-session Canvas2D rebuild. The canvas is polluted with WebGPU usage; rebuild would require DOM replacement + re-attaching all interaction listeners + transferring observed elements. Risk/reward heavily favors deferral.

Documented as Known Limitation in CONTEXT.md. A future ward may add a `device-lost` event consumers can subscribe to.

### 8 — Backwards compatibility
- `LiquidOptions.renderer` accepts the same string values plus `'auto'`. Existing callers passing `'canvas2d'` or `'webgpu'` get unchanged behavior.
- Default change: callers who omitted `renderer` previously got `'canvas2d'`; they now get `'auto'`. On WebGPU-capable browsers this means an upgrade (smoother rendering); on others, identical behavior plus a `console.info` log (silenceable).
- `WebGPUUnavailableError` is thrown ONLY when `renderer: 'webgpu'` is explicitly passed. Existing W37 tests asserting this throw continue to pass.

### 9 — React/Vue adapter forward
Both adapters forward `LiquidOptions` verbatim via the provider's `config` prop. `renderer: 'auto'` flows through unchanged. No adapter changes required; no new test fixtures.

### 10 — Demo migration
Three demos currently use a hand-rolled `try { create({ renderer: requested ?? "webgpu" }) } catch (WebGPUUnavailableError) { create({ no renderer }) }` pattern. With W41 they should consume the new `'auto'` default:

- `demo/scenes/fusion.ts`, `demo/scenes/refraction.ts`, `demo/scenes/playground.ts`:
  - Drop `requestedRenderer ?? "webgpu"` defaults. Honor the URL override `?renderer=webgpu` for explicit-WebGPU demos (still useful — proves the hard-fail path).
  - When the URL override is absent, omit the `renderer` field from `LiquidDOM.create()` (let it default to `'auto'`).
  - Keep the existing `WebGPUUnavailableError` catch ONLY on the explicit-`?renderer=webgpu` path. When `'auto'` is used, the catch is unreachable for that error.
  - Update `setBadge(...)` calls to read `instance.activeRenderer` after `create()` resolves (single source of truth, replaces the local `active` variable).
  - **`refraction.ts` specifically:** the post-create gate `if (active === "webgpu" && refractionEnabled)` that conditionally calls `setBackgroundTexture` MUST also be rewritten to `if (instance.activeRenderer === "webgpu" && refractionEnabled)`. Otherwise, when `'auto'` resolves to webgpu, the gate (still using the stale local `active = "canvas2d"` default) would skip setting the texture and refraction silently disables.

Diff shape per file is small (~10 lines each). Test that the demos still render correctly on both Chrome (webgpu path) and Firefox (canvas2d fallback path).

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | auto_mode_uses_webgpu_when_available | `LiquidDOM.create({ renderer: 'auto' })` + mock navigator.gpu success → `instance.activeRenderer === 'webgpu'` |
| 2 | auto_mode_falls_back_to_canvas2d_when_webgpu_unavailable | `renderer: 'auto'` + `navigator.gpu = undefined` → `instance.activeRenderer === 'canvas2d'`; `LiquidDOM.create` resolves without throw |
| 3 | auto_mode_logs_fallback_info | Fallback path with default `silentFallback`: exactly one `console.info` call with message matching `/WebGPU unavailable/i` |
| 4 | silentFallback_true_suppresses_log | Same fallback with `silentFallback: true`: zero `console.info` calls |
| 5 | webgpu_mode_throws_on_unavailable | `renderer: 'webgpu'` + no `navigator.gpu` → `LiquidDOM.create` rejects with `WebGPUUnavailableError` (W37 contract preserved) |
| 6 | canvas2d_mode_skips_webgpu_probing | `renderer: 'canvas2d'` + spy on `requestAdapter` → 0 calls |
| 7 | activeRenderer_getter_reflects_active_path | `instance.activeRenderer` returns `'webgpu'` after webgpu success, `'canvas2d'` after canvas2d init or fallback |
| 8 | omitted_renderer_option_acts_as_auto | `LiquidDOM.create({})` (NO renderer option at all) + `navigator.gpu = undefined` → resolves successfully, `instance.activeRenderer === 'canvas2d'`. Distinct from T5 (which throws on explicit webgpu) and confirms the literal default string |
| 9 | auto_fallback_creates_fresh_canvas | `vi.spyOn(document, 'createElement')` → `'canvas'` argument called exactly twice in the auto-fallback path (once initial, once fallback). On webgpu success path: exactly one canvas creation |
| 10 | auto_mode_rethrows_non_webgpu_errors | Mock `WebGPURenderer.init` (or `navigator.gpu.requestAdapter`) to throw a `TypeError`. `renderer: 'auto'` → `LiquidDOM.create` rejects with that `TypeError` (NOT swallowed). Locks the `!(err instanceof WebGPUUnavailableError)` rethrow branch |

## Must NOT
- Throw on `WebGPUUnavailableError` in `'auto'` mode — only `'webgpu'` mode hard-fails.
- Swallow non-`WebGPUUnavailableError` errors in `'auto'` mode (a `TypeError` from a bug must surface).
- Render with two renderers simultaneously — only one `Renderer` is active at a time.
- Leak GPU resources on fallback — W37's catch-block already calls `device.destroy()` on partial init failure. W41 must not bypass this path.
- Auto-rebuild as Canvas2D on mid-session `device.lost` (v1 deferral).
- Reuse the WebGPU-polluted canvas for Canvas2D init in the fallback path.

## Must DO
- Use `let canvas` and reassign in fallback branch; run `resizeCanvas()` and compute `hasCanvasCtx` AFTER the renderer-init block.
- Extract `mountCanvas` helper and use it in both initial create + fallback (no duplicated 20-line styling block).
- Update JSDoc per §1 checklist + the W37 historical-doc revision note.
- Audit existing tests for `console.info` interaction — currently no spies exist; new W41-default test runs in jsdom will silently fall back. If any future test asserts "no console.info", pass `silentFallback: true`.
- Migrate the three demos per §10 — drop redundant try/catch on the `'auto'` path.
- Update CONTEXT.md Architecture Decisions row + Known Limitations to reflect new default + device-lost deferral.

## Verification
1. `cargo test && npm test` → all 292 prior tests + 10 W41 tests = 302 tests green.
2. `cargo clippy` → 0 warnings.
3. Manual smoke in Chrome 113+: `npm run dev` → open `http://localhost:3000/scenes/fusion.html`. Expected: `renderer-badge` reads `webgpu` (sourced from `instance.activeRenderer`). No `console.info` line about fallback.
4. Manual smoke in Firefox stable (no WebGPU): same URL. Expected: `renderer-badge` reads `canvas2d`. Single `console.info` line about WebGPU unavailability. Blobs render via Canvas2D path (smooth Bezier curves).
5. Manual smoke with `?renderer=webgpu` URL override on a no-WebGPU browser: the demo's existing explicit-webgpu try/catch fallback fires (preserved on that URL path).
6. Manual smoke with `?renderer=canvas2d` on Chrome: forces Canvas2D, no probe.
7. Manual smoke with no URL override on both browsers: confirms `'auto'` default behavior end-to-end.
