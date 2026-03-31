use wasm_bindgen::prelude::*;
use crate::buffer::EntityBuffer;

/// The public WASM API. TypeScript interacts exclusively through this struct.
#[wasm_bindgen]
pub struct LiquidCore {
    buffer: EntityBuffer,
}

#[wasm_bindgen]
impl LiquidCore {
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: EntityBuffer::new(capacity),
        }
    }

    /// Returns the byte offset of the buffer within WASM linear memory.
    pub fn ptr(&self) -> *const f32 {
        self.buffer.ptr()
    }

    /// Current capacity in entities.
    pub fn capacity(&self) -> usize {
        self.buffer.capacity()
    }

    /// Grow the buffer. TS must re-create its Float32Array view after this call.
    pub fn grow(&mut self, new_capacity: usize) {
        self.buffer.grow(new_capacity);
    }

    /// Called by requestAnimationFrame each frame.
    /// For now: dummy mutation — adds dt_ms to custom_param_1 (index 6) of
    /// every entity that has a non-zero width (i.e. is "alive").
    pub fn tick(&mut self, dt_ms: f32) {
        for i in 0..self.buffer.capacity() {
            let slice = self.buffer.entity_slice_mut(i);
            // Only touch entities with non-zero width (considered active)
            if slice[2] != 0.0 {
                slice[6] += dt_ms; // custom_param_1 += dt
            }
        }
    }
}
