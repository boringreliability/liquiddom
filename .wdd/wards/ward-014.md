---
ward: 14
revision: null
name: "Runtime Teardown and Idempotent Lifecycle"
epic: "runtime-hardening"
status: "complete"
dependencies: [13]
layer: "typescript"
estimated_tests: 5
created: "2026-03-31"
completed: "2026-04-01"
---
# Ward 014: Runtime Teardown and Idempotent Lifecycle

## Scope
Implement a complete `destroy()` method on `LiquidDOMInstance` that safely tears down all runtime resources: cancels the RAF loop, removes DOM event listeners, removes the injected canvas element, unobserves all tracked elements, and frees the WASM `LiquidCore`. The method must be idempotent (safe to call multiple times) and support a full create-destroy-create lifecycle without leaking resources.

## Inputs
- Ward 013: Instance-based `LiquidDOMInstance` with stub `destroy()`
- `PhantomObserver` with per-element `unobserve()` cleanup

## Outputs
- Fully implemented `destroy()` on `LiquidDOMInstance`
- Internal `destroyed` flag preventing use-after-destroy
- Clean create-destroy-create cycle support

## Specification

### `destroy()` Implementation

The `destroy()` method performs the following steps in order:

1. **Guard** — if instance is already destroyed (`this.destroyed === true`), return immediately (idempotent).
2. **Cancel RAF** — call `cancelAnimationFrame(this.animationId)` to stop the render loop.
3. **Unobserve all elements** — iterate `PhantomObserver`'s tracked elements and call `unobserve()` on each, which removes per-element `mouseenter`/`mouseleave` listeners.
4. **Remove document listeners** — remove the `mousemove` and `mouseleave` listeners that were attached for pointer tracking.
5. **Remove window listeners** — remove the `resize` listener used for canvas resizing.
6. **Remove canvas** — call `this.canvas.remove()` to detach the injected `<canvas>` from the DOM.
7. **Free WASM core** — call `core.free()` if the WASM `LiquidCore` instance exists (wasm-bindgen free).
8. **Null out references** — set observer, canvas, core, and wasmMemory to `null`.
9. **Set flag** — `this.destroyed = true`.

### Post-Destroy Behavior

- `observe()` and `unobserve()` on a destroyed instance throw `Error("LiquidDOM instance has been destroyed")`.
- A new `LiquidDOM.create()` call after destroying a previous instance works cleanly — no stale global state leaks.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_destroy_removes_canvas` | After `destroy()`, the canvas element is no longer in `document.body` |
| 2 | `test_destroy_cancels_raf` | After `destroy()`, `cancelAnimationFrame` was called with the correct ID |
| 3 | `test_destroy_removes_listeners` | After `destroy()`, document `mousemove`/`mouseleave` and window `resize` listeners are removed |
| 4 | `test_double_destroy_safe` | Calling `destroy()` twice does not throw and does not call `cancelAnimationFrame` a second time |
| 5 | `test_create_destroy_create_cycle` | `create() -> destroy() -> create()` produces a fully functional second instance with its own canvas and RAF loop |

## Must NOT
- Change any Rust/WASM code (only call existing `free()`)
- Add new rendering features
- Change the public API shape established in Ward 013
- Leave any event listener or DOM node behind after `destroy()`

## Must DO
- Implement full resource cleanup in `destroy()`
- Make `destroy()` idempotent (no-throw on repeated calls)
- Throw on `observe()`/`unobserve()` after destroy
- Support create-destroy-create lifecycle without leaks
- Store listener references at creation time so they can be removed by identity

## Verification
- All 5 tests green
- Manual check: create instance, observe elements, destroy, confirm canvas gone and RAF stopped
- Create-destroy-create cycle produces identical visual behavior on second instance
