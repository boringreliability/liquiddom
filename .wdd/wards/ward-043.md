---
ward: 43
revision: null
name: "FreeDrop Entity Type & Buffer Extension"
epic: "element-physics-extensions"
status: "complete"
dependencies: [22, 23, 31]
layer: "both"
estimated_tests: 8
created: "2026-05-10"
completed: "2026-05-14"
---
# Ward 043: FreeDrop Entity Type & Buffer Extension

## Scope
Introduce a second entity class — a DOM-less, free-floating particle that lives in the same slot pool as soft-body entities. FreeDrop occupies one slot but has no springs, no neighbors, and no DOM anchor. It carries its own velocity and integrates position each tick.

This ward is **pure plumbing**: the slot kind, dispatch path, lazy init, particle write-out, the `spawnDroplet` TS API, and a unified Rust-side `release_slot(id)` for clean slot reuse across both entity kinds. No gravity (W46), no spawning UX (W44), no culling (W45). Without gravity, a FreeDrop moves at constant velocity forever — fine for plumbing verification.

Out of scope:
- Gravity / per-droplet forces (W46).
- Lifetime, fading, automatic culling (W45).
- Collision between droplets and bodies (deferred indefinitely).
- A `despawnDroplet(id)` API — droplets accumulate in W43. `destroy()` cleans them via `unobserveAll` extension (see §"TS changes" below).

## Inputs
- `EntityBuffer` and `EntityBody` system (`src/buffer.rs`, `src/physics.rs`).
- `dispatch_strategy` in `src/physics.rs:15-28`.
- `LiquidCore::tick` in `src/api.rs:74-127` — per-slot loop.
- `PARTICLES_PER_BODY = 16` — particle-buffer layout.
- W31 buffer slot[5]=`liquid_type`, slot[6]=`impulse_vx`, slot[7]=`impulse_vy`. W43 redefines slot[6]/[7] under `liquid_type=6` to be **initial velocity** consumed once at lazy-init.

## Outputs
- **Rust**:
  - New `PhysicsStrategy::FreeDrop` variant (raw value `6.0`).
  - New `FreeParticle` struct in `src/physics.rs` — `pos: Vec2`, `velocity: Vec2`, `radius: f32`.
  - New `Vec<Option<FreeParticle>>` parallel to `Vec<Option<EntityBody>>` on `LiquidCore`. (Slot index `i` is in at most one of the two vecs — invariant enforced by `release_slot` and a defensive `debug_assert!` in the FreeDrop branch.)
  - **New `LiquidCore::release_slot(&mut self, id: u32)`** — `wasm_bindgen` public. Sets `bodies[id] = None` and `free_particles[id] = None`. Called by TS in both `unobserve` (existing soft-body path) and `spawnDroplet` (before initializing a recycled slot). Idempotent.
  - `tick()` dispatch branches on `liquid_type=6`: skips body-init, lazily creates `FreeParticle` from slot[6]/[7] as initial velocity, integrates `pos += velocity * dt`, writes 16 particle positions distributed on a circle (radius from slot[2]/2 — see Decision §8) so the existing renderer draws a visible blob.
  - **Test-only accessors** (`#[cfg(test)]`): `pub fn body_is_some(&self, i: usize) -> bool`, `pub fn free_particle_is_some(&self, i: usize) -> bool`, `pub fn free_particle_pos(&self, i: usize) -> Option<Vec2>`.
- **TS**:
  - `PhantomObserver.spawnDroplet(opts: SpawnDropletOptions) → id` — allocates a slot from the same pool as `observe()`, calls `core.release_slot(id)` to clear any stale Rust state, writes initial state into buffer. Options object: `{ x, y, vx, vy, radius?: number = 4 }` (default visual radius 4 px → diameter 8 in slot[2]).
  - `LiquidDOMInstance.spawnDroplet(opts: SpawnDropletOptions) → number` — public wrapper with destroy guard.
  - `PhantomObserver.unobserveAll` extended to also iterate `dropletIds` and call `release_slot` per id, then clear the set.
  - Render-loop skip: FreeDrop slots are EXCLUDED from the `preserveBackgrounds` clip-hole loop because their bounding rect would partially erase their own visual blob.

