---
ward: 16
revision: null
name: "Capacity Correctness and Grow Semantics"
epic: "runtime-hardening"
status: "planned"
dependencies: [15]
layer: "both"
estimated_tests: 4
created: "2026-03-31"
completed: null
---
# Ward 016: Capacity Correctness and Grow Semantics

## Scope
Fix the capacity mismatch between the TypeScript and Rust layers after a `grow()` call, and define explicit grow semantics for the project. Currently, if `LiquidCore.grow()` is called on the Rust side, the TS-side `PhantomObserver` and `WasmBridge` may retain stale capacity values and views, leading to out-of-bounds writes or silent data corruption. This ward makes grow an explicit, coordinated operation with a single code path through `WasmBridge`, and establishes the rule: no auto-grow — capacity changes are always caller-initiated.

## Inputs
- Ward 015: `WasmBridge` with `rebind(newCapacity)` and stale-view detection
- Rust `LiquidCore.grow(new_capacity)` (existing WASM export)
- `PhantomObserver` capacity field

## Outputs
- `LiquidDOMInstance.grow(newCapacity)` public method
- Coordinated grow path: Rust grow -> bridge rebind -> observer setViews -> capacity updated everywhere
- Rust-side validation that grow preserves existing entity data
- Explicit "no auto-grow" policy enforced

## Specification

### Public API Addition

```typescript
interface LiquidDOMInstance {
  // ... existing methods from Ward 013
  grow(newCapacity: number): void;
  readonly capacity: number;
}
```

### Grow Sequence

When `instance.grow(newCapacity)` is called:

1. **Validate** — `newCapacity > currentCapacity`, instance not destroyed.
2. **Rust grow** — call `core.grow(newCapacity)` which reallocates the Rust-side buffers and may trigger `memory.grow()`.
3. **Bridge rebind** — call `bridge.rebind(newCapacity)` which re-reads pointers from `core` and creates fresh `Float32Array` views.
4. **Observer update** — call `observer.setViews(bridge.entityView(), bridge.particleView())` and update the observer's internal capacity.
5. **Instance capacity** — update the instance's `capacity` property.

### Rust-Side Contract

- `LiquidCore.grow(new_capacity)` must preserve all existing entity data in slots `0..old_capacity`.
- After grow, `ptr()` and `particle_ptr()` return valid pointers to the new (possibly relocated) buffers.
- Grow must not reset or zero out occupied slots.

### No Auto-Grow Policy

- `PhantomObserver.observe()` throws when capacity is exceeded (existing behavior) — it does NOT auto-grow.
- Only explicit `instance.grow()` increases capacity.
- This keeps the grow path predictable and avoids surprise `memory.grow()` during RAF ticks.

### Capacity Alignment Check

- After grow, `bridge.capacity`, `observer.capacity`, and `core.capacity()` (if exposed) must all agree.
- A debug assertion (`console.assert` or similar) verifies alignment after each grow in development.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_capacity_reflects_state_after_grow` | After `instance.grow(256)`, `instance.capacity` equals 256 and `bridge.entityView().length` equals `256 * FLOATS_PER_ENTITY` |
| 2 | `test_new_entities_observed_after_grow` | After growing from 4 to 8, observing a 5th element succeeds without throwing capacity error |
| 3 | `test_rust_ts_capacity_aligned` | After grow, the Rust-side buffer length (via `core.ptr()`/view) and TS-side `bridge.capacity` match exactly |
| 4 | `test_grow_preserves_existing_data` | Entities observed before grow retain their position/size data in the buffer after grow completes |

## Must NOT
- Introduce auto-grow behavior (capacity changes only via explicit `grow()` call)
- Change rendering or physics logic
- Break the existing observe/unobserve flow for within-capacity operations
- Allow grow to a smaller capacity (shrink is not supported)

## Must DO
- Expose `grow(newCapacity)` on `LiquidDOMInstance`
- Coordinate Rust grow, bridge rebind, and observer view update in a single code path
- Preserve all existing entity data across grow
- Validate TS and Rust capacity are aligned after every grow
- Throw if grow is called on a destroyed instance or with invalid capacity

## Verification
- All 4 tests green
- Manual test: create instance with capacity 4, observe 4 elements, grow to 8, observe 4 more — all 8 render correctly
- No stale `Float32Array` views remain after grow (verified by buffer identity check)
