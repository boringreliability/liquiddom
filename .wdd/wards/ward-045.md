---
ward: 45
revision: 2
name: "Droplet Culling & Lifetime Management"
epic: "element-physics-extensions"
status: "complete"
dependencies: [43]
layer: "both"
estimated_tests: 10
created: "2026-05-10"
completed: "2026-05-14"
---
# Ward 045: Droplet Culling & Lifetime Management

## Scope
Close the W43 caveat "droplets accumulate forever, no culling yet". A FreeDrop slot is automatically deactivated when its center exits the viewport AABB (plus `cull_margin`) OR when its `lifetime_ms` reaches 0. Deactivated slots are reclaimed for future `spawnDroplet` calls. Adds a public `despawnDroplet(id)` API for explicit deletion.

**W45 is pure state-management.** FreeDrop slots are NOT currently rendered — the existing `PhantomObserver.render()` loop iterates only `idToElement` (soft-body slots), excluding `dropletIds`. W45 keeps the buffer state correct (cull, lifetime, slot reuse); making droplets visible is a follow-up (small render-loop extension, not in W45 scope). Manual verification is via buffer-state assertions and test scaffolds, not visual demo.

Soft-body entities are NOT subject to viewport-cull — they have DOM anchors and follow the page off-screen. Lifetime applies only to FreeDrop.

Out of scope:
- Fade-out animation when culled. Slot deactivates instantly.
- Soft-body culling — soft-bodies remain DOM-anchored. Viewport-cull for them is a render-time optimization already in W18.
- **Visible rendering of FreeDrop slots** — droplets exist in the WASM particle buffer but the canvas renderer doesn't iterate `dropletIds` yet. Tracked as a follow-up ward.
- Multi-pass culling across `grow()` — capacity changes still wipe state.

## Inputs
- W43 FreeDrop slots (`liquid_type=6`, `free_particles: Vec<Option<FreeParticle>>`).
- `LiquidCore::release_slot(id)` for slot teardown (W43).
- `dt_ms` already passed to `tick()` — usable directly for lifetime decrement.
- `LiquidDOM.create()` already computes `viewportSize` per frame via `getViewportSize()`. Used today for canvas resize + render-cull; W45 also passes it into `tick()`.

## Outputs
- **Rust**:
  - `FreeParticle.lifetime_ms: f32` field (initial state read from buffer slot at lazy-init).
  - `tick()` signature gains 5 parameters: `vp_x, vp_y, vp_w, vp_h, cull_margin` (already has `#[allow(clippy::too_many_arguments)]`). No setter pattern — viewport-per-frame is naturally a tick() arg and avoids the ordering pitfall in R1 of r1.
  - FreeDrop branch extended: after `integrate(dt)`, decrement `lifetime_ms -= dt_ms`. If `lifetime_ms <= 0` OR `pos` is outside viewport+margin, deactivate the slot by setting `slice[2] = slice[3] = 0` AND clearing `free_particles[i] = None`.
- **TS**:
  - `SpawnDropletOptions.lifetimeMs?: number` (default 5000). Written to **buffer slot[3]** at spawn (NOT slot[4]). Decision §3.
  - `PhantomObserver.spawnDroplet` reused-slot scan: when no `availableIds` entry exists, scan `dropletIds` for entries whose buffer slot has `slot[2] === 0` (Rust-culled). Recycle the first hit.
  - `PhantomObserver.despawnDroplet(id: number): void` — TS-side explicit deletion.
  - `LiquidDOMInstance.despawnDroplet(id: number): void` — public wrapper with destroy guard.
  - `LiquidDOM.create()` RAF loop passes viewport into `tick()` each frame.