## Decisions (locked in this spec)
1. **Parallel `Vec<Option<FreeParticle>>`, not an `enum SlotBody`.** Restructuring `bodies` to a 3-variant enum would force every reader to match. Parallel storage costs ~24 bytes per unused slot vs. an `EntityBody`'s kilobytes. Invariant: at most one of `bodies[i]` and `free_particles[i]` is `Some`. Enforced by `release_slot` (TS calls it from both `unobserve` and `spawnDroplet`) AND a `debug_assert!(self.bodies[i].is_none())` at the FreeDrop init site so a TS bug that writes `liquid_type=6` to a live soft-body slot is caught in debug builds.
2. **Reuse slot[6]/[7] as initial velocity for FreeDrop.** Under `liquid_type=6` these slots are read **once** at lazy `FreeParticle` init; subsequent ticks ignore them. Under `liquid_type=4` (Shake) they remain per-frame impulse. Dispatch by `liquid_type`, no collision. Slot zeroing on `unobserve` (`buffer.fill(0, offset, offset + 9)`) means a recycled slot starts with slot[6]/[7]=0 — `spawnDroplet` is the only writer.
3. **Active-marker is still `w == 0` means inactive.** FreeDrop slots write non-zero `diameter` into slot[2] and the same value into slot[3]. Skip logic at `api.rs:79` untouched.
4. **Particles distributed on a circle.** Closed-loop angular distribution `theta = j * TAU / 16` produces a visible disc via the existing Bezier-midpoint spline renderer (the spline approximates a circle within ~2% — verified by reviewer). W38 SDF will replace this.
5. **`spawnDroplet` takes an options object, not positional args.** Five positional numbers (`x, y, vx, vy, radius`) is the exact case where call sites become unreadable. Matches existing API patterns (`tween`, `impulse` both use options objects in `index.ts`).
6. **`observe(el, 6)` throws.** The error message references `spawnDroplet`. Spec Must NOT also forbids manual buffer-write of `slot[5] = 6` on a live soft-body slot — the defensive `debug_assert!` in Decision §1 catches this in tests.
7. **`dropletIds` is used for `unobserveAll` cleanup.** Not dead code: `destroy()` calls `unobserveAll`, which now iterates both `idToElement` (soft-body slots) and `dropletIds` (droplet slots) to call `release_slot` per id. Without this, droplets leak past `destroy()`.
8. **slot[2] = slot[3] = visual diameter, particles distributed at radius = slot[2]/2.** Rationale: the existing render path may read slot[2]/[3] as bounding-box (W53 `preserveBackgrounds` does this). Storing diameter ensures the bounding rect matches the visual blob's extent. The `FreeParticle.radius` Rust field stores half the slot[2] value.
9. **FreeDrop slots are EXCLUDED from `preserveBackgrounds` clip-hole.** Reviewer caught: with `preserveBackgrounds: true`, the existing clip loop would carve a tiny rect at the droplet's slot[0..4] position, partially erasing the droplet's own particles. The render loop now reads `slice[5]` and skips the clip branch when `liquid_type === 6`.
10. **No `lifetime_ms` field in W43.** Tied to W45 culling.

## Specification

### Rust changes

**`src/physics.rs`** — add enum variant + struct:
```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicsStrategy {
    Default, Tear, Magnet, Dragged, Shake, Tween,
    FreeDrop,  // 6.0 — W43
}

pub fn dispatch_strategy(liquid_type: f32) -> PhysicsStrategy {
    if liquid_type.is_nan() { return PhysicsStrategy::Default; }
    match liquid_type.round() as i32 {
        // existing arms…
        6 => PhysicsStrategy::FreeDrop,
        _ => PhysicsStrategy::Default,
    }
}

#[derive(Debug, Clone)]
pub struct FreeParticle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub radius: f32,
}

impl FreeParticle {
    pub fn new(pos: Vec2, velocity: Vec2, radius: f32) -> Self {
        Self { pos, velocity, radius }
    }
    pub fn integrate(&mut self, dt: f32) {
        self.pos += self.velocity * dt;
    }
}
```

