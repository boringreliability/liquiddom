---
ward: 46
revision: 2
name: "Device Orientation Gravity Vector"
epic: "element-physics-extensions"
status: "complete"
dependencies: [43, 45]
layer: "both"
estimated_tests: 8
created: "2026-05-10"
completed: "2026-05-15"
---
# Ward 046: Device Orientation Gravity Vector

## Scope
Gravity. Per-frame `(gravity_x, gravity_y)` is added to `tick()` and applied inside Rust as `velocity += gravity * dt` for selected strategies. TS owns the source: a fixed vector (desktop), a `DeviceOrientationEvent`-driven mapping (mobile tilt), or off. Opt-in; default off — no regression for current consumers.

The biggest visible payoff is FreeDrop: droplets currently fly in straight lines. With gravity they arc, fall, and accumulate believable physics. This was the immediate W56 follow-up question ("the droplets just fly away?").

**Units:** TS-side `vector` is in **px/s²** (pixels per second squared). The orientation source maps device angles → normalized `[-1, 1]` → multiplied by a configurable `strength` (default 980 px/s² ≈ 1 g at typical screen scale). Rust receives raw px/s² and integrates against `dt` in seconds. No m/s² unit conversion at the FFI boundary — TS owns the scale choice.

Out of scope:
- Per-droplet gravity override (all droplets share one global vector).
- Wind / fluid drag / non-conservative forces.
- 3D gravity (mobile devices have z-tilt; we only use 2D).
- Magnet/Tear strategies — they're stubs today, not active.

## Inputs
- W45 `tick()` signature (15 args; W46 grows to 17).
- W43 `FreeParticle::integrate(dt)` — extends to read shared gravity from tick().
- W22 `EntityBody::run_physics(...)` for soft-bodies — gravity applied to each particle's velocity before springs/repulsion.
- Existing `reducedMotion` detection at `packages/core/ts/src/index.ts` (used to gate `physicsDt`).
- `DeviceOrientationEvent` (browser API; iOS Safari requires explicit permission since iOS 13+).

## Outputs
- **Rust**:
  - `tick()` signature gains `gravity_x: f32, gravity_y: f32` (2 new args at the end, after the W45 viewport args).
  - `FreeParticle::integrate(dt, gravity_x, gravity_y)` — applies gravity then position integration.
  - `EntityBody::apply_gravity(dt, gravity_x, gravity_y)` — adds `gravity * dt` to every particle's velocity. Called from `tick()` for Default/Shake strategies; skipped for Dragged/Tween (Decision §5).
- **TS**:
  - New `LiquidOptions.gravity?: GravityOptions` (init-only; live-tuning deferred).
  - `GravityOptions` interface: `{ source: 'none' | 'fixed' | 'orientation', vector?: [number, number], strength?: number }`.
  - RAF loop computes `(gx, gy)` per frame and passes to `core.tick(...)`. Reduced-motion clamps to `(0, 0)`.
  - `instance.requestOrientationPermission(): Promise<boolean>` — wraps iOS-style `DeviceOrientationEvent.requestPermission()`. Returns `true` on grant or when no permission is required (browsers without the API), `false` on denial.
- `WasmCore.tick` interface signature gains 2 args.

## Decisions (locked in this spec)
1. **Gravity passed in `tick()` per frame, not via setter.** Same rationale as W45 §1: setter ordering pitfall. `tick()` already has `#[allow(clippy::too_many_arguments)]`; +2 args is fine.
2. **Units are px/s² at the FFI boundary.** TS owns the conversion if the consumer thinks in m/s². Spec doesn't expose meters anywhere.
3. **`source: 'none'` is the default.** Existing `LiquidDOM.create({...})` calls without `gravity` see `gravity = (0, 0)` every frame → zero regression. T6 locks this.
4. **`source: 'fixed'` uses `vector` verbatim.** If `vector` is omitted with `source: 'fixed'`, treat as `[0, 0]` (no-op equivalent to `source: 'none'`).
5. **`source: 'orientation'` maps `gamma → x, beta → y`.** Both are clamped to `[-90, 90]` then normalized to `[-1, 1]` via division by 90, then multiplied by `strength` (default 980 px/s²). The sign convention: positive `gamma` (device tilted right) → positive x; positive `beta` (device tilted away from user) → positive y. Documented; matches "the liquid pools toward the low edge of the screen" intuition.
6. **Strategy gating in Rust** — there are TWO independent layers:
   - **Gravity gate (the `matches!` set):** decides whether `body.apply_gravity(...)` runs. Applies when `strategy ∈ {Default, Shake, Magnet, Tear}`. Plus FreeDrop has its own integrate path that takes gravity directly. Skipped for **Dragged** and **Tween** — gravity would fight cursor/target-driven position.
   - **Strategy match (the existing `match strategy { ... }`):** dispatches physics shape (springs, neighbors, repulsion). Independent of the gate above. Magnet/Tear are stubs that fall through to `_ => run_physics(...)` — they receive gravity because they're in the `matches!` SET, not because of the match-arm fallthrough.
   - **Shake vs Tween asymmetry:** Shake adds an impulse to velocity then lets `run_physics` settle — gravity is just another velocity contribution the same springs handle. Tween writes a target position directly via `base_pos` and bypasses settling — gravity drift on top of a position-curve would visibly fight the curve. Hence Shake gets gravity, Tween does not.
