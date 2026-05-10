/// Number of f32 values per entity in the flat buffer.
/// Layout: [x, y, width, height, interaction_state, liquid_type, custom_param_1, reserved, border_radius_px]
pub const FLOATS_PER_ENTITY: usize = 9;

/// A flat f32 buffer for sharing entity data with JavaScript via WASM memory.
/// Each entity occupies exactly FLOATS_PER_ENTITY (9) floats (36 bytes).
pub struct EntityBuffer {
    data: Vec<f32>,
    entity_capacity: usize,
}

impl EntityBuffer {
    /// Create a new buffer with capacity for `capacity` entities.
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0f32; capacity * FLOATS_PER_ENTITY],
            entity_capacity: capacity,
        }
    }

    /// Raw pointer to the buffer data (for WASM memory sharing).
    pub fn ptr(&self) -> *const f32 {
        self.data.as_ptr()
    }

    /// Number of floats currently in the buffer.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Returns true if the buffer contains no floats.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Total capacity in entities.
    pub fn capacity(&self) -> usize {
        self.entity_capacity
    }

    /// Grow the buffer to hold at least `new_capacity` entities.
    /// Panics if `new_capacity` is less than or equal to current capacity.
    pub fn grow(&mut self, new_capacity: usize) {
        assert!(
            new_capacity > self.entity_capacity,
            "new_capacity ({}) must be greater than current capacity ({})",
            new_capacity,
            self.entity_capacity
        );
        self.data.resize(new_capacity * FLOATS_PER_ENTITY, 0.0);
        self.entity_capacity = new_capacity;
    }

    /// Get an immutable slice of FLOATS_PER_ENTITY floats for entity `id`.
    pub fn entity_slice(&self, id: usize) -> &[f32] {
        let start = id * FLOATS_PER_ENTITY;
        &self.data[start..start + FLOATS_PER_ENTITY]
    }

    /// Get a mutable slice of FLOATS_PER_ENTITY floats for entity `id`.
    pub fn entity_slice_mut(&mut self, id: usize) -> &mut [f32] {
        let start = id * FLOATS_PER_ENTITY;
        &mut self.data[start..start + FLOATS_PER_ENTITY]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_allocates_correct_capacity() {
        let buf = EntityBuffer::new(100);
        // 100 entities × FLOATS_PER_ENTITY (9) floats = 900 floats in the buffer
        assert_eq!(buf.len(), 100 * FLOATS_PER_ENTITY);
        assert_eq!(buf.capacity(), 100);
    }

    #[test]
    fn test_initial_values_are_zero() {
        let buf = EntityBuffer::new(10);
        // All 10 * FLOATS_PER_ENTITY floats should be 0.0
        for i in 0..10 {
            let slice = buf.entity_slice(i);
            assert_eq!(slice.len(), FLOATS_PER_ENTITY);
            for &val in slice {
                assert_eq!(val, 0.0);
            }
        }
    }

    #[test]
    fn test_ptr_returns_valid_pointer() {
        let buf = EntityBuffer::new(10);
        let ptr = buf.ptr();
        assert!(!ptr.is_null());
        // Verify pointer points to start of buffer data
        // by reading the first float through the pointer
        unsafe {
            assert_eq!(*ptr, 0.0);
        }
    }

    #[test]
    fn test_entity_slice_returns_correct_range() {
        let mut buf = EntityBuffer::new(10);
        // Write known values to entity 5
        {
            let slice = buf.entity_slice_mut(5);
            slice[0] = 10.0; // x
            slice[1] = 20.0; // y
            slice[2] = 100.0; // width
            slice[3] = 50.0; // height
            slice[4] = 1.0; // hover state
            slice[5] = 0.0; // squish type
            slice[6] = 5.0; // border radius
            slice[7] = 0.0; // reserved
        }

        // Read back and verify it's at the correct position
        let slice = buf.entity_slice(5);
        assert_eq!(slice[0], 10.0);
        assert_eq!(slice[1], 20.0);
        assert_eq!(slice[2], 100.0);
        assert_eq!(slice[3], 50.0);
        assert_eq!(slice[4], 1.0);
        assert_eq!(slice[5], 0.0);
        assert_eq!(slice[6], 5.0);
        assert_eq!(slice[7], 0.0);

        // Verify entity 4 and 6 are still zero (no bleed)
        for &val in buf.entity_slice(4) {
            assert_eq!(val, 0.0);
        }
        for &val in buf.entity_slice(6) {
            assert_eq!(val, 0.0);
        }
    }

    #[test]
    fn test_grow_increases_capacity() {
        let mut buf = EntityBuffer::new(10);

        // Write data to entity 3 before grow
        {
            let slice = buf.entity_slice_mut(3);
            slice[0] = 42.0;
            slice[1] = 99.0;
        }

        // Grow to 50 entities
        buf.grow(50);

        assert_eq!(buf.capacity(), 50);
        assert_eq!(buf.len(), 50 * FLOATS_PER_ENTITY); // 50 × FLOATS_PER_ENTITY

        // Verify old data survived the grow
        let slice = buf.entity_slice(3);
        assert_eq!(slice[0], 42.0);
        assert_eq!(slice[1], 99.0);

        // Verify new space is zero-initialized
        let slice = buf.entity_slice(49);
        for &val in slice {
            assert_eq!(val, 0.0);
        }
    }

    #[test]
    #[should_panic]
    fn test_grow_panics_if_smaller() {
        let mut buf = EntityBuffer::new(100);
        // Attempting to shrink should panic
        buf.grow(50);
    }

    // ── Ward 042: Border-Radius Aware Rest Shape ──

    /// Ward 042 test #8: entity buffer layout is 9 floats per entity.
    /// FLOATS_PER_ENTITY bumps from 8 to 9 to add slot[8] = border_radius_px.
    /// Verifies BOTH the immutable and mutable slice accessors return 9 floats (M4).
    #[test]
    fn test_w42_entity_buffer_layout_is_9_floats() {
        assert_eq!(FLOATS_PER_ENTITY, 9);

        let mut buf = EntityBuffer::new(100);
        assert_eq!(buf.len(), 100 * FLOATS_PER_ENTITY);

        let slice = buf.entity_slice(0);
        assert_eq!(slice.len(), 9);

        let slice_mut = buf.entity_slice_mut(0);
        assert_eq!(slice_mut.len(), 9);
    }
}
