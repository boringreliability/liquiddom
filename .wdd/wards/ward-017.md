---
ward: 17
revision: null
name: "Hidden-Tab, Large-dt, and Pause/Resume Controls"
epic: "runtime-resilience"
status: "planned"
dependencies: [14]
layer: "typescript"
estimated_tests: 4
created: "2026-03-31"
completed: null
---
# Ward 017: Hidden-Tab, Large-dt, and Pause/Resume Controls

## Scope
Clamp the frame delta-time to a safe maximum (e.g. 50 ms) to prevent physics explosions after tab-backgrounding or debugger pauses. Add explicit `pause()` / `resume()` lifecycle methods and wire them to the Page Visibility API so the simulation automatically pauses when the tab is hidden and resumes when it becomes visible again.

## Inputs
- Runtime lifecycle and RAF loop from Ward 014 (teardown / idempotent lifecycle)
- `requestAnimationFrame` timestamp deltas
- `document.visibilityState` and `visibilitychange` event

## Outputs
- `MAX_DT` constant (50 ms default, configurable)
- `pause()` and `resume()` public API methods on the runtime instance
- `isPaused` readonly state flag
- Automatic visibility-change listener that calls pause/resume
- Defined pointer/interaction state behaviour across pause/resume boundaries (pointer state frozen on pause, re-evaluated on resume)

## Specification

### dt Clamping
- Before each physics step, clamp `dt = Math.min(rawDt, MAX_DT)`.
- `MAX_DT` defaults to 50 ms but is overridable via config.
- If `rawDt` exceeds `MAX_DT`, the excess time is silently discarded (no accumulation or sub-stepping).

### Pause / Resume API
- `pause()`: cancels the pending RAF, sets `isPaused = true`. Calling `pause()` while already paused is a no-op.
- `resume()`: resets the last-timestamp so the first resumed frame sees `dt ≈ 0` (not the wall-clock gap), requests a new RAF, sets `isPaused = false`. Calling `resume()` while already running is a no-op.
- Pointer/interaction state is frozen at the moment of pause. On resume, pointer state remains frozen until the next real pointer event arrives.

### Visibility Integration
- On `visibilitychange`: if `document.visibilityState === 'hidden'` call `pause()`; if `'visible'` call `resume()`.
- The listener is registered in the runtime start phase and removed on teardown (Ward 014 contract).

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_dt_clamped_after_large_gap` | When rawDt exceeds MAX_DT, the physics step receives MAX_DT |
| 2 | `test_pause_stops_raf` | Calling pause() cancels the pending RAF and sets isPaused true |
| 3 | `test_resume_restarts_cleanly` | Calling resume() after pause restarts the loop with dt near zero |
| 4 | `test_visibility_hidden_triggers_pause` | A simulated visibilitychange to "hidden" calls pause; "visible" calls resume |

## Must NOT
- Accumulate or sub-step excess dt — discard it
- Allow physics to receive unbounded dt values
- Leak the visibilitychange listener after teardown
- Mutate pointer state during pause (freeze it)

## Must DO
- Clamp dt to MAX_DT on every frame before physics
- Provide idempotent pause() and resume() (safe to call repeatedly)
- Reset last-timestamp on resume so first frame dt is near zero
- Register visibilitychange listener on start, remove on teardown
- Expose isPaused as readonly state

## Verification
- All 4 tests green
- Manual test: background tab for 10+ seconds, return — no physics explosion, smooth resume
