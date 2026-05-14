---
ward: 44
revision: 2
name: "Impulse-Triggered Droplet Spawning"
epic: "element-physics-extensions"
status: "complete"
dependencies: [43, 45]
layer: "typescript"
estimated_tests: 7
created: "2026-05-10"
completed: "2026-05-14"
---
# Ward 044: Impulse-Triggered Droplet Spawning

## Scope
Tie FreeDrop spawning to the existing `impulse()` API: when `magnitude` exceeds a threshold AND `splash` is configured, spawn 1–N droplets at points on the entity's perimeter with velocities derived from the impulse vector + jitter. Pure TypeScript — leverages W43 (`spawnDroplet`) and W45 (auto-cull via lifetime).

W44 is purely about **opting impulse into spawning droplets**. Backwards-compatible: existing `impulse()` calls without `splash` behave exactly as today.

**FreeDrop visibility caveat (carried from W43/W45):** droplets exist in the WASM buffer and tick correctly, but `PhantomObserver.render()` doesn't iterate `dropletIds` yet. The demo scene won't show droplets until the rendering follow-up ward lands. W44's tests verify state, not visuals.

Out of scope:
- A visual demo scene (waiting on FreeDrop rendering follow-up).
- Changes to W31 Shake behavior — splash is purely additive.
- Custom spawn-position curves — fixed perimeter sampling for W44.
- Tying splash to anything other than `impulse()` (e.g., hover, focus).

## Inputs
- W43 `instance.spawnDroplet({ x, y, vx, vy, radius?, lifetimeMs? })`.
- W45 droplet auto-cull (lifetime expiry + viewport AABB).
- Existing `impulse()` at `packages/core/ts/src/index.ts:488-524`.
- Existing entity buffer layout: `slot[0..3]` = x, y, w, h (W42 + W43 conventions). Used to derive perimeter spawn points.

## Outputs
- Updated `impulse()` signature: optional `splash?: SplashOptions`.
- New `SplashOptions` interface exported from `index.ts`.
- `impulse()` body extended: after writing slot[5]=4 (Shake) + slot[6]/[7] (impulse vector), if `magnitude >= splash.threshold` AND `splash` defined, fire `spawnDroplet` `splash.count` times. Capacity-exceeded throws are caught silently.
- 7 new tests in a new file `packages/core/ts/__tests__/splash.test.ts`.