7. **Reduced-motion clamps gravity to (0, 0).** Mirrors the existing `physicsDt = reducedMotion ? 0 : dt;` pattern. Without this, a static page with `prefers-reduced-motion: reduce` would still see droplets drift toward the gravity direction — counter to the user's accessibility intent.
8. **`requestOrientationPermission()` returns `true` when no permission is needed.** On Chrome/Firefox/non-iOS Safari, `DeviceOrientationEvent.requestPermission` is `undefined`. Method early-returns `true` so consumer code can be uniform across platforms.
9. **Orientation listener auto-attaches when `source === 'orientation'`.** No manual subscribe step. Listener is removed on `destroy()` to prevent leaks. iOS users must call `requestOrientationPermission()` from a user-gesture handler BEFORE orientation events start firing — but the listener is attached regardless (permission denial just means events never arrive).
10. **`strength` default `980 px/s²`.** Approximates 1 g at typical screen scale (~100 px/m, so 9.8 m/s² × 100 px/m ≈ 980 px/s²). Empirical; tuned for visible-but-not-overwhelming droplet acceleration.

## Specification

### `GravityOptions` interface

```ts
export interface GravityOptions {
  source: 'none' | 'fixed' | 'orientation';
  /** Used when source === 'fixed'. Units: px/s². Omitted with 'fixed' is treated as [0, 0]. */
  vector?: [number, number];
  /**
   * Multiplier for the normalized [-1, 1] orientation mapping. Units: px/s².
   * Default 980 (≈ 1 g at typical screen scale of 100 px/m, since 9.81 m/s² × 100 px/m ≈ 981).
   */
  strength?: number;
}
```

**Orientation sign convention** (Decision §5):
- `gamma` (device tilt left-right) → screen `x`. Positive gamma = top tilted right → positive gx → drift right.
- `beta` (device tilt front-back) → screen `y`. Positive beta = top tilted AWAY from user → positive gy. In CSS pixel coords, positive y is DOWN, so liquid pools at the bottom edge of the page — which IS the physical low edge when the top is tilted away. ✓
- Example: device flat → tilt top edge away from you, `beta = +30°`. Normalized: `+0.33`. With `strength=980`: `gravity_y = +326 px/s²` (down). Particles drift toward the bottom of the visible page.

Added to `LiquidOptions`:
```ts
export interface LiquidOptions {
  // …existing fields…
  /** Ward 046: gravity source for FreeDrop + soft-body particles. Default { source: 'none' }. */
  gravity?: GravityOptions;
}
```

### Rust changes

**`src/physics.rs`** — extend `FreeParticle::integrate` + add `EntityBody::apply_gravity`:
```rust
impl FreeParticle {
    pub fn integrate(&mut self, dt: f32, gravity_x: f32, gravity_y: f32) {
        self.velocity.x += gravity_x * dt;
        self.velocity.y += gravity_y * dt;
        self.pos += self.velocity * dt;
    }
    // is_expired() unchanged
}

impl EntityBody {
    pub fn apply_gravity(&mut self, dt: f32, gravity_x: f32, gravity_y: f32) {
        if gravity_x == 0.0 && gravity_y == 0.0 { return; }
        let g = Vec2::new(gravity_x, gravity_y);
        for particle in &mut self.particles {
            particle.velocity += g * dt;
        }
    }
}
```