**`src/api.rs`** — add the parallel storage + `release_slot` + dispatch branch:
```rust
#[wasm_bindgen]
pub struct LiquidCore {
    buffer: EntityBuffer,
    bodies: Vec<Option<EntityBody>>,
    free_particles: Vec<Option<FreeParticle>>,  // NEW
    particle_data: Vec<f32>,
}

#[wasm_bindgen]
impl LiquidCore {
    // existing constructor + grow extended:
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: EntityBuffer::new(capacity),
            bodies: (0..capacity).map(|_| None).collect(),
            free_particles: (0..capacity).map(|_| None).collect(),
            particle_data: vec![0.0; capacity * PARTICLE_FLOATS_PER_BODY],
        }
    }

    pub fn grow(&mut self, new_capacity: usize) {
        self.buffer.grow(new_capacity);
        self.bodies.resize_with(new_capacity, || None);
        self.free_particles.resize_with(new_capacity, || None);
        self.particle_data.resize(new_capacity * PARTICLE_FLOATS_PER_BODY, 0.0);
    }

    /// W43: unified slot-clear path. Idempotent — calling on an already-empty
    /// slot is a no-op. TS calls this from both unobserve (soft-body teardown)
    /// and spawnDroplet (before lazy-init of a recycled slot).
    pub fn release_slot(&mut self, id: u32) {
        let i = id as usize;
        if i >= self.bodies.len() { return; }
        self.bodies[i] = None;
        self.free_particles[i] = None;
    }

    // In tick(), after the `if w == 0.0 { continue; }` check:
    let strategy = dispatch_strategy(liquid_type);
    if strategy == PhysicsStrategy::FreeDrop {
        debug_assert!(
            self.bodies[i].is_none(),
            "FreeDrop slot {i} also has a soft-body — invariant violated. \
             Did TS forget to call release_slot before spawnDroplet?"
        );
        let part = self.free_particles[i].get_or_insert_with(|| {
            FreeParticle::new(
                Vec2::new(x, y),
                Vec2::new(slice[6], slice[7]),
                w * 0.5, // radius = diameter / 2 (Decision §8)
            )
        });
        part.integrate(dt);
        let offset = i * PARTICLE_FLOATS_PER_BODY;
        let n = PARTICLES_PER_BODY as f32;
        for j in 0..PARTICLES_PER_BODY {
            let theta = (j as f32) * std::f32::consts::TAU / n;
            self.particle_data[offset + j * 2]     = part.pos.x + theta.cos() * part.radius;
            self.particle_data[offset + j * 2 + 1] = part.pos.y + theta.sin() * part.radius;
        }
        continue;
    }
    // existing soft-body lazy init + dispatch follows unchanged
```

**`src/api.rs` (test-only accessors at the bottom of `impl LiquidCore`):**
```rust
#[cfg(test)]
impl LiquidCore {
    pub fn body_is_some(&self, i: usize) -> bool { self.bodies[i].is_some() }
    pub fn free_particle_is_some(&self, i: usize) -> bool { self.free_particles[i].is_some() }
    pub fn free_particle_pos(&self, i: usize) -> Option<Vec2> {
        self.free_particles[i].as_ref().map(|p| p.pos)
    }
}
```

### TS changes

**`packages/core/ts/src/phantom-observer.ts`** — droplet allocator + `unobserveAll` extension:
```ts
export interface SpawnDropletOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual radius in CSS px. Defaults to 4 (diameter 8). */
  radius?: number;
}

private readonly dropletIds: Set<number> = new Set();

spawnDroplet(opts: SpawnDropletOptions, releaseSlot: (id: number) => void): number {
  const id = this.availableIds.length > 0
    ? this.availableIds.pop()!
    : this.nextId++;
  if (id >= this._capacity) {
    throw new Error(`PhantomObserver capacity exceeded: ${this._capacity} slots max`);
  }
  releaseSlot(id); // Clear stale Rust state for recycled slots (Decision §1).
  this.dropletIds.add(id);
  const radius = opts.radius ?? 4;
  const diameter = radius * 2;
  const off = id * FLOATS_PER_ENTITY;
  this.buffer[off]     = opts.x;
  this.buffer[off + 1] = opts.y;
  this.buffer[off + 2] = diameter;     // width = diameter (Decision §8)
  this.buffer[off + 3] = diameter;     // height = diameter
  this.buffer[off + 4] = 0;            // interaction_state
  this.buffer[off + 5] = 6.0;          // liquid_type = FreeDrop
  this.buffer[off + 6] = opts.vx;      // initial vx (consumed once)
  this.buffer[off + 7] = opts.vy;      // initial vy
  this.buffer[off + 8] = 0;            // border-radius irrelevant
  return id;
}

// Extension to existing unobserveAll:
unobserveAll(releaseSlot: (id: number) => void): void {
  const elements = [...this.idToElement.values()];
  for (const el of elements) this.unobserve(el, releaseSlot);
  // W43: also clear droplet slots.
  for (const id of this.dropletIds) {
    releaseSlot(id);
    const off = id * FLOATS_PER_ENTITY;
    this.buffer.fill(0, off, off + FLOATS_PER_ENTITY);
    this.availableIds.push(id);
  }
  this.dropletIds.clear();
}

// Existing unobserve(el) signature extended:
unobserve(el: HTMLElement, releaseSlot: (id: number) => void): void {
  // …existing teardown…
  releaseSlot(id); // W43: clear Rust state
  // …existing buffer zero + availableIds push…
}
```

