---
ward: 15
revision: null
name: "Memory Bridge Encapsulation"
epic: "runtime-hardening"
status: "planned"
dependencies: [14]
layer: "typescript"
estimated_tests: 4
created: "2026-03-31"
completed: null
---
# Ward 015: Memory Bridge Encapsulation

## Scope
Introduce a new `WasmBridge` class that centralizes all WASM shared-memory access: pointer retrieval, `Float32Array` view creation, and view rebinding after `memory.grow()`. Currently `PhantomObserver` directly constructs `Float32Array` views from raw pointers and owns the `rebindBuffer()` logic — this couples it to WASM internals. `WasmBridge` becomes the single owner of pointer management, making the memory contract explicit and testable in isolation.

## Inputs
- Ward 014: Clean instance lifecycle with destroy support
- `PhantomObserver.rebindBuffer()` and direct `Float32Array` construction in constructor
- `WasmMemorySource` interface (`phantom-observer.ts`)

## Outputs
- New file `ts/src/wasm-bridge.ts` with `WasmBridge` class
- `PhantomObserver` refactored to receive views from `WasmBridge` instead of constructing them
- `rebindBuffer()` removed from `PhantomObserver` — rebinding is `WasmBridge`'s responsibility

## Specification

### `WasmBridge` Class

```typescript
// ts/src/wasm-bridge.ts
class WasmBridge {
  constructor(memory: WebAssembly.Memory, core: LiquidCore, capacity: number);

  /** Entity buffer view (FLOATS_PER_ENTITY * capacity) */
  entityView(): Float32Array;

  /** Particle buffer view (PARTICLE_FLOATS_PER_BODY * capacity) */
  particleView(): Float32Array | null;

  /** Rebind all views after memory.grow() invalidates the ArrayBuffer */
  rebind(newCapacity: number): void;

  /** Current capacity */
  readonly capacity: number;
}
```

### Implementation Details

1. **Constructor** — reads `core.ptr()` and `core.particle_ptr()`, creates initial `Float32Array` views over `memory.buffer`.
2. **`entityView()` / `particleView()`** — return the current cached views. These are the only way to access shared memory.
3. **`rebind(newCapacity)`** — re-reads pointers from `core`, creates fresh `Float32Array` views over the (possibly relocated) `memory.buffer`. Updates internal capacity. This is the single place where stale-view recovery happens.
4. **Stale detection** — after `memory.grow()`, the underlying `ArrayBuffer` is detached. `WasmBridge` can detect this by checking `memory.buffer !== this.cachedBuffer` and throw or auto-rebind as appropriate.

### PhantomObserver Changes

- Constructor accepts `{ entityView: Float32Array, particleView: Float32Array | null }` instead of `WasmMemorySource`.
- `rebindBuffer()` is removed — the bridge calls a simpler `setViews(entity, particle)` on the observer after rebinding.
- `PhantomObserver` no longer imports or knows about `WebAssembly.Memory`.

### Integration in LiquidDOMInstance

- `LiquidDOM.create()` constructs `WasmBridge` (if WASM is available) and passes views to `PhantomObserver`.
- On future grow calls (Ward 016), the instance calls `bridge.rebind(newCap)` then `observer.setViews(bridge.entityView(), bridge.particleView())`.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_bridge_creates_valid_views` | `entityView()` returns a `Float32Array` with length `capacity * FLOATS_PER_ENTITY`; `particleView()` returns correct length or null |
| 2 | `test_bridge_rebinds_after_grow` | After simulating `memory.grow()`, calling `rebind()` produces new views over the new buffer |
| 3 | `test_stale_view_detection` | Accessing views after `memory.grow()` without rebind is detectable (buffer mismatch or detached buffer check) |
| 4 | `test_phantom_observer_uses_bridge` | `PhantomObserver` constructed with bridge-provided views can observe/sync/render without touching raw pointers |

## Must NOT
- Change any Rust/WASM code
- Add new rendering features
- Break existing observe/unobserve/sync/render behavior
- Allow `PhantomObserver` to directly import `WebAssembly.Memory` after this ward

## Must DO
- Create `WasmBridge` as the single owner of pointer-to-view conversion
- Remove `rebindBuffer()` and `WasmMemorySource` usage from `PhantomObserver`
- Keep mock/non-WASM path working (PhantomObserver with plain `Float32Array`, no bridge)
- Expose stale-view detection so callers know when rebind is needed

## Verification
- All 4 tests green
- Demo runs identically — `WasmBridge` is an internal refactor with no visible change
- `PhantomObserver` has zero references to `WebAssembly.Memory` or raw pointer numbers