**`src/api.rs`** — extend `tick()` signature; apply gravity per strategy:
```rust
#[allow(clippy::too_many_arguments)]
pub fn tick(
    &mut self,
    dt_ms: f32,
    pointer_x: f32, pointer_y: f32, pointer_active: bool,
    tension: f32, damping: f32, substeps: u32,
    repulsion_radius: f32, repulsion_strength: f32, neighbor_spring_k: f32,
    vp_x: f32, vp_y: f32, vp_w: f32, vp_h: f32, cull_margin: f32,
    gravity_x: f32, gravity_y: f32, // W46 additions
) {
    // …existing dt + iteration setup…

    for i in 0..self.buffer.capacity() {
        // …existing slice/skip checks…

        let liquid_type = slice[5];
        let strategy = dispatch_strategy(liquid_type);

        if strategy == PhysicsStrategy::FreeDrop {
            // …existing FreeDrop branch, but integrate() now takes gravity:
            part.integrate(dt, gravity_x, gravity_y);
            // …
            continue;
        }

        // Soft-body path:
        let body = self.bodies[i].get_or_insert_with(/* …W42 init… */);
        body.base_pos = Vec2::new(x, y);

        // W46: apply gravity BEFORE strategy physics (so springs/repulsion can react).
        // Skip for Dragged (cursor-driven) + Tween (target-driven).
        let apply_gravity = matches!(
            strategy,
            PhysicsStrategy::Default | PhysicsStrategy::Shake
                | PhysicsStrategy::Magnet | PhysicsStrategy::Tear,
        );
        if apply_gravity {
            body.apply_gravity(dt, gravity_x, gravity_y);
        }

        body.skip_rigid_translation = strategy == PhysicsStrategy::Dragged;
        match strategy {
            // …existing match arms unchanged…
        }
        // …existing particle write-back…
    }
}
```

### TS changes

**`packages/core/ts/src/wasm-bridge.ts`** — extend `WasmCore.tick`:
```ts
tick(
  dt: number, px: number, py: number, active: boolean,
  tension: number, damping: number, substeps: number,
  repulsionRadius: number, repulsionStrength: number, neighborSpringK: number,
  vpX: number, vpY: number, vpW: number, vpH: number, cullMargin: number,
  gravityX: number, gravityY: number, // W46
): void;
```

**`packages/core/ts/src/index.ts`** — gravity orchestration in `LiquidDOM.create`:
```ts
const gravityOpt = options?.gravity ?? { source: 'none' };
const gravityStrength = gravityOpt.strength ?? 980;

// Mutable per-frame vector. 'orientation' source writes here on each event;
// 'fixed' writes once at init; 'none' leaves it at zero.
let gravityX = 0;
let gravityY = 0;

if (gravityOpt.source === 'fixed' && gravityOpt.vector) {
  [gravityX, gravityY] = gravityOpt.vector;
}

let orientationListener: ((e: DeviceOrientationEvent) => void) | null = null;
if (gravityOpt.source === 'orientation' && typeof window !== 'undefined') {
  orientationListener = (e) => {
    const gamma = clamp(e.gamma ?? 0, -90, 90) / 90;  // [-1, 1]
    const beta = clamp(e.beta ?? 0, -90, 90) / 90;
    gravityX = gamma * gravityStrength;
    gravityY = beta * gravityStrength;
  };
  window.addEventListener('deviceorientation', orientationListener);
}

// In RAF loop:
const gx = reducedMotion ? 0 : gravityX;
const gy = reducedMotion ? 0 : gravityY;
core!.tick(
  physicsDt, pointerX, pointerY, pointerActive && !reducedMotion,
  physics.tension, physics.damping, physics.substeps,
  physics.repulsionRadius, physics.repulsionStrength, physics.neighborSpringK,
  0, 0, vp.w, vp.h, CULL_MARGIN_PX,
  gx, gy,
);

// In destroy():
if (orientationListener) {
  window.removeEventListener('deviceorientation', orientationListener);
}
```

`clamp(v, lo, hi)` — local helper:
```ts
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
```

**`LiquidDOMInstance.requestOrientationPermission()`** — public API:
```ts
async requestOrientationPermission(): Promise<boolean> {
  if (destroyed) throw new Error("Cannot requestOrientationPermission on a destroyed LiquidDOM instance");
  const evCtor = (window as unknown as {
    DeviceOrientationEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> };
  }).DeviceOrientationEvent;
  if (!evCtor || typeof evCtor.requestPermission !== 'function') {
    return true; // no permission required on this platform
  }
  try {
    const result = await evCtor.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}
```

Added to `LiquidDOMInstance` interface:
```ts
/**
 * Ward 046: prompt for device orientation permission (iOS 13+).
 *
 * **MUST be called from a user-gesture event handler** (e.g. button `click`) —
 * iOS WebKit silently denies non-gesture permission requests. Returns `true`
 * on grant or when no permission is required (Chrome, Firefox, non-iOS Safari).
 */
requestOrientationPermission(): Promise<boolean>;
```

