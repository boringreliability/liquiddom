---
ward: 13
revision: null
name: "Instance-Based Runtime API"
epic: "runtime-hardening"
status: "complete"
dependencies: [12]
layer: "typescript"
estimated_tests: 4
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 013: Instance-Based Runtime API

## Scope
Refactor the static singleton `LiquidDOM` class to an instance-based API where `LiquidDOM.create(options)` returns an isolated instance with its own observer, canvas, and animation loop. This is the foundation for all subsequent runtime-hardening work — multiple independent instances must coexist without corrupting each other's state.

## Inputs
- Ward 012: Current `LiquidDOM` static class (`ts/src/index.ts`)
- Current `PhantomObserver` class (`ts/src/phantom-observer.ts`)

## Outputs
- New instance-based API: `LiquidDOM.create(options) -> LiquidDOMInstance`
- `LiquidDOMInstance` with methods: `observe(el)`, `unobserve(el)`, `destroy()`
- Updated `demo/main.ts` using the new API
- Deprecation or removal of all static methods on `LiquidDOM`

## Specification

### New Public API

```typescript
interface LiquidDOMInstance {
  observe(el: HTMLElement, liquidType?: number): number;
  unobserve(el: HTMLElement): void;
  destroy(): void;
}

class LiquidDOM {
  static async create(options?: LiquidOptions): Promise<LiquidDOMInstance>;
}
```

### Implementation Details

1. **`LiquidDOM.create(options)`** — async factory that performs the same initialization as the current `init()` (WASM load, canvas injection, RAF loop, pointer tracking) but stores all state on a private instance object instead of static fields.

2. **Instance isolation** — each instance owns its own:
   - `PhantomObserver`
   - `<canvas>` element
   - `requestAnimationFrame` loop ID
   - Pointer tracking listeners (scoped to document, but stored per-instance for later cleanup)
   - WASM `LiquidCore` instance

3. **`instance.observe(el)`** — delegates to the instance's `PhantomObserver.observe()`.

4. **`instance.unobserve(el)`** — delegates to the instance's `PhantomObserver.unobserve()`.

5. **`instance.destroy()`** — placeholder that is a no-op in this ward (full teardown is Ward 014). Must exist so the public API shape is final from day one.

6. **Remove static `init()`, `observe()`, `unobserve()`** from `LiquidDOM` — the only static method is `create()`.

### Migration

- `demo/main.ts` changes from `await LiquidDOM.init(opts)` / `LiquidDOM.observe(el)` to `const dom = await LiquidDOM.create(opts)` / `dom.observe(el)`.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_create_returns_instance` | `LiquidDOM.create()` resolves to an object with `observe`, `unobserve`, and `destroy` methods |
| 2 | `test_multiple_instances_coexist` | Two instances created with separate options each inject their own canvas and do not share observer state |
| 3 | `test_observe_unobserve_on_instance` | `instance.observe(el)` registers an element; `instance.unobserve(el)` removes it; calling observe on instance A does not affect instance B |
| 4 | `test_demo_works_with_instance_api` | The demo entry point initializes and runs without errors using the new instance-based API |

## Must NOT
- Change any Rust/WASM code
- Add new rendering features or visual changes
- Introduce auto-grow or capacity changes
- Break the existing demo — it must keep working after migration

## Must DO
- Replace all static state with per-instance state
- Expose `destroy()` on the instance (even if it is a no-op stub in this ward)
- Ensure two simultaneous instances do not interfere with each other
- Update `demo/main.ts` to use the new API

## Verification
- All 4 tests green
- `demo/main.ts` runs with `LiquidDOM.create()` and produces the same visual output as before
- No static mutable state remains on the `LiquidDOM` class