**`packages/core/ts/src/index.ts`** — public wrapper + wire `releaseSlot`:
```ts
// The `core` handle is non-null when WASM loaded; null in mock mode.
const releaseSlot = (id: number) => { core?.release_slot(id); };

// In LiquidDOMInstance:
spawnDroplet(opts: SpawnDropletOptions): number {
  if (destroyed) throw new Error("Cannot spawnDroplet on a destroyed LiquidDOM instance");
  return observer.spawnDroplet(opts, releaseSlot);
}
```

Add `spawnDroplet(opts: SpawnDropletOptions): number;` to the `LiquidDOMInstance` interface, and re-export `SpawnDropletOptions` from `index.ts`.

### `observe(el, 6)` guard
At the top of `PhantomObserver.observe(el, liquidType)` (currently around `phantom-observer.ts:163`):
```ts
if (liquidType === 6) {
  throw new Error("observe() does not accept liquid_type=6 (FreeDrop). Use instance.spawnDroplet() instead.");
}
```

### Render-loop FreeDrop exclusion from clip
In `PhantomObserver.render()` at the `if (clipping)` block (currently `phantom-observer.ts:435-447` post-W54), guard:
```ts
const isFreeDrop = this.buffer[entityOffset + 5] === 6.0;
const clipping = viewport?.preserveBackgrounds === true && !isFreeDrop;
```

## Tests
4 Rust tests in `src/physics.rs` (or a new `src/api.rs` test module), 4 TS tests in `packages/core/ts/__tests__/free-drop.test.ts`.

