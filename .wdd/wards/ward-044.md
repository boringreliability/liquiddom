---
ward: 44
revision: null
name: "Impulse-Triggered Droplet Spawning"
epic: "element-physics-extensions"
status: "planned"
dependencies: [43]
layer: "typescript"
estimated_tests: 3
created: "2026-05-10"
completed: null
---
# Ward 044: Impulse-Triggered Droplet Spawning

## Scope
Tie FreeDrop spawning to the existing `impulse()` API: when `magnitude` exceeds a threshold, spawn 1–N droplets at the entity perimeter with velocities derived from impulse vector. Pure TS — leverages W43.

## Inputs
- W43 `instance.spawnDroplet(...)`
- `impulse()` in `ts/src/index.ts`

## Outputs
- Updated `impulse()` signature: optional `splash?: { threshold, count, jitter, lifetimeMs }`
- Default: no splash. Opt-in.

## Specification
- When `magnitude >= splash.threshold`, after writing impulse to buffer, call `spawnDroplet` `splash.count` times.
- Spawn positions: random points on the entity's perimeter (use buffer particle positions if available, else corners).
- Velocity: `direction * (magnitude * 0.3) + jitter * randomUnit()`.
- Spawned droplets respect global capacity. If pool full, silently skip.

## Tests
| # | Test Name | Verifies |
|---|-----------|----------|
| _Filled at approve_ | | |

## Must NOT
- Spawn droplets when `splash` is undefined (backwards compatible).
- Throw when capacity is exhausted — silently no-op.
- Require WebGPU.

## Must DO
- Demo scene "splash buttons" showing droplets fly off on hard impulse.
- Automatic cleanup when droplet exits viewport (delegated to W45).

## Verification
TS test: spawn impulse with splash, verify droplet count in buffer. Manual: hard-impulse demo button — droplets visibly fly off.