## Decisions (locked in this spec)
1. **Viewport passed in `tick()`, not a setter.** r1 proposed `set_viewport()` but the ordering pitfall (forget the setter → cull silently disabled) is a class of bug the spec must not create. `tick()` already carries 10 args + `#[allow(clippy::too_many_arguments)]`; +5 is fine. One wasm-bindgen call per frame, no ordering risk.
2. **Lifetime lives in `FreeParticle.lifetime_ms`, initial value read from slot[3] ONCE.** Rust owns it after lazy-init. Read-once invariant matches W43's slot[6]/[7] (initial velocity) pattern.
3. **Lifetime uses slot[3], NOT slot[4].** W43 made slot[2]=slot[3]=diameter (cosmetic redundancy — Rust only reads slot[2]). Reclaiming slot[3] for lifetime costs nothing visually and preserves slot[4] (interaction_state) for future hover/focus extension on droplets. **Active-marker stays slot[2]==0** (W43 invariant preserved).
4. **Center-based cull is the FreeDrop coordinate semantics.** For FreeDrop, `slot[0]/[1]` is the particle **center** (W43 wrote `Vec2::new(x, y)` directly into `FreeParticle.pos`). The existing W18 render-cull at `phantom-observer.ts:524-534` treats `slot[0]/[1]` as the **top-left corner** of a soft-body rect. The two layers consistently disagree, but since the W18 render-cull iterates `idToElement` only and excludes droplets, the mismatch is moot today. If a future render ward extends the loop to droplets, IT will handle FreeDrop's center semantics explicitly.
5. **`SpawnDropletOptions.x/y` are in the same coord frame as `observer.sync()` writes for soft-bodies.** That is: viewport-relative in fullscreen mode, container-relative in container mode. The viewport passed to `tick()` is `(0, 0, vp.w, vp.h, cullMargin)` always — the container's translation is already absorbed by `observer.setCoordOffset()` upstream, so buffer-space and viewport-space coincide.
6. **Deactivation sets `slice[2] = slice[3] = 0`.** Matches existing skip-condition (`api.rs:96`). Clears `free_particles[i]` for invariant cleanliness (W43 Decision §1). slot[3] zeroing also clears lingering lifetime data.
7. **`spawnDroplet` allocator order: availableIds → scan → nextId.** Explicit unified post-allocation flow: regardless of source, `releaseSlot(id)` is called, `dropletIds.add(id)`, buffer slot fully written. No double-clear.
8. **`scanForFreedDropletSlot` iterates `dropletIds`, not `0..nextId`.** Bounded by spawn count. A `w==0` slot whose id is still in `dropletIds` was deactivated by Rust cull (TS-driven cull via `despawnDroplet` removes from `dropletIds` immediately, so it's never seen by the scan).
9. **`despawnDroplet(id)` is idempotent and silent on non-droplet ids.** `dropletIds.has(id)` is the gate. Calling on a soft-body id or a previously-despawned id is a no-op. Mirrors W14 `unobserve` idempotency.
10. **No fade-out.** Instant deactivation. Possible v2 if a use case emerges.
11. **Render ordering: render last frame THEN check cull.** The FreeDrop tick branch writes the 16 particle positions for the CURRENT pos BEFORE the cull check. A freshly-culled droplet still renders its final frame (when rendering is added in the follow-up). Lock this in Test #9.
12. **`cull_margin = 100` per frame** (constant in TS RAF loop, matching the existing W18 render-cull default at `index.ts:358`). Configurable via a future `LiquidOptions.cullMargin` if needed; not in W45 scope.
13. **Renewing lifetime requires despawn + respawn.** The respawn returns a new id (slot may be the same after recycling, but conceptually it's a new entity). Callers holding ids across a renewal must update them.

## Specification

### Rust changes

**`src/physics.rs`** — extend `FreeParticle`:
```rust
#[derive(Debug, Clone)]
pub struct FreeParticle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub radius: f32,
    pub lifetime_ms: f32,  // NEW (W45)
}

impl FreeParticle {
    pub fn new(pos: Vec2, velocity: Vec2, radius: f32, lifetime_ms: f32) -> Self {
        Self { pos, velocity, radius, lifetime_ms }
    }

    pub fn integrate(&mut self, dt: f32) {
        self.pos += self.velocity * dt;
    }

    pub fn is_expired(&self) -> bool {
        self.lifetime_ms <= 0.0
    }
}
```

**`src/api.rs`** — extend `tick()` signature + FreeDrop cull branch:
```rust
#[allow(clippy::too_many_arguments)]
pub fn tick(
    &mut self,
    dt_ms: f32,
    pointer_x: f32,
    pointer_y: f32,
    pointer_active: bool,
    tension: f32,
    damping: f32,
    substeps: u32,
    repulsion_radius: f32,
    repulsion_strength: f32,
    neighbor_spring_k: f32,
    // W45 additions:
    vp_x: f32,
    vp_y: f32,
    vp_w: f32,
    vp_h: f32,
    cull_margin: f32,
) {
    // existing dt + pointer setup…
    let viewport = (vp_x, vp_y, vp_w, vp_h, cull_margin);

    for i in 0..self.buffer.capacity() {
        // existing slice read + w==0 skip…

        if strategy == PhysicsStrategy::FreeDrop {
            // existing debug_assert + lazy init.
            // W45: slot[3] is lifetime (NOT diameter; slot[2] is the diameter).
            let part = self.free_particles[i].get_or_insert_with(|| {
                FreeParticle::new(
                    Vec2::new(x, y),
                    Vec2::new(slice[6], slice[7]),
                    w * 0.5,                  // radius = diameter / 2 (W43 §8)
                    slice[3],                 // lifetime_ms (W45 §3)
                )
            });
            part.integrate(dt);
            part.lifetime_ms -= dt_ms;

            // Capture render state BEFORE the cull check / borrow release.
            let pos = part.pos;
            let radius = part.radius;
            let expired = part.is_expired();
            // Drop the &mut self.free_particles[i] borrow before mutating other fields:
            // the get_or_insert_with reference is released at end of the let binding above
            // because we don't reuse `part` after this point.

            // Render last frame (Decision §11).
            let offset = i * PARTICLE_FLOATS_PER_BODY;
            let n = PARTICLES_PER_BODY as f32;
            for j in 0..PARTICLES_PER_BODY {
                let theta = (j as f32) * std::f32::consts::TAU / n;
                self.particle_data[offset + j * 2]     = pos.x + theta.cos() * radius;
                self.particle_data[offset + j * 2 + 1] = pos.y + theta.sin() * radius;
            }

            // Cull check.
            let aabb_cull = is_outside_viewport(pos, viewport);
            if expired || aabb_cull {
                let slice_mut = self.buffer.entity_slice_mut(i);
                slice_mut[2] = 0.0;
                slice_mut[3] = 0.0;
                self.free_particles[i] = None;
            }
            continue;
        }
        // existing soft-body path (unchanged) — viewport args are ignored for soft-body.
    }
}
```

Helper function:
```rust
fn is_outside_viewport(pos: Vec2, vp: (f32, f32, f32, f32, f32)) -> bool {
    let (x, y, w, h, m) = vp;
    pos.x < x - m || pos.y < y - m || pos.x > x + w + m || pos.y > y + h + m
}
```

### TS changes

**`packages/core/ts/src/phantom-observer.ts`** — extend `SpawnDropletOptions`, slot scan, `despawnDroplet`:
```ts
export interface SpawnDropletOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius?: number;
  /** W45: ms before auto-despawn. Default 5000. */
  lifetimeMs?: number;
}

spawnDroplet(opts: SpawnDropletOptions): number {
  // Allocator priority: availableIds (LIFO) > scan-for-Rust-culled > fresh nextId.
  let id: number;
  if (this.availableIds.length > 0) {
    id = this.availableIds.pop()!;
  } else {
    const scanned = this.scanForFreedDropletSlot();
    if (scanned !== undefined) {
      id = scanned;
    } else {
      const wouldBe = this.nextId;
      if (wouldBe >= this._capacity) {
        throw new Error(`PhantomObserver capacity exceeded: ${this._capacity} slots max`);
      }
      id = this.nextId++;
    }
  }
  // Unified post-allocation flow.
  this.releaseSlot?.(id);
  this.dropletIds.add(id);

  const radius = opts.radius ?? 4;
  const lifetimeMs = opts.lifetimeMs ?? 5000;
  const diameter = radius * 2;
  const off = id * FLOATS_PER_ENTITY;
  this.buffer[off]     = opts.x;
  this.buffer[off + 1] = opts.y;
  this.buffer[off + 2] = diameter;      // W43: active-marker + visual diameter
  this.buffer[off + 3] = lifetimeMs;    // W45: lifetime (was: diameter symmetry, now real data)
  this.buffer[off + 4] = 0;             // interaction_state (reserved for future FreeDrop hover)
  this.buffer[off + 5] = 6.0;           // liquid_type = FreeDrop
  this.buffer[off + 6] = opts.vx;       // initial vx
  this.buffer[off + 7] = opts.vy;       // initial vy
  this.buffer[off + 8] = 0;
  return id;
}

private scanForFreedDropletSlot(): number | undefined {
  // A w==0 slot whose id is still in dropletIds was deactivated by Rust cull
  // (despawnDroplet removes from dropletIds before zeroing the buffer).
  for (const id of this.dropletIds) {
    if (this.buffer[id * FLOATS_PER_ENTITY + 2] === 0) {
      this.dropletIds.delete(id);
      return id;
    }
  }
  return undefined;
}

despawnDroplet(id: number): void {
  if (!this.dropletIds.has(id)) return;
  this.dropletIds.delete(id);
  this.releaseSlot?.(id);
  const off = id * FLOATS_PER_ENTITY;
  this.buffer.fill(0, off, off + FLOATS_PER_ENTITY);
  this.availableIds.push(id);
}
```

**`packages/core/ts/src/wasm-bridge.ts`** — extend `WasmCore.tick` signature:
```ts
tick(
  dt: number, px: number, py: number, active: boolean,
  tension: number, damping: number, substeps: number,
  repulsionRadius: number, repulsionStrength: number, neighborSpringK: number,
  vpX: number, vpY: number, vpW: number, vpH: number, cullMargin: number,
): void;
```

**`packages/core/ts/src/index.ts`** — public API + RAF loop:
```ts
// In LiquidDOMInstance interface:
/** W45: explicitly remove a droplet. No-op if id is not a droplet slot. */
despawnDroplet(id: number): void;

// In the instance object:
despawnDroplet(id: number): void {
  if (destroyed) throw new Error("Cannot despawnDroplet on a destroyed LiquidDOM instance");
  observer.despawnDroplet(id);
}

// In the RAF loop, replace:
//   core!.tick(physicsDt, …existing args…);
// with:
const CULL_MARGIN_PX = 100;
const vp = getViewportSize();
core!.tick(
  physicsDt,
  pointerX, pointerY, pointerActive && !reducedMotion,
  physics.tension, physics.damping, physics.substeps,
  physics.repulsionRadius, physics.repulsionStrength, physics.neighborSpringK,
  0, 0, vp.w, vp.h, CULL_MARGIN_PX,
);
```

## Tests
5 Rust tests in `src/api.rs::tests`, 5 TS tests in `packages/core/ts/__tests__/free-drop.test.ts`.

| # | Test Name | Layer | Verifies |
|---|-----------|-------|----------|
| 1 | `test_freedrop_culls_off_screen` | Rust | `tick(..., vp=0,0,100,100, cullMargin=10)`. Spawn at (50, 50) velocity (200, 0). After `tick(dt_ms=1000)`, pos crosses x=200 > 100+10 margin → buffer slot[2] == 0, `free_particle_is_some(0) == false`. |
| 2 | `test_freedrop_lifetime_expiry` | Rust | Slot[3] (lifetime) = 100 ms, velocity (0, 0). After `tick(dt_ms=200)`, slot deactivated despite stationary pos. |
| 3 | `test_cull_does_not_affect_soft_body` | Rust | Soft-body slot (`liquid_type=0`) at far-off pos `(99999, 99999)` with `tick(..., vp=0,0,100,100, m=10)`. After `tick()`, `body_is_some(0) == true`, slice[2]/[3] unchanged. |
| 4 | `test_freedrop_lifetime_read_once_at_init` | Rust | After lazy init, mutating slot[3] to a fresh value is IGNORED by Rust (lifetime lives in `FreeParticle.lifetime_ms`, not buffer). Spawn FreeDrop with slot[3]=1000, tick 100 ms → remaining ~900 ms. Rewrite slot[3]=999999, tick 1000 ms → expired because original lifetime was the source of truth. Locks Decision §2 read-once invariant. (Originally proposed in r2 as `test_cull_disabled_when_viewport_zero_width_or_height`; the read-once test is more load-bearing since `tick_no_cull` helper already exercises the huge-margin convention across all other tests.) |
| 5 | `test_freedrop_renders_last_frame_then_culls` | Rust | Spawn FreeDrop at viewport edge; `tick()` moves it across the margin. Verify `particle_data` for that slot reflects the OUT-OF-VIEWPORT pos (last-frame render) AND `slice[2] == 0` AFTER. Locks Decision §11. |
| 6 | `spawnDroplet_reuses_rust_culled_slots` | TS | Spawn 2 droplets at capacity 2 → ids 0, 1. Manually zero `buffer[off+2]` for slot 0 (simulate Rust cull). Third `spawnDroplet` returns id 0 (recycled via scan), not throw. `dropletIds.has(0) === true`, fresh data written. |
| 7 | `spawnDroplet_prefers_availableIds_over_scan` | TS | Capacity 2. Spawn 2 droplets (ids 0, 1). `despawnDroplet(0)` → `availableIds=[0]`. Zero `buffer[off+2]` for slot 1 (Rust-culled). Third spawn returns **0** (availableIds wins, LIFO), NOT 1 (scan would also return it). Asserts allocator priority Decision §7. |
| 8 | `despawnDroplet_removes_slot_and_recycles_id` | TS | Spawn droplet → id=N. `dropletIds.has(N)===true`. `instance.despawnDroplet(N)` → `dropletIds.has(N)===false`, `availableIds` contains N, buffer slot zeroed, `releaseSlot` spy called with N. Subsequent `despawnDroplet(N)` is silent no-op. Calling on a soft-body id is also no-op (does not modify `availableIds`). |
| 9 | `despawnDroplet_throws_after_destroy` | TS | Construct instance, call `destroy()`, then `instance.despawnDroplet(0)` throws. Mirrors the existing destroy-guard pattern. |
| 10 | `spawnDroplet_writes_lifetime_to_slot_3` | TS | `spawnDroplet({ ..., lifetimeMs: 1234 })` → `buffer[off + 3] === 1234`. Default (omitted): `buffer[off + 3] === 5000`. Verifies slot[3] is the lifetime channel (W45 Decision §3). |

After W45: 208 + 10 = **218 tests** (52 Rust + 166 TS — Rust grows by 5, TS by 5).

## Must NOT
- Cull DOM-anchored entities (Decision §9 of r1 → §"Scope" intro here). Soft-body slots remain active regardless of viewport position.
- Add per-frame allocation for tracking lifetimes — `FreeParticle.lifetime_ms` is on the existing struct.
- Repurpose slot[5] (liquid_type dispatch).
- Throw from `despawnDroplet` on a non-droplet id (Decision §9 here).
- Apply lifetime/cull to Shake (`liquid_type=4`) or other non-FreeDrop strategies.
- Render FreeDrop slots — explicitly out of scope; the render-loop change is a follow-up ward.

## Must DO
- A spawned droplet whose pos crosses `viewport + cullMargin` returns its slot in the same tick.
- Lifetime expiry deactivates stationary droplets.
- `spawnDroplet` after a cull recycles the freed id without throwing capacity-exceeded.
- `instance.despawnDroplet(id)` is on the public `LiquidDOMInstance`, has destroy guard, is idempotent on unknown ids.
- `tick()` is called with viewport args every frame in the RAF loop.
- Existing W43 tests + all W47/W48/W52/W54 adapter tests continue to pass.

## Risks & Mitigations
- **R1: Borrow-checker conflict in tick().** FreeDrop branch needs to read `free_particles[i]` (mutable borrow via `get_or_insert_with`), then mutate `buffer.entity_slice_mut(i)` and `free_particles[i]`. Mitigation: copy `pos`/`radius`/`expired` out to locals BEFORE the cull check, let the borrow drop at end of the let binding, then mutate. Tested by Test #5.
- **R2: `scanForFreedDropletSlot` iterates `dropletIds`.** Worst case = spawn count, bounded by capacity. For typical capacities (32–256) negligible.
- **R3: `cull_margin` hardcoded to 100 px.** Matches W18 render-cull default. Configurable via future `LiquidOptions.cullMargin` if needed.
- **R4: Lifetime decrement uses `dt_ms` (raw ms), integration uses `dt` (seconds).** Two unit conventions in one branch — required because lifetime is exposed to TS in ms. Verified by Tests #2 + #5.
- **R5: `despawnDroplet` mid-tick.** JS is single-threaded; `tick()` is synchronous wasm-bindgen call. No interleave possible.
- **R6: `grow()` and existing droplets.** `free_particles.resize_with(new_capacity, || None)` preserves existing entries; new slots start `None`. Existing droplets continue ticking normally.
- **R7: `tick()` signature now has 15 args.** Already `#[allow(clippy::too_many_arguments)]`. A `TickArgs` struct refactor is a candidate for a perf/cleanup ward but out of W45 scope.
- **R8: Stale viewport state on instance reuse.** Today `LiquidCore` is constructed fresh per `LiquidDOM.create()`; viewport is passed every frame so no stale state. If a future ward reuses `LiquidCore` across mounts, the per-frame arg passing makes this naturally safe (no setter to leak).
- **R9: Renderer doesn't iterate `dropletIds`.** W43-shipped + W45-extended state is internally correct, but droplets are invisible. Documented in §"Scope" / §"Out of scope". A follow-up ward extends `render()`.

## Verification
1. `cargo test api::tests::test_freedrop_culls* api::tests::test_freedrop_lifetime* api::tests::test_cull_does_not_affect* api::tests::test_freedrop_renders_last_frame*` covers Rust tests 1–5.
2. `npm test -- packages/core/ts/__tests__/free-drop.test.ts` covers TS tests 6–10.
3. Full verify: 52 Rust + 166 TS = 218 tests pass, 0 clippy warnings.
4. Manual: a scratch program spawns 200 droplets with velocities flying them off-screen; `instance.getBuffer()` shows the pool recovered (most slots have w==0) within a few seconds.
5. Manual: spawn a stationary droplet with `lifetimeMs: 500` and inspect the buffer 600 ms later — slot is zeroed.