Listener attachment ordering — wrap in init order so an early throw doesn't leak the listener:
```ts
// Inside LiquidDOM.create() — AFTER WASM init + canvas mount succeed
// (so any earlier throw doesn't leave an orphan listener):
let orientationListener: ((e: DeviceOrientationEvent) => void) | null = null;
if (gravityOpt.source === 'orientation' && typeof window !== 'undefined') {
  orientationListener = (e) => {
    const gamma = clamp(e.gamma ?? 0, -90, 90) / 90;
    const beta = clamp(e.beta ?? 0, -90, 90) / 90;
    gravityX = gamma * gravityStrength;
    gravityY = beta * gravityStrength;
  };
  window.addEventListener('deviceorientation', orientationListener);
}
```

## Tests

| # | Test Name | Layer | Verifies |
|---|-----------|-------|----------|
| 1 | `test_freedrop_gravity_drift` | Rust | Stationary FreeDrop at `(50, 50)`, velocity `(0, 0)`. After tick 1 (`dt_ms=1000, gy=100`): semi-implicit Euler yields `velocity.y = 0 + 100*1 = 100`, then `pos.y = 50 + 100*1 = 150`. After tick 2: `velocity.y = 100 + 100 = 200`, `pos.y = 150 + 200 = 350`. Assert exact values. |
| 2 | `test_softbody_gravity_drift` | Rust | Soft-body slot (liquid_type=0) at `(100, 100, 50, 30)`. Run 60 ticks at `dt_ms=16.67, gx=100, gy=0`. Compare centroid x against a parallel scenario with `gx=0`: gravity scenario's centroid x is at least 10 px greater. Tolerance: `> 10 px diff`. |
| 3 | `test_gravity_skip_dragged` | Rust | Two parallel scenarios with identical Dragged setup (`liquid_type=3`). Scenario A: `tick(..., gx=0, gy=0)`. Scenario B: `tick(..., gx=100, gy=100)`. After 10 ticks, assert each particle's velocity (x, y) is identical between A and B within `1e-5`. Requires `peek_body_particle_velocity(slot, j)` test-only accessor on LiquidCore. |
| 4 | `gravity_fixed_vector_passes_to_tick` | TS | Spy on `core.tick`. Construct with `gravity: { source: 'fixed', vector: [50, 980] }`. After one RAF tick, last call to `tick()` had `gravityX === 50, gravityY === 980`. |
| 5 | `gravity_source_none_passes_zero` | TS | Default options (no gravity). Spy verifies `gx === 0, gy === 0` in tick() call. |
| 6 | `gravity_orientation_beta_gamma_mapping` | TS | Construct with `gravity: { source: 'orientation', strength: 980 }`. Dispatch a fake `deviceorientation` event with `gamma: 45, beta: 30`. Next RAF tick: `expect(gx).toBeCloseTo(490, 3)` and `expect(gy).toBeCloseTo(326.667, 2)` (floating-point tolerance — exact `===` is unsafe for `(30/90)*980`). |
| 7 | `gravity_reduced_motion_clamps_to_zero` | TS | Force `prefers-reduced-motion: reduce` via `LiquidOptions.forceReducedMotion: true`. With `gravity: { source: 'fixed', vector: [100, 100] }`. Spy verifies `gx === 0, gy === 0` (gravity clamped despite non-zero fixed vector). |
| 8 | `requestOrientationPermission_handles_unsupported` | TS | Two sub-cases: (a) jsdom default — `window.DeviceOrientationEvent` is `undefined` → `!evCtor` branch → returns `true`. (b) Explicit stub `(window as any).DeviceOrientationEvent = function() {}` (no `requestPermission` static) → `typeof evCtor.requestPermission !== 'function'` branch → returns `true`. Restore in `afterEach`. |
| 9 | `gravity_orientation_listener_removed_on_destroy` | TS | Spy on `window.removeEventListener`. Construct with `gravity: { source: 'orientation' }`, then `instance.destroy()`. Verify `removeEventListener` was called with `'deviceorientation'` and the SAME function reference passed to `addEventListener` (captured via a spy on `addEventListener`). Locks R6. |
| 10 | `gravity_fixed_without_vector_is_zero` | TS | Construct with `gravity: { source: 'fixed' }` (no `vector` field). Spy verifies `gx === 0, gy === 0` in tick() call. Locks Decision §4. |

