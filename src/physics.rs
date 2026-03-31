use crate::math::Vec2;

/// A single particle in a soft body simulation.
#[derive(Debug, Clone)]
pub struct Particle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub local_rest: Vec2,
}

/// A soft body representation of a single DOM element.
/// Holds particles distributed along the element's perimeter.
pub struct EntityBody {
    pub particles: Vec<Particle>,
    pub base_pos: Vec2,
    pub width: f32,
    pub height: f32,
}

impl Particle {
    pub fn new(pos: Vec2, local_rest: Vec2) -> Self {
        Self {
            pos,
            velocity: Vec2::zero(),
            local_rest,
        }
    }
}

impl EntityBody {
    /// Create a new body by distributing `num_particles` evenly along
    /// the perimeter of a rectangle (width × height).
    /// Starts at top-left corner, walks clockwise.
    pub fn new_rect(width: f32, height: f32, num_particles: usize) -> Self {
        let perimeter = 2.0 * (width + height);
        let spacing = perimeter / num_particles as f32;

        let particles = (0..num_particles)
            .map(|i| {
                let d = i as f32 * spacing;
                let rest = if d < width {
                    // Top edge: left → right
                    Vec2::new(d, 0.0)
                } else if d < width + height {
                    // Right edge: top → bottom
                    Vec2::new(width, d - width)
                } else if d < 2.0 * width + height {
                    // Bottom edge: right → left
                    Vec2::new(width - (d - width - height), height)
                } else {
                    // Left edge: bottom → top
                    Vec2::new(0.0, height - (d - 2.0 * width - height))
                };

                Particle::new(rest, rest)
            })
            .collect();

        Self {
            particles,
            base_pos: Vec2::zero(),
            width,
            height,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_particle_initialization() {
        let rest = Vec2::new(10.0, 20.0);
        let p = Particle::new(rest, rest);

        assert_eq!(p.pos, rest);
        assert_eq!(p.local_rest, rest);
        assert_eq!(p.velocity, Vec2::zero());
    }

    #[test]
    fn test_entity_body_rect_distribution() {
        // 4 particles on a 100×100 rect → one at each corner
        let body = EntityBody::new_rect(100.0, 100.0, 4);

        assert_eq!(body.particles.len(), 4);
        assert_eq!(body.width, 100.0);
        assert_eq!(body.height, 100.0);
        assert_eq!(body.base_pos, Vec2::zero());

        // Perimeter = 400, spacing = 100.
        // Starting top-left, walking clockwise:
        // [0] = (0, 0)       — top-left corner
        // [1] = (100, 0)     — top-right corner
        // [2] = (100, 100)   — bottom-right corner
        // [3] = (0, 100)     — bottom-left corner
        let expected = [
            Vec2::new(0.0, 0.0),
            Vec2::new(100.0, 0.0),
            Vec2::new(100.0, 100.0),
            Vec2::new(0.0, 100.0),
        ];

        for (i, exp) in expected.iter().enumerate() {
            let p = &body.particles[i];
            assert!(
                (p.local_rest.x - exp.x).abs() < 0.01
                    && (p.local_rest.y - exp.y).abs() < 0.01,
                "particle {} local_rest: {:?}, expected: {:?}",
                i,
                p.local_rest,
                exp,
            );
            // Initial pos should equal local_rest (no displacement)
            assert_eq!(p.pos, p.local_rest);
        }
    }

    #[test]
    fn test_entity_body_particle_count() {
        // Verify particle count matches for various inputs
        let body8 = EntityBody::new_rect(200.0, 100.0, 8);
        assert_eq!(body8.particles.len(), 8);

        let body16 = EntityBody::new_rect(50.0, 30.0, 16);
        assert_eq!(body16.particles.len(), 16);

        let body1 = EntityBody::new_rect(10.0, 10.0, 1);
        assert_eq!(body1.particles.len(), 1);
    }
}