| # | Test Name | Layer | Verifies |
|---|-----------|-------|----------|
| 1 | `test_dispatch_strategy_freedrop` | Rust | `dispatch_strategy(6.0)` → `FreeDrop`. `dispatch_strategy(6.4)` (rounds to 6) → `FreeDrop`. `dispatch_strategy(7.0)` → `Default`. `dispatch_strategy(f32::NAN)` → `Default`. |
| 2 | `test_freedrop_lazy_init_and_velocity_persistence` | Rust | Initial pos `(0, 0)`, slot[6]=`100`, slot[7]=`50`, dt_ms=100. After `tick()`: `core.free_particle_pos(0) == Some(Vec2(10, 5))`, `core.body_is_some(0) == false`. Second `tick()` with slot[6]/[7] mutated to `(999, 999)`: pos == `(20, 10)` (slot[6]/[7] ignored after first init). |
| 3 | `test_freedrop_writes_particle_circle` | Rust | After `tick()` on a FreeDrop slot at `(100, 200)` with slot[2]=`16` (diameter, radius=8), the 16 particle (x, y) pairs in `particle_data[slot_offset..+32]` satisfy `((x-100)² + (y-200)²).sqrt() ≈ 8` within 1e-4 epsilon. |
| 4 | `test_release_slot_clears_both_storages_and_grow_resizes_free_particles` | Rust | Two assertions: (a) spawn a soft-body slot via `tick()` so `body_is_some(0)` is true; call `release_slot(0)`; assert `body_is_some(0) == false`. Then write `liquid_type=6` + non-zero w to slot 0, `tick()`, assert `free_particle_is_some(0) == true` AND `body_is_some(0) == false` (invariant holds). (b) After `core.grow(new_capacity=2*current)`, `free_particle_is_some(new_capacity-1) == false` (resize extends with None, doesn't panic). |
| 5 | `spawnDroplet_options_object_writes_buffer_correctly` | TS | `instance.spawnDroplet({ x: 10, y: 20, vx: 0, vy: 0, radius: 6 })` returns id `N`. Buffer at `N*FLOATS_PER_ENTITY` == `[10, 20, 12, 12, 0, 6, 0, 0, 0]` (diameter=12 from radius=6). Default radius: `spawnDroplet({ x:0,y:0,vx:0,vy:0 })` writes diameter=8 in slot[2]/[3]. |
| 6 | `spawnDroplet_throws_when_capacity_exceeded` | TS | Capacity-1 instance: first `spawnDroplet` returns 0; second throws an error referencing "capacity exceeded". After throw: `availableIds.length === 0`, `nextId === 1` (slot pool unchanged). |
| 7 | `observe_rejects_liquid_type_6` | TS | `instance.observe(el, 6)` throws an error referencing `spawnDroplet`. The slot pool's `availableIds` and `nextId` are unchanged. |
| 8 | `destroy_releases_droplet_slots_via_unobserveAll` | TS | Spawn 3 droplets. Call `instance.destroy()`. `releaseSlot` mock spy called with each droplet id. `dropletIds.size === 0` after. |

After W43: 199 + 8 = **207 tests** (47 Rust + 160 TS — Rust grows by 4, TS by 4).

## Must NOT
- Allocate a new buffer per droplet — reuse the existing slot pool.
- Allow a slot to be `Some` in both `bodies[i]` and `free_particles[i]`. Enforced by `release_slot` + `debug_assert!`.
- Read slot[6]/[7] on every FreeDrop tick — only on the first tick (lazy init).
- Render FreeDrop via the soft-body spline path. FreeDrop writes its 16 particle positions directly as a circle.
- Add new buffer slots. FreeDrop reuses slot[6]/[7] under a different semantic per `liquid_type`.
- Couple `FreeParticle::integrate` to gravity. The body is `pos += velocity * dt`, nothing else. W46 will extend.
- Run the `preserveBackgrounds` clip-hole path on FreeDrop slots (Decision §9).
- Mutate slot[5] from non-6 to 6 on a live soft-body slot via direct buffer write — the `debug_assert!` catches this in tests; production behavior is "use `spawnDroplet`".

## Must DO
- `liquid_type = 6` round-trips through `dispatch_strategy` (Test #1).
- Existing strategies untouched; all current tests continue to pass.
- Capacity accounting unchanged — a droplet occupies one slot like an entity.
- `spawnDroplet` is the ONLY way to create a FreeDrop. `observe(el, 6)` throws.
- `destroy()` (via extended `unobserveAll`) clears all droplet slots.
- Public `LiquidDOMInstance.spawnDroplet` has destroy guard (mirrors `tween`/`refreshTheme`/`refreshShadow`).

## Risks & Mitigations
- **R1: `Vec<Option<FreeParticle>>` memory cost.** ~24 bytes per Option per slot. For capacity=1024 that's ~24 KB always allocated. Negligible vs. `EntityBody` kilobytes per slot. Documented in Decision §1.
- **R2: TS `dropletIds` accumulates without `despawnDroplet`.** W45 will add culling. For W43 the set is only iterated in `unobserveAll`/`destroy`; memory grows linearly with spawn count, bounded by `capacity`.
- **R3: Particle distribution depends on `slot[2]`.** If `radius=0` is passed, diameter=0, particles collapse to a point (invisible). Documented behavior, not an error.
- **R4: Spline renderer accuracy on 16-pt circle.** Verified ~98% accurate (Bezier-midpoint approximation, ~2% radial inset). Visually a circle at all practical sizes.
- **R5: FreeDrop slot writes `liquid_type=6` mid-flight on a live body slot.** Decision §1's `debug_assert!` traps this in tests. Release builds: orphaned body stays dormant (FreeDrop branch `continue`s before body init), no functional bug, just memory waste until next `release_slot` or `grow`.
- **R6: Slot reuse across kind boundary.** `release_slot` clears both vecs idempotently. Called from `unobserve` (soft-body → empty) and `spawnDroplet` (any → droplet). Tests #4 + #8 cover the round-trips.
- **R7: `preserveBackgrounds` clip-hole partially erasing droplets.** Mitigated by Decision §9 — render reads `slice[5]` and skips clipping for FreeDrop slots. Implicitly tested by Test #5's buffer state (slot[5]=6) + the existing `preserveBackgrounds` test suite which mustn't regress.
- **R8: Mock-mode FreeDrop integration.** When WASM fails to load, the TS-side `releaseSlot` callback is `core?.release_slot(id)` — no-op. `spawnDroplet` still works at the buffer level (TS test #5 verifies). Particle integration (pos updates over time) requires Rust and doesn't run in mock mode. Documented in Verification.

## Verification
1. `cargo test physics::tests::test_freedrop_*` and `cargo test api::tests::*` cover Rust tests 1–4.
2. `npm test -- packages/core/ts/__tests__/free-drop.test.ts` covers TS tests 5–8.
3. Full verify: 47 Rust + 160 TS = 207 tests pass. 0 clippy warnings.
4. Test environment notes:
   - Tests 1–4 run via `cargo test` (native Rust, no WASM/jsdom).
   - Tests 5–8 run via vitest+jsdom — pure TS-side buffer-write assertions plus a spy on the `releaseSlot` callback. They do NOT verify Rust-side integration; that's the cargo tests' job.
5. `npm pack --dry-run --workspace liquiddom` — no new files (additions are to existing `phantom-observer.ts`, `index.ts`, `api.rs`, `physics.rs`).
6. Manual: scratch demo calls `instance.spawnDroplet({ x: 400, y: 100, vx: 80, vy: 0 })` — a small disc travels 80 px/s rightward and exits the viewport, never returning (no gravity, no culling yet).