## Decisions (locked in this spec)
1. **`splash` is opt-in.** Backwards compatibility: `impulse(el, { magnitude: 50 })` without `splash` spawns zero droplets, identical to today's behavior. Test #1 locks this.
2. **Threshold gate.** `splash.threshold` (in `magnitude` units) — droplets spawn ONLY when `(options.magnitude ?? 10) >= splash.threshold`. Below threshold = silent zero spawns. Lets consumers set "hard impulse triggers splash, soft impulse doesn't."
3. **Spawn position: edge-centered perimeter sampling.** Distribute `count` spawn positions evenly around the bounding-rect perimeter using `t = (j + 0.5) / count` for `j = 0..count-1`. The `+ 0.5` centers samples within their arc segment. For the visually important `count=4` case this lands at the four mid-edges (mid-top, mid-right, mid-bottom, mid-left); `count=8` interleaves with the corners; etc. The `count=1` corner case lands at `t=0.5` which falls on the bottom-right corner (the start of the bottom edge in the top → right → bottom → left wrap-order) — acceptable since a single droplet from any deterministic perimeter point is visually neutral. Simpler than reading live particle positions, deterministic for testability.
4. **Velocity formula:** `vector = direction * magnitude * splash.speedScale + randomUnit() * splash.jitter`. `speedScale` defaults to `0.3` (per spec); `jitter` defaults to `0`. `randomUnit()` returns a uniformly-distributed unit vector in 2D — `Math.random() * 2π → cos/sin pair`. Sign of `direction` is preserved (impulse direction).
5. **Lifetime: `splash.lifetimeMs` passed through verbatim (undefined-safe).** No fallback in W44 — `spawnDroplet` owns the canonical default (5000 ms today). Reviewer caught: hardcoding `5000` here duplicates the default and creates drift hazard if W43/W45 ever retunes it. Same applies to `radius` (Decision §6).
6. **Radius: `splash.radius` passed through verbatim.** `spawnDroplet` owns the canonical default (4 today).
7. **Any throw from `spawnDroplet` aborts the remaining splash loop, silently.** Spec text loosened from "capacity-exceeded only" (r1) per reviewer: bare `catch {}` would swallow any future error class added to `spawnDroplet`. Treating ALL splash throws as "abandon remaining droplets" is acceptable because (a) the only current throw is capacity-exceeded, (b) splash is best-effort by design, and (c) the host's impulse state is already written by the time we reach the splash loop. Tests assert "no throw propagates to caller".
8. **Splash spawning runs ONCE per `impulse()` call, not per frame.** Decoupled from the Shake auto-reset timer — droplets are spawned synchronously inside `impulse()`, then tick independently via W43/W45.
9. **Randomness is `Math.random()`-driven.** No injected RNG for W44 — tests assert structural invariants (count, position within perimeter, velocity sign/magnitude bounds) rather than exact values. Acceptable for stochastic effects. A seedable RNG could be a future enhancement if reproducibility becomes important.
10. **Splash fires AFTER impulse buffer writes, BEFORE the auto-reset timer.** Order locked in so the splash sampler reads the same `slot[0..3]` values that the next tick will physics-step against — splash and host-impulse stay co-temporal. (Earlier framing claimed this was for "throw safety"; reviewer noted that's bogus since `try/catch` already prevents propagation. The real reason is buffer-read consistency.)
11. **No interaction with `liquid_type=4` (Shake) buffer semantics.** Splash droplets get their own slots (`liquid_type=6` FreeDrop). The element's own Shake remains active for `splash.lifetimeMs ?? 5000` ms only via the existing W31 timer (not extended by splash).

## Specification

### `SplashOptions` interface

```ts
export interface SplashOptions {
  /** Minimum `magnitude` required to fire splash. Below this → zero droplets. */
  threshold: number;
  /** Number of droplets to spawn (best-effort; capped by capacity). Required. */
  count: number;
  /** Random unit-vector jitter added to droplet velocity. Default 0. */
  jitter?: number;
  /** Scale applied to magnitude when deriving droplet speed. Default 0.3. */
  speedScale?: number;
  /** Lifetime per droplet (ms) — passed to spawnDroplet. Default 5000. */
  lifetimeMs?: number;
  /** Visual radius per droplet (px) — passed to spawnDroplet. Default 4. */
  radius?: number;
}
```

### Updated `impulse()` signature

```ts
impulse(element: HTMLElement, options?: {
  direction?: [number, number];
  magnitude?: number;
  duration?: number;
  splash?: SplashOptions;
}): void;
```

### Spawn-position sampler

Given entity rect `(x, y, w, h)` and `count` requested positions, compute `count` points evenly distributed around the perimeter:

```ts
function samplePerimeterPoint(t: number, x: number, y: number, w: number, h: number) {
  // t ∈ [0, 1) → walks the rect's edges in order: top → right → bottom → left.
  if (t < 0.25)      return [x + w * (t * 4),         y];
  else if (t < 0.5)  return [x + w,                    y + h * ((t - 0.25) * 4)];
  else if (t < 0.75) return [x + w - w * ((t - 0.5) * 4), y + h];
  else               return [x,                        y + h - h * ((t - 0.75) * 4)];
}
```

For `count` spawns, use **`t = (j + 0.5) / count`** for `j = 0..count-1`. The `+ 0.5` centers each sample within its arc segment — `count=4` lands at the four mid-edges. See Decision §3 for the `count=1` corner case (lands at bottom-right corner; visually neutral).

### Splash logic inside `impulse()`

```ts
// existing impulse logic writes slot[5..7] and schedules auto-reset…

const splash = options?.splash;
if (splash !== undefined && mag >= splash.threshold) {
  const buf = observer.getBuffer();
  const x = buf[off];
  const y = buf[off + 1];
  const w = buf[off + 2];
  const h = buf[off + 3];

  const speed = mag * (splash.speedScale ?? 0.3);
  const jitter = splash.jitter ?? 0;
  const radius = splash.radius ?? 4;
  const lifetimeMs = splash.lifetimeMs ?? 5000;

  for (let j = 0; j < splash.count; j++) {
    const t = (j + 0.5) / splash.count;
    const [px, py] = samplePerimeterPoint(t, x, y, w, h);
    const angle = Math.random() * Math.PI * 2;
    const vx = dx * speed + Math.cos(angle) * jitter;
    const vy = dy * speed + Math.sin(angle) * jitter;
    try {
      // observer.spawnDroplet is the right delegate — destroy-guard already
      // ran at the top of impulse(), and matches the codebase pattern of
      // calling observer-method directly from inside LiquidDOMInstance methods.
      observer.spawnDroplet({
        x: px,
        y: py,
        vx,
        vy,
        radius: splash.radius,
        lifetimeMs: splash.lifetimeMs,
      });
    } catch {
      break; // Any throw → pool exhausted (today the only path); abandon.
    }
  }
}

// existing auto-reset timer follows unchanged…
```

Note: `observer` is the closed-over `PhantomObserver` from `LiquidDOM.create()`. The codebase pattern (every other `LiquidDOMInstance` method in `index.ts`) is to call `observer.X(...)` directly rather than `this.X(...)`. Reviewer flagged the `this.spawnDroplet` form as a destructuring footgun.

### Defaults summary

| Field | Default | Note |
|---|---|---|
| `threshold` | (required) | Force the consumer to pick — splash without a threshold is a footgun. |
| `count` | (required) | Same reason. |
| `jitter` | `0` | Zero by default = clean directional spray. |
| `speedScale` | `0.3` | Per spec text. |
| `lifetimeMs` | inherits `spawnDroplet`'s default | W44 doesn't redefine — passes `undefined` through if unset. |
| `radius` | inherits `spawnDroplet`'s default | Same — single source of truth. |

**Note on `magnitude` interaction with `threshold`**: `impulse()` defaults `magnitude` to `10`. A consumer who sets `splash: { threshold: 5, count: 3 }` without specifying `magnitude` will see splash fire on every call (10 ≥ 5). Document this in the `splash` JSDoc to avoid surprise.

## Tests
All tests in new file `packages/core/ts/__tests__/splash.test.ts`. Mock `Math.random` where needed for determinism.

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `impulse_without_splash_spawns_zero_droplets` | `impulse(el, { magnitude: 100 })` (no splash) → `dropletIds.size === 0` and `availableIds` / `nextId` unchanged after call. Backwards-compat invariant. |
| 2 | `impulse_below_threshold_spawns_zero_droplets` | `impulse(el, { magnitude: 5, splash: { threshold: 10, count: 3 } })` → zero droplets (magnitude < threshold). |
| 3 | `impulse_above_threshold_spawns_requested_count` | `impulse(el, { magnitude: 50, splash: { threshold: 10, count: 4 } })` → `dropletIds.size === 4`. Each droplet's slot has `liquid_type === 6`. |
| 4 | `splash_spawns_at_perimeter_positions` | Mock entity at `(100, 100, 80, 40)`. `splash.count: 4`, `direction: [1, 0]`, `magnitude: 50`. With **edge-centered sampling** (`t = (j+0.5)/4` → `t = 0.125, 0.375, 0.625, 0.875`), the 4 droplets land at mid-top, mid-right, mid-bottom, mid-left. Verify each `slot[0]/[1]` lies on one of the four edges and the four points are distinct. |
| 5 | `splash_velocity_combines_direction_and_jitter` | Use `vi.spyOn(Math, "random").mockReturnValue(0)` so `angle = 0` → `cos=1, sin=0`. `impulse(el, { direction: [1, 0], magnitude: 100, splash: { threshold: 0, count: 1, jitter: 10, speedScale: 0.5 } })` → exactly 1 droplet, `slot[6] = vx = 1*100*0.5 + 1*10 = 60`, `slot[7] = vy = 0 + 0*10 = 0`. |
| 6 | `splash_silently_skips_when_capacity_exhausted` | Fresh instance with `capacity: 2`, observe 1 element (slot 0). `expect(() => instance.impulse(el, { magnitude: 50, splash: { threshold: 0, count: 5 } })).not.toThrow()`. `dropletIds.size === 1` (only the remaining slot 1 was free). |
| 7 | `splash_lifetime_and_radius_overrides_propagate` | `impulse(el, { magnitude: 50, splash: { threshold: 0, count: 1, lifetimeMs: 333, radius: 7 } })` → droplet's `slot[2]` (diameter) = 14, `slot[3]` (lifetime) = 333. Omitting them: `splash.lifetimeMs` undefined → spawnDroplet's default (5000) wins; `slot[3] === 5000`. |

After W44: 218 + 7 = **225 tests** (52 Rust + 173 TS).

## Must NOT
- Spawn droplets when `splash` is undefined (backwards compatible).
- Throw when capacity is exhausted — `try`/`catch` swallows the `spawnDroplet` throw and breaks the loop.
- Spawn droplets when `magnitude < splash.threshold`.
- Couple splash to Rust — pure TS additive to `impulse()`.
- Modify the existing W31 Shake timer (`impulseTimers`) — splash doesn't extend or alter impulse duration.
- Require an element to be a soft-body — but in practice, `impulse()` already throws on non-observed elements, so this is enforced upstream.

## Must DO
- Backwards-compatibility: every existing `impulse()` test in `liquiddom-api.test.ts` continues to pass without modification.
- Capacity safety: silent skip on capacity-exhausted, no propagated throw, no partial state corruption (auto-reset timer for Shake still fires).
- Spawn positions are on the element's perimeter at deterministic `t = j / count` offsets.
- Droplets inherit `splash.lifetimeMs` and `splash.radius` overrides; defaults match `spawnDroplet`.
- New `SplashOptions` type is exported from `index.ts` (re-export alongside `SpawnDropletOptions`).

## Risks & Mitigations
- **R1: Splash count of 0 or negative.** `for (let j = 0; j < splash.count; j++)` handles `count=0` as zero iterations naturally. Negative counts: same — loop never enters. No explicit guard needed.
- **R2: `magnitude` defaults to 10 when `impulse()` omits it.** Splash threshold check uses `mag = options?.magnitude ?? 10`. A splash with `threshold: 0` always fires regardless of magnitude. Documented behavior, not a bug.
- **R3: `Math.random` state isolation.** Splash uses 1 random number per droplet (the jitter angle). For 100 splash droplets in a frame that's 100 calls — negligible. No PRNG seeding required.
- **R4: Velocity overflow on extreme magnitudes.** `magnitude * speedScale` is a `number` in IEEE 754; no overflow concern for realistic `magnitude < 1e6`. Buffer slots are `Float32Array`, so very large magnitudes (`> ~3.4e38`) would saturate to `Infinity` and the cull math (`pos.x > vp.x + vp.w + margin`) would still work correctly (`Infinity > finite = true`).
- **R5: Stale buffer reads.** Splash reads `slot[0..3]` from the observer's buffer — same source the next tick uses. No staleness; impulse and splash see the same frame's data.
- **R6: Capacity-exhausted mid-loop.** Already handled by try/catch + break. Idempotent: existing spawns aren't rolled back, remaining spawns silently skipped. Test #6 locks this.
- **R7: Main-thread cost of large splash counts.** Splash runs synchronously in `impulse()`. `count: 200` executes ~200 `spawnDroplet` calls + buffer writes on the calling thread. Bound `count` to small values (recommended ≤ 32) in consumer code — W44 doesn't enforce a cap.
- **R8: Shake auto-reset cannot affect droplet slots.** The auto-reset `setTimeout` (existing W31 logic at `index.ts:516-521`) targets the IMPULSED entity's `id` only. Splash droplets occupy DIFFERENT slot ids (allocated fresh by `spawnDroplet`), so the reset cannot clobber `liquid_type=6` on a droplet. Correct-by-construction.

## Verification
1. `npm test -- packages/core/ts/__tests__/splash.test.ts` runs the 7 new tests.
2. Full verify: 52 Rust + 173 TS = 225 tests pass, 0 clippy warnings.
3. Manual: in a scratch app, call `instance.impulse(el, { magnitude: 100, splash: { threshold: 50, count: 6, jitter: 30 } })`. Inspect `instance.getBuffer()` — 6 droplet slots populated with `liquid_type=6` and velocities centered around the impulse direction with jitter spread. (No visible droplets until rendering follow-up ward.)
