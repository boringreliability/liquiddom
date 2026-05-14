use wasm_bindgen::prelude::*;
use crate::buffer::EntityBuffer;
use crate::math::Vec2;
use crate::physics::{EntityBody, FreeParticle, dispatch_strategy, PhysicsStrategy, strategy_shake};

/// Number of particles per soft body (4 per edge of the rectangle).
pub const PARTICLES_PER_BODY: usize = 16;

/// Floats per body in particle_data: x,y per particle = PARTICLES_PER_BODY * 2.
const PARTICLE_FLOATS_PER_BODY: usize = PARTICLES_PER_BODY * 2;

/// The public WASM API. TypeScript interacts exclusively through this struct.
#[wasm_bindgen]
pub struct LiquidCore {
    buffer: EntityBuffer,
    bodies: Vec<Option<EntityBody>>,
    /// Ward 043: parallel storage for DOM-less free-floating particles.
    /// Invariant: at most one of bodies[i] / free_particles[i] is Some.
    free_particles: Vec<Option<FreeParticle>>,
    particle_data: Vec<f32>,
}

#[wasm_bindgen]
impl LiquidCore {
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: EntityBuffer::new(capacity),
            bodies: (0..capacity).map(|_| None).collect(),
            free_particles: (0..capacity).map(|_| None).collect(),
            particle_data: vec![0.0; capacity * PARTICLE_FLOATS_PER_BODY],
        }
    }

    /// Returns the byte offset of the entity buffer within WASM linear memory.
    pub fn ptr(&self) -> *const f32 {
        self.buffer.ptr()
    }

    /// Returns the byte offset of the particle data buffer within WASM linear memory.
    pub fn particle_ptr(&self) -> *const f32 {
        self.particle_data.as_ptr()
    }

    /// Current capacity in entities.
    pub fn capacity(&self) -> usize {
        self.buffer.capacity()
    }

    /// Grow the buffer. TS must re-create its Float32Array views after this call.
    pub fn grow(&mut self, new_capacity: usize) {
        self.buffer.grow(new_capacity);
        self.bodies.resize_with(new_capacity, || None);
        self.free_particles.resize_with(new_capacity, || None);
        self.particle_data
            .resize(new_capacity * PARTICLE_FLOATS_PER_BODY, 0.0);
    }

    /// Ward 043: unified slot-clear path. Idempotent. TS calls this from both
    /// `unobserve` (soft-body teardown) and `spawnDroplet` (before re-init of
    /// a recycled slot). Out-of-bounds ids are a no-op.
    pub fn release_slot(&mut self, id: u32) {
        let i = id as usize;
        if i >= self.bodies.len() {
            return;
        }
        self.bodies[i] = None;
        self.free_particles[i] = None;
    }

    /// Called by requestAnimationFrame each frame.
    /// dt_ms is in milliseconds — converted to seconds internally.
    /// tension, damping, substeps are physics config parameters from TS.
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
    ) {
        let dt = dt_ms / 1000.0;
        let pointer_pos = Vec2::new(pointer_x, pointer_y);

        for i in 0..self.buffer.capacity() {
            let slice = self.buffer.entity_slice(i);
            let w = slice[2];
            let h = slice[3];

            if w == 0.0 {
                // Entity not active — skip
                continue;
            }

            let x = slice[0];
            let y = slice[1];
            let border_radius = slice[8];

            let liquid_type = slice[5];
            let strategy = dispatch_strategy(liquid_type);

            // Ward 043: FreeDrop branch — DOM-less particle, no soft-body.
            // Lazy init reads slot[6]/[7] as initial velocity ONCE; subsequent
            // ticks ignore them (velocity persists in FreeParticle.velocity).
            if strategy == PhysicsStrategy::FreeDrop {
                debug_assert!(
                    self.bodies[i].is_none(),
                    "FreeDrop slot {} also has a soft-body — invariant violated. \
                     Did TS forget to call release_slot before spawnDroplet?",
                    i
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
                    self.particle_data[offset + j * 2] = part.pos.x + theta.cos() * part.radius;
                    self.particle_data[offset + j * 2 + 1] = part.pos.y + theta.sin() * part.radius;
                }
                continue;
            }

            // Lazily create body on first encounter using the border-radius
            // value TS wrote on observe/resize (Ward 042). Slot[8] changes
            // after construction do NOT rebuild the body — re-observe is
            // required to update the rest shape (spec §5).
            let body = self.bodies[i].get_or_insert_with(|| {
                EntityBody::new_rounded_rect(w, h, border_radius, PARTICLES_PER_BODY)
            });

            // DOM state is king — update base_pos from buffer
            body.base_pos = Vec2::new(x, y);

            // During drag, skip rigid translation so particles lag behind with squish
            body.skip_rigid_translation = strategy == PhysicsStrategy::Dragged;

            match strategy {
                PhysicsStrategy::Dragged => {
                    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps, repulsion_radius, repulsion_strength, neighbor_spring_k);
                }
                PhysicsStrategy::Shake => {
                    let impulse_vx = slice[6];
                    let impulse_vy = slice[7];
                    strategy_shake(body, dt, tension, damping, impulse_vx, impulse_vy, pointer_pos, pointer_active, substeps);
                }
                _ => {
                    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps, repulsion_radius, repulsion_strength, neighbor_spring_k);
                }
            }

            // Write particle positions to flat buffer (pos is global after physics)
            let offset = i * PARTICLE_FLOATS_PER_BODY;
            for (j, particle) in body.particles.iter().enumerate() {
                let idx = offset + j * 2;
                self.particle_data[idx] = particle.pos.x;
                self.particle_data[idx + 1] = particle.pos.y;
            }
        }
    }
}