After W46: 232 + 10 = **242 tests** (55 Rust + 187 TS — Rust grows by 3, TS by 7).

## Must NOT
- Auto-request iOS permission (Decision §9 + iOS WebKit policy). Must be user-gesture-initiated.
- Apply gravity when `prefers-reduced-motion` is active (T7 locks).
- Default to gravity on (Decision §3 — `source: 'none'` default).
- Apply gravity to Dragged or Tween strategies (Decision §6).
- Add new buffer slots — gravity is per-tick scalar, not per-entity.
- Change `FreeParticle`'s integration order (`velocity += g*dt` before `pos += velocity*dt` — semi-implicit Euler, matches the existing soft-body integration).
- Hold a reference to the `DeviceOrientationEvent` after the handler returns — only `gamma`/`beta` numbers are read.

## Must DO
- Existing `LiquidDOM.create({...})` calls without `gravity` see zero behavior change (T5).
- Soft-body, FreeDrop, and Shake strategies see gravity; Dragged and Tween do not (T1, T2, T3).
- `prefers-reduced-motion` clamps gravity to (0, 0) (T7).
- `destroy()` removes the `deviceorientation` listener.
- `requestOrientationPermission()` works cross-platform (T8 locks the no-op-on-Chrome path).
- Existing W43 (FreeDrop), W44 (splash), W45 (cull) tests continue to pass (now with the 17-arg `tick()` signature — call sites updated).

## Risks & Mitigations
- **R1: 17-arg `tick()` is large.** `#[allow(clippy::too_many_arguments)]` already in place. A `TickArgs` struct refactor is a candidate for a future cleanup ward (alongside W45's similar size). Out of W46 scope.
- **R2: Existing `tick()` call sites must update.** Found via `grep "core.tick("` + `grep "core!.tick("` + `grep "wasm.tick("`. Three production sites + tests. Spec's test plan T4-T7 verifies the production call sites; existing `ffi-integration.test.ts` (W45 updated to 15 args) needs another bump to 17.
- **R3: `DeviceOrientationEvent` not available in jsdom.** TS tests T6 must dispatch a synthetic event via `new Event('deviceorientation')` with `gamma`/`beta` patched on the event object. T8 stubs `window.DeviceOrientationEvent` directly. No real device required.
- **R4: Strength default of 980 px/s² may be too strong for tiny droplets.** Acceptable for v1 — consumers can override via `strength`. Empirical tuning is a follow-up if needed.
- **R5: Tween + gravity interaction.** Decision §6 skips gravity for Tween. But what if a consumer enables gravity globally and also tweens an element? The element's particles will NOT receive gravity during the tween (target-driven). After tween ends and strategy reverts to Default, gravity resumes. Documented behavior; not a bug.
- **R6: Orientation event listener attached even before permission grant on iOS.** No-op until permission granted (events simply don't fire). Removed on `destroy()`. Acceptable footprint.
- **R7: Reduced-motion gate runs every frame.** O(1) check (boolean read). Negligible. Note: existing `MediaQueryList.change` listener in `index.ts:271-275` already propagates OS-level reduced-motion toggling to the `reducedMotion` flag, so the gravity clamp follows automatically. Runtime mutation of `forceReducedMotion` (init-only option) is out of scope; tracked separately.
- **R8: `DeviceOrientationEvent` requires HTTPS in modern browsers.** Chrome 91+, iOS 12.2+ enforce secure context for orientation events. `localhost` is exempt (dev). Plain-HTTP production deploys will silently see zero events. Document in the public API JSDoc for `source: 'orientation'` consumers.

## Verification
1. `cargo test physics::tests::test_freedrop_gravity_drift test_softbody_gravity_drift test_gravity_skip_dragged` — Rust tests T1-T3.
2. `npm test -- packages/core/ts/__tests__/gravity.test.ts` — TS tests T4-T8.
3. Full verify: 55 Rust + 185 TS = 240 tests pass. 0 clippy warnings.
4. **Manual smoke test (desktop):** Open `demo/scenes/splash-buttons.html` modified to construct with `gravity: { source: 'fixed', vector: [0, 800] }`. Click "Explosion" — droplets should arc upward, then fall, instead of flying straight up off-screen. Lifetime cull still applies (~3.5s).
5. **Manual smoke test (mobile):** Build the demo, open on iOS Safari, tap a permission-prompt button that calls `instance.requestOrientationPermission()`. Tilt the phone — droplets and soft-body blobs should slosh in the tilt direction.
