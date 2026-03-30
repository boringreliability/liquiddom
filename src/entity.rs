use crate::buffer::{EntityBuffer, FLOATS_PER_ENTITY};

/// Immutable reference to a single entity's data in the flat buffer.
pub struct EntityRef<'a> {
    slice: &'a [f32],
}

/// Mutable reference to a single entity's data in the flat buffer.
pub struct EntityRefMut<'a> {
    slice: &'a mut [f32],
}

impl<'a> EntityRef<'a> {
    pub fn new(slice: &'a [f32]) -> Self {
        assert_eq!(
            slice.len(),
            FLOATS_PER_ENTITY,
            "EntityRef requires exactly {} floats, got {}",
            FLOATS_PER_ENTITY,
            slice.len()
        );
        Self { slice }
    }

    pub fn x(&self) -> f32 {
        self.slice[0]
    }

    pub fn y(&self) -> f32 {
        self.slice[1]
    }

    pub fn width(&self) -> f32 {
        self.slice[2]
    }

    pub fn height(&self) -> f32 {
        self.slice[3]
    }

    pub fn interaction_state(&self) -> f32 {
        self.slice[4]
    }

    pub fn liquid_type(&self) -> f32 {
        self.slice[5]
    }
}

impl<'a> EntityRefMut<'a> {
    pub fn new(slice: &'a mut [f32]) -> Self {
        assert_eq!(
            slice.len(),
            FLOATS_PER_ENTITY,
            "EntityRefMut requires exactly {} floats, got {}",
            FLOATS_PER_ENTITY,
            slice.len()
        );
        Self { slice }
    }

    pub fn x(&self) -> f32 {
        self.slice[0]
    }

    pub fn y(&self) -> f32 {
        self.slice[1]
    }

    pub fn width(&self) -> f32 {
        self.slice[2]
    }

    pub fn height(&self) -> f32 {
        self.slice[3]
    }

    pub fn interaction_state(&self) -> f32 {
        self.slice[4]
    }

    pub fn liquid_type(&self) -> f32 {
        self.slice[5]
    }

    pub fn set_x(&mut self, val: f32) {
        self.slice[0] = val;
    }

    pub fn set_y(&mut self, val: f32) {
        self.slice[1] = val;
    }

    pub fn set_width(&mut self, val: f32) {
        self.slice[2] = val;
    }

    pub fn set_height(&mut self, val: f32) {
        self.slice[3] = val;
    }

    pub fn set_interaction_state(&mut self, val: f32) {
        self.slice[4] = val;
    }

    pub fn set_liquid_type(&mut self, val: f32) {
        self.slice[5] = val;
    }
}

impl EntityBuffer {
    /// Get an immutable accessor for entity `id`.
    pub fn entity(&self, id: usize) -> EntityRef<'_> {
        EntityRef::new(self.entity_slice(id))
    }

    /// Get a mutable accessor for entity `id`.
    pub fn entity_mut(&mut self, id: usize) -> EntityRefMut<'_> {
        EntityRefMut::new(self.entity_slice_mut(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_ref_reads_position_and_size() {
        let mut buf = EntityBuffer::new(10);
        // Write known values via raw slice
        {
            let slice = buf.entity_slice_mut(3);
            slice[0] = 10.0; // x
            slice[1] = 20.0; // y
            slice[2] = 200.0; // width
            slice[3] = 100.0; // height
        }

        let entity = buf.entity(3);
        assert_eq!(entity.x(), 10.0);
        assert_eq!(entity.y(), 20.0);
        assert_eq!(entity.width(), 200.0);
        assert_eq!(entity.height(), 100.0);
    }

    #[test]
    fn test_entity_ref_mut_updates_position() {
        let mut buf = EntityBuffer::new(10);

        {
            let mut entity = buf.entity_mut(5);
            entity.set_x(42.0);
            entity.set_y(99.0);
        }

        // Verify the mutation landed in the underlying buffer
        let slice = buf.entity_slice(5);
        assert_eq!(slice[0], 42.0);
        assert_eq!(slice[1], 99.0);
    }

    #[test]
    fn test_entity_ref_reads_states() {
        let mut buf = EntityBuffer::new(10);
        {
            let slice = buf.entity_slice_mut(7);
            slice[4] = 1.0; // hover
            slice[5] = 2.0; // magnet
        }

        let entity = buf.entity(7);
        assert_eq!(entity.interaction_state(), 1.0);
        assert_eq!(entity.liquid_type(), 2.0);
    }

    #[test]
    fn test_entity_ref_mut_updates_states() {
        let mut buf = EntityBuffer::new(10);

        {
            let mut entity = buf.entity_mut(2);
            entity.set_interaction_state(2.0); // active
            entity.set_liquid_type(1.0); // tear
        }

        let slice = buf.entity_slice(2);
        assert_eq!(slice[4], 2.0);
        assert_eq!(slice[5], 1.0);
    }

    #[test]
    fn test_buffer_entity_integration() {
        let mut buf = EntityBuffer::new(10);

        // Write via entity_mut
        {
            let mut entity = buf.entity_mut(0);
            entity.set_x(1.0);
            entity.set_y(2.0);
            entity.set_width(3.0);
            entity.set_height(4.0);
        }

        // Read back via entity (immutable)
        let entity = buf.entity(0);
        assert_eq!(entity.x(), 1.0);
        assert_eq!(entity.y(), 2.0);
        assert_eq!(entity.width(), 3.0);
        assert_eq!(entity.height(), 4.0);

        // Confirm other entities are untouched
        let other = buf.entity(1);
        assert_eq!(other.x(), 0.0);
        assert_eq!(other.y(), 0.0);
    }

    #[test]
    fn test_multiple_mutations_persist() {
        let mut buf = EntityBuffer::new(10);

        {
            let mut entity = buf.entity_mut(4);
            entity.set_x(10.0);
            entity.set_y(20.0);
            entity.set_width(300.0);
            entity.set_height(150.0);
            entity.set_interaction_state(1.0);
            entity.set_liquid_type(2.0);
        }

        // All 6 writes should persist — no overwrites
        let entity = buf.entity(4);
        assert_eq!(entity.x(), 10.0);
        assert_eq!(entity.y(), 20.0);
        assert_eq!(entity.width(), 300.0);
        assert_eq!(entity.height(), 150.0);
        assert_eq!(entity.interaction_state(), 1.0);
        assert_eq!(entity.liquid_type(), 2.0);
    }
}