#[cfg(test)]
impl LiquidCore {
    /// Ward 043 test-only: peek at parallel storage state.
    pub fn body_is_some(&self, i: usize) -> bool {
        self.bodies[i].is_some()
    }

    pub fn free_particle_is_some(&self, i: usize) -> bool {
        self.free_particles[i].is_some()
    }

    pub fn free_particle_pos(&self, i: usize) -> Option<Vec2> {
        self.free_particles[i].as_ref().map(|p| p.pos)
    }

    /// Write a buffer slot directly for tests (no DOM dependency).
    pub fn write_slot(&mut self, i: usize, slot: [f32; crate::buffer::FLOATS_PER_ENTITY]) {
        self.buffer.entity_slice_mut(i).copy_from_slice(&slot);
    }

    pub fn read_particle(&self, slot_idx: usize, particle_idx: usize) -> (f32, f32) {
        let off = slot_idx * PARTICLE_FLOATS_PER_BODY + particle_idx * 2;
        (self.particle_data[off], self.particle_data[off + 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Default slot for a FreeDrop at (x, y) with diameter=d and velocity (vx, vy).
    fn freedrop_slot(x: f32, y: f32, d: f32, vx: f32, vy: f32) -> [f32; crate::buffer::FLOATS_PER_ENTITY] {
        [x, y, d, d, 0.0, 6.0, vx, vy, 0.0]
    }

    // ── Test #1 — dispatch_strategy(6.0) returns FreeDrop ──
    #[test]
    fn test_dispatch_strategy_freedrop() {
        assert_eq!(dispatch_strategy(6.0), PhysicsStrategy::FreeDrop);
        assert_eq!(dispatch_strategy(6.4), PhysicsStrategy::FreeDrop);
        assert_eq!(dispatch_strategy(7.0), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(f32::NAN), PhysicsStrategy::Default);
    }

    // ── Test #2 — FreeDrop lazy-init + velocity persists across ticks ──
    #[test]
    fn test_freedrop_lazy_init_and_velocity_persistence() {
        let mut core = LiquidCore::new(1);
        // Pos (0, 0), diameter=8, velocity (100, 50) px/s.
        core.write_slot(0, freedrop_slot(0.0, 0.0, 8.0, 100.0, 50.0));

        core.tick(100.0, 0.0, 0.0, false, 1.0, 1.0, 1, 0.0, 0.0, 0.0);

        assert!(!core.body_is_some(0), "FreeDrop slot must not create a soft-body");
        let pos = core.free_particle_pos(0).expect("FreeParticle must be lazily created");
        assert!((pos.x - 10.0).abs() < 1e-3, "expected x=10, got {}", pos.x);
        assert!((pos.y - 5.0).abs() < 1e-3, "expected y=5, got {}", pos.y);

        // Mutate slot[6]/[7] to verify they're ignored after lazy init.
        core.write_slot(0, freedrop_slot(0.0, 0.0, 8.0, 999.0, 999.0));
        core.tick(100.0, 0.0, 0.0, false, 1.0, 1.0, 1, 0.0, 0.0, 0.0);
        let pos2 = core.free_particle_pos(0).unwrap();
        // Velocity (100, 50) persisted internally; if slot[6]/[7] had been
        // re-consumed, pos2 would jump dramatically (~100 units further).
        assert!((pos2.x - 20.0).abs() < 1e-3, "expected x=20 (velocity persisted), got {}", pos2.x);
        assert!((pos2.y - 10.0).abs() < 1e-3, "expected y=10, got {}", pos2.y);
    }

    // ── Test #3 — FreeDrop writes 16 particles on a circle ──
    #[test]
    fn test_freedrop_writes_particle_circle() {
        let mut core = LiquidCore::new(1);
        // Diameter=16 → radius=8. Initial velocity zero so center stays at (100, 200).
        core.write_slot(0, freedrop_slot(100.0, 200.0, 16.0, 0.0, 0.0));

        core.tick(0.0, 0.0, 0.0, false, 1.0, 1.0, 1, 0.0, 0.0, 0.0);

        for j in 0..PARTICLES_PER_BODY {
            let (px, py) = core.read_particle(0, j);
            let dist = ((px - 100.0).powi(2) + (py - 200.0).powi(2)).sqrt();
            assert!(
                (dist - 8.0).abs() < 1e-3,
                "particle {} not on circle: dist={}, expected 8",
                j, dist
            );
        }
    }

    // ── Test #4 — release_slot clears both storages; grow extends with None ──
    #[test]
    fn test_release_slot_clears_both_storages_and_grow_resizes() {
        let mut core = LiquidCore::new(2);

        // Spawn a soft-body slot (liquid_type=0, with w/h > 0).
        core.write_slot(0, [10.0, 10.0, 100.0, 50.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        core.tick(16.0, 0.0, 0.0, false, 1.0, 1.0, 1, 0.0, 0.0, 0.0);
        assert!(core.body_is_some(0), "soft-body should be created on tick");

        // release_slot must clear bodies[0].
        core.release_slot(0);
        assert!(!core.body_is_some(0), "release_slot must clear bodies[i]");
        assert!(!core.free_particle_is_some(0), "release_slot must also clear free_particles[i]");

        // After release, write FreeDrop to slot 0 and tick — invariant: only free_particles[0] is Some.
        core.write_slot(0, freedrop_slot(0.0, 0.0, 8.0, 50.0, 0.0));
        core.tick(16.0, 0.0, 0.0, false, 1.0, 1.0, 1, 0.0, 0.0, 0.0);
        assert!(!core.body_is_some(0), "invariant: bodies[0] must remain None for FreeDrop slot");
        assert!(core.free_particle_is_some(0), "free_particle must be lazily created");

        // grow() extends free_particles with None (no panic when accessing new slots).
        core.grow(4);
        assert!(!core.free_particle_is_some(3), "newly grown slots start as None");
        assert!(!core.body_is_some(3), "newly grown body slots start as None");
    }
}
