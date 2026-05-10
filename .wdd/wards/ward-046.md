---
ward: 46
revision: null
name: "Device Orientation Gravity Vector"
epic: "element-physics-extensions"
status: "planned"
dependencies: []
layer: "both"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 046: Device Orientation Gravity Vector

## Scope
On mobile, the host page can opt into device-tilt-driven gravity: liquid sloshes in the direction the phone is tilted. TS owns the permission flow and event listener; Rust receives a per-frame `(gx, gy)` vector via `tick()`.

## Inputs
- `DeviceOrientationEvent` (browser API)
- Existing `tick()` signature

## Outputs
- New `LiquidOptions.gravity: { source: 'none' | 'orientation' | 'fixed', vector?: [number, number] }`
- `tick()` gains two parameters: `gravity_x`, `gravity_y` (m/s² scale, mapped to physics units in Rust)
- TS exposes `instance.requestOrientationPermission()` for iOS Safari

## Specification
- `source: 'none'` (default): gravity always `(0, 0)`. No regression.
- `source: 'fixed'`: use `vector` directly each frame.
- `source: 'orientation'`: TS subscribes to `deviceorientation`, maps `gamma` → x, `beta` → y, scales by configurable `strength` (default 0.5g).
- Rust applies `gravity * dt` to all active particles (Default and FreeDrop strategies). Skip during Dragged.
- iOS requires explicit permission via `DeviceOrientationEvent.requestPermission()` — call only on user gesture.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Auto-request iOS permission (must be user-gesture initiated).
- Apply gravity when `prefers-reduced-motion` is active.
- Default to gravity on (silent surprise).

## Must DO
- Unit test the gamma/beta → vector mapping in TS.
- Rust test: stationary particle drifts in gravity direction over time.

## Verification
Mobile demo scene that asks permission then visibly tilts the liquid in the buttons. Desktop: `gravity: { source: 'fixed', vector: [0, 9.8] }` produces the same visual.
