use wasm_bindgen::prelude::*;
use crate::buffer::EntityBuffer;
use crate::math::Vec2;
use crate::physics::{EntityBody, dispatch_strategy, PhysicsStrategy, strategy_shake};

/// Number of particles per soft body (4 per edge of the rectangle).
pub const PARTICLES_PER_BODY: usize = 16;

/// Floats per body in particle_data: x,y per particle = PARTICLES_PER_BODY * 2.
const PARTICLE_FLOATS_PER_BODY: usize = PARTICLES_PER_BODY * 2;

/// The public WASM API. TypeScript interacts exclusively through this struct.
#[wasm_bindgen]
pub struct LiquidCore {
    buffer: EntityBuffer,
    bodies: Vec<Option<EntityBody>>,
    particle_data: Vec<f32>,
}

#[wasm_bindgen]
impl LiquidCore {
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: EntityBuffer::new(capacity),
            bodies: (0..capacity).map(|_| None).collect(),
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
        self.particle_data
            .resize(new_capacity * PARTICLE_FLOATS_PER_BODY, 0.0);
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

            // Lazily create body on first encounter
            let body = self.bodies[i].get_or_insert_with(|| {
                EntityBody::new_rect(w, h, PARTICLES_PER_BODY)
            });

            // DOM state is king — update base_pos from buffer
            body.base_pos = Vec2::new(x, y);

            // Dispatch physics strategy based on liquid_type
            let liquid_type = slice[5];
            let strategy = dispatch_strategy(liquid_type);

            // During drag, skip rigid translation so particles lag behind with squish
            body.skip_rigid_translation = strategy == PhysicsStrategy::Dragged;

            match strategy {
                PhysicsStrategy::Dragged => {
                    // DOM element moves with pointer, sync() updates base_pos.
                    // skip_rigid_translation is set above — springs create squish.
                    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps);
                }
                PhysicsStrategy::Shake => {
                    let impulse_vx = slice[6];
                    let impulse_vy = slice[7];
                    strategy_shake(body, dt, tension, damping, impulse_vx, impulse_vy, pointer_pos, pointer_active, substeps);
                }
                _ => {
                    // Default, Tear, Magnet, Tween — all use default physics
                    body.tick_with_substeps(dt, tension, damping, pointer_pos, pointer_active, substeps);
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
