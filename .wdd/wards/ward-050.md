---
ward: 50
revision: null
name: "Web Worker Offload (Optional)"
epic: "framework-adapters-dx"
status: "planned"
dependencies: []
layer: "typescript"
estimated_tests: 4
created: "2026-05-10"
completed: null
---
# Ward 050: Web Worker Offload (Optional)

## Scope
Move the WASM tick onto a Web Worker behind an opt-in `useWorker: true` flag. Main thread continues handling DOM observation and rendering. Two-thread design with shared `WebAssembly.Memory` (`SharedArrayBuffer`) so no per-frame postMessage of buffer data.

## Inputs
- `WasmBridge` ownership of `WebAssembly.Memory`
- `LiquidCore.tick()` entry point

## Outputs
- `ts/src/worker/tick-worker.ts` — Worker entry that owns the WASM instance
- New `WasmBridge.Worker` variant that posts pointer/control messages instead of calling `core.tick()` directly
- `LiquidOptions.useWorker?: boolean` (default false)

## Specification
- Requires cross-origin isolation (COOP/COEP headers) for `SharedArrayBuffer`. Document as a deployment requirement.
- Without isolation, fall back to single-threaded mode and warn once.
- Per-frame: main thread posts `{ kind: 'tick', dt, pointer, config }`; worker computes; main thread reads particles directly from shared memory after a `Atomics.wait`-based handshake or a `postMessage` ack.
- Initial implementation: `postMessage` ack — `Atomics.wait` is a follow-up perf optimization.
- DESTROY sequence must terminate worker before freeing WASM.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Increase main-bundle weight when `useWorker: false`.
- Break SSR (Worker is always client-only).
- Introduce data races on the entity buffer (TS writes only when worker is idle).

## Must DO
- Bundle the worker via Vite/Rolldown's `?worker` import so it's drop-in.
- Detect missing COOP/COEP and document the warning.
- Match single-threaded output frame-for-frame in a determinism test.

## Verification
A/B page with `useWorker: false` vs `true`. Frame-time monitor shows main-thread idle when worker is on. Determinism test passes.
